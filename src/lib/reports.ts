// Shared helpers for report pages
export function dateRange(sp: { from?: string; to?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const ok = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
  return { from: ok(sp.from) ?? yearStart, to: ok(sp.to) ?? today, today };
}

export function periodKey(date: string, period: "monthly" | "quarterly") {
  const [y, m] = date.split("-").map(Number);
  return period === "monthly" ? `${y}-${String(m).padStart(2, "0")}` : `${y}-Q${Math.ceil(m / 3)}`;
}

export function daysBetween(a: string, b: string) {
  return Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);
}
