package storage

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"family-budget/backend/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrConflict       = errors.New("conflict")
	ErrUnauthorized   = errors.New("unauthorized")
	ErrAlreadySetup   = errors.New("already setup")
	ErrCategoryInUse  = errors.New("category in use")
	ErrIdempotentMiss = errors.New("idempotency key required")
)

type Repository struct {
	db  *pgxpool.Pool
	loc *time.Location
}

type SetupProfile struct {
	Name string `json:"name"`
	PIN  string `json:"pin"`
}

type TransactionInput struct {
	Type            string     `json:"type"`
	AmountCents     int64      `json:"amount_cents"`
	CategoryID      int64      `json:"category_id"`
	IsEssential     *bool      `json:"is_essential"`
	Comment         string     `json:"comment"`
	TransactionDate *time.Time `json:"transaction_date"`
	CreatedBy       int64      `json:"-"`
	IdempotencyKey  string     `json:"-"`
}

type TransactionFilters struct {
	Year       int
	Month      int
	CategoryID int64
	Type       string
	Essential  string
	Query      string
	Limit      int
	Offset     int
}

func Open(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 12
	cfg.MinConns = 1
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err = db.Ping(pingCtx); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func New(db *pgxpool.Pool, loc *time.Location) *Repository {
	return &Repository{db: db, loc: loc}
}

func (r *Repository) IsSetup(ctx context.Context) (bool, int, error) {
	var count int
	if err := r.db.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&count); err != nil {
		return false, 0, err
	}
	return count >= 2, count, nil
}

func (r *Repository) Setup(ctx context.Context, profiles []SetupProfile) ([]models.User, error) {
	if len(profiles) != 2 {
		return nil, fmt.Errorf("exactly two profiles required")
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&count); err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, ErrAlreadySetup
	}
	users := make([]models.User, 0, 2)
	for _, profile := range profiles {
		hash, err := bcrypt.GenerateFromPassword([]byte(profile.PIN), bcrypt.DefaultCost)
		if err != nil {
			return nil, err
		}
		var user models.User
		err = tx.QueryRow(ctx, `INSERT INTO users(name, pin_hash) VALUES($1, $2) RETURNING id, name, created_at, updated_at`,
			strings.TrimSpace(profile.Name), string(hash)).Scan(&user.ID, &user.Name, &user.CreatedAt, &user.UpdatedAt)
		if err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, tx.Commit(ctx)
}

func (r *Repository) Users(ctx context.Context) ([]models.User, error) {
	rows, err := r.db.Query(ctx, `SELECT id, name, created_at, updated_at FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []models.User
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Name, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (r *Repository) Login(ctx context.Context, userID int64, pin string) (models.User, string, string, error) {
	var user models.User
	var pinHash string
	err := r.db.QueryRow(ctx, `SELECT id, name, pin_hash, created_at, updated_at FROM users WHERE id=$1`, userID).
		Scan(&user.ID, &user.Name, &pinHash, &user.CreatedAt, &user.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return user, "", "", ErrUnauthorized
	}
	if err != nil {
		return user, "", "", err
	}
	if err = bcrypt.CompareHashAndPassword([]byte(pinHash), []byte(pin)); err != nil {
		return user, "", "", ErrUnauthorized
	}
	token, err := randomToken(32)
	if err != nil {
		return user, "", "", err
	}
	csrf, err := randomToken(32)
	if err != nil {
		return user, "", "", err
	}
	_, err = r.db.Exec(ctx, `INSERT INTO sessions(token_hash, user_id, csrf_token, expires_at) VALUES($1, $2, $3, $4)`,
		hashToken(token), user.ID, csrf, time.Now().Add(30*24*time.Hour))
	return user, token, csrf, err
}

func (r *Repository) Session(ctx context.Context, token string) (models.User, string, error) {
	var user models.User
	var csrf string
	err := r.db.QueryRow(ctx, `SELECT u.id, u.name, u.created_at, u.updated_at, s.csrf_token
		FROM sessions s JOIN users u ON u.id=s.user_id
		WHERE s.token_hash=$1 AND s.expires_at > now()`, hashToken(token)).
		Scan(&user.ID, &user.Name, &user.CreatedAt, &user.UpdatedAt, &csrf)
	if errors.Is(err, pgx.ErrNoRows) {
		return user, "", ErrUnauthorized
	}
	return user, csrf, err
}

func (r *Repository) Logout(ctx context.Context, token string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM sessions WHERE token_hash=$1`, hashToken(token))
	return err
}

