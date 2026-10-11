package api

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync/atomic"
	"testing"

	"aivory/server/internal/store"
)

func newChannelModelImportFixture(t *testing.T) *channelAdminFixture {
	t.Helper()
	fx := newChannelAdminFixture(t)
	d := Deps{DB: fx.db, Logger: log.New(io.Discard, "", 0)}
	fx.mux.handle(http.MethodGet, "/api/admin/channels/:id/models/discover", func(w http.ResponseWriter, r *http.Request) {
		discoverChannelModelsAdmin(d, w, r)
	})
	fx.mux.handle(http.MethodPost, "/api/admin/channels/:id/models/import", func(w http.ResponseWriter, r *http.Request) {
		importChannelModelsAdmin(d, w, r)
	})
	return &fx
}

func TestDiscoverChannelModelsPreviewsWithoutPersistingAndImportsSelection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"data": []map[string]string{
			{"id": "gpt-5"},
			{"id": "gpt-image-1"},
			{"id": "text-embedding-3-small"},
			{"id": "whisper-1"},
		}})
	}))
	defer server.Close()

	fx := newChannelModelImportFixture(t)
	channel, err := store.CreateChannel(t.Context(), fx.db, "Selective", "openai", "chat", server.URL+"/v1", "secret")
	if err != nil {
		t.Fatal(err)
	}

	previewRecorder := fx.request(t, http.MethodGet, "/api/admin/channels/"+channel.ID+"/models/discover", "")
	if previewRecorder.Code != http.StatusOK {
		t.Fatalf("preview status=%d body=%s", previewRecorder.Code, previewRecorder.Body.String())
	}
	var preview channelModelDiscoveryResponse
	if err := json.Unmarshal(previewRecorder.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.Discovered != 4 || preview.SkippedUnsupported != 1 || len(preview.Models) != 4 {
		t.Fatalf("preview=%+v", preview)
	}
	supported := map[string]bool{}
	for _, model := range preview.Models {
		supported[model.RequestID] = model.Supported
	}
	if !supported["gpt-5"] || !supported["gpt-image-1"] || !supported["text-embedding-3-small"] || supported["whisper-1"] {
		t.Fatalf("preview support flags=%+v", supported)
	}
	models, err := store.ListModels(t.Context(), fx.db, "", false)
	if err != nil || len(models) != 0 {
		t.Fatalf("preview persisted models=%+v err=%v", models, err)
	}

	importRecorder := fx.request(t, http.MethodPost, "/api/admin/channels/"+channel.ID+"/models/import", `{"request_ids":["gpt-5","gpt-image-1"]}`)
	if importRecorder.Code != http.StatusOK {
		t.Fatalf("import status=%d body=%s", importRecorder.Code, importRecorder.Body.String())
	}
	var result channelModelImportResponse
	if err := json.Unmarshal(importRecorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Created != 2 || result.SkippedExisting != 0 {
		t.Fatalf("result=%+v", result)
	}
	models, err = store.ListModels(t.Context(), fx.db, "", false)
	if err != nil || len(models) != 2 {
		t.Fatalf("selected models=%+v err=%v", models, err)
	}
	requestIDs := []string{models[0].RequestID, models[1].RequestID}
	sort.Strings(requestIDs)
	if strings.Join(requestIDs, ",") != "gpt-5,gpt-image-1" {
		t.Fatalf("request ids=%v", requestIDs)
	}
}

func TestDiscoverAPIMartChannelModelsIncludesSupportedImageAliases(t *testing.T) {
	fx := newChannelModelImportFixture(t)
	channel, err := store.CreateChannel(t.Context(), fx.db, "APIMart", "apimart", "", "https://api.apimart.ai/v1", "secret")
	if err != nil {
		t.Fatal(err)
	}

	recorder := fx.request(t, http.MethodGet, "/api/admin/channels/"+channel.ID+"/models/discover", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("preview status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var preview channelModelDiscoveryResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"gpt-image-2",
		"gpt-image-2-official",
		"gpt-image-2.5-flare",
		"gpt-image-2.5-sunburst",
		"gpt-image-2.5-ext",
	}
	if preview.Discovered != len(want) || len(preview.Models) != len(want) {
		t.Fatalf("preview=%+v", preview)
	}
	for i, model := range preview.Models {
		if model.RequestID != want[i] || model.Kind != "image" || !model.Supported {
			t.Fatalf("model[%d]=%+v", i, model)
		}
	}

	recorder = fx.request(t, http.MethodPost, "/api/admin/channels/"+channel.ID+"/models/import", `{"request_ids":["gpt-image-2.5-flare","gpt-image-2.5-ext"]}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("import status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	models, err := store.ListModels(t.Context(), fx.db, "image", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 || models[0].Kind != "image" || models[1].Kind != "image" {
		t.Fatalf("imported models=%+v", models)
	}
}

func importChannelModelsRequest(t *testing.T, fx *channelAdminFixture, channelID string) (*httptest.ResponseRecorder, channelModelImportResponse) {
	t.Helper()
	recorder := fx.request(t, http.MethodPost, "/api/admin/channels/"+channelID+"/models/import", "")
	var result channelModelImportResponse
	if recorder.Code == http.StatusOK {
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Fatalf("decode import result: %v, body=%s", err, recorder.Body.String())
		}
	}
	return recorder, result
}

func TestImportOpenAIChannelModelsClassifiesAndSkipsDuplicates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/models" {
			t.Errorf("request = %s %s", r.Method, r.URL.String())
		}
		if got := r.Header.Get("Authorization"); got != "Bearer openai-secret" {
			t.Errorf("authorization = %q", got)
		}
		if got := r.Header.Get("Accept"); got != "application/json" {
			t.Errorf("accept = %q", got)
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": []map[string]string{
			{"id": "gpt-5"},
			{"id": "text-embedding-3-small"},
			{"id": "gpt-image-1"},
			{"id": "whisper-1"},
			{"id": " GPT-5 "},
		}})
	}))
	defer server.Close()

	fx := newChannelModelImportFixture(t)
	channel, err := store.CreateChannel(t.Context(), fx.db, "OpenAI", "openai", "responses", server.URL+"/v1", "openai-secret")
	if err != nil {
		t.Fatal(err)
	}

	recorder, result := importChannelModelsRequest(t, fx, channel.ID)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if result.Discovered != 4 || result.Created != 3 || result.SkippedExisting != 0 || result.SkippedUnsupported != 1 {
		t.Fatalf("first import = %+v", result)
	}
	if contains := recorder.Body.String(); contains == "" || json.Valid([]byte(contains)) == false {
		t.Fatalf("invalid response body: %q", contains)
	}
	if got := recorder.Body.String(); strings.Contains(got, "openai-secret") {
		t.Fatalf("API key leaked in response: %s", got)
	}

	models, err := store.ListModels(t.Context(), fx.db, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 3 {
		t.Fatalf("models = %+v", models)
	}
	kinds := map[string]string{}
	for _, model := range models {
		kinds[model.RequestID] = model.Kind
		if !model.Enabled || !model.Vision || !model.Stream || model.ToolMode != "native" || model.Currency != "USD" {
			t.Errorf("unexpected defaults for %s: %+v", model.RequestID, model)
		}
		if model.Kind == "chat" {
			tools, parseErr := store.ParseOfficialTools(model.OfficialTools)
			if parseErr != nil || len(tools) != 3 {
				t.Errorf("responses tools for %s = %+v, err=%v", model.RequestID, tools, parseErr)
			}
		}
	}
	if kinds["gpt-5"] != "chat" || kinds["text-embedding-3-small"] != "embedding" || kinds["gpt-image-1"] != "image" {
		t.Fatalf("model kinds = %+v", kinds)
	}

	recorder, result = importChannelModelsRequest(t, fx, channel.ID)
	if recorder.Code != http.StatusOK || result.Created != 0 || result.SkippedExisting != 3 || result.SkippedUnsupported != 1 {
		t.Fatalf("second import status=%d result=%+v body=%s", recorder.Code, result, recorder.Body.String())
	}
}

func TestImportAnthropicChannelModelsUsesHeadersAndPagination(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/v1/models" || r.URL.Query().Get("limit") != "1000" {
			t.Errorf("request URL = %s", r.URL.String())
		}
		if got := r.Header.Get("x-api-key"); got != "claude-secret" {
			t.Errorf("x-api-key = %q", got)
		}
		if got := r.Header.Get("anthropic-version"); got != "2023-06-01" {
			t.Errorf("anthropic-version = %q", got)
		}
		if r.URL.Query().Get("after_id") == "" {
			writeJSON(w, http.StatusOK, map[string]any{
				"data":     []map[string]string{{"id": "claude-opus-4-1", "display_name": "Claude Opus 4.1"}},
				"has_more": true,
				"last_id":  "claude-opus-4-1",
			})
			return
		}
		if got := r.URL.Query().Get("after_id"); got != "claude-opus-4-1" {
			t.Errorf("after_id = %q", got)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"data":     []map[string]string{{"id": "claude-sonnet-4-5", "display_name": "Claude Sonnet 4.5"}},
			"has_more": false,
		})
	}))
	defer server.Close()

	fx := newChannelModelImportFixture(t)
	channel, err := store.CreateChannel(t.Context(), fx.db, "Claude", "claude", "", server.URL, "claude-secret")
	if err != nil {
		t.Fatal(err)
	}
	recorder, result := importChannelModelsRequest(t, fx, channel.ID)
	if recorder.Code != http.StatusOK || result.Discovered != 2 || result.Created != 2 || result.SkippedUnsupported != 0 {
		t.Fatalf("status=%d result=%+v body=%s", recorder.Code, result, recorder.Body.String())
	}
	if requests.Load() != 2 {
		t.Fatalf("requests=%d", requests.Load())
	}
	models, err := store.ListModels(t.Context(), fx.db, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 {
		t.Fatalf("models=%+v", models)
	}
	labels := []string{models[0].Label, models[1].Label}
	sort.Strings(labels)
	if labels[0] != "Claude Opus 4.1" || labels[1] != "Claude Sonnet 4.5" {
		t.Fatalf("labels=%v", labels)
	}
}

func TestImportGeminiChannelModelsUsesHeaderPaginationAndCapabilities(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/v1beta/models" || r.URL.Query().Get("pageSize") != "1000" {
			t.Errorf("request URL = %s", r.URL.String())
		}
		if r.URL.Query().Get("key") != "" {
			t.Error("Gemini key must not be sent in the query string")
		}
		if got := r.Header.Get("x-goog-api-key"); got != "gemini-secret" {
			t.Errorf("x-goog-api-key = %q", got)
		}
		if r.URL.Query().Get("pageToken") == "" {
			writeJSON(w, http.StatusOK, map[string]any{
				"models": []map[string]any{
					{"name": "models/gemini-2.5-flash", "displayName": "Gemini 2.5 Flash", "description": "Fast", "supportedGenerationMethods": []string{"generateContent"}},
					{"name": "models/gemini-2.5-flash-image", "displayName": "Gemini Image", "supportedGenerationMethods": []string{"generateContent"}},
					{"name": "models/text-embedding-004", "supportedGenerationMethods": []string{"embedContent"}},
					{"name": "models/gemini-2.5-flash-preview-tts", "supportedGenerationMethods": []string{"generateContent"}},
				},
				"nextPageToken": "next page",
			})
			return
		}
		if got := r.URL.Query().Get("pageToken"); got != "next page" {
			t.Errorf("pageToken = %q", got)
		}
		writeJSON(w, http.StatusOK, map[string]any{"models": []map[string]any{
			{"name": "models/gemini-2.5-flash", "supportedGenerationMethods": []string{"generateContent"}},
			{"name": "models/gemini-pro-vision", "displayName": "Gemini Pro Vision", "supportedGenerationMethods": []string{"generateContent"}},
		}})
	}))
	defer server.Close()

	fx := newChannelModelImportFixture(t)
	channel, err := store.CreateChannel(t.Context(), fx.db, "Gemini", "gemini", "", server.URL, "gemini-secret")
	if err != nil {
		t.Fatal(err)
	}
	recorder, result := importChannelModelsRequest(t, fx, channel.ID)
	if recorder.Code != http.StatusOK || result.Discovered != 5 || result.Created != 3 || result.SkippedUnsupported != 2 {
		t.Fatalf("status=%d result=%+v body=%s", recorder.Code, result, recorder.Body.String())
	}
	if requests.Load() != 2 {
		t.Fatalf("requests=%d", requests.Load())
	}
	models, err := store.ListModels(t.Context(), fx.db, "", false)
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]string{}
	for _, model := range models {
		kinds[model.RequestID] = model.Kind
	}
	if kinds["gemini-2.5-flash"] != "chat" || kinds["gemini-2.5-flash-image"] != "image" || kinds["gemini-pro-vision"] != "chat" {
		t.Fatalf("model kinds=%+v", kinds)
	}
	if _, imported := kinds["text-embedding-004"]; imported {
		t.Fatalf("Gemini embedContent-only model was imported: %+v", kinds)
	}
}

func TestChannelModelDiscoveryRejectsCrossOriginRedirectWithoutLeakingKey(t *testing.T) {
	var redirectedRequests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		redirectedRequests.Add(1)
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("redirect leaked authorization: %q", got)
		}
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", target.URL+"/models")
		w.WriteHeader(http.StatusTemporaryRedirect)
	}))
	defer source.Close()

	fx := newChannelModelImportFixture(t)
	channel, err := store.CreateChannel(t.Context(), fx.db, "Redirect", "openai", "chat", source.URL+"/v1", "redirect-secret")
	if err != nil {
		t.Fatal(err)
	}
	recorder, _ := importChannelModelsRequest(t, fx, channel.ID)
	if recorder.Code != http.StatusBadGateway || recorder.Body.String() != "{\"error\":\"channel_model_discovery_failed\"}\n" {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if redirectedRequests.Load() != 0 {
		t.Fatalf("redirect target received %d requests", redirectedRequests.Load())
	}
	if strings.Contains(recorder.Body.String(), "redirect-secret") {
		t.Fatalf("API key leaked in response: %s", recorder.Body.String())
	}
}
