package httpapi

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"family-budget/backend/internal/config"
	"family-budget/backend/internal/models"
	"family-budget/backend/internal/storage"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type ctxKey string

const userKey ctxKey = "user"
const csrfKey ctxKey = "csrf"
const sessionCookie = "fb_session"

type Server struct {
	repo    *storage.Repository
	cfg     config.Config
	logger  *slog.Logger
	limiter struct {
		mu       sync.Mutex
		attempts map[string][]time.Time
	}
}

type errorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func NewServer(repo *storage.Repository, cfg config.Config, logger *slog.Logger) *Server {
	s := &Server{repo: repo, cfg: cfg, logger: logger}
	s.limiter.attempts = map[string][]time.Time{}
	return s
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer, s.securityHeaders, s.cors)
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	api := chi.NewRouter()
	api.Get("/setup/status", s.setupStatus)
	api.Post("/setup", s.setup)
	api.Get("/auth/profiles", s.profiles)
	api.Post("/auth/login", s.login)
	api.Post("/auth/logout", s.logout)
	api.Group(func(protected chi.Router) {
		protected.Use(s.requireAuth)
		protected.Get("/auth/me", s.me)
		protected.Get("/categories", s.categories)
		protected.Get("/transactions", s.transactions)
		protected.Get("/transactions/comment-suggestions", s.commentSuggestions)
		protected.Get("/transactions/{id}", s.transaction)
		protected.Get("/analytics/summary", s.summary)
		protected.Get("/analytics/categories", s.categoryAnalytics)
		protected.Get("/analytics/timeline", s.timeline)
		protected.Get("/analytics/monthly", s.monthlyTimeline)
		protected.Get("/analytics/comparison", s.comparison)
		protected.Get("/budgets", s.budget)
		protected.Get("/goals", s.goals)
		protected.Get("/recurring-payments", s.recurringPayments)
		protected.Get("/export", s.exportData)
		protected.Get("/backup", s.backupData)

		protected.Group(func(mutating chi.Router) {
			mutating.Use(s.requireCSRF)
			mutating.Post("/categories", s.createCategory)
			mutating.Patch("/categories/{id}", s.updateCategory)
			mutating.Delete("/categories/{id}", s.deleteCategory)
			mutating.Post("/transactions", s.createTransaction)
			mutating.Patch("/transactions/{id}", s.updateTransaction)
			mutating.Delete("/transactions/{id}", s.deleteTransaction)
			mutating.Put("/budgets/{year}/{month}", s.setBudget)
			mutating.Post("/goals", s.createGoal)
			mutating.Patch("/goals/{id}", s.updateGoal)
			mutating.Post("/goals/{id}/deposit", s.depositGoal)
			mutating.Delete("/goals/{id}", s.deleteGoal)
			mutating.Post("/recurring-payments", s.createRecurringPayment)
			mutating.Patch("/recurring-payments/{id}", s.updateRecurringPayment)
			mutating.Delete("/recurring-payments/{id}", s.deleteRecurringPayment)
			mutating.Post("/recurring-payments/{id}/pay", s.payRecurringPayment)
			mutating.Post("/import", s.importData)
		})
	})
	r.Mount("/api/v1", api)
	r.NotFound(s.frontend)
	r.Get("/*", s.frontend)
	return r
}

func (s *Server) setupStatus(w http.ResponseWriter, r *http.Request) {
	setup, count, err := s.repo.IsSetup(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"is_setup": setup, "profiles_count": count})
}