func (r *Repository) Categories(ctx context.Context, includeInactive bool, kind string) ([]models.Category, error) {
	query := `SELECT id, name, icon, color, kind, sort_order, is_active, is_essential, created_at, updated_at FROM categories`
	clauses := []string{}
	args := []any{}
	if !includeInactive {
		clauses = append(clauses, "is_active=true")
	}
	if kind == "expense" || kind == "income" {
		args = append(args, kind)
		clauses = append(clauses, fmt.Sprintf("kind=$%d", len(args)))
	}
	if len(clauses) > 0 {
		query += ` WHERE ` + strings.Join(clauses, " AND ")
	}
	query += ` ORDER BY sort_order, id`
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []models.Category
	for rows.Next() {
		var c models.Category
		if err := rows.Scan(&c.ID, &c.Name, &c.Icon, &c.Color, &c.Kind, &c.SortOrder, &c.IsActive, &c.IsEssential, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, c)
	}
	return list, rows.Err()
}

func (r *Repository) CreateCategory(ctx context.Context, c models.Category) (models.Category, error) {
	if normalizeKind(c.Kind) == "income" {
		c.IsEssential = true
	}
	err := r.db.QueryRow(ctx, `INSERT INTO categories(name, icon, color, kind, sort_order, is_active, is_essential)
		VALUES($1,$2,$3,$4,$5,true,$6) RETURNING id, name, icon, color, kind, sort_order, is_active, is_essential, created_at, updated_at`,
		strings.TrimSpace(c.Name), c.Icon, c.Color, normalizeKind(c.Kind), c.SortOrder, c.IsEssential).
		Scan(&c.ID, &c.Name, &c.Icon, &c.Color, &c.Kind, &c.SortOrder, &c.IsActive, &c.IsEssential, &c.CreatedAt, &c.UpdatedAt)
	return c, err
}

func (r *Repository) UpdateCategory(ctx context.Context, id int64, c models.Category) (models.Category, error) {
	if normalizeKind(c.Kind) == "income" {
		c.IsEssential = true
	}
	err := r.db.QueryRow(ctx, `UPDATE categories SET name=$2, icon=$3, color=$4, kind=$5, sort_order=$6, is_active=$7, is_essential=$8, updated_at=now()
		WHERE id=$1 RETURNING id, name, icon, color, kind, sort_order, is_active, is_essential, created_at, updated_at`,
		id, strings.TrimSpace(c.Name), c.Icon, c.Color, normalizeKind(c.Kind), c.SortOrder, c.IsActive, c.IsEssential).
		Scan(&c.ID, &c.Name, &c.Icon, &c.Color, &c.Kind, &c.SortOrder, &c.IsActive, &c.IsEssential, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	return c, err
}

func (r *Repository) DeleteCategory(ctx context.Context, id int64) error {
	var used bool
	if err := r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM transactions WHERE category_id=$1)
		OR EXISTS(SELECT 1 FROM recurring_payments WHERE category_id=$1)`, id).Scan(&used); err != nil {
		return err
	}
	if used {
		return ErrCategoryInUse
	}
	tag, err := r.db.Exec(ctx, `DELETE FROM categories WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) CreateTransaction(ctx context.Context, in TransactionInput) (models.Transaction, error) {
	var t models.Transaction
	if strings.TrimSpace(in.IdempotencyKey) == "" {
		return t, ErrIdempotentMiss
	}
	isEssential := any(nil)
	if in.IsEssential != nil {
		isEssential = *in.IsEssential
	}
	date := time.Now().In(r.loc)
	if in.TransactionDate != nil {
		date = in.TransactionDate.In(r.loc)
	}
	err := r.db.QueryRow(ctx, `INSERT INTO transactions(type, amount_cents, category_id, is_essential, comment, transaction_date, created_by, idempotency_key)
		VALUES($1,$2,$3,COALESCE($4, (SELECT is_essential FROM categories WHERE id=$3)),$5,$6,$7,$8)
		ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
		RETURNING id`, in.Type, in.AmountCents, in.CategoryID, isEssential, strings.TrimSpace(in.Comment), date, in.CreatedBy, in.IdempotencyKey).Scan(&t.ID)
	if err != nil {
		return t, err
	}
	return r.Transaction(ctx, t.ID)
}

