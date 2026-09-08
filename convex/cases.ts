import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { accessTokenFor } from "./google";
import * as gmail from "./lib/gmail";
import * as cliniko from "./lib/cliniko";

/**
 * "Create Case" from a mental health plan attached to an email: read the attachment with Claude, let the user check
 * the details and pick the Cliniko patient, then create the patient case in Cliniko. The plan itself is not stored.
 */
export const readPlan = action({
  args: { gmailMessageId: v.string(), attachmentId: v.string(), mime: v.string(), filename: v.string() },
  handler: async (ctx, a): Promise<Record<string, string | null>> => {
    const me = await ctx.runQuery(internal.googleData.meForAction, {});
    if (!me) throw new Error("Sign in first.");
    const account = await ctx.runQuery(internal.googleData.accountForUser, { userId: me._id });
    if (!account || account.status !== "connected") throw new Error("Connect Gmail first.");
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"].includes(a.mime)) throw new Error("The plan needs to be a PDF or a photo.");
    const token = await accessTokenFor(ctx, account._id);
    const data = await gmail.getAttachment(token, a.gmailMessageId, a.attachmentId);
    if (data.size > 12 * 1024 * 1024) throw new Error("That attachment is too large to read (12 MB limit).");
    const base64 = data.data.replace(/-/g, "+").replace(/_/g, "/");
    const fields = await ctx.runAction(internal.ai.extractMentalHealthPlan, { base64, mime: a.mime, filename: a.filename });
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "case.readPlan", subjectId: a.gmailMessageId, detail: a.filename });
    return fields;
  },
});

export const create = action({
  args: { patientId: v.string(), name: v.string(), notes: v.optional(v.string()), issueDate: v.optional(v.string()), expiryDate: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ id: string; url: string }> => {
    const me = await ctx.runQuery(internal.bookings.requireStaff, {});
    if (!a.name.trim()) throw new Error("Give the case a name.");
    const c = await cliniko.createPatientCase({ patient_id: a.patientId, name: a.name.trim(), notes: a.notes?.trim() || undefined, issue_date: a.issueDate || undefined, expiry_date: a.expiryDate || undefined });
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "cliniko.caseCreate", subjectId: c.id, detail: a.name });
    return { id: c.id, url: cliniko.clinikoWebUrl(`/patients/${a.patientId}`) };
  },
});
