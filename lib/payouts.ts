export type PayoutPeriod = "today" | "7d" | "14d" | "30d" | "custom";

const lagosOffsetMs = 60 * 60 * 1000;

function lagosDate(date = new Date()) {
  return new Date(date.getTime() + lagosOffsetMs).toISOString().slice(0, 10);
}

function utcStartOfLagosDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid calendar date");
  const date = new Date(`${value}T00:00:00+01:00`);
  if (Number.isNaN(date.getTime()) || lagosDate(date) !== value) throw new Error("Invalid calendar date");
  return date;
}

export function payoutDateRange(params: URLSearchParams) {
  const period = (params.get("period") ?? "today") as PayoutPeriod;
  if (!["today", "7d", "14d", "30d", "custom"].includes(period)) throw new Error("Invalid date range");
  const today = lagosDate();
  const from = period === "custom" ? params.get("from") : today;
  const to = period === "custom" ? params.get("to") : today;
  if (!from || !to) throw new Error("Custom range needs start and end dates");
  const end = utcStartOfLagosDate(to);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = utcStartOfLagosDate(from);
  if (period !== "custom") start.setUTCDate(start.getUTCDate() - (period === "7d" ? 6 : period === "14d" ? 13 : period === "30d" ? 29 : 0));
  if (start >= end) throw new Error("Start date must be on or before end date");
  return { from: start.toISOString(), to: end.toISOString(), period };
}

export function nextFridayCutoff(now = new Date()) {
  const day = lagosDate(now);
  const friday = utcStartOfLagosDate(day);
  const lagosWeekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const daysUntilFriday = (5 - lagosWeekday + 7) % 7;
  friday.setUTCDate(friday.getUTCDate() + daysUntilFriday);
  if (friday <= now) friday.setUTCDate(friday.getUTCDate() + 7);
  return friday.toISOString();
}

export function lastFridayCutoff(now = new Date()) {
  const next = new Date(nextFridayCutoff(now));
  next.setUTCDate(next.getUTCDate() - 7);
  return next.toISOString();
}

export function payoutPage(params: URLSearchParams) {
  const page = Number(params.get("page") ?? "1");
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new Error("Invalid page number");
  return { page, size: 10, start: (page - 1) * 10, end: page * 10 - 1 };
}
