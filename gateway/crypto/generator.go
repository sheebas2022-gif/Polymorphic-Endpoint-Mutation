package crypto

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
)

// Token uses the UTF-8 decimal interval, not a binary TOTP counter.
// Eight hexadecimal characters match the blueprint (32 bits).
func Token(seed []byte, interval int64) string {
	mac := hmac.New(sha256.New, seed)
	mac.Write([]byte(strconv.FormatInt(interval, 10)))
	return hex.EncodeToString(mac.Sum(nil))[:8]
}
