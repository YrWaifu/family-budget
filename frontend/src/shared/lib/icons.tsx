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

export const iconNames = Object.keys(icons);
