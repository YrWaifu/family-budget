export type User = {
  id: number;
  name: string;
};

export type Category = {
  id: number;
  name: string;
  icon: string;
  color: string;
  kind: "expense" | "income";
  sort_order: number;
  is_active: boolean;
  is_essential: boolean;
};

export type Transaction = {
  id: number;
  type: "expense" | "income";
  amount_cents: number;
  category_id: number;
  category_name: string;
  category_icon: string;
  category_color: string;
  category_is_essential: boolean;
  is_essential: boolean;
  comment: string;
  transaction_date: string;
  created_by: number;
  author_name: string;
};

export type Summary = {
  year: number;
  month: number;
  income_cents: number;
  expense_cents: number;
  balance_cents: number;
  budget_cents: number;
  budget_left_cents: number;
  budget_used_percent: number;
  previous_expense_cents: number;
  expense_delta_percent: number;
  forecast_expense_cents: number;
};

export type CategoryTotal = {
  category_id: number;
  name: string;
  icon: string;
  color: string;
  is_essential: boolean;
  transactions_count: number;
  amount_cents: number;
};

export type TimelinePoint = {
  date: string;
  income_cents: number;
  expense_cents: number;
};

export type Goal = {
  id: number;
  name: string;
  target_amount_cents: number;
  current_amount_cents: number;
  icon: string;
  color: string;
  deadline: string | null;
  is_completed: boolean;
};

export type RecurringPayment = {
  id: number;
  name: string;
  amount_cents: number;
  category_id: number;
  category_name: string;
  category_icon: string;
  category_color: string;
  day_of_month: number;
  is_active: boolean;
};

export type TransactionPayload = {
  type: "expense" | "income";
  amount_cents: number;
  category_id: number;
  is_essential: boolean;
  comment: string;
  transaction_date?: string;
};

let csrfToken = localStorage.getItem("csrf_token") ?? "";

function idempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function setCSRF(token: string) {
  csrfToken = token;
  localStorage.setItem("csrf_token", token);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD"].includes((options.method ?? "GET").toUpperCase()) && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(`/api/v1${path}`, { ...options, credentials: "include", headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "Запрос не выполнен");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  setupStatus: () => request<{ is_setup: boolean; profiles_count: number }>("/setup/status"),
  setup: (profiles: Array<{ name: string; pin: string }>) =>
    request<{ users: User[] }>("/setup", { method: "POST", body: JSON.stringify({ profiles }) }),
  profiles: () => request<{ users: User[] }>("/auth/profiles"),
  login: async (user_id: number, pin: string) => {
    const result = await request<{ user: User; csrf_token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ user_id, pin }),
    });
    setCSRF(result.csrf_token);
    return result;
  },
  logout: () => request("/auth/logout", { method: "POST" }),
  me: async () => {
    const result = await request<{ user: User; csrf_token: string }>("/auth/me");
    setCSRF(result.csrf_token);
    return result;
  },
  categories: (includeInactive = false, kind?: "expense" | "income") =>
    request<{ categories: Category[] }>(`/categories?include_inactive=${includeInactive}${kind ? `&kind=${kind}` : ""}`),
  saveCategory: (category: Partial<Category>) =>
    category.id
      ? request<Category>(`/categories/${category.id}`, { method: "PATCH", body: JSON.stringify(category) })
      : request<Category>("/categories", { method: "POST", body: JSON.stringify(category) }),
  deleteCategory: (id: number) => request(`/categories/${id}`, { method: "DELETE" }),
  transactions: (query: string) => request<{ transactions: Transaction[] }>(`/transactions${query}`),
  createTransaction: (payload: TransactionPayload) =>
    request<Transaction>("/transactions", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey() },
      body: JSON.stringify(payload),
    }),
  updateTransaction: (id: number, payload: TransactionPayload) =>
    request<Transaction>(`/transactions/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteTransaction: (id: number) => request(`/transactions/${id}`, { method: "DELETE" }),
  summary: (year: number, month: number) => request<Summary>(`/analytics/summary?year=${year}&month=${month}`),
  categoryAnalytics: (year: number, month: number, essential?: string) =>
    request<{ items: CategoryTotal[] }>(`/analytics/categories?year=${year}&month=${month}${essential ? `&essential=${essential}` : ""}`),
  timeline: (year: number, month: number, essential?: string) =>
    request<{ items: TimelinePoint[] }>(`/analytics/timeline?year=${year}&month=${month}${essential ? `&essential=${essential}` : ""}`),
  monthlyTimeline: (year: number, essential?: string) =>
    request<{ items: TimelinePoint[] }>(`/analytics/monthly?year=${year}${essential ? `&essential=${essential}` : ""}`),
  commentSuggestions: (categoryID: number) => request<{ suggestions: string[] }>(`/transactions/comment-suggestions?category_id=${categoryID}`),
  comparison: () => request<{ current: Summary; previous: Summary }>("/analytics/comparison"),
  budget: (year: number, month: number) => request<{ amount_cents: number; year: number; month: number }>(`/budgets?year=${year}&month=${month}`),
  setBudget: (year: number, month: number, amount_cents: number) =>
    request(`/budgets/${year}/${month}`, { method: "PUT", body: JSON.stringify({ amount_cents }) }),
  goals: () => request<{ goals: Goal[] }>("/goals"),
  saveGoal: (goal: Partial<Goal>) =>
    goal.id ? request<Goal>(`/goals/${goal.id}`, { method: "PATCH", body: JSON.stringify(goal) }) : request<Goal>("/goals", { method: "POST", body: JSON.stringify(goal) }),
  depositGoal: (id: number, amount_cents: number) => request<Goal>(`/goals/${id}/deposit`, { method: "POST", body: JSON.stringify({ amount_cents }) }),
  deleteGoal: (id: number) => request(`/goals/${id}`, { method: "DELETE" }),
  recurring: () => request<{ recurring_payments: RecurringPayment[] }>("/recurring-payments"),
  saveRecurring: (payment: Partial<RecurringPayment>) =>
    payment.id
      ? request<RecurringPayment>(`/recurring-payments/${payment.id}`, { method: "PATCH", body: JSON.stringify(payment) })
      : request<RecurringPayment>("/recurring-payments", { method: "POST", body: JSON.stringify(payment) }),
  payRecurring: (id: number) => request<Transaction>(`/recurring-payments/${id}/pay`, { method: "POST" }),
  deleteRecurring: (id: number) => request(`/recurring-payments/${id}`, { method: "DELETE" }),
};
