import { action, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser } from "./lib/auth";

/**
 * Bank feed through Basiq (CDR-accredited Australian aggregator; Bendigo Bank is a data holder). The practice
 * links its account once through Basiq's consent page; after that we read transactions and show the payer's
 * reference next to each credit so a direct deposit can be matched to an invoice. Nothing is stored here.
 *
 * Setup: BASIQ_API_KEY on the Convex deployment (npx convex env set BASIQ_API_KEY …), then "Link bank account"
 * on Money → Transactions → Bank.
 */
const BASE = "https://au-api.basiq.io";
const USER_KEY = "bank.basiqUserId";

async function token(scope: "SERVER_ACCESS" | "CLIENT_ACCESS", userId?: string): Promise<string> {
  const key = process.env.BASIQ_API_KEY;
  if (!key) throw new Error("BASIQ_API_KEY is not set on the Convex deployment.");
  const body = new URLSearchParams({ scope, ...(userId ? { userId } : {}) });
  const r = await fetch(`${BASE}/token`, { method: "POST", headers: { Authorization: `Basic ${key}`, "basiq-version": "3.0", "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error(`Basiq token failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()) as { access_token: string }).access_token;
}

async function api<T>(tok: string, path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${tok}`, "basiq-version": "3.0", "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`Basiq ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

export type BankTransaction = { id: string; description: string; amountCents: number; direction: "credit" | "debit"; postDate: string; status: string; accountId: string; accountName?: string };

export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", USER_KEY)).unique();
    return { configured: !!process.env.BASIQ_API_KEY, linked: !!row?.value };
  },
});

/** A Basiq consent-page link for the practice to connect its bank account (creates the Basiq user on first use). */
export const connectLink = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const me = await ctx.runQuery(internal.bookings.requireStaff, {});
    const server = await token("SERVER_ACCESS");
    let userId = (await ctx.runQuery(internal.settings.getInternal, { key: USER_KEY })) as string | null;
    if (!userId) {
      const u = await api<{ id: string }>(server, "/users", { method: "POST", body: JSON.stringify({ email: me.email }) });
      userId = u.id;
      await ctx.runMutation(internal.settings.setInternal, { key: USER_KEY, value: userId });
    }
    const client = await token("CLIENT_ACCESS", userId);
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "bank.connectLink" });
    return { url: `https://consent.basiq.io/home?token=${encodeURIComponent(client)}` };
  },
});

/** Recent transactions across the linked accounts, credits first, newest first. */
export const transactions = action({
  args: {},
  handler: async (ctx): Promise<{ linked: boolean; accounts: Array<{ id: string; name: string; accountNo?: string; institution?: string }>; rows: BankTransaction[] }> => {
    const me = await ctx.runQuery(internal.bookings.requireStaff, {});
    const userId = (await ctx.runQuery(internal.settings.getInternal, { key: USER_KEY })) as string | null;
    if (!userId) return { linked: false, accounts: [], rows: [] };
    const server = await token("SERVER_ACCESS");
    type Acc = { id: string; name?: string; accountNo?: string; institution?: string };
    type Tx = { id: string; description?: string; amount?: string; direction?: string; postDate?: string; transactionDate?: string; status?: string; account?: string };
    const accounts = (await api<{ data: Acc[] }>(server, `/users/${userId}/accounts`)).data ?? [];
    const tx = (await api<{ data: Tx[] }>(server, `/users/${userId}/transactions?limit=500`)).data ?? [];
    const accName = new Map(accounts.map((a) => [a.id, a.name ?? a.accountNo ?? a.id]));
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "bank.transactions" });
    return {
      linked: true,
      accounts: accounts.map((a) => ({ id: a.id, name: a.name ?? a.accountNo ?? a.id, accountNo: a.accountNo, institution: a.institution })),
      rows: tx.map((t) => ({ id: t.id, description: (t.description ?? "").trim(), amountCents: Math.round(Math.abs(Number(t.amount ?? 0)) * 100), direction: (t.direction === "credit" ? "credit" : "debit") as "credit" | "debit", postDate: t.postDate ?? t.transactionDate ?? "", status: t.status ?? "posted", accountId: t.account ?? "", accountName: accName.get(t.account ?? "") })).sort((a, b) => (b.postDate > a.postDate ? 1 : b.postDate < a.postDate ? -1 : 0)),
    };
  },
});
