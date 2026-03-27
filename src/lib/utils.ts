import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | null | undefined, currency = "EUR") {
  if (value == null) return "–";
  return new Intl.NumberFormat("fi-FI", { style: "currency", currency }).format(value);
}

export function formatDate(date: Date | string | null | undefined) {
  if (!date) return "–";
  return new Intl.DateTimeFormat("fi-FI").format(new Date(date));
}
