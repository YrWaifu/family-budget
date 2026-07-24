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
  PiggyBank,
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
import { amountToCents, dateInputToISO, formatMoney, formatShortDate, isoDate, monthLabel } from "../shared/lib/format";
import { CategoryIcon, iconOptions } from "../shared/lib/icons";

type AuthState = "loading" | "setup" | "login" | "ready";

const transactionSchema = z.object({
  type: z.enum(["expense", "income"]),
  amount: z.string().refine((value) => amountToCents(value) > 0, "Введите сумму"),
  category_id: z.number().min(1, "Выберите категорию"),
  is_essential: z.boolean(),
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
            <Route path="/goals" element={<GoalsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <nav className="fixed bottom-0 left-1/2 z-30 grid w-full max-w-xl -translate-x-1/2 grid-cols-5 border-t border-slate-200 bg-white/95 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <NavItem to="/" icon={<Home size={21} />} label="Главная" />
          <NavItem to="/history" icon={<History size={21} />} label="История" />
          <NavItem to="/goals" icon={<PiggyBank size={21} />} label="Цели" />
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
      <section>
        <ChartCard items={analytics.data?.items ?? []} />
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
  const income = summary?.income_cents ?? 0;
  const expense = summary?.expense_cents ?? 0;
  const balance = summary?.balance_cents ?? 0;
  const spentPercent = income > 0 ? Math.min(100, Math.round((expense / income) * 100)) : 0;
  const savedPercent = income > 0 ? Math.max(0, 100 - spentPercent) : 0;
  const verdict = income <= 0
    ? "Добавь доход, и здесь появится понятная сводка месяца."
    : balance >= 0
      ? `Осталось ${formatMoney(balance)} · ${savedPercent}% дохода не потрачено`
      : `Минус ${formatMoney(Math.abs(balance))} · расходы выше доходов`;
  return (
    <section className="hero-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-white/70">Итог месяца</p>
          <strong className="mt-1 block text-4xl font-black tracking-normal">{loading ? "..." : formatMoney(balance)}</strong>
        </div>
        <div className={`summary-pill ${balance < 0 ? "summary-pill-danger" : ""}`}>
          {balance >= 0 ? "в плюсе" : "перерасход"}
        </div>
      </div>
      <p className="mt-3 text-sm font-semibold text-white/72">{verdict}</p>
      <div className="summary-flow mt-5">
        <Metric label="Пришло" value={formatMoney(income)} />
        <Metric label="Потрачено" value={formatMoney(expense)} />
      </div>
      <div className="summary-bar mt-4" aria-label="Доля потраченного дохода">
        <span className="summary-bar-spent" style={{ width: `${spentPercent}%` }} />
        <span className="summary-bar-left" />
      </div>
      <div className="mt-2 flex justify-between text-xs font-bold text-white/60">
        <span>{spentPercent}% потрачено</span>
        <span>{savedPercent}% осталось</span>
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
  const mergedItems = mergeCategoryTotals(items);
  const data = mergedItems.length ? mergedItems : [{ name: "Нет расходов", amount_cents: 1, color: "#cbd5e1", category_id: 0, icon: "CircleEllipsis", is_essential: true, transactions_count: 0 }];
  return (
    <div className="panel h-56 p-3">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="amount_cents" innerRadius="58%" outerRadius="86%" paddingAngle={3}>
            {data.map((item, index) => <Cell key={`${item.category_id}-${item.is_essential}-${index}`} fill={item.color} />)}
          </Pie>
          <Tooltip formatter={(value) => formatMoney(Number(value))} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function mergeCategoryTotals(items: CategoryTotal[]): CategoryTotal[] {
  const byCategory = new Map<number, CategoryTotal>();
  for (const item of items) {
    const current = byCategory.get(item.category_id);
    if (!current) {
      byCategory.set(item.category_id, { ...item });
      continue;
    }
    current.amount_cents += item.amount_cents;
    current.transactions_count += item.transactions_count;
    current.is_essential = current.is_essential && item.is_essential;
  }
  return Array.from(byCategory.values()).sort((a, b) => b.amount_cents - a.amount_cents);
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
      is_essential: transaction?.is_essential ?? transaction?.category_is_essential ?? categories[0]?.is_essential ?? true,
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
  const selectedCategoryID = form.watch("category_id");
  const availableCategories = useMemo(() => categories.filter((category) => category.kind === selectedType), [categories, selectedType]);
  const suggestions = useQuery({
    queryKey: ["commentSuggestions", selectedCategoryID],
    queryFn: () => api.commentSuggestions(selectedCategoryID),
    enabled: open && selectedCategoryID > 0,
  });
  useEffect(() => {
    if (!availableCategories.some((category) => category.id === form.getValues("category_id")) && availableCategories[0]) {
      form.setValue("category_id", availableCategories[0].id);
      form.setValue("is_essential", availableCategories[0].is_essential);
    }
  }, [availableCategories, form, selectedType]);
  const changeCategory = (value: number) => {
    form.setValue("category_id", value);
    const category = availableCategories.find((item) => item.id === value);
    if (selectedType === "expense" && category) {
      form.setValue("is_essential", category.is_essential);
    }
  };
  const submit = form.handleSubmit((values) => {
    mutation.mutate({
      type: values.type,
      amount_cents: amountToCents(values.amount),
      category_id: values.category_id,
      is_essential: values.type === "expense" ? values.is_essential : true,
      comment: values.comment,
      transaction_date: dateInputToISO(values.transaction_date),
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
            <CategorySelect categories={availableCategories} value={form.watch("category_id")} onChange={changeCategory} />
            {selectedType === "expense" && (
              <RequiredChoice value={form.watch("is_essential")} onChange={(value) => form.setValue("is_essential", value)} name="transaction-essential" />
            )}
            <label className="field">
              <span>Дата</span>
              <input type="date" {...form.register("transaction_date")} />
            </label>
            <label className="field">
              <span>Комментарий</span>
              <input maxLength={240} placeholder="Необязательно" {...form.register("comment")} />
            </label>
            {(suggestions.data?.suggestions ?? []).length > 0 && (
              <div className="suggestion-row">
                {suggestions.data!.suggestions.map((comment) => (
                  <button key={comment} type="button" className="suggestion-chip" onClick={() => form.setValue("comment", comment)}>
                    {comment}
                  </button>
                ))}
              </div>
            )}
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
  const [comment, setComment] = useState("");
  const [isEssential, setIsEssential] = useState(true);
  const queryClient = useQueryClient();
  const suggestions = useQuery({
    queryKey: ["commentSuggestions", category?.id],
    queryFn: () => api.commentSuggestions(category!.id),
    enabled: open && Boolean(category?.id),
  });
  const mutation = useMutation({
    mutationFn: () => api.createTransaction({ type: "expense", amount_cents: amountToCents(amount), category_id: category!.id, is_essential: isEssential, comment, transaction_date: new Date().toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      onSaved();
      setAmount("");
      setComment("");
      setIsEssential(true);
      onOpenChange(false);
    },
  });
  useEffect(() => {
    if (open) {
      setAmount("");
      setComment("");
      setIsEssential(category?.is_essential ?? true);
    }
  }, [category?.is_essential, open]);
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
          <div className="mt-4">
            <RequiredChoice value={isEssential} onChange={setIsEssential} name="quick-essential" />
          </div>
          <label className="field mt-4">
            <span>Комментарий</span>
            <input maxLength={240} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Необязательно" />
          </label>
          {(suggestions.data?.suggestions ?? []).length > 0 && (
            <div className="suggestion-row mt-2">
              {suggestions.data!.suggestions.map((item) => (
                <button key={item} type="button" className="suggestion-chip" onClick={() => setComment(item)}>
                  {item}
                </button>
              ))}
            </div>
          )}
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

function CategoryIconSelect({ value, color, onChange }: { value: string; color: string; onChange: (value: string) => void }) {
  const selected = iconOptions.find((option) => option.name === value) ?? iconOptions[iconOptions.length - 1];
  return (
    <label className="field">
      <span>Иконка</span>
      <Select.Root value={value} onValueChange={onChange}>
        <Select.Trigger className="select-trigger">
          <span className="flex min-w-0 items-center gap-2">
            <span className="category-badge tiny" style={{ backgroundColor: color }}>
              <CategoryIcon name={selected.name} className="h-4 w-4 text-white" />
            </span>
            <Select.Value />
          </span>
          <Select.Icon><ChevronDown size={18} /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="select-content">
            <Select.Viewport>
              {iconOptions.map((option) => (
                <Select.Item className="select-item" value={option.name} key={option.name}>
                  <Select.ItemText>
                    <span className="flex items-center gap-2">
                      <CategoryIcon name={option.name} className="h-4 w-4" />
                      <span>{option.label}</span>
                    </span>
                  </Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </label>
  );
}

function RequiredChoice({ value, onChange, name }: { value: boolean; onChange: (value: boolean) => void; name: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-bold text-slate-500">Тип расхода</p>
      <div className="required-choice">
        <label className={value ? "required-choice-active" : ""}>
          <input type="radio" name={name} checked={value} onChange={() => onChange(true)} />
          <span className="required-check"><Check size={14} /></span>
          <span>
            <b>Обязательная</b>
            <small>То, без чего нельзя: продукты, дом, здоровье</small>
          </span>
        </label>
        <label className={!value ? "required-choice-active" : ""}>
          <input type="radio" name={name} checked={!value} onChange={() => onChange(false)} />
          <span className="required-check"><Check size={14} /></span>
          <span>
            <b>Необязательная</b>
            <small>То, что можно сократить: покупки, кафе, развлечения</small>
          </span>
        </label>
      </div>
    </div>
  );
}

function HistoryPage() {
  const [filters, setFilters] = useState({ q: "", type: "", category: "", essential: "" });
  const [date, setDate] = useState(() => new Date());
  const query = `?year=${date.getFullYear()}&month=${date.getMonth() + 1}&limit=80&q=${encodeURIComponent(filters.q)}${filters.type ? `&type=${filters.type}` : ""}${filters.category ? `&category_id=${filters.category}` : ""}${filters.essential ? `&essential=${filters.essential}` : ""}`;
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
        <FilterChip active={filters.essential === "true"} onClick={() => setFilters({ ...filters, essential: filters.essential === "true" ? "" : "true" })}>Обязательные</FilterChip>
        <FilterChip active={filters.essential === "false"} onClick={() => setFilters({ ...filters, essential: filters.essential === "false" ? "" : "false" })}>Необязательные</FilterChip>
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
              {[item.comment, item.author_name, formatShortDate(item.transaction_date)].filter(Boolean).join(" · ")}
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
  const [essentialFilter, setEssentialFilter] = useState("");
  const [view, setView] = useState<"days" | "months" | "categories">("days");
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const summary = useQuery({ queryKey: ["summary", year, month], queryFn: () => api.summary(year, month) });
  const categories = useQuery({ queryKey: ["categoryAnalytics", year, month, essentialFilter], queryFn: () => api.categoryAnalytics(year, month, essentialFilter) });
  const allCategories = useQuery({ queryKey: ["categoryAnalytics", year, month, "all"], queryFn: () => api.categoryAnalytics(year, month) });
  const timeline = useQuery({ queryKey: ["timeline", year, month, essentialFilter], queryFn: () => api.timeline(year, month, essentialFilter) });
  const monthlyTimeline = useQuery({ queryKey: ["monthlyTimeline", year, essentialFilter], queryFn: () => api.monthlyTimeline(year, essentialFilter) });
  const dayData = timeline.data?.items.map((item) => ({ ...item, label: item.date.slice(8), expense: item.expense_cents / 100, income: item.income_cents / 100 })) ?? [];
  const monthData = monthlyTimeline.data?.items.map((item) => ({ ...item, label: monthLabel(Number(item.date.slice(0, 4)), Number(item.date.slice(5, 7))).slice(0, 3), expense: item.expense_cents / 100, income: item.income_cents / 100 })) ?? [];
  const allItems = allCategories.data?.items ?? [];
  const totalExpenses = allItems.reduce((sum, item) => sum + item.amount_cents, 0);
  const essentialTotal = allItems.filter((item) => item.is_essential).reduce((sum, item) => sum + item.amount_cents, 0);
  const optionalTotal = totalExpenses - essentialTotal;
  const filteredItems = categories.data?.items ?? [];
  const categoryItems = essentialFilter ? filteredItems : mergeCategoryTotals(filteredItems);
  return (
    <div className="space-y-4 pb-8">
      <MonthSwitcher date={date} onChange={setDate} />
      <div className="grid grid-cols-2 gap-3">
        <SmallStat title="Расходы" value={formatMoney(summary.data?.expense_cents ?? 0)} />
        <SmallStat title="Доходы" value={formatMoney(summary.data?.income_cents ?? 0)} />
      </div>
      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">Обязательные</p>
            <strong className="text-lg">{formatMoney(essentialTotal)}</strong>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500">Необязательные</p>
            <strong className="text-lg">{formatMoney(optionalTotal)}</strong>
          </div>
        </div>
        <div className="progress-track">
          <div className="progress-fill bg-sky-500" style={{ width: `${totalExpenses ? (essentialTotal / totalExpenses) * 100 : 0}%` }} />
        </div>
        <p className="text-xs font-semibold text-slate-500">
          {totalExpenses ? `${Math.round((optionalTotal / totalExpenses) * 100)}% расходов можно пересмотреть` : "За месяц расходов пока нет"}
        </p>
      </div>
      <div className="segmented segmented-3">
        <button type="button" className={!essentialFilter ? "selected" : ""} onClick={() => setEssentialFilter("")}>Все</button>
        <button type="button" className={essentialFilter === "true" ? "selected" : ""} onClick={() => setEssentialFilter("true")}>Обязательные</button>
        <button type="button" className={essentialFilter === "false" ? "selected" : ""} onClick={() => setEssentialFilter("false")}>Необязательные</button>
      </div>
      <div className="segmented segmented-3">
        <button type="button" className={view === "days" ? "selected" : ""} onClick={() => setView("days")}>Дни</button>
        <button type="button" className={view === "months" ? "selected" : ""} onClick={() => setView("months")}>Месяцы</button>
        <button type="button" className={view === "categories" ? "selected" : ""} onClick={() => setView("categories")}>Категории</button>
      </div>
      {view === "days" && <TimelineChart data={dayData} emptyText="За выбранный месяц операций пока нет" />}
      {view === "months" && <TimelineChart data={monthData} emptyText="За выбранный год операций пока нет" />}
      {view === "categories" && (
        <>
          <div className="panel h-72 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryItems}>
                <XAxis dataKey="name" hide />
                <Tooltip formatter={(value) => formatMoney(Number(value))} />
                <Bar dataKey="amount_cents" radius={[6, 6, 0, 0]}>
                  {categoryItems.map((item) => <Cell key={`${item.category_id}-${item.is_essential}`} fill={item.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <CategoryBreakdown items={categoryItems} total={categoryItems.reduce((sum, item) => sum + item.amount_cents, 0)} />
        </>
      )}
    </div>
  );
}

function TimelineChart({ data, emptyText }: { data: Array<{ label: string; expense: number; income: number }>; emptyText: string }) {
  const hasData = data.some((item) => item.expense > 0 || item.income > 0);
  if (!hasData) return <div className="empty-panel">{emptyText}</div>;
  return (
    <div className="panel h-72 p-3">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <Tooltip formatter={(value) => formatMoney(Number(value) * 100)} />
          <Area type="monotone" dataKey="expense" name="Расходы" stroke="#f97316" fill="#fed7aa" strokeWidth={2} />
          <Area type="monotone" dataKey="income" name="Доходы" stroke="#22c55e" fill="#bbf7d0" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoryBreakdown({ items, total }: { items: CategoryTotal[]; total: number }) {
  if (!items.length) return <div className="empty-panel">Нет расходов для выбранного фильтра</div>;
  return (
    <div className="panel divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
      {items.map((item) => {
        const percent = total ? Math.round((item.amount_cents / total) * 100) : 0;
        return (
          <div className="space-y-2 p-3" key={`${item.category_id}-${item.is_essential}`}>
            <div className="flex items-center gap-3">
              <span className="category-badge small" style={{ backgroundColor: item.color }}>
                <CategoryIcon name={item.icon} className="h-5 w-5 text-white" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{item.name}</p>
                <p className="text-xs text-slate-500">{item.is_essential ? "Обязательная" : "Необязательная"} · {item.transactions_count} оп.</p>
              </div>
              <div className="text-right">
                <strong>{formatMoney(item.amount_cents)}</strong>
                <p className="text-xs text-slate-500">{percent}%</p>
              </div>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${percent}%`, backgroundColor: item.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GoalsPage() {
  const queryClient = useQueryClient();
  const goals = useQuery({ queryKey: ["goals"], queryFn: api.goals });
  const [salaryDaysInput, setSalaryDaysInput] = useState(() => localStorage.getItem("salary_days") ?? "");
  const items = goals.data?.goals ?? [];
  const salaryDays = parseSalaryDays(salaryDaysInput);
  const activeGoals = items
    .filter((goal) => !goal.is_completed)
    .sort((left, right) => goalPriority(left) - goalPriority(right));
  const completedGoals = items.filter((goal) => goal.is_completed);
  const targetTotal = activeGoals.reduce((sum, goal) => sum + goal.target_amount_cents, 0);
  const currentTotal = activeGoals.reduce((sum, goal) => sum + goal.current_amount_cents, 0);
  const remainingTotal = Math.max(0, targetTotal - currentTotal);
  const salaryPlan = activeGoals.reduce((sum, goal) => sum + (goalPerSalaryNeed(goal, salaryDays) ?? 0), 0);
  const closestGoal = activeGoals[0];
  const progress = targetTotal ? Math.min(100, (currentTotal / targetTotal) * 100) : 0;
  useEffect(() => {
    localStorage.setItem("salary_days", salaryDaysInput);
  }, [salaryDaysInput]);
  return (
    <div className="space-y-4 pb-8">
      <section className="hero-panel">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-white/70">Цели</p>
            <strong className="mt-1 block text-4xl font-black tracking-normal">{formatMoney(currentTotal)}</strong>
            <p className="mt-1 text-sm font-bold text-white/75">накоплено из {formatMoney(targetTotal)}</p>
          </div>
          <span className="summary-pill">{activeGoals.length ? `${activeGoals.length} активн.` : "план пуст"}</span>
        </div>
        <div className="mt-5 flex items-center justify-between text-sm font-bold text-white/80">
          <span>Общий прогресс</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-white/15">
          <div className="h-full rounded-full bg-white" style={{ width: `${progress}%` }} />
        </div>
        <div className="goal-hero-grid">
          <div>
            <span>Осталось</span>
            <strong>{formatMoney(remainingTotal)}</strong>
          </div>
          <div>
            <span>С каждой зарплаты</span>
            <strong>{salaryPlan ? formatMoney(salaryPlan) : "нужны дни"}</strong>
          </div>
        </div>
        {closestGoal && (
          <p className="mt-3 text-sm font-bold text-white/75">
            Ближайшая: {closestGoal.name} · {goalDeadlineText(closestGoal)}
          </p>
        )}
      </section>
      <section className="panel salary-days-panel">
        <div className="min-w-0 flex-1">
          <h2 className="font-black">Зарплатные дни</h2>
          <p className="text-sm font-bold text-slate-500">
            {salaryDays.length ? `Расчет по дням: ${salaryDays.join(", ")}` : "Укажи числа месяца через запятую"}
          </p>
        </div>
        <input
          className="plain-input"
          inputMode="numeric"
          value={salaryDaysInput}
          onChange={(event) => setSalaryDaysInput(event.target.value)}
          placeholder="5, 20"
        />
      </section>
      <GoalRow salaryDays={salaryDays} onSaved={() => queryClient.invalidateQueries()} />
      {activeGoals.length ? (
        <div className="space-y-3">
          {activeGoals.map((goal) => <GoalRow key={goal.id} goal={goal} salaryDays={salaryDays} onSaved={() => queryClient.invalidateQueries()} />)}
        </div>
      ) : (
        <div className="empty-panel">Целей пока нет. Добавь первую, и здесь появится понятный план накопления.</div>
      )}
      {completedGoals.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-sm font-black uppercase text-slate-500">Завершенные</h2>
          {completedGoals.map((goal) => <GoalRow key={goal.id} goal={goal} salaryDays={salaryDays} onSaved={() => queryClient.invalidateQueries()} />)}
        </section>
      )}
    </div>
  );
}

function parseSalaryDays(value: string): number[] {
  return Array.from(
    new Set(
      value
        .split(/[,\s;]+/)
        .map((part) => Number(part))
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31),
    ),
  ).sort((left, right) => left - right);
}

function goalDateValue(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

function goalDaysLeft(goal: Goal): number | null {
  const value = goalDateValue(goal.deadline);
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const deadline = new Date(year, month - 1, day).getTime();
  return Math.ceil((deadline - start) / 86400000);
}

function goalRemaining(goal: Goal): number {
  return Math.max(0, goal.target_amount_cents - goal.current_amount_cents);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function salaryEventsUntil(deadlineValue: string, salaryDays: number[]): number {
  const [year, month, day] = deadlineValue.split("-").map(Number);
  if (!year || !month || !day || !salaryDays.length) return 0;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const deadline = new Date(year, month - 1, day);
  const events = new Set<string>();
  for (let cursor = new Date(start.getFullYear(), start.getMonth(), 1); cursor <= deadline; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
    for (const salaryDay of salaryDays) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), Math.min(salaryDay, daysInMonth(cursor.getFullYear(), cursor.getMonth())));
      if (date >= start && date <= deadline) events.add(isoDate(date));
    }
  }
  return events.size;
}

function goalPerSalaryNeed(goal: Goal, salaryDays: number[]): number | null {
  const remaining = goalRemaining(goal);
  if (!remaining) return 0;
  const deadline = goalDateValue(goal.deadline);
  if (!deadline || !salaryDays.length) return null;
  return Math.ceil(remaining / Math.max(1, salaryEventsUntil(deadline, salaryDays)));
}

function recurringDueDate(dayOfMonth: number): Date {
  const today = new Date();
  const currentMonthDay = Math.min(dayOfMonth, daysInMonth(today.getFullYear(), today.getMonth()));
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), currentMonthDay);
  if (thisMonth >= new Date(today.getFullYear(), today.getMonth(), today.getDate())) return thisMonth;
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return new Date(nextMonth.getFullYear(), nextMonth.getMonth(), Math.min(dayOfMonth, daysInMonth(nextMonth.getFullYear(), nextMonth.getMonth())));
}

function recurringSalaryPlan(payment: RecurringPayment, salaryDays: number[]): { perSalary: number | null; salaryCount: number; dueDate: Date } {
  const dueDate = recurringDueDate(payment.day_of_month);
  const salaryCount = salaryEventsUntil(isoDate(dueDate), salaryDays);
  return {
    perSalary: salaryDays.length ? Math.ceil(payment.amount_cents / Math.max(1, salaryCount)) : null,
    salaryCount,
    dueDate,
  };
}

function goalPriority(goal: Goal): number {
  const daysLeft = goalDaysLeft(goal);
  if (daysLeft !== null) return daysLeft;
  return 100000 + goalRemaining(goal);
}

function goalDeadlineText(goal: Goal): string {
  const daysLeft = goalDaysLeft(goal);
  if (daysLeft === null) return "без срока";
  const date = formatShortDate(dateInputToISO(goalDateValue(goal.deadline)));
  if (daysLeft < 0) return `срок был ${date}`;
  if (daysLeft === 0) return `срок сегодня`;
  return `${date}, осталось ${daysLeft} дн.`;
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ["categories-all"], queryFn: () => api.categories(true) });
  const expenseCategories = useQuery({ queryKey: ["categories", "expense", "all"], queryFn: () => api.categories(true, "expense") });
  const recurring = useQuery({ queryKey: ["recurring"], queryFn: api.recurring });
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [categorySearch, setCategorySearch] = useState("");
  const [salaryDaysInput, setSalaryDaysInput] = useState(() => localStorage.getItem("salary_days") ?? "");
  const salaryDays = parseSalaryDays(salaryDaysInput);
  const recurringItems = recurring.data?.recurring_payments ?? [];
  const recurringSalaryTotal = recurringItems
    .filter((payment) => payment.is_active)
    .reduce((sum, payment) => sum + (recurringSalaryPlan(payment, salaryDays).perSalary ?? 0), 0);
  const filteredCategories = useMemo(() => {
    const query = categorySearch.trim().toLowerCase();
    const items = categories.data?.categories ?? [];
    if (!query) return items;
    return items.filter((category) => category.name.toLowerCase().includes(query));
  }, [categories.data?.categories, categorySearch]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  useEffect(() => {
    localStorage.setItem("salary_days", salaryDaysInput);
  }, [salaryDaysInput]);
  return (
    <div className="space-y-4 pb-8">
      <div className="panel flex items-center justify-between p-4">
        <span className="flex items-center gap-2 font-semibold">{dark ? <Moon size={19} /> : <Sun size={19} />} Тема</span>
        <Switch.Root className="switch-root" checked={dark} onCheckedChange={setDark}><Switch.Thumb className="switch-thumb" /></Switch.Root>
      </div>
      <Tabs.Root defaultValue="categories" className="space-y-4">
        <Tabs.List className="tabs-list">
          <Tabs.Trigger value="categories">Категории</Tabs.Trigger>
          <Tabs.Trigger value="regular">Регулярные</Tabs.Trigger>
          <Tabs.Trigger value="backup">Бэкап</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="categories" className="space-y-2">
          <CategoryEditor onSaved={() => queryClient.invalidateQueries()} />
          <label className="search-box">
            <Search size={18} />
            <input value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} placeholder="Найти категорию" />
          </label>
          {filteredCategories.map((category) => <CategoryEditor key={category.id} category={category} onSaved={() => queryClient.invalidateQueries()} />)}
          {!filteredCategories.length && <div className="empty-panel">Категория не найдена</div>}
        </Tabs.Content>
        <Tabs.Content value="regular" className="space-y-2">
          <div className="panel recurring-summary">
            <div>
              <h2 className="text-lg font-black">Регулярные расходы</h2>
              <p className="text-sm font-bold text-slate-500">
                {salaryDays.length ? `Зарплатные дни: ${salaryDays.join(", ")}` : "Укажи зарплатные дни, чтобы видеть сумму с каждой зарплаты"}
              </p>
            </div>
            <div className="recurring-summary-total">
              <span>Отложить с зарплаты</span>
              <strong>{recurringSalaryTotal ? formatMoney(recurringSalaryTotal) : "0 ₽"}</strong>
            </div>
            <input
              className="plain-input"
              inputMode="numeric"
              value={salaryDaysInput}
              onChange={(event) => setSalaryDaysInput(event.target.value)}
              placeholder="5, 20"
            />
          </div>
          <RecurringRow categories={expenseCategories.data?.categories ?? []} salaryDays={salaryDays} onSaved={() => queryClient.invalidateQueries()} />
          {recurringItems.map((payment) => <RecurringRow key={payment.id} payment={payment} categories={expenseCategories.data?.categories ?? []} salaryDays={salaryDays} onSaved={() => queryClient.invalidateQueries()} />)}
        </Tabs.Content>
        <Tabs.Content value="backup" className="space-y-2">
          <div className="panel space-y-3 p-4">
            <h2 className="text-lg font-bold">Бэкап данных</h2>
            <p className="text-sm text-slate-500">
              Скачивается JSON-файл со всеми профилями, категориями, операциями, целями и регулярными шаблонами.
            </p>
            <a className="primary-button justify-center" href="/api/v1/backup">
              <Download size={18} /> Скачать бэкап
            </a>
            <a className="secondary-button justify-center" href="/api/v1/export?format=csv">
              <Download size={18} /> Скачать историю CSV
            </a>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function CategoryEditor({ category, onSaved }: { category?: Category; onSaved: () => void }) {
  const isNew = !category;
  const [expanded, setExpanded] = useState(isNew);
  const [draft, setDraft] = useState<Partial<Category>>(category ?? { name: "", icon: "CircleEllipsis", color: "#38bdf8", kind: "expense", sort_order: 130, is_active: true, is_essential: true });
  const [message, setMessage] = useState("");
  const mutation = useMutation({
    mutationFn: () => api.saveCategory(draft),
    onSuccess: () => {
      onSaved();
      if (!isNew) setExpanded(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteCategory(category!.id),
    onSuccess: onSaved,
    onError: (error) => setMessage(error.message || "Категория уже используется. Ее можно скрыть."),
  });
  const colors = ["#22c55e", "#f97316", "#3b82f6", "#14b8a6", "#ef4444", "#8b5cf6", "#06b6d4", "#f43f5e", "#eab308", "#64748b"];
  const meta = `${draft.kind === "income" ? "Доход" : "Расход"} · ${draft.is_active === false ? "скрыта" : "активна"}`;
  if (!expanded) {
    return (
      <button className="panel category-editor-summary" type="button" onClick={() => setExpanded(true)}>
        <span className="category-badge small" style={{ backgroundColor: draft.color }}>
          <CategoryIcon name={draft.icon ?? "CircleEllipsis"} className="h-5 w-5 text-white" />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate font-bold">{draft.name}</span>
          <span className="block truncate text-xs text-slate-500">{meta}</span>
        </span>
        <ChevronDown size={18} className="text-slate-400" />
      </button>
    );
  }
  return (
    <div className="panel space-y-4 p-4">
      <div className="flex items-center gap-3">
        <span className="category-badge small" style={{ backgroundColor: draft.color }}>
          <CategoryIcon name={draft.icon ?? "CircleEllipsis"} className="h-5 w-5 text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">{isNew ? "Новая категория" : draft.name}</h3>
          <p className="text-xs text-slate-500">{meta}</p>
        </div>
        {!isNew && (
          <button className="icon-button" type="button" onClick={() => setExpanded(false)} title="Свернуть">
            <ChevronDown size={18} />
          </button>
        )}
      </div>
      <label className="field">
        <span>Название</span>
        <input value={draft.name ?? ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Например, Такси" />
      </label>
      <div className="segmented">
        <button type="button" className={draft.kind !== "income" ? "selected" : ""} onClick={() => setDraft({ ...draft, kind: "expense" })}>Расход</button>
        <button type="button" className={draft.kind === "income" ? "selected" : ""} onClick={() => setDraft({ ...draft, kind: "income", is_essential: true })}>Доход</button>
      </div>
      <CategoryIconSelect value={draft.icon ?? "CircleEllipsis"} color={draft.color ?? "#38bdf8"} onChange={(icon) => setDraft({ ...draft, icon })} />
      <div className="space-y-2">
        <p className="text-sm font-bold text-slate-500">Цвет</p>
        <div className="color-grid">
          {colors.map((color) => (
            <button
              key={color}
              className={`color-swatch ${draft.color === color ? "color-swatch-active" : ""}`}
              style={{ backgroundColor: color }}
              onClick={() => setDraft({ ...draft, color })}
              type="button"
              title={color}
            />
          ))}
          <input className="color-input" type="color" value={draft.color ?? "#38bdf8"} onChange={(event) => setDraft({ ...draft, color: event.target.value })} />
        </div>
      </div>
      {message && <p className="error-text">{message}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button className="primary-button justify-center" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          <Check size={18} /> {isNew ? "Создать" : "Сохранить"}
        </button>
        {category ? (
          <button
            className="secondary-button justify-center"
            onClick={() => {
              const nextDraft = { ...draft, is_active: !(draft.is_active ?? true) };
              setDraft(nextDraft);
              api.saveCategory(nextDraft).then(onSaved).catch((error) => setMessage(error.message));
            }}
          >
            {(draft.is_active ?? true) ? "Скрыть" : "Показать"}
          </button>
        ) : (
          <button className="secondary-button justify-center" onClick={() => setDraft({ name: "", icon: "CircleEllipsis", color: "#38bdf8", kind: "expense", sort_order: 130, is_active: true, is_essential: true })}>
            Очистить
          </button>
        )}
      </div>
      {category && (
        <button className="danger-button" onClick={() => window.confirm("Удалить категорию? Если она уже использовалась, лучше скрыть ее.") && remove.mutate()}>
          <Trash2 size={18} /> Удалить категорию
        </button>
      )}
    </div>
  );
}

function GoalRow({ goal, salaryDays, onSaved }: { goal?: Goal; salaryDays: number[]; onSaved: () => void }) {
  const isNew = !goal;
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? String(goal.target_amount_cents / 100) : "");
  const [current, setCurrent] = useState(goal ? String(goal.current_amount_cents / 100) : "");
  const [deadline, setDeadline] = useState(goalDateValue(goal?.deadline));
  const [deposit, setDeposit] = useState("");
  const [message, setMessage] = useState("");
  const progress = goal ? Math.min(100, Math.round((goal.current_amount_cents / Math.max(1, goal.target_amount_cents)) * 100)) : 0;
  const remaining = goal ? goalRemaining(goal) : Math.max(0, amountToCents(target) - amountToCents(current));
  const salaryNeed = goal ? goalPerSalaryNeed(goal, salaryDays) : null;
  const salaryCount = goal ? salaryEventsUntil(goalDateValue(goal.deadline), salaryDays) : 0;
  const quickAmounts = [1000, 3000, 5000].map((value) => value * 100).filter((value) => value < remaining);
  if (goal && remaining > 0 && !quickAmounts.includes(remaining)) quickAmounts.push(remaining);
  const save = useMutation({
    mutationFn: () =>
      api.saveGoal({
        ...goal,
        name: name.trim(),
        target_amount_cents: amountToCents(target),
        current_amount_cents: amountToCents(current),
        icon: "PiggyBank",
        color: goal?.color ?? "#38bdf8",
        deadline: deadline ? dateInputToISO(deadline) : null,
        is_completed: goal?.is_completed ?? false,
      }),
    onSuccess: (savedGoal) => {
      if (isNew) {
        setName("");
        setTarget("");
        setCurrent("");
        setDeadline("");
      }
      if (!isNew) {
        setCurrent(String(savedGoal.current_amount_cents / 100));
      }
      onSaved();
    },
  });
  const complete = useMutation({
    mutationFn: () => api.saveGoal({ ...goal, is_completed: !goal!.is_completed }),
    onSuccess: onSaved,
  });
  const add = useMutation({
    mutationFn: (amount: number) => api.depositGoal(goal!.id, amount),
    onSuccess: (savedGoal) => {
      setDeposit("");
      setCurrent(String(savedGoal.current_amount_cents / 100));
      onSaved();
    },
  });
  const remove = useMutation({ mutationFn: () => api.deleteGoal(goal!.id), onSuccess: onSaved });
  const saveGoal = () => {
    if (!name.trim() || amountToCents(target) <= 0) {
      setMessage("Заполни название и сумму цели");
      return;
    }
    if (amountToCents(current) > amountToCents(target)) {
      setMessage("Уже накоплено не может быть больше суммы цели");
      return;
    }
    setMessage("");
    save.mutate();
  };
  return (
    <div className={`panel goal-card ${goal?.is_completed ? "goal-card-completed" : ""}`}>
      <div className="goal-card-head">
        <span className="category-badge small" style={{ backgroundColor: goal?.color ?? "#38bdf8" }}>
          <PiggyBank size={20} className="text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-black">{goal ? goal.name : "Новая цель"}</h3>
          <p className="text-xs font-bold text-slate-500">
            {goal ? (goal.is_completed ? "готово" : goalDeadlineText(goal)) : "создай цель, срок можно не ставить"}
          </p>
        </div>
        {goal && <span className="goal-status-pill">{progress}%</span>}
      </div>

      {goal && (
        <div className="goal-plan">
          <div>
            <span>Накоплено</span>
            <strong>{formatMoney(goal.current_amount_cents)}</strong>
          </div>
          <div>
            <span>Осталось</span>
            <strong>{formatMoney(remaining)}</strong>
          </div>
          <div>
            <span>С зарплаты</span>
            <strong>{salaryNeed === null ? "нужны дни" : salaryNeed ? formatMoney(salaryNeed) : "готово"}</strong>
          </div>
        </div>
      )}

      {goal && (
        <div className="space-y-2">
          <div className="progress-track">
            <div className="progress-fill bg-sky-500" style={{ width: `${progress}%` }} />
          </div>
          {remaining === 0 && <p className="text-sm font-bold text-emerald-600">Цель набрана. Можно отметить ее завершенной.</p>}
          {remaining > 0 && salaryNeed !== null && (
            <p className="text-sm font-bold text-slate-500">
              До срока осталось зарплат: {salaryCount || 1}. Откладывай по {formatMoney(salaryNeed)}.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="field">
          <span>Название</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, отпуск" />
        </label>
        <label className="field">
          <span>Нужно накопить</span>
          <input inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="100000" />
        </label>
        <label className="field">
          <span>Уже накоплено</span>
          <input inputMode="decimal" value={current} onChange={(event) => setCurrent(event.target.value)} placeholder="0" />
        </label>
        <label className="field">
          <span>Хочу к дате</span>
          <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
        </label>
      </div>

      {goal && (
        <>
          {quickAmounts.length > 0 && (
            <div className="goal-quick-grid">
              {quickAmounts.map((amount) => (
                <button key={amount} className="secondary-button justify-center" type="button" disabled={add.isPending} onClick={() => add.mutate(amount)}>
                  +{formatMoney(amount)}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <label className="field">
              <span>Пополнить вручную</span>
              <input inputMode="decimal" value={deposit} onChange={(event) => setDeposit(event.target.value)} placeholder="5000" />
            </label>
            <button className="icon-button self-end" disabled={amountToCents(deposit) <= 0 || add.isPending} onClick={() => add.mutate(amountToCents(deposit))} title="Пополнить"><Plus size={18} /></button>
          </div>
        </>
      )}
      {message && <p className="error-text">{message}</p>}
      <div className={goal ? "grid grid-cols-2 gap-2" : ""}>
        <button className="primary-button w-full justify-center" onClick={saveGoal} disabled={save.isPending}>
          <Check size={18} /> {goal ? "Сохранить" : "Создать цель"}
        </button>
        {goal && (
          <button className="secondary-button justify-center" type="button" onClick={() => complete.mutate()} disabled={complete.isPending}>
            {goal.is_completed ? "Вернуть" : "Завершить"}
          </button>
        )}
      </div>
      {goal && (
        <button className="danger-button" onClick={() => window.confirm("Удалить цель?") && remove.mutate()}>
          <Trash2 size={18} /> Удалить цель
        </button>
      )}
    </div>
  );
}

function RecurringRow({ payment, categories, salaryDays, onSaved }: { payment?: RecurringPayment; categories: Category[]; salaryDays: number[]; onSaved: () => void }) {
  const isNew = !payment;
  const [name, setName] = useState(payment?.name ?? "");
  const [amount, setAmount] = useState(payment ? String(payment.amount_cents / 100) : "");
  const [categoryID, setCategoryID] = useState(payment?.category_id ?? categories[0]?.id ?? 0);
  const [day, setDay] = useState(payment?.day_of_month ?? 1);
  const [message, setMessage] = useState("");
  const paymentPlan = payment ? recurringSalaryPlan(payment, salaryDays) : null;
  useEffect(() => {
    if (!categoryID && categories[0]) setCategoryID(categories[0].id);
  }, [categories, categoryID]);
  const save = useMutation({ mutationFn: () => api.saveRecurring({ ...payment, name, amount_cents: amountToCents(amount), category_id: categoryID, day_of_month: day, is_active: payment?.is_active ?? true }), onSuccess: onSaved });
  const pay = useMutation({ mutationFn: () => api.payRecurring(payment!.id), onSuccess: onSaved });
  const remove = useMutation({ mutationFn: () => api.deleteRecurring(payment!.id), onSuccess: onSaved });
  return (
    <div className="panel space-y-3 p-3">
      <div className="flex items-center gap-3">
        {payment && (
          <span className="category-badge small" style={{ backgroundColor: payment.category_color }}>
            <CategoryIcon name={payment.category_icon} className="h-5 w-5 text-white" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-black">{isNew ? "Новый шаблон" : name}</h3>
          {paymentPlan && (
            <p className="text-xs font-bold text-slate-500">
              Списание {formatShortDate(isoDate(paymentPlan.dueDate))}
            </p>
          )}
        </div>
      </div>
      {payment && paymentPlan && (
        <div className="recurring-plan">
          <div>
            <span>Платеж</span>
            <strong>{formatMoney(payment.amount_cents)}</strong>
          </div>
          <div>
            <span>С зарплаты</span>
            <strong>{paymentPlan.perSalary === null ? "нужны дни" : formatMoney(paymentPlan.perSalary)}</strong>
          </div>
          <div>
            <span>До списания</span>
            <strong>{paymentPlan.salaryCount || 1} зарпл.</strong>
          </div>
        </div>
      )}
      <label className="field">
        <span>Название</span>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, интернет" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="field">
          <span>Сумма</span>
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="990" />
        </label>
        <label className="field">
          <span>День месяца</span>
          <input type="number" min={1} max={31} value={day} onChange={(event) => setDay(Number(event.target.value))} />
        </label>
      </div>
      <CategorySelect categories={categories} value={categoryID} onChange={setCategoryID} />
      {message && <p className="error-text">{message}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button
          className="primary-button justify-center"
          onClick={() => {
            if (!name.trim() || amountToCents(amount) <= 0 || !categoryID) {
              setMessage("Заполни название, сумму и категорию");
              return;
            }
            setMessage("");
            save.mutate();
          }}
        >
          <Check size={18} /> {isNew ? "Создать" : "Сохранить"}
        </button>
        {payment && (
          <button className="secondary-button justify-center" onClick={() => pay.mutate()}>
            Записать расход
          </button>
        )}
      </div>
      {payment && (
        <button className="danger-button" onClick={() => window.confirm("Удалить этот шаблон? Уже созданные расходы останутся в истории.") && remove.mutate()}>
          <Trash2 size={18} /> Удалить шаблон
        </button>
      )}
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
