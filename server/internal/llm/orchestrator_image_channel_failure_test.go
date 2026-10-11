package llm

import (
	"context"
	"strings"
	"testing"

	"aivory/server/internal/store"
)

func TestProviderConfigurationFailurePersistsFailedTurn(t *testing.T) {
	orchestrator, _, _, conversation, _, db := setupToolRouteTest(t)
	channel, err := store.CreateChannel(context.Background(), db, "Broken provider", "missing-provider", "chat", "https://example.invalid", "key")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	model, err := store.CreateModel(context.Background(), db, store.Model{
		ChannelID: channel.ID,
		Kind:      "chat",
		RequestID: "broken-provider-model",
		Label:     "Broken provider model",
		Enabled:   true,
	})
	if err != nil {
		t.Fatalf("create model: %v", err)
	}

	var events []SseEvent
	_, runErr := orchestrator.Run(context.Background(), RunRequest{
		UserID:         "u1",
		ConversationID: conversation.ID,
		ModelID:        model.ID,
		UserText:       "generate a product poster",
	}, func(event SseEvent) {
		events = append(events, event)
	})
	if runErr == nil {
		t.Fatal("Run error = nil, want provider configuration error")
	}

	messages, err := store.ListAllMessages(context.Background(), db, conversation.ID)
	if err != nil {
		t.Fatalf("list messages: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("persisted messages = %d, want user + failed assistant", len(messages))
	}
	if messages[0].Role != "user" || !strings.Contains(string(messages[0].Blocks), "generate a product poster") {
		t.Fatalf("user message = %+v", messages[0])
	}
	if messages[1].Role != "assistant" || messages[1].Status != "error" || strings.TrimSpace(messages[1].Error) == "" {
		t.Fatalf("assistant failure = %+v", messages[1])
	}
	if len(events) == 0 || events[0].Type != "message_start" || events[0].MessageID != messages[1].ID {
		t.Fatalf("events = %+v, want message_start for persisted assistant", events)
	}
}
