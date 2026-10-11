package llm

import (
	"errors"
	"testing"
)

func TestImageGenerationFailureTextExtractsStructuredProviderMessage(t *testing.T) {
	err := errors.New(`openai image 400: {"error":{"code":"bad_request","message":"请上传参考图"}}`)
	if got := imageGenerationFailureText(err); got != "请上传参考图" {
		t.Fatalf("failure text = %q, want provider message", got)
	}
}

func TestImageGenerationFailureTextDoesNotExposeUnstructuredDiagnostics(t *testing.T) {
	err := errors.New(`openai image 500: upstream unavailable (request_id=secret)`)
	if got := imageGenerationFailureText(err); got != "" {
		t.Fatalf("failure text = %q, want empty", got)
	}
}