func (s *Server) setup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Profiles []storage.SetupProfile `json:"profiles"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.Profiles) != 2 {
		writeError(w, http.StatusBadRequest, "validation_error", "Нужно создать ровно два профиля")
		return
	}
	for _, p := range req.Profiles {
		if len(strings.TrimSpace(p.Name)) < 1 || len(strings.TrimSpace(p.Name)) > 80 || len(p.PIN) < 4 || len(p.PIN) > 12 {
			writeError(w, http.StatusBadRequest, "validation_error", "Имя и PIN заполнены некорректно")
			return
		}
	}
	users, err := s.repo.Setup(r.Context(), req.Profiles)
	if errors.Is(err, storage.ErrAlreadySetup) {
		writeError(w, http.StatusConflict, "already_setup", "Первичная настройка уже выполнена")
		return
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"users": users})
}

func (s *Server) profiles(w http.ResponseWriter, r *http.Request) {
	users, err := s.repo.Users(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if !s.allowLogin(r.RemoteAddr) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Слишком много попыток входа")
		return
	}
	var req struct {
		UserID int64  `json:"user_id"`
		PIN    string `json:"pin"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	user, token, csrf, err := s.repo.Login(r.Context(), req.UserID, req.PIN)
	if errors.Is(err, storage.ErrUnauthorized) {
		writeError(w, http.StatusUnauthorized, "invalid_pin", "Неверный PIN")
		return
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.cfg.CookieSecure,
		MaxAge:   30 * 24 * 60 * 60,
	})
	writeJSON(w, http.StatusOK, map[string]any{"user": user, "csrf_token": csrf})
}

func (s *Server) allowLogin(remoteAddr string) bool {
	ip := strings.Split(remoteAddr, ":")[0]
	now := time.Now()
	windowStart := now.Add(-5 * time.Minute)
	s.limiter.mu.Lock()
	defer s.limiter.mu.Unlock()
	attempts := s.limiter.attempts[ip]
	fresh := attempts[:0]
	for _, attempt := range attempts {
		if attempt.After(windowStart) {
			fresh = append(fresh, attempt)
		}
	}
	if len(fresh) >= 10 {
		s.limiter.attempts[ip] = fresh
		return false
	}
	s.limiter.attempts[ip] = append(fresh, now)
	return true
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		_ = s.repo.Logout(r.Context(), cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: s.cfg.CookieSecure, MaxAge: -1})
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"user": userFrom(r.Context()), "csrf_token": r.Context().Value(csrfKey)})
}

func (s *Server) categories(w http.ResponseWriter, r *http.Request) {
	includeInactive := r.URL.Query().Get("include_inactive") == "true"
	list, err := s.repo.Categories(r.Context(), includeInactive, r.URL.Query().Get("kind"))
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"categories": list})
}

func (s *Server) createCategory(w http.ResponseWriter, r *http.Request) {
	var c models.Category
	if !decodeJSON(w, r, &c) || !validCategory(w, c) {
		return
	}
	created, err := s.repo.CreateCategory(r.Context(), c)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) updateCategory(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var c models.Category
	if !decodeJSON(w, r, &c) || !validCategory(w, c) {
		return
	}
	updated, err := s.repo.UpdateCategory(r.Context(), id, c)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) deleteCategory(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	err := s.repo.DeleteCategory(r.Context(), id)
	if errors.Is(err, storage.ErrCategoryInUse) {
		writeError(w, http.StatusConflict, "category_in_use", "Категория уже используется. Ее можно скрыть, но не удалить")
		return
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) transactions(w http.ResponseWriter, r *http.Request) {
	year, month := monthParams(r, s.cfg.Location)
	categoryID, _ := strconv.ParseInt(r.URL.Query().Get("category_id"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	list, err := s.repo.Transactions(r.Context(), storage.TransactionFilters{
		Year: year, Month: month, CategoryID: categoryID, Type: r.URL.Query().Get("type"),
		Essential: r.URL.Query().Get("essential"), Query: r.URL.Query().Get("q"), Limit: limit, Offset: offset,
	})
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transactions": list})
}

func (s *Server) commentSuggestions(w http.ResponseWriter, r *http.Request) {
	categoryID, _ := strconv.ParseInt(r.URL.Query().Get("category_id"), 10, 64)
	if categoryID <= 0 {
		writeJSON(w, http.StatusOK, map[string]any{"suggestions": []string{}})
		return
	}
	list, err := s.repo.CommentSuggestions(r.Context(), categoryID)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"suggestions": list})
}

func (s *Server) transaction(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	t, err := s.repo.Transaction(r.Context(), id)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) createTransaction(w http.ResponseWriter, r *http.Request) {
	input, ok := s.transactionInput(w, r)
	if !ok {
		return
	}
	input.CreatedBy = userFrom(r.Context()).ID
	input.IdempotencyKey = r.Header.Get("Idempotency-Key")
	t, err := s.repo.CreateTransaction(r.Context(), input)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (s *Server) updateTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	input, ok := s.transactionInput(w, r)
	if !ok {
		return
	}
	t, err := s.repo.UpdateTransaction(r.Context(), id, input)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) deleteTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	if err := s.repo.DeleteTransaction(r.Context(), id); err != nil {
		s.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) summary(w http.ResponseWriter, r *http.Request) {
	year, month := monthParams(r, s.cfg.Location)
	data, err := s.repo.Summary(r.Context(), year, month)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, data)
}

