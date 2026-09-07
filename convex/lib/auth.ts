import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export const allowedEmails = () => (process.env.ALLOWED_EMAILS ?? "barbara@barbarafraser.net,luke@barbarafraser.net").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

/** The signed-in Happy Days user, or null when signed out or not on the allowlist. */
export async function currentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await ctx.db.query("users").withIndex("by_clerk", (q) => q.eq("clerkId", identity.subject)).unique();
  if (!user) return null;
  return allowedEmails().includes(user.email.toLowerCase()) ? user : null;
}

export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await currentUser(ctx);
  if (!user) throw new Error("Sign in with a barbarafraser.net account.");
  return user;
}

/** First name for pills and notifications ("Luke replied"). */
export const firstName = (u: Pick<Doc<"users">, "name" | "email">) => (u.name || u.email).split(/[\s@]/)[0];