func (r *Repository) Transaction(ctx context.Context, id int64) (models.Transaction, error) {
	var t models.Transaction
	err := r.db.QueryRow(ctx, transactionSelect()+` WHERE t.id=$1`, id).Scan(scanTransaction(&t)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return t, ErrNotFound
	}
	return t, err
}

func (r *Repository) Transactions(ctx context.Context, f TransactionFilters) ([]models.Transaction, error) {
	args := []any{}
	clauses := []string{"1=1"}
	if f.Year > 0 && f.Month > 0 {
		start := time.Date(f.Year, time.Month(f.Month), 1, 0, 0, 0, 0, r.loc)
		end := start.AddDate(0, 1, 0)
		args = append(args, start, end)
		clauses = append(clauses, fmt.Sprintf("t.transaction_date >= $%d AND t.transaction_date < $%d", len(args)-1, len(args)))
	}
	if f.CategoryID > 0 {
		args = append(args, f.CategoryID)
		clauses = append(clauses, fmt.Sprintf("t.category_id=$%d", len(args)))
	}
	if f.Type != "" {
		args = append(args, f.Type)
		clauses = append(clauses, fmt.Sprintf("t.type=$%d", len(args)))
	}
	if f.Essential == "true" || f.Essential == "false" {
		args = append(args, f.Essential == "true")
		clauses = append(clauses, fmt.Sprintf("t.is_essential=$%d", len(args)))
	}
	if strings.TrimSpace(f.Query) != "" {
		args = append(args, "%"+strings.ToLower(strings.TrimSpace(f.Query))+"%")
		clauses = append(clauses, fmt.Sprintf("lower(t.comment) LIKE $%d", len(args)))
	}
	limit := f.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args = append(args, limit, max(f.Offset, 0))
	query := transactionSelect() + ` WHERE ` + strings.Join(clauses, " AND ") + fmt.Sprintf(` ORDER BY t.transaction_date DESC, t.id DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args))
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(scanTransaction(&t)...); err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, rows.Err()
}

func (r *Repository) ExportTransactions(ctx context.Context) ([]models.Transaction, error) {
	rows, err := r.db.Query(ctx, transactionSelect()+` ORDER BY t.transaction_date DESC, t.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(scanTransaction(&t)...); err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, rows.Err()
}

func (r *Repository) CommentSuggestions(ctx context.Context, categoryID int64) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT comment
		FROM transactions
		WHERE category_id=$1 AND comment <> ''
		GROUP BY comment
		ORDER BY max(transaction_date) DESC
		LIMIT 8`, categoryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []string
	for rows.Next() {
		var comment string
		if err := rows.Scan(&comment); err != nil {
			return nil, err
		}
		list = append(list, comment)
	}
	return list, rows.Err()
}

func (r *Repository) UpdateTransaction(ctx context.Context, id int64, in TransactionInput) (models.Transaction, error) {
	isEssential := any(nil)
	if in.IsEssential != nil {
		isEssential = *in.IsEssential
	}
	date := time.Now().In(r.loc)
	if in.TransactionDate != nil {
		date = in.TransactionDate.In(r.loc)
	}
	tag, err := r.db.Exec(ctx, `UPDATE transactions SET type=$2, amount_cents=$3, category_id=$4, is_essential=COALESCE($5, (SELECT is_essential FROM categories WHERE id=$4)), comment=$6, transaction_date=$7, updated_at=now() WHERE id=$1`,
		id, in.Type, in.AmountCents, in.CategoryID, isEssential, strings.TrimSpace(in.Comment), date)
	if err != nil {
		return models.Transaction{}, err
	}
	if tag.RowsAffected() == 0 {
		return models.Transaction{}, ErrNotFound
	}
	return r.Transaction(ctx, id)
}

func (r *Repository) DeleteTransaction(ctx context.Context, id int64) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM transactions WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) Budget(ctx context.Context, year, month int) (models.MonthlyBudget, error) {
	var b models.MonthlyBudget
	err := r.db.QueryRow(ctx, `SELECT id, year, month, amount_cents, created_at, updated_at FROM monthly_budgets WHERE year=$1 AND month=$2`, year, month).
		Scan(&b.ID, &b.Year, &b.Month, &b.AmountCents, &b.CreatedAt, &b.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return b, ErrNotFound
	}
	return b, err
}

func (r *Repository) Budgets(ctx context.Context) ([]models.MonthlyBudget, error) {
	rows, err := r.db.Query(ctx, `SELECT id, year, month, amount_cents, created_at, updated_at FROM monthly_budgets ORDER BY year DESC, month DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []models.MonthlyBudget
	for rows.Next() {
		var b models.MonthlyBudget
		if err := rows.Scan(&b.ID, &b.Year, &b.Month, &b.AmountCents, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, b)
	}
	return list, rows.Err()
}

