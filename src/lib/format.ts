/** Formatting helpers, all en-AU. */
export const aud = (cents: number | undefined | null, opts: { whole?: boolean } = {}) => ((cents ?? 0) / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: opts.whole ? 0 : 2, maximumFractionDigits: opts.whole ? 0 : 2 });
export const int = (n: number | undefined | null) => (n ?? 0).toLocaleString("en-AU");
export const when = (t: number | string | undefined | null) => (t ? new Date(t).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
export const day = (t: number | string | undefined | null) => (t ? new Date(t).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const time = (t: number | string | undefined | null) => (t ? new Date(t).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }) : "—");
export const weekday = (t: number | string) => new Date(t).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });

export function ago(t: number | undefined | null): string {
  if (!t) return "never";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)} d ago`;
  return day(t);
}

/** Mail-list style date: time today, weekday this week, otherwise day and month. */
export function mailDate(t: number): string {
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  if (now.getTime() - t < 6 * 86_400_000) return d.toLocaleDateString("en-AU", { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const dueLabel = (t: number | undefined) => {
  if (!t) return "";
  const d = new Date(t); const now = new Date();
  const dayDiff = Math.round((new Date(d.toDateString()).getTime() - new Date(now.toDateString()).getTime()) / 86_400_000);
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  if (dayDiff === -1) return "Yesterday";
  if (dayDiff < 0) return `${-dayDiff} days overdue`;
  if (dayDiff < 7) return d.toLocaleDateString("en-AU", { weekday: "long" });
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
};

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");

/** Colour tokens for tags and lists. */
export const TONE_CLASS: Record<string, string> = {
  neutral: "bg-muted text-fg-secondary", blue: "bg-blue-soft text-blue", green: "bg-success-soft text-success", amber: "bg-warning-soft text-warning", red: "bg-error-soft text-error", purple: "bg-[#7c6cf2]/10 text-[#6b5bd6] dark:text-[#a99cff]",
};
export const TONE_DOT: Record<string, string> = { neutral: "bg-fg-quaternary", blue: "bg-blue", green: "bg-success", amber: "bg-warning", red: "bg-error", purple: "bg-[#7c6cf2]" };
export const TONES = ["neutral", "blue", "green", "amber", "red", "purple"] as const;
