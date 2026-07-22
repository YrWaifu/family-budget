package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWriteErrorUsesStableEnvelope(t *testing.T) {
	rec := httptest.NewRecorder()
	writeError(rec, http.StatusBadRequest, "validation_error", "Ошибка")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d", rec.Code)
	}
	if got := rec.Body.String(); got != "{\"error\":{\"code\":\"validation_error\",\"message\":\"Ошибка\"}}\n" {
		t.Fatalf("unexpected body: %s", got)
	}
}