func (r *Repository) SetBudget(ctx context.Context, year, month int, amount int64) (models.MonthlyBudget, error) {
	var b models.MonthlyBudget
	err := r.db.QueryRow(ctx, `INSERT INTO monthly_budgets(year, month, amount_cents) VALUES($1,$2,$3)
		ON CONFLICT (year, month) DO UPDATE SET amount_cents=EXCLUDED.amount_cents, updated_at=now()
		RETURNING id, year, month, amount_cents, created_at, updated_at`, year, month, amount).
		Scan(&b.ID, &b.Year, &b.Month, &b.AmountCents, &b.CreatedAt, &b.UpdatedAt)
	return b, err
}

func (r *Repository) Summary(ctx context.Context, year, month int) (models.Summary, error) {
	start := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, r.loc)
	end := start.AddDate(0, 1, 0)
	prevStart := start.AddDate(0, -1, 0)
	var s models.Summary
	s.Year = year
	s.Month = month
	err := r.db.QueryRow(ctx, `SELECT
		COALESCE(sum(amount_cents) FILTER (WHERE type='income'), 0),
		COALESCE(sum(amount_cents) FILTER (WHERE type='expense'), 0)
		FROM transactions WHERE transaction_date >= $1 AND transaction_date < $2`, start, end).Scan(&s.IncomeCents, &s.ExpenseCents)
	if err != nil {
		return s, err
	}
	_ = r.db.QueryRow(ctx, `SELECT COALESCE(amount_cents, 0) FROM monthly_budgets WHERE year=$1 AND month=$2`, year, month).Scan(&s.BudgetCents)
	_ = r.db.QueryRow(ctx, `SELECT COALESCE(sum(amount_cents), 0) FROM transactions WHERE type='expense' AND transaction_date >= $1 AND transaction_date < $2`, prevStart, start).Scan(&s.PreviousExpenseCents)
	s.BalanceCents = s.IncomeCents - s.ExpenseCents
	s.BudgetLeftCents = s.BudgetCents - s.ExpenseCents
	if s.BudgetCents > 0 {
		s.BudgetUsedPercent = float64(s.ExpenseCents) / float64(s.BudgetCents) * 100
	}
	if s.PreviousExpenseCents > 0 {
		s.ExpenseDeltaPercent = (float64(s.ExpenseCents-s.PreviousExpenseCents) / float64(s.PreviousExpenseCents)) * 100
	}
	daysPassed := max(time.Now().In(r.loc).Day(), 1)
	if year != time.Now().In(r.loc).Year() || month != int(time.Now().In(r.loc).Month()) {
		daysPassed = end.Add(-24 * time.Hour).Day()
	}
	daysInMonth := end.Add(-24 * time.Hour).Day()
	s.ForecastExpenseCents = int64(float64(s.ExpenseCents) / float64(daysPassed) * float64(daysInMonth))
	return s, nil
}

