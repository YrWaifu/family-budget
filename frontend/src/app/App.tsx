import { zodResolver } from "@hookform/resolvers/zod";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import * as Switch from "@radix-ui/react-switch";
import * as Tabs from "@radix-ui/react-tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import {
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  Home,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { api, type Category, type CategoryTotal, type Goal, type RecurringPayment, type Summary, type Transaction, type TransactionPayload, type User } from "../shared/api/client";
import { amountToCents, formatMoney, isoDate, monthLabel } from "../shared/lib/format";
import { CategoryIcon, iconNames } from "../shared/lib/icons";

type AuthState = "loading" | "setup" | "login" | "ready";

const transactionSchema = z.object({
  type: z.enum(["expense", "income"]),
  amount: z.string().refine((value) => amountToCents(value) > 0, "Введите сумму"),
  category_id: z.number().min(1, "Выберите категорию"),
  transaction_date: z.string().min(1),
  comment: z.string().max(240),
});

type TransactionForm = z.infer<typeof transactionSchema>;

export function App() {
  const queryClient = useQueryClient();
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    api
      .me()
      .then((result) => {
        setUser(result.user);
        setAuthState("ready");
      })
      .catch(() => {
        api.setupStatus()
          .then((status) => setAuthState(status.is_setup ? "login" : "setup"))
          .catch(() => setAuthState("setup"));
      });
  }, []);

  if (authState === "loading") return <Splash />;
  if (authState === "setup") return <SetupScreen onReady={() => setAuthState("login")} />;
  if (authState === "login") return <LoginScreen onLogin={(nextUser) => { setUser(nextUser); setAuthState("ready"); }} />;
  if (!user) return <Splash />;

  return (
    <Shell
      user={user}
      onLogout={async () => {
        await api.logout();
        queryClient.clear();
        setUser(null);
        setAuthState("login");
      }}
    />
  );
}

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col pb-24">
        <header className="sticky top-0 z-20 flex items-center justify-between bg-slate-50/90 px-4 py-3 backdrop-blur dark:bg-slate-950/90">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Семейный бюджет</p>
            <h1 className="text-xl font-bold">{user.name}</h1>
          </div>
          <button className="icon-button" onClick={onLogout} title="Выйти">
            <LogOut size={20} />
          </button>
        </header>
        <main className="flex-1 px-4">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <nav className="fixed bottom-0 left-1/2 z-30 grid w-full max-w-xl -translate-x-1/2 grid-cols-4 border-t border-slate-200 bg-white/95 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <NavItem to="/" icon={<Home size={21} />} label="Главная" />
          <NavItem to="/history" icon={<History size={21} />} label="История" />
          <NavItem to="/analytics" icon={<BarChart3 size={21} />} label="Аналитика" />
          <NavItem to="/settings" icon={<Settings size={21} />} label="Еще" />
        </nav>
      </div>
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-item ${isActive ? "nav-item-active" : ""}`}>
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}

function Dashboard() {
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [quickCategory, setQuickCategory] = useState<Category | null>(null);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth() + 1;
  const queryClient = useQueryClient();

  const summary = useQuery({ queryKey: ["summary", year, month], queryFn: () => api.summary(year, month) });
  const categories = useQuery({ queryKey: ["categories", "expense"], queryFn: () => api.categories(false, "expense") });
  const allCategories = useQuery({ queryKey: ["categories", "active"], queryFn: () => api.categories() });
  const analytics = useQuery({ queryKey: ["categoryAnalytics", year, month], queryFn: () => api.categoryAnalytics(year, month) });
  const transactions = useQuery({ queryKey: ["transactions", year, month, "recent"], queryFn: () => api.transactions(`?year=${year}&month=${month}&limit=10`) });

  const refresh = () => queryClient.invalidateQueries();
  const activeCategories = categories.data?.categories ?? [];

  return (
    <div className="space-y-5 pb-8">
      <MonthSwitcher date={monthDate} onChange={setMonthDate} />
      <BudgetHero summary={summary.data} loading={summary.isLoading} />
      <section className="grid grid-cols-[1.05fr_0.95fr] gap-3">
        <ChartCard items={analytics.data?.items ?? []} />
        <div className="panel flex flex-col justify-between p-4">
          <span className="text-sm text-slate-500">Прогноз расходов</span>
          <strong className="text-2xl">{formatMoney(summary.data?.forecast_expense_cents ?? 0)}</strong>
          <span className="text-xs text-slate-500">
            {deltaText(summary.data)}
          </span>
        </div>
      </section>
      <section className="space-y-3">
        <SectionTitle title="Быстрый расход" action={<TransactionDialog categories={allCategories.data?.categories ?? activeCategories} onSaved={refresh} />} />
        <div className="category-grid">
          {activeCategories.map((category) => (
            <button key={category.id} className="category-button" onClick={() => { navigator.vibrate?.(20); setQuickCategory(category); }}>
              <span className="category-badge" style={{ backgroundColor: category.color }}>
                <CategoryIcon name={category.icon} className="h-6 w-6 text-white" />
              </span>
              <span>{category.name}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <SectionTitle title="Последние операции" />
        <TransactionList items={transactions.data?.transactions ?? []} compact onChanged={refresh} categories={activeCategories} />
      </section>
      <QuickAmountDialog category={quickCategory} open={Boolean(quickCategory)} onOpenChange={(open) => !open && setQuickCategory(null)} onSaved={refresh} />
    </div>
  );
}

function BudgetHero({ summary, loading }: { summary?: Summary; loading: boolean }) {
  const used = Math.min(summary?.budget_used_percent ?? 0, 100);
  return (
    <section className="hero-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-white/70">Расходы месяца</p>
          <strong className="mt-1 block text-4xl font-black tracking-normal">{loading ? "..." : formatMoney(summary?.expense_cents ?? 0)}</strong>
        </div>
        <div className="rounded-full bg-white/12 px-3 py-2 text-right">
          <p className="text-xs text-white/65">Баланс</p>
          <b>{formatMoney(summary?.balance_cents ?? 0)}</b>
        </div>
      </div>
      <div className="mt-8 grid grid-cols-3 gap-3">
        <Metric label="Доходы" value={formatMoney(summary?.income_cents ?? 0)} />
        <Metric label="Бюджет" value={formatMoney(summary?.budget_cents ?? 0)} />
        <Metric label="Остаток" value={formatMoney(summary?.budget_left_cents ?? 0)} />
      </div>
      <div className="mt-5 h-2 rounded-full bg-white/15">
        <div className="h-full rounded-full bg-emerald-300" style={{ width: `${used}%` }} />
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-white/60">{label}</p>
      <p className="truncate text-sm font-bold">{value}</p>
    </div>
  );
}

function ChartCard({ items }: { items: CategoryTotal[] }) {
  const data = items.length ? items : [{ name: "Нет расходов", amount_cents: 1, color: "#cbd5e1", category_id: 0, icon: "CircleEllipsis" }];
  return (
    <div className="panel h-48 p-3">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="amount_cents" innerRadius="58%" outerRadius="86%" paddingAngle={3}>
            {data.map((item) => <Cell key={item.category_id} fill={item.color} />)}
          </Pie>
          <Tooltip formatter={(value) => formatMoney(Number(value))} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function MonthSwitcher({ date, onChange }: { date: Date; onChange: (date: Date) => void }) {
  return (
    <div className="flex items-center justify-between pt-1">
      <button className="icon-button" onClick={() => onChange(new Date(date.getFullYear(), date.getMonth() - 1, 1))} title="Предыдущий месяц">
        <ChevronLeft size={20} />
      </button>
      <strong className="text-base capitalize">{monthLabel(date.getFullYear(), date.getMonth() + 1)}</strong>
      <button className="icon-button" onClick={() => onChange(new Date(date.getFullYear(), date.getMonth() + 1, 1))} title="Следующий месяц">
        <ChevronRight size={20} />
      </button>
    </div>
  );
}

function TransactionDialog({ categories, transaction, onSaved, trigger }: { categories: Category[]; transaction?: Transaction; onSaved: () => void; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const form = useForm<TransactionForm>({
    resolver: zodResolver(transactionSchema),
    values: {
      type: transaction?.type ?? "expense",
      amount: transaction ? String(transaction.amount_cents / 100) : "",
      category_id: transaction?.category_id ?? categories[0]?.id ?? 0,
      transaction_date: transaction ? isoDate(new Date(transaction.transaction_date)) : isoDate(),
      comment: transaction?.comment ?? "",
    },
  });
  const mutation = useMutation({
    mutationFn: (payload: TransactionPayload) => transaction ? api.updateTransaction(transaction.id, payload) : api.createTransaction(payload),
    onSuccess: () => {
      queryClient.invalidateQueries();
      onSaved();
      setOpen(false);
    },
  });
  const selectedType = form.watch("type");
  const availableCategories = useMemo(() => categories.filter((category) => category.kind === selectedType), [categories, selectedType]);
  useEffect(() => {
    if (!availableCategories.some((category) => category.id === form.getValues("category_id")) && availableCategories[0]) {
      form.setValue("category_id", availableCategories[0].id);
    }
  }, [availableCategories, form, selectedType]);
  const submit = form.handleSubmit((values) => {
    mutation.mutate({
      type: values.type,
      amount_cents: amountToCents(values.amount),
      category_id: values.category_id,
      comment: values.comment,
      transaction_date: new Date(values.transaction_date).toISOString(),
    });
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        {trigger ?? (
          <button className="primary-button">
            <Plus size={19} /> Добавить
          </button>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="sheet">
          <div className="sheet-head">
            <Dialog.Title className="text-xl font-bold">{transaction ? "Операция" : "Новая операция"}</Dialog.Title>
            <Dialog.Close className="icon-button"><X size={20} /></Dialog.Close>
          </div>
          <form className="space-y-4" onSubmit={submit}>
            <div className="segmented">
              <button type="button" className={selectedType === "expense" ? "selected" : ""} onClick={() => form.setValue("type", "expense")}>Расход</button>
              <button type="button" className={selectedType === "income" ? "selected" : ""} onClick={() => form.setValue("type", "income")}>Доход</button>
            </div>
            <label className="field">
              <span>Сумма</span>
              <input inputMode="decimal" placeholder="150,50" {...form.register("amount")} />
            </label>
            <CategorySelect categories={availableCategories} value={form.watch("category_id")} onChange={(value) => form.setValue("category_id", value)} />
            <label className="field">
              <span>Дата</span>
              <input type="date" {...form.register("transaction_date")} />
            </label>
            <label className="field">
              <span>Комментарий</span>
              <input maxLength={240} placeholder="Необязательно" {...form.register("comment")} />
            </label>
            {mutation.error && <p className="error-text">{mutation.error.message}</p>}
            <button className="primary-button w-full justify-center" disabled={mutation.isPending}>
              <Check size={19} /> Готово
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function QuickAmountDialog({ category, open, onOpenChange, onSaved }: { category: Category | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.createTransaction({ type: "expense", amount_cents: amountToCents(amount), category_id: category!.id, comment: "", transaction_date: new Date().toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      onSaved();
      setAmount("");
      onOpenChange(false);
    },
  });
  useEffect(() => {
    if (open) setAmount("");
  }, [open]);
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="sheet">
          <div className="sheet-head">
            <Dialog.Title className="flex items-center gap-3 text-xl font-bold">
              {category && <span className="category-badge small" style={{ backgroundColor: category.color }}><CategoryIcon name={category.icon} className="h-5 w-5 text-white" /></span>}
              {category?.name}
            </Dialog.Title>
            <Dialog.Close className="icon-button"><X size={20} /></Dialog.Close>
          </div>
          <div className="amount-display">{amount || "0"} ₽</div>
          <div className="keypad">
            {keys.map((key) => (
              <button key={key} onClick={() => setAmount((current) => key === "⌫" ? current.slice(0, -1) : current + key)}>{key}</button>
            ))}
          </div>
          {mutation.error && <p className="error-text">{mutation.error.message}</p>}
          <button className="primary-button mt-4 w-full justify-center" disabled={amountToCents(amount) <= 0 || mutation.isPending} onClick={() => mutation.mutate()}>
            <Check size={19} /> Готово
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CategorySelect({ categories, value, onChange }: { categories: Category[]; value: number; onChange: (value: number) => void }) {
  const selected = categories.find((category) => category.id === value);
  return (
    <label className="field">
      <span>Категория</span>
      <Select.Root value={String(value || "")} onValueChange={(next) => onChange(Number(next))}>
        <Select.Trigger className="select-trigger">
          <span className="flex items-center gap-2">
            {selected && <span className="category-dot" style={{ backgroundColor: selected.color }} />}
            <Select.Value placeholder="Выберите" />
          </span>
          <Select.Icon><ChevronDown size={18} /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="select-content">
            <Select.Viewport>
              {categories.map((category) => (
                <Select.Item className="select-item" value={String(category.id)} key={category.id}>
                  <Select.ItemText>{category.name}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </label>
  );
}

function HistoryPage() {
  const [filters, setFilters] = useState({ q: "", type: "", category: "" });
  const [date, setDate] = useState(() => new Date());
  const query = `?year=${date.getFullYear()}&month=${date.getMonth() + 1}&limit=80&q=${encodeURIComponent(filters.q)}${filters.type ? `&type=${filters.type}` : ""}${filters.category ? `&category_id=${filters.category}` : ""}`;
  const categories = useQuery({ queryKey: ["categories", "all"], queryFn: () => api.categories(true) });
  const transactions = useQuery({ queryKey: ["transactions", query], queryFn: () => api.transactions(query) });
  const queryClient = useQueryClient();
  return (
    <div className="space-y-4 pb-8">
      <MonthSwitcher date={date} onChange={setDate} />
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label className="search-box">
          <Search size={18} />
          <input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Поиск" />
        </label>
        <a className="icon-button" href="/api/v1/export?format=csv" title="Экспорт CSV"><Download size={20} /></a>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <FilterChip active={!filters.type} onClick={() => setFilters({ ...filters, type: "" })}>Все</FilterChip>
        <FilterChip active={filters.type === "expense"} onClick={() => setFilters({ ...filters, type: "expense" })}>Расходы</FilterChip>
        <FilterChip active={filters.type === "income"} onClick={() => setFilters({ ...filters, type: "income" })}>Доходы</FilterChip>
        {(categories.data?.categories ?? []).map((category) => (
          <FilterChip key={category.id} active={filters.category === String(category.id)} onClick={() => setFilters({ ...filters, category: filters.category === String(category.id) ? "" : String(category.id) })}>
            {category.name}
          </FilterChip>
        ))}
      </div>
      <TransactionList items={transactions.data?.transactions ?? []} categories={categories.data?.categories ?? []} onChanged={() => queryClient.invalidateQueries()} />
    </div>
  );
}

function TransactionList({ items, categories, onChanged, compact }: { items: Transaction[]; categories: Category[]; onChanged: () => void; compact?: boolean }) {
  const remove = useMutation({ mutationFn: (id: number) => api.deleteTransaction(id), onSuccess: onChanged });
  if (!items.length) return <div className="empty-panel">Операций пока нет</div>;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div className="transaction-row" key={item.id}>
          <span className="category-badge small" style={{ backgroundColor: item.category_color }}>
            <CategoryIcon name={item.category_icon} className="h-5 w-5 text-white" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{item.category_name}</p>
            <p className="truncate text-xs text-slate-500">
              {item.comment || item.author_name} · {new Date(item.transaction_date).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
            </p>
          </div>
          <strong className={item.type === "income" ? "text-emerald-600" : "text-slate-950 dark:text-white"}>
            {item.type === "income" ? "+" : "-"}{formatMoney(item.amount_cents)}
          </strong>
          {!compact && (
            <div className="flex gap-1">
              <TransactionDialog categories={categories} transaction={item} onSaved={onChanged} trigger={<button className="icon-button" title="Редактировать"><CalendarDays size={18} /></button>} />
              <button className="icon-button danger" title="Удалить" onClick={() => window.confirm("Удалить операцию?") && remove.mutate(item.id)}>
                <Trash2 size={18} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AnalyticsPage() {
  const [date, setDate] = useState(() => new Date());
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const summary = useQuery({ queryKey: ["summary", year, month], queryFn: () => api.summary(year, month) });
  const categories = useQuery({ queryKey: ["categoryAnalytics", year, month], queryFn: () => api.categoryAnalytics(year, month) });
  const timeline = useQuery({ queryKey: ["timeline", year, month], queryFn: () => api.timeline(year, month) });
  const chartData = timeline.data?.items.map((item) => ({ ...item, day: item.date.slice(8), expense: item.expense_cents / 100, income: item.income_cents / 100 })) ?? [];
  return (
    <div className="space-y-4 pb-8">
      <MonthSwitcher date={date} onChange={setDate} />
      <div className="grid grid-cols-2 gap-3">
        <SmallStat title="Расходы" value={formatMoney(summary.data?.expense_cents ?? 0)} />
        <SmallStat title="Доходы" value={formatMoney(summary.data?.income_cents ?? 0)} />
      </div>
      <div className="panel h-64 p-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
            <Tooltip formatter={(value) => formatMoney(Number(value) * 100)} />
            <Area type="monotone" dataKey="expense" stroke="#f97316" fill="#fed7aa" strokeWidth={2} />
            <Area type="monotone" dataKey="income" stroke="#22c55e" fill="#bbf7d0" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="panel h-72 p-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={categories.data?.items ?? []}>
            <XAxis dataKey="name" hide />
            <Tooltip formatter={(value) => formatMoney(Number(value))} />
            <Bar dataKey="amount_cents" radius={[6, 6, 0, 0]}>
              {(categories.data?.items ?? []).map((item) => <Cell key={item.category_id} fill={item.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SettingsPage() {
  const now = new Date();
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ["categories-all"], queryFn: () => api.categories(true) });
  const expenseCategories = useQuery({ queryKey: ["categories", "expense", "all"], queryFn: () => api.categories(true, "expense") });
  const goals = useQuery({ queryKey: ["goals"], queryFn: api.goals });
  const recurring = useQuery({ queryKey: ["recurring"], queryFn: api.recurring });
  const budget = useQuery({ queryKey: ["budget", now.getFullYear(), now.getMonth() + 1], queryFn: () => api.budget(now.getFullYear(), now.getMonth() + 1) });
  const saveBudget = useMutation({ mutationFn: (amount: string) => api.setBudget(now.getFullYear(), now.getMonth() + 1, amountToCents(amount)), onSuccess: () => queryClient.invalidateQueries() });
  const [budgetValue, setBudgetValue] = useState("");
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return (
    <div className="space-y-4 pb-8">
      <div className="panel flex items-center justify-between p-4">
        <span className="flex items-center gap-2 font-semibold">{dark ? <Moon size={19} /> : <Sun size={19} />} Тема</span>
        <Switch.Root className="switch-root" checked={dark} onCheckedChange={setDark}><Switch.Thumb className="switch-thumb" /></Switch.Root>
      </div>
      <Tabs.Root defaultValue="budget" className="space-y-4">
        <Tabs.List className="tabs-list">
          <Tabs.Trigger value="budget">Бюджет</Tabs.Trigger>
          <Tabs.Trigger value="categories">Категории</Tabs.Trigger>
          <Tabs.Trigger value="goals">Цели</Tabs.Trigger>
          <Tabs.Trigger value="regular">Платежи</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="budget" className="panel space-y-3 p-4">
          <p className="text-sm text-slate-500">Текущий бюджет: {formatMoney(budget.data?.amount_cents ?? 0)}</p>
          <label className="field"><span>Новая сумма</span><input inputMode="decimal" value={budgetValue} onChange={(event) => setBudgetValue(event.target.value)} /></label>
          <button className="primary-button w-full justify-center" onClick={() => saveBudget.mutate(budgetValue)}>Сохранить</button>
        </Tabs.Content>
        <Tabs.Content value="categories" className="space-y-2">
          {(categories.data?.categories ?? []).map((category) => <CategoryEditor key={category.id} category={category} onSaved={() => queryClient.invalidateQueries()} />)}
          <CategoryEditor onSaved={() => queryClient.invalidateQueries()} />
        </Tabs.Content>
        <Tabs.Content value="goals" className="space-y-2">
          {(goals.data?.goals ?? []).map((goal) => <GoalRow key={goal.id} goal={goal} onSaved={() => queryClient.invalidateQueries()} />)}
          <GoalRow onSaved={() => queryClient.invalidateQueries()} />
        </Tabs.Content>
        <Tabs.Content value="regular" className="space-y-2">
          {(recurring.data?.recurring_payments ?? []).map((payment) => <RecurringRow key={payment.id} payment={payment} categories={expenseCategories.data?.categories ?? []} onSaved={() => queryClient.invalidateQueries()} />)}
          <RecurringRow categories={expenseCategories.data?.categories ?? []} onSaved={() => queryClient.invalidateQueries()} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function CategoryEditor({ category, onSaved }: { category?: Category; onSaved: () => void }) {
  const [draft, setDraft] = useState<Partial<Category>>(category ?? { name: "", icon: "CircleEllipsis", color: "#38bdf8", kind: "expense", sort_order: 130, is_active: true });
  const mutation = useMutation({ mutationFn: () => api.saveCategory(draft), onSuccess: onSaved });
  return (
    <div className="panel grid grid-cols-[auto_1fr_auto] items-center gap-3 p-3">
      <span className="category-badge small" style={{ backgroundColor: draft.color }}><CategoryIcon name={draft.icon ?? "CircleEllipsis"} className="h-5 w-5 text-white" /></span>
      <div className="grid gap-2">
        <input className="plain-input" value={draft.name ?? ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Категория" />
        <div className="flex gap-2">
          <input className="color-input" type="color" value={draft.color ?? "#38bdf8"} onChange={(event) => setDraft({ ...draft, color: event.target.value })} />
          <select className="plain-input" value={draft.icon} onChange={(event) => setDraft({ ...draft, icon: event.target.value })}>
            {iconNames.map((name) => <option key={name}>{name}</option>)}
          </select>
          <select className="plain-input" value={draft.kind ?? "expense"} onChange={(event) => setDraft({ ...draft, kind: event.target.value as "expense" | "income" })}>
            <option value="expense">Расход</option>
            <option value="income">Доход</option>
          </select>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        {category && <Switch.Root className="switch-root" checked={draft.is_active ?? true} onCheckedChange={(checked) => setDraft({ ...draft, is_active: checked })}><Switch.Thumb className="switch-thumb" /></Switch.Root>}
        <button className="icon-button" title="Сохранить" onClick={() => mutation.mutate()}><Check size={18} /></button>
      </div>
    </div>
  );
}

function GoalRow({ goal, onSaved }: { goal?: Goal; onSaved: () => void }) {
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? String(goal.target_amount_cents / 100) : "");
  const [deposit, setDeposit] = useState("");
  const save = useMutation({ mutationFn: () => api.saveGoal({ ...goal, name, target_amount_cents: amountToCents(target), current_amount_cents: goal?.current_amount_cents ?? 0, icon: "PiggyBank", color: goal?.color ?? "#38bdf8", is_completed: goal?.is_completed ?? false }), onSuccess: onSaved });
  const add = useMutation({ mutationFn: () => api.depositGoal(goal!.id, amountToCents(deposit)), onSuccess: onSaved });
  const progress = goal ? Math.min(100, (goal.current_amount_cents / goal.target_amount_cents) * 100) : 0;
  return (
    <div className="panel space-y-3 p-3">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input className="plain-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Цель" />
        <button className="icon-button" onClick={() => save.mutate()}><Check size={18} /></button>
      </div>
      <input className="plain-input" inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Сумма" />
      {goal && (
        <>
          <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-full rounded-full bg-sky-400" style={{ width: `${progress}%` }} /></div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input className="plain-input" inputMode="decimal" value={deposit} onChange={(event) => setDeposit(event.target.value)} placeholder="Пополнить" />
            <button className="icon-button" onClick={() => add.mutate()}><Plus size={18} /></button>
          </div>
        </>
      )}
    </div>
  );
}

function RecurringRow({ payment, categories, onSaved }: { payment?: RecurringPayment; categories: Category[]; onSaved: () => void }) {
  const [name, setName] = useState(payment?.name ?? "");
  const [amount, setAmount] = useState(payment ? String(payment.amount_cents / 100) : "");
  const [categoryID, setCategoryID] = useState(payment?.category_id ?? categories[0]?.id ?? 0);
  const [day, setDay] = useState(payment?.day_of_month ?? 1);
  const save = useMutation({ mutationFn: () => api.saveRecurring({ ...payment, name, amount_cents: amountToCents(amount), category_id: categoryID, day_of_month: day, is_active: payment?.is_active ?? true }), onSuccess: onSaved });
  const pay = useMutation({ mutationFn: () => api.payRecurring(payment!.id), onSuccess: onSaved });
  return (
    <div className="panel space-y-3 p-3">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input className="plain-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Платеж" />
        <button className="icon-button" onClick={() => save.mutate()}><Check size={18} /></button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="plain-input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Сумма" />
        <input className="plain-input" type="number" min={1} max={31} value={day} onChange={(event) => setDay(Number(event.target.value))} />
      </div>
      <CategorySelect categories={categories} value={categoryID} onChange={setCategoryID} />
      {payment && <button className="secondary-button w-full justify-center" onClick={() => pay.mutate()}>Оплатить сейчас</button>}
    </div>
  );
}

function SetupScreen({ onReady }: { onReady: () => void }) {
  const [profiles, setProfiles] = useState([{ name: "", pin: "" }, { name: "", pin: "" }]);
  const mutation = useMutation({ mutationFn: () => api.setup(profiles), onSuccess: onReady });
  return (
    <AuthFrame title="Первичная настройка">
      <div className="space-y-3">
        {profiles.map((profile, index) => (
          <div className="panel space-y-2 p-4" key={index}>
            <input className="plain-input" placeholder={`Профиль ${index + 1}`} value={profile.name} onChange={(event) => setProfiles(profiles.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
            <input className="plain-input" inputMode="numeric" type="password" placeholder="PIN" value={profile.pin} onChange={(event) => setProfiles(profiles.map((item, i) => i === index ? { ...item, pin: event.target.value } : item))} />
          </div>
        ))}
        {mutation.error && <p className="error-text">{mutation.error.message}</p>}
        <button className="primary-button w-full justify-center" onClick={() => mutation.mutate()}>Создать профили</button>
      </div>
    </AuthFrame>
  );
}

function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: api.profiles });
  const [selected, setSelected] = useState<number | null>(null);
  const [pin, setPin] = useState("");
  const mutation = useMutation({
    mutationFn: () => api.login(selected!, pin),
    onSuccess: (result) => onLogin(result.user),
  });
  const users = profiles.data?.users;
  useEffect(() => {
    if (!selected && users?.[0]) setSelected(users[0].id);
  }, [selected, users]);
  return (
    <AuthFrame title="Вход">
      <div className="grid grid-cols-2 gap-3">
        {(users ?? []).map((user) => (
          <button key={user.id} className={`profile-button ${selected === user.id ? "profile-selected" : ""}`} onClick={() => setSelected(user.id)}>
            <WalletCards size={24} /> {user.name}
          </button>
        ))}
      </div>
      <input className="pin-input" type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="PIN" />
      {mutation.error && <p className="error-text">{mutation.error.message}</p>}
      <button className="primary-button w-full justify-center" disabled={!selected || pin.length < 4} onClick={() => mutation.mutate()}>Войти</button>
    </AuthFrame>
  );
}

function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 px-5 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-sm flex-col justify-center gap-8">
        <div className="app-mark">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="text-sm font-semibold uppercase text-slate-400">Семейный бюджет</p>
          <h1 className="mt-2 text-4xl font-black">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {action}
    </div>
  );
}

function SmallStat({ title, value }: { title: string; value: string }) {
  return (
    <div className="panel p-4">
      <p className="text-sm text-slate-500">{title}</p>
      <strong className="mt-1 block text-xl">{value}</strong>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button className={`filter-chip ${active ? "filter-chip-active" : ""}`} onClick={onClick}>{children}</button>;
}

function Splash() {
  return <div className="grid min-h-screen place-items-center bg-slate-950 text-white"><div className="app-mark"><span /><span /><span /></div></div>;
}

function deltaText(summary?: Summary) {
  if (!summary || summary.previous_expense_cents === 0) return "Сравнение появится после второго месяца";
  const sign = summary.expense_delta_percent > 0 ? "выше" : "ниже";
  return `${Math.abs(summary.expense_delta_percent).toFixed(0)}% ${sign} прошлого месяца`;
}
