package config

import (
	"log/slog"
	"os"
	"strings"
	"time"
)

type Config struct {
	AppEnv         string
	HTTPAddr       string
	DatabaseURL    string
	SessionSecret  string
	CookieSecure   bool
	Location       *time.Location
	EnableDemoData bool
	CORSOrigins    []string
}

func Load() Config {
	locName := env("APP_TIMEZONE", "Europe/Moscow")
	loc, err := time.LoadLocation(locName)
	if err != nil {
		loc = time.FixedZone("Europe/Moscow", 3*60*60)
	}
	return Config{
		AppEnv:         env("APP_ENV", "development"),
		HTTPAddr:       env("HTTP_ADDR", ":8080"),
		DatabaseURL:    env("DATABASE_URL", "postgres://family_budget:family_budget@localhost:5432/family_budget?sslmode=disable"),
		SessionSecret:  env("SESSION_SECRET", "local-development-secret-change-me"),
		CookieSecure:   envBool("COOKIE_SECURE", false),
		Location:       loc,
		EnableDemoData: envBool("ENABLE_DEMO_DATA", false),
		CORSOrigins:    splitOrigins(env("CORS_ORIGINS", "http://localhost:8080,http://localhost:5173")),
	}
}

func (c Config) LogLevel() slog.Level {
	if c.AppEnv == "development" {
		return slog.LevelDebug
	}
	return slog.LevelInfo
}

func env(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func envBool(key string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	return value == "1" || value == "true" || value == "yes"
}

func splitOrigins(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

