package server

import (
	"net/http"
	"os"
	"strconv"
)

func envBoolDefault(name string, fallback bool) bool {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	return value != "false"
}

func optionalQuery(r *http.Request, name string) *string {
	value := r.URL.Query().Get(name)
	if value == "" {
		return nil
	}
	return &value
}

func contextCacheKey(ctxName *string) string {
	if ctxName == nil {
		return "__default"
	}
	return *ctxName
}

func parseSinceMinutes(value string, max uint32) uint32 {
	if value == "" {
		return defaultLogSinceMin
	}
	parsed, err := strconv.ParseUint(value, 10, 32)
	if err != nil {
		return defaultLogSinceMin
	}
	return normalizeSinceMinutes(uint32(parsed), max)
}

func normalizeSinceMinutes(value, max uint32) uint32 {
	if value == 0 {
		value = defaultLogSinceMin
	}
	if value > max {
		return max
	}
	return value
}
