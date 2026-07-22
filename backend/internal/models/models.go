package models

import "time"

type User struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Category struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Icon        string    `json:"icon"`
	Color       string    `json:"color"`
	Kind        string    `json:"kind"`
	SortOrder   int       `json:"sort_order"`
	IsActive    bool      `json:"is_active"`
	IsEssential bool      `json:"is_essential"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Transaction struct {
	ID                  int64     `json:"id"`
	Type                string    `json:"type"`
	AmountCents         int64     `json:"amount_cents"`
	CategoryID          int64     `json:"category_id"`
	CategoryName        string    `json:"category_name"`
	CategoryIcon        string    `json:"category_icon"`
	CategoryColor       string    `json:"category_color"`
	CategoryIsEssential bool      `json:"category_is_essential"`
	IsEssential         bool      `json:"is_essential"`
	Comment             string    `json:"comment"`
	TransactionDate     time.Time `json:"transaction_date"`
	CreatedBy           int64     `json:"created_by"`
	AuthorName          string    `json:"author_name"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

type MonthlyBudget struct {
	ID          int64     `json:"id"`
	Year        int       `json:"year"`
	Month       int       `json:"month"`
	AmountCents int64     `json:"amount_cents"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type SavingGoal struct {
	ID                 int64      `json:"id"`
	Name               string     `json:"name"`
	TargetAmountCents  int64      `json:"target_amount_cents"`
	CurrentAmountCents int64      `json:"current_amount_cents"`
	Icon               string     `json:"icon"`
	Color              string     `json:"color"`
	Deadline           *time.Time `json:"deadline"`
	IsCompleted        bool       `json:"is_completed"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type RecurringPayment struct {
	ID            int64     `json:"id"`
	Name          string    `json:"name"`
	AmountCents   int64     `json:"amount_cents"`
	CategoryID    int64     `json:"category_id"`
	CategoryName  string    `json:"category_name"`
	CategoryIcon  string    `json:"category_icon"`
	CategoryColor string    `json:"category_color"`
	DayOfMonth    int       `json:"day_of_month"`
	IsActive      bool      `json:"is_active"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type Summary struct {
	Year                 int     `json:"year"`
	Month                int     `json:"month"`
	IncomeCents          int64   `json:"income_cents"`
	ExpenseCents         int64   `json:"expense_cents"`
	BalanceCents         int64   `json:"balance_cents"`
	BudgetCents          int64   `json:"budget_cents"`
	BudgetLeftCents      int64   `json:"budget_left_cents"`
	BudgetUsedPercent    float64 `json:"budget_used_percent"`
	PreviousExpenseCents int64   `json:"previous_expense_cents"`
	ExpenseDeltaPercent  float64 `json:"expense_delta_percent"`
	ForecastExpenseCents int64   `json:"forecast_expense_cents"`
}

type CategoryTotal struct {
	CategoryID        int64  `json:"category_id"`
	Name              string `json:"name"`
	Icon              string `json:"icon"`
	Color             string `json:"color"`
	IsEssential       bool   `json:"is_essential"`
	TransactionsCount int    `json:"transactions_count"`
	AmountCents       int64  `json:"amount_cents"`
}

type TimelinePoint struct {
	Date         string `json:"date"`
	IncomeCents  int64  `json:"income_cents"`
	ExpenseCents int64  `json:"expense_cents"`
}

type BackupData struct {
	ExportedAt        time.Time          `json:"exported_at"`
	SchemaVersion     int                `json:"schema_version"`
	Users             []User             `json:"users"`
	Categories        []Category         `json:"categories"`
	Transactions      []Transaction      `json:"transactions"`
	Budgets           []MonthlyBudget    `json:"budgets"`
	Goals             []SavingGoal       `json:"goals"`
	RecurringPayments []RecurringPayment `json:"recurring_payments"`
}
