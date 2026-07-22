package money

import "testing"

func TestParseToCents(t *testing.T) {
	tests := map[string]int64{
		"150":    15000,
		"150.5":  15050,
		"150.50": 15050,
		"150,50": 15050,
		"1 200":  120000,
	}
	for input, want := range tests {
		got, err := ParseToCents(input)
		if err != nil {
			t.Fatalf("ParseToCents(%q) returned error: %v", input, err)
		}
		if got != want {
			t.Fatalf("ParseToCents(%q)=%d, want %d", input, got, want)
		}
	}
}

func TestParseToCentsRejectsInvalidValues(t *testing.T) {
	for _, input := range []string{"", "0", "-1", "12.345", "abc"} {
		if _, err := ParseToCents(input); err == nil {
			t.Fatalf("ParseToCents(%q) expected error", input)
		}
	}
}

