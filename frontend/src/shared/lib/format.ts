export const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

export function formatMoney(cents: number): string {
  return money.format(Math.round(cents / 100));
}

export function amountToCents(value: string): number {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return 0;
  const [rubles, kopecks = ""] = normalized.split(".");
  return Number(rubles) * 100 + Number(kopecks.padEnd(2, "0"));
}

export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

export function isoDate(value = new Date()): string {
  return value.toISOString().slice(0, 10);
}