func (s *Server) categoryAnalytics(w http.ResponseWriter, r *http.Request) {
	year, month := monthParams(r, s.cfg.Location)
	data, err := s.repo.CategoryAnalytics(r.Context(), year, month, r.URL.Query().Get("essential"))
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": data})
}

func (s *Server) timeline(w http.ResponseWriter, r *http.Request) {
	year, month := monthParams(r, s.cfg.Location)
	data, err := s.repo.Timeline(r.Context(), year, month, r.URL.Query().Get("essential"))
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": data})
}

func (s *Server) monthlyTimeline(w http.ResponseWriter, r *http.Request) {
	now := time.Now().In(s.cfg.Location)
	year, _ := strconv.Atoi(r.URL.Query().Get("year"))
	if year == 0 {
		year = now.Year()
	}
	data, err := s.repo.MonthlyTimeline(r.Context(), year, r.URL.Query().Get("essential"))
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": data})
}

func (s *Server) comparison(w http.ResponseWriter, r *http.Request) {
	now := time.Now().In(s.cfg.Location)
	current, err := s.repo.Summary(r.Context(), now.Year(), int(now.Month()))
	if err != nil {
		s.fail(w, err)
		return
	}
	prev := now.AddDate(0, -1, 0)
	previous, err := s.repo.Summary(r.Context(), prev.Year(), int(prev.Month()))
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"current": current, "previous": previous})
}

func (s *Server) budget(w http.ResponseWriter, r *http.Request) {
	year, month := monthParams(r, s.cfg.Location)
	budget, err := s.repo.Budget(r.Context(), year, month)
	if errors.Is(err, storage.ErrNotFound) {
		writeJSON(w, http.StatusOK, models.MonthlyBudget{Year: year, Month: month})
		return
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, budget)
}

func (s *Server) setBudget(w http.ResponseWriter, r *http.Request) {
	year, _ := strconv.Atoi(chi.URLParam(r, "year"))
	month, _ := strconv.Atoi(chi.URLParam(r, "month"))
	var req struct {
		AmountCents int64 `json:"amount_cents"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if year < 2000 || month < 1 || month > 12 || req.AmountCents < 0 {
		writeError(w, http.StatusBadRequest, "validation_error", "Некорректный бюджет")
		return
	}
	b, err := s.repo.SetBudget(r.Context(), year, month, req.AmountCents)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, b)
}

func (s *Server) goals(w http.ResponseWriter, r *http.Request) {
	list, err := s.repo.Goals(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"goals": list})
}

func (s *Server) createGoal(w http.ResponseWriter, r *http.Request) {
	var g models.SavingGoal
	if !decodeJSON(w, r, &g) || !validGoal(w, g) {
		return
	}
	g.ID = 0
	saved, err := s.repo.SaveGoal(r.Context(), g)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (s *Server) updateGoal(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var g models.SavingGoal
	if !decodeJSON(w, r, &g) || !validGoal(w, g) {
		return
	}
	g.ID = id
	saved, err := s.repo.SaveGoal(r.Context(), g)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) depositGoal(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var req struct {
		AmountCents int64 `json:"amount_cents"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.AmountCents <= 0 {
		writeError(w, http.StatusBadRequest, "validation_error", "Сумма пополнения должна быть больше нуля")
		return
	}
	g, err := s.repo.DepositGoal(r.Context(), id, req.AmountCents)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, g)
}

