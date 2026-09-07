/**
 * TickTick-style quick add. "Call Smith re report Friday 2pm !high #Reports @Luke" becomes a title, a due date
 * and time, a priority, a list name and an assignee first name. Anything it doesn't understand stays in the title.
 */
export type QuickAdd = { title: string; dueAt?: number; allDay: boolean; priority: "none" | "low" | "medium" | "high"; listName?: string; assigneeFirst?: string; tags: string[] };

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function parseQuickAdd(input: string, now = new Date()): QuickAdd {
  let text = ` ${input.trim()} `;
  const out: QuickAdd = { title: "", allDay: true, priority: "none", tags: [] };

  const pri = text.match(/\s!(high|med|medium|low|1|2|3)\b/i);
  if (pri) { const p = pri[1].toLowerCase(); out.priority = p === "high" || p === "1" ? "high" : p === "low" || p === "3" ? "low" : "medium"; text = text.replace(pri[0], " "); }
  const list = text.match(/\s#([\w-]+)/);
  if (list) { out.listName = list[1]; text = text.replace(list[0], " "); }
  const who = text.match(/\s@(\w+)/);
  if (who) { out.assigneeFirst = who[1]; text = text.replace(who[0], " "); }
  for (const m of Array.from(text.matchAll(/\s\+([\w-]+)/g))) { out.tags.push(m[1]); text = text.replace(m[0], " "); }

  const date = new Date(now); date.setHours(0, 0, 0, 0);
  let hasDate = false;
  let time: { h: number; m: number } | undefined;

  const tm = text.match(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i) ?? text.match(/\s(?:at\s+)(\d{1,2})(?::(\d{2}))?\b/i);
  if (tm) { let h = Number(tm[1]); const mm = Number(tm[2] ?? 0); const ap = (tm[3] ?? "").toLowerCase(); if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; if (h < 24 && mm < 60) { time = { h, m: mm }; text = text.replace(tm[0], " "); } }

  if (/\stoday\b/i.test(text)) { hasDate = true; text = text.replace(/\stoday\b/i, " "); }
  else if (/\stomorrow\b|\stmr\b/i.test(text)) { date.setDate(date.getDate() + 1); hasDate = true; text = text.replace(/\stomorrow\b|\stmr\b/i, " "); }
  else if (/\snext week\b/i.test(text)) { date.setDate(date.getDate() + ((8 - date.getDay()) % 7 || 7)); hasDate = true; text = text.replace(/\snext week\b/i, " "); }
  else {
    const wd = text.match(/\s(?:on\s+|next\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|rsday|urday)?\b/i);
    if (wd) {
      const target = DAYS.findIndex((d) => d.startsWith(wd[1].toLowerCase().slice(0, 3)));
      const isNext = /next\s+/i.test(wd[0]);
      let diff = (target - date.getDay() + 7) % 7;
      if (diff === 0 || isNext) diff += 7;
      if (isNext && diff > 7) diff -= 7;
      date.setDate(date.getDate() + diff); hasDate = true; text = text.replace(wd[0], " ");
    } else {
      const dm = text.match(/\s(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
      if (dm) { const d = Number(dm[1]); const m = Number(dm[2]) - 1; const y = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : date.getFullYear(); const cand = new Date(y, m, d); if (!Number.isNaN(cand.getTime())) { date.setTime(cand.getTime()); if (!dm[3] && cand.getTime() < now.getTime() - 86_400_000) date.setFullYear(y + 1); hasDate = true; text = text.replace(dm[0], " "); } }
      else {
        const md = text.match(/\s(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i) ?? text.match(/\s(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
        if (md) { const [a, b] = /^\d/.test(md[1]) ? [md[1], md[2]] : [md[2], md[1]]; const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]; const m = months.indexOf(b.toLowerCase().slice(0, 3)); const cand = new Date(date.getFullYear(), m, Number(a)); if (cand.getTime() < now.getTime() - 86_400_000) cand.setFullYear(cand.getFullYear() + 1); date.setTime(cand.getTime()); hasDate = true; text = text.replace(md[0], " "); }
      }
    }
  }
  const inN = text.match(/\sin\s+(\d+)\s+(day|days|week|weeks|hour|hours)\b/i);
  if (inN) { const n = Number(inN[1]); const u = inN[2].toLowerCase(); if (u.startsWith("hour")) { const t = new Date(now.getTime() + n * 3_600_000); date.setTime(t.getTime()); time = { h: t.getHours(), m: t.getMinutes() }; } else date.setDate(date.getDate() + n * (u.startsWith("week") ? 7 : 1)); hasDate = true; text = text.replace(inN[0], " "); }

  if (time && !hasDate) { hasDate = true; if (time.h * 60 + time.m <= now.getHours() * 60 + now.getMinutes()) date.setDate(date.getDate() + 1); }
  if (hasDate) { if (time) { date.setHours(time.h, time.m, 0, 0); out.allDay = false; } out.dueAt = date.getTime(); }
  out.title = text.replace(/\s+/g, " ").trim().replace(/^(re|re:)\s*$/i, "");
  return out;
}
