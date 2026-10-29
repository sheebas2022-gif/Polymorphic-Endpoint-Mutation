package crypto

import "testing"

func TestSharedVector(t *testing.T) {
	if got := Token([]byte("0123456789abcdef0123456789abcdef"), 28333333); got != "6f12b8ed" {
		t.Fatalf("cross-language vector: got %s", got)
	}
}