func (s *Server) deleteGoal(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	if err := s.repo.DeleteGoal(r.Context(), id); err != nil {
		s.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) recurringPayments(w http.ResponseWriter, r *http.Request) {
	list, err := s.repo.RecurringPayments(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"recurring_payments": list})
}

func (s *Server) createRecurringPayment(w http.ResponseWriter, r *http.Request) {
	var p models.RecurringPayment
	if !decodeJSON(w, r, &p) || !validRecurring(w, p) {
		return
	}
	p.ID = 0
	saved, err := s.repo.SaveRecurringPayment(r.Context(), p)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (s *Server) updateRecurringPayment(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var p models.RecurringPayment
	if !decodeJSON(w, r, &p) || !validRecurring(w, p) {
		return
	}
	p.ID = id
	saved, err := s.repo.SaveRecurringPayment(r.Context(), p)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) deleteRecurringPayment(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	if err := s.repo.DeleteRecurringPayment(r.Context(), id); err != nil {
		s.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) payRecurringPayment(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	t, err := s.repo.PayRecurringPayment(r.Context(), id, userFrom(r.Context()).ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (s *Server) exportData(w http.ResponseWriter, r *http.Request) {
	list, err := s.repo.ExportTransactions(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	if r.URL.Query().Get("format") == "json" {
		writeJSON(w, http.StatusOK, map[string]any{"transactions": list})
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="family-budget.csv"`)
	_, _ = w.Write([]byte{0xEF, 0xBB, 0xBF})
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"дата", "тип", "сумма", "категория", "комментарий", "автор"})
	for _, t := range list {
		_ = writer.Write([]string{
			t.TransactionDate.In(s.cfg.Location).Format("2006-01-02 15:04"),
			t.Type,
			fmt.Sprintf("%d.%02d", t.AmountCents/100, t.AmountCents%100),
			t.CategoryName,
			t.Comment,
			t.AuthorName,
		})
	}
	writer.Flush()
}

func (s *Server) backupData(w http.ResponseWriter, r *http.Request) {
	data, err := s.repo.Backup(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	filename := fmt.Sprintf("family-budget-backup-%s.json", time.Now().In(s.cfg.Location).Format("20060102-150405"))
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(data)
}

func (s *Server) importData(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Transactions []storage.TransactionInput `json:"transactions"`
		DryRun       bool                       `json:"dry_run"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	errorsByRow := []map[string]any{}
	for i, item := range req.Transactions {
		if err := validateTransaction(item); err != nil {
			errorsByRow = append(errorsByRow, map[string]any{"row": i + 1, "message": err.Error()})
		}
	}
	if req.DryRun || len(errorsByRow) > 0 {
		writeJSON(w, http.StatusOK, map[string]any{"valid": len(errorsByRow) == 0, "errors": errorsByRow, "rows": len(req.Transactions)})
		return
	}
	created := 0
	for i := range req.Transactions {
		req.Transactions[i].CreatedBy = userFrom(r.Context()).ID
		req.Transactions[i].IdempotencyKey = fmt.Sprintf("import:%d:%d", userFrom(r.Context()).ID, time.Now().UnixNano()+int64(i))
		if _, err := s.repo.CreateTransaction(r.Context(), req.Transactions[i]); err == nil {
			created++
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{"created": created})
}

func (s *Server) transactionInput(w http.ResponseWriter, r *http.Request) (storage.TransactionInput, bool) {
	var input storage.TransactionInput
	if !decodeJSON(w, r, &input) {
		return input, false
	}
	if err := validateTransaction(input); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", err.Error())
		return input, false
	}
	return input, true
}

func validateTransaction(input storage.TransactionInput) error {
	if input.Type != "expense" && input.Type != "income" {
		return errors.New("Тип должен быть расходом или доходом")
	}
	if input.AmountCents <= 0 {
		return errors.New("Сумма должна быть больше нуля")
	}
	if input.CategoryID <= 0 {
		return errors.New("Выберите категорию")
	}
	if len(input.Comment) > 240 {
		return errors.New("Комментарий слишком длинный")
	}
	return nil
}

func validCategory(w http.ResponseWriter, c models.Category) bool {
	if len(strings.TrimSpace(c.Name)) < 1 || len(strings.TrimSpace(c.Name)) > 80 || c.Icon == "" || c.Color == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "Категория заполнена некорректно")
		return false
	}
	if c.Kind != "" && c.Kind != "expense" && c.Kind != "income" {
		writeError(w, http.StatusBadRequest, "validation_error", "Тип категории должен быть расходом или доходом")
		return false
	}
	return true
}

func validGoal(w http.ResponseWriter, g models.SavingGoal) bool {
	if len(strings.TrimSpace(g.Name)) < 1 || len(strings.TrimSpace(g.Name)) > 80 || g.TargetAmountCents <= 0 || g.CurrentAmountCents < 0 {
		writeError(w, http.StatusBadRequest, "validation_error", "Цель заполнена некорректно")
		return false
	}
	if g.Icon == "" {
		g.Icon = "PiggyBank"
	}
	if g.Color == "" {
		g.Color = "#38bdf8"
	}
	return true
}

func validRecurring(w http.ResponseWriter, p models.RecurringPayment) bool {
	if len(strings.TrimSpace(p.Name)) < 1 || len(strings.TrimSpace(p.Name)) > 80 || p.AmountCents <= 0 || p.CategoryID <= 0 || p.DayOfMonth < 1 || p.DayOfMonth > 31 {
		writeError(w, http.StatusBadRequest, "validation_error", "Регулярный платеж заполнен некорректно")
		return false
	}
	return true
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookie)
		if err != nil || cookie.Value == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized", "Нужно войти")
			return
		}
		user, csrf, err := s.repo.Session(r.Context(), cookie.Value)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "Сессия истекла")
			return
		}
		ctx := context.WithValue(r.Context(), userKey, user)
		ctx = context.WithValue(ctx, csrfKey, csrf)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) requireCSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		want, _ := r.Context().Value(csrfKey).(string)
		if want == "" || r.Header.Get("X-CSRF-Token") != want {
			writeError(w, http.StatusForbidden, "csrf_failed", "Не удалось подтвердить запрос")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		for _, allowed := range s.cfg.CORSOrigins {
			if origin == allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, Idempotency-Key")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
				break
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) frontend(w http.ResponseWriter, r *http.Request) {
	path := filepath.Join("web", "dist", filepath.Clean(r.URL.Path))
	if r.URL.Path == "/" {
		path = filepath.Join("web", "dist", "index.html")
	}
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		http.ServeFile(w, r, path)
		return
	}
	index := filepath.Join("web", "dist", "index.html")
	if _, err := os.Stat(index); err == nil {
		http.ServeFile(w, r, index)
		return
	}
	writeError(w, http.StatusNotFound, "frontend_not_built", "Frontend еще не собран")
}

func (s *Server) fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storage.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Запись не найдена")
	case errors.Is(err, storage.ErrIdempotentMiss):
		writeError(w, http.StatusBadRequest, "idempotency_required", "Нужен Idempotency-Key")
	default:
		s.logger.Error("request failed", slog.String("error", err.Error()))
		writeError(w, http.StatusInternalServerError, "internal_error", "Что-то пошло не так")
	}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Некорректный JSON")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	var resp errorResponse
	resp.Error.Code = code
	resp.Error.Message = message
	writeJSON(w, status, resp)
}

func parseID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "bad_id", "Некорректный идентификатор")
		return 0, false
	}
	return id, true
}

func monthParams(r *http.Request, loc *time.Location) (int, int) {
	now := time.Now().In(loc)
	year, _ := strconv.Atoi(r.URL.Query().Get("year"))
	month, _ := strconv.Atoi(r.URL.Query().Get("month"))
	if year == 0 {
		year = now.Year()
	}
	if month == 0 {
		month = int(now.Month())
	}
	return year, month
}

func userFrom(ctx context.Context) models.User {
	user, _ := ctx.Value(userKey).(models.User)
	return user
}
