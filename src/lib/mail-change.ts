import type { ListItem } from "../../convex/mail";
export type MailChange = "archive" | "unarchive" | "trash" | "untrash" | "star" | "unstar" | "unread" | "spam" | "labels";
/** Apply only server-confirmed changes. Failed IDs remain visible and selected. */
export function applyMailChange(items: ListItem[], completed: string[], op: MailChange, view: string, labelId?: string, payload?: { add: string[]; remove: string[] }) {
  const ids = new Set(completed);
  const remove = op === "archive" || op === "trash" || op === "spam" || (op === "unarchive" && view === "archive") || (op === "untrash" && view === "trash") || (op === "labels" && ((view === "label" && !!labelId && payload?.remove.includes(labelId)) || (payload?.remove.includes("INBOX") && (view === "inbox" || view === "unread" || view.startsWith("smart:")))));
  return items.filter(i => !remove || !ids.has(i.gmailThreadId)).map(i => {
    if (!ids.has(i.gmailThreadId)) return i;
    if (op === "star" || op === "unstar") return { ...i, starred: op === "star" };
    if (op === "unread") return { ...i, unread: true };
    if (op === "labels" && payload) return { ...i, labelIds: [...new Set([...i.labelIds.filter(l => !payload.remove.includes(l)), ...payload.add])] };
    return i;
  });
}
