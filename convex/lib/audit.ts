import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export async function audit(ctx: MutationCtx, entry: { userId?: Id<"users">; action: string; subjectKind: string; subjectId?: string; detail?: string; ip?: string }) {
  await ctx.db.insert("auditLog", { ...entry, at: Date.now() });
}
