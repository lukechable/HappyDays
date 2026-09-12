import type { ListItem } from "../../convex/mail";
export type MailChange = "archive" | "unarchive" | "trash" | "untrash" | "star" | "unstar" | "unread" | "spam" | "labels";
/** Apply only server-confirmed changes. Failed IDs remain visible and selected. */
export function applyMailChange(items: ListItem[], completed: string[], op: MailChange, view: string, labelId?: string, payload?: { add: string[]; remove: string[] }) {
  const ids = new Set(completed);
  const changes = op === "archive" ? { add: [], remove: ["INBOX"] }
    : op === "unarchive" ? { add: ["INBOX"], remove: ["TRASH", "SPAM"] }
    : op === "trash" ? { add: ["TRASH"], remove: ["INBOX"] }
    : op === "untrash" ? { add: [], remove: ["TRASH"] }
    : op === "spam" ? { add: ["SPAM"], remove: ["INBOX"] }
    : op === "star" ? { add: ["STARRED"], remove: [] }
    : op === "unstar" ? { add: [], remove: ["STARRED"] }
    : op === "unread" ? { add: ["UNREAD"], remove: [] }
    : payload ?? { add: [], remove: [] };
  return items.flatMap(i => {
    if (!ids.has(i.gmailThreadId)) return [i];
    if (op === "trash" && view === "trash") return []; // Permanent deletion.
    const labelIds = [...new Set([...(i.labelIds ?? []).filter(l => !changes.remove.includes(l)), ...changes.add])];
    const has = (label: string) => labelIds.includes(label);
    const excluded = (view !== "trash" && has("TRASH")) || (view !== "spam" && has("SPAM"));
    if (excluded) return [];
    if ((view === "inbox" || view === "unread" || view.startsWith("smart:")) && !has("INBOX")) return [];
    if (view === "unread" && !has("UNREAD") && !i.unread) return [];
    const required: Record<string, string> = { starred: "STARRED", drafts: "DRAFT", sent: "SENT", spam: "SPAM", trash: "TRASH" };
    if (required[view] && !has(required[view])) return [];
    if (view === "archive" && (has("INBOX") || has("DRAFT"))) return [];
    if (view === "label" && labelId && !has(labelId)) return [];
    if (op === "archive" && ["overdue", "assigned", "matter"].includes(view)) return [];
    return [{ ...i, labelIds, ...(op === "star" || op === "unstar" ? { starred: op === "star" } : {}), ...(op === "unread" ? { unread: true } : {}) }];
  });
}