func (r *Repository) CategoryAnalytics(ctx context.Context, year, month int, essential string) ([]models.CategoryTotal, error) {
	start := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, r.loc)
	end := start.AddDate(0, 1, 0)
	args := []any{start, end}
	clauses := []string{"t.type='expense'", "t.transaction_date >= $1", "t.transaction_date < $2"}
	if essential == "true" || essential == "false" {
		args = append(args, essential == "true")
		clauses = append(clauses, fmt.Sprintf("t.is_essential=$%d", len(args)))
	}
	rows, err := r.db.Query(ctx, `SELECT c.id, c.name, c.icon, c.color, t.is_essential, count(t.id), COALESCE(sum(t.amount_cents),0)
		FROM categories c JOIN transactions t ON t.category_id=c.id
		WHERE `+strings.Join(clauses, " AND ")+`
		GROUP BY c.id, t.is_essential ORDER BY sum(t.amount_cents) DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []models.CategoryTotal
	for rows.Next() {
		var item models.CategoryTotal
		if err := rows.Scan(&item.CategoryID, &item.Name, &item.Icon, &item.Color, &item.IsEssential, &item.TransactionsCount, &item.AmountCents); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func (r *Repository) Timeline(ctx context.Context, year, month int) ([]models.TimelinePoint, error) {
	start := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, r.loc)
	end := start.AddDate(0, 1, 0)
	rows, err := r.db.Query(ctx, `SELECT to_char(day, 'YYYY-MM-DD'),
		COALESCE(sum(t.amount_cents) FILTER (WHERE t.type='income'), 0),
		COALESCE(sum(t.amount_cents) FILTER (WHERE t.type='expense'), 0)
		FROM generate_series($1::timestamptz, ($2::timestamptz - interval '1 day'), interval '1 day') day
		LEFT JOIN transactions t ON date_trunc('day', t.transaction_date)=day
		GROUP BY day ORDER BY day`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []models.TimelinePoint
	for rows.Next() {
		var p models.TimelinePoint
		if err := rows.Scan(&p.Date, &p.IncomeCents, &p.ExpenseCents); err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	return list, rows.Err()
}

func (r *Repository) Goals(ctx context.Context) ([]models.SavingGoal, error) {
	rows, err := r.db.Query(ctx, `SELECT id, name, target_amount_cents, current_amount_cents, icon, color, deadline, is_completed, created_at, updated_at FROM saving_goals ORDER BY is_completed, deadline NULLS LAST, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []models.SavingGoal
	for rows.Next() {
		var g models.SavingGoal
		if err := rows.Scan(&g.ID, &g.Name, &g.TargetAmountCents, &g.CurrentAmountCents, &g.Icon, &g.Color, &g.Deadline, &g.IsCompleted, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, g)
	}
	return list, rows.Err()
}

