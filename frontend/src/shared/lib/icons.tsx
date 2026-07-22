import {
  Car,
  CircleEllipsis,
  Gift,
  Heart,
  HeartPulse,
  Home,
  PiggyBank,
  Plane,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Utensils,
  WalletCards,
  Wifi,
  type LucideIcon,
} from "lucide-react";

/* eslint-disable react-refresh/only-export-components */

const icons: Record<string, LucideIcon> = {
  Car,
  CircleEllipsis,
  Gift,
  Heart,
  HeartPulse,
  Home,
  PiggyBank,
  Plane,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Utensils,
  WalletCards,
  Wifi,
};

export function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const Icon = icons[name] ?? CircleEllipsis;
  return <Icon className={className} aria-hidden="true" />;
}

export const iconOptions = [
  { name: "ShoppingBasket", label: "Продукты" },
  { name: "Utensils", label: "Кафе" },
  { name: "Home", label: "Дом" },
  { name: "Car", label: "Машина" },
  { name: "HeartPulse", label: "Здоровье" },
  { name: "ShoppingBag", label: "Покупки" },
  { name: "Plane", label: "Поездки" },
  { name: "Shirt", label: "Одежда" },
  { name: "Gift", label: "Подарки" },
  { name: "Wifi", label: "Связь" },
  { name: "WalletCards", label: "Доход" },
  { name: "PiggyBank", label: "Цель" },
  { name: "Heart", label: "Забота" },
  { name: "CircleEllipsis", label: "Другое" },
];