func (r *Repository) SaveGoal(ctx context.Context, g models.SavingGoal) (models.SavingGoal, error) {
	if g.ID == 0 {
		err := r.db.QueryRow(ctx, `INSERT INTO saving_goals(name, target_amount_cents, current_amount_cents, icon, color, deadline, is_completed)
			VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, target_amount_cents, current_amount_cents, icon, color, deadline, is_completed, created_at, updated_at`,
			strings.TrimSpace(g.Name), g.TargetAmountCents, g.CurrentAmountCents, g.Icon, g.Color, g.Deadline, g.IsCompleted).
			Scan(&g.ID, &g.Name, &g.TargetAmountCents, &g.CurrentAmountCents, &g.Icon, &g.Color, &g.Deadline, &g.IsCompleted, &g.CreatedAt, &g.UpdatedAt)
		return g, err
	}
	err := r.db.QueryRow(ctx, `UPDATE saving_goals SET name=$2, target_amount_cents=$3, current_amount_cents=$4, icon=$5, color=$6, deadline=$7, is_completed=$8, updated_at=now()
		WHERE id=$1 RETURNING id, name, target_amount_cents, current_amount_cents, icon, color, deadline, is_completed, created_at, updated_at`,
		g.ID, strings.TrimSpace(g.Name), g.TargetAmountCents, g.CurrentAmountCents, g.Icon, g.Color, g.Deadline, g.IsCompleted).
		Scan(&g.ID, &g.Name, &g.TargetAmountCents, &g.CurrentAmountCents, &g.Icon, &g.Color, &g.Deadline, &g.IsCompleted, &g.CreatedAt, &g.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return g, ErrNotFound
	}
	return g, err
}

func (r *Repository) DepositGoal(ctx context.Context, id, amount int64) (models.SavingGoal, error) {
	var g models.SavingGoal
	err := r.db.QueryRow(ctx, `UPDATE saving_goals
		SET current_amount_cents=current_amount_cents+$2,
		    is_completed=(current_amount_cents+$2)>=target_amount_cents,
		    updated_at=now()
		WHERE id=$1
		RETURNING id, name, target_amount_cents, current_amount_cents, icon, color, deadline, is_completed, created_at, updated_at`, id, amount).
		Scan(&g.ID, &g.Name, &g.TargetAmountCents, &g.CurrentAmountCents, &g.Icon, &g.Color, &g.Deadline, &g.IsCompleted, &g.CreatedAt, &g.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return g, ErrNotFound
	}
	return g, err
}

func (r *Repository) DeleteGoal(ctx context.Context, id int64) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM saving_goals WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) RecurringPayments(ctx context.Context) ([]models.RecurringPayment, error) {
	rows, err := r.db.Query(ctx, `SELECT rp.id, rp.name, rp.amount_cents, rp.category_id, c.name, c.icon, c.color, rp.day_of_month, rp.is_active, rp.created_at, rp.updated_at
		FROM recurring_payments rp JOIN categories c ON c.id=rp.category_id ORDER BY rp.day_of_month, rp.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []models.RecurringPayment
	for rows.Next() {
		var p models.RecurringPayment
		if err := rows.Scan(&p.ID, &p.Name, &p.AmountCents, &p.CategoryID, &p.CategoryName, &p.CategoryIcon, &p.CategoryColor, &p.DayOfMonth, &p.IsActive, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	return list, rows.Err()
}

func (r *Repository) SaveRecurringPayment(ctx context.Context, p models.RecurringPayment) (models.RecurringPayment, error) {
	if p.ID == 0 {
		err := r.db.QueryRow(ctx, `INSERT INTO recurring_payments(name, amount_cents, category_id, day_of_month, is_active)
			VALUES($1,$2,$3,$4,$5) RETURNING id`, strings.TrimSpace(p.Name), p.AmountCents, p.CategoryID, p.DayOfMonth, p.IsActive).Scan(&p.ID)
		if err != nil {
			return p, err
		}
	} else {
		tag, err := r.db.Exec(ctx, `UPDATE recurring_payments SET name=$2, amount_cents=$3, category_id=$4, day_of_month=$5, is_active=$6, updated_at=now() WHERE id=$1`,
			p.ID, strings.TrimSpace(p.Name), p.AmountCents, p.CategoryID, p.DayOfMonth, p.IsActive)
		if err != nil {
			return p, err
		}
		if tag.RowsAffected() == 0 {
			return p, ErrNotFound
		}
	}
	for _, item := range mustList(r.RecurringPayments(ctx)) {
		if item.ID == p.ID {
			return item, nil
		}
	}
	return p, nil
}

func (r *Repository) DeleteRecurringPayment(ctx context.Context, id int64) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM recurring_payments WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) PayRecurringPayment(ctx context.Context, id, userID int64) (models.Transaction, error) {
	var p models.RecurringPayment
	err := r.db.QueryRow(ctx, `SELECT id, name, amount_cents, category_id FROM recurring_payments WHERE id=$1 AND is_active=true`, id).
		Scan(&p.ID, &p.Name, &p.AmountCents, &p.CategoryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.Transaction{}, ErrNotFound
	}
	if err != nil {
		return models.Transaction{}, err
	}
	key := fmt.Sprintf("recurring:%d:%s", id, time.Now().In(r.loc).Format("2006-01-02"))
	return r.CreateTransaction(ctx, TransactionInput{
		Type: "expense", AmountCents: p.AmountCents, CategoryID: p.CategoryID,
		Comment: p.Name, CreatedBy: userID, IdempotencyKey: key,
	})
}

func (r *Repository) Backup(ctx context.Context) (models.BackupData, error) {
	data := models.BackupData{
		ExportedAt:    time.Now().In(r.loc),
		SchemaVersion: 1,
	}
	var err error
	if data.Users, err = r.Users(ctx); err != nil {
		return data, err
	}
	if data.Categories, err = r.Categories(ctx, true, ""); err != nil {
		return data, err
	}
	if data.Transactions, err = r.ExportTransactions(ctx); err != nil {
		return data, err
	}
	if data.Budgets, err = r.Budgets(ctx); err != nil {
		return data, err
	}
	if data.Goals, err = r.Goals(ctx); err != nil {
		return data, err
	}
	if data.RecurringPayments, err = r.RecurringPayments(ctx); err != nil {
		return data, err
	}
	return data, nil
}

func (r *Repository) EnsureDemoData(ctx context.Context) error {
	setup, _, err := r.IsSetup(ctx)
	if err != nil || setup {
		return err
	}
	users, err := r.Setup(ctx, []SetupProfile{{Name: "Аня", PIN: "1111"}, {Name: "Саша", PIN: "2222"}})
	if err != nil {
		return err
	}
	categories, err := r.Categories(ctx, false, "expense")
	if err != nil {
		return err
	}
	now := time.Now().In(r.loc)
	for i, category := range categories[:min(5, len(categories))] {
		_, err = r.CreateTransaction(ctx, TransactionInput{
			Type: "expense", AmountCents: int64(55000 + i*12300), CategoryID: category.ID,
			Comment: "Демо-операция", TransactionDate: &now, CreatedBy: users[0].ID,
			IdempotencyKey: fmt.Sprintf("demo-%d", i),
		})
		if err != nil {
			return err
		}
	}
	_, err = r.SetBudget(ctx, now.Year(), int(now.Month()), 12000000)
	return err
}

func transactionSelect() string {
	return `SELECT t.id, t.type, t.amount_cents, t.category_id, c.name, c.icon, c.color, c.is_essential, t.is_essential, t.comment, t.transaction_date, t.created_by, u.name, t.created_at, t.updated_at
		FROM transactions t JOIN categories c ON c.id=t.category_id JOIN users u ON u.id=t.created_by`
}

func normalizeKind(kind string) string {
	if kind == "income" {
		return "income"
	}
	return "expense"
}

func scanTransaction(t *models.Transaction) []any {
	return []any{&t.ID, &t.Type, &t.AmountCents, &t.CategoryID, &t.CategoryName, &t.CategoryIcon, &t.CategoryColor, &t.CategoryIsEssential, &t.IsEssential, &t.Comment, &t.TransactionDate, &t.CreatedBy, &t.AuthorName, &t.CreatedAt, &t.UpdatedAt}
}

func randomToken(size int) (string, error) {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func IsUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func mustList[T any](v []T, err error) []T {
	if err != nil {
		return nil
	}
	return v
}
