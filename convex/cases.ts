import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { accessTokenFor } from "./google";
import * as gmail from "./lib/gmail";
import * as cliniko from "./lib/cliniko";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { allowedEmails } from "./lib/auth";
import { dateOnly } from "./lib/rebateRules";

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
    const fields = await extractPlan(ctx, token, a);
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "case.readPlan", subjectId: a.gmailMessageId, detail: a.filename });
    return fields;
  },
});

export const create = action({
  args: { patientId: v.string(), name: v.string(), notes: v.optional(v.string()), issueDate: v.optional(v.string()), expiryDate: v.optional(v.string()),
    maxSessions: v.optional(v.number()), contactId: v.optional(v.string()), attachmentIds: v.optional(v.array(v.string())), sourceKey: v.string() },
  handler: async (ctx, a): Promise<{ id: string; url: string }> => {
    const me = await ctx.runQuery(internal.bookings.requireStaff, {});
    return await createInCliniko(ctx, a, me);
  },
});

/** Automatic extraction and exact matching; the resulting case still needs staff verification before claiming. */
export const autoCreateFromPlan = action({
  args: { gmailMessageId: v.string(), attachmentId: v.string(), mime: v.string(), filename: v.string() },
  handler: async (ctx, a): Promise<{ id: string; url: string }> => {
    const me = await ctx.runQuery(internal.bookings.requireStaff, {});
    if (me.email.startsWith("guest@")) throw new Error("Guest accounts cannot import referrals.");
    const f = await ctx.runAction(api.cases.readPlan, a);
    return await matchAndCreate(ctx, f, a, me);
  },
});

type PlanAttachment = { gmailMessageId: string; attachmentId: string; mime: string; filename: string };
type CaseInput = { patientId: string; name: string; notes?: string; issueDate?: string; expiryDate?: string; maxSessions?: number; contactId?: string; attachmentIds?: string[]; sourceKey: string };
async function createInCliniko(ctx: ActionCtx, a: CaseInput, me: { _id: Id<"users">; email: string }): Promise<{ id: string; url: string }> {
    if (me.email.startsWith("guest@")) throw new Error("Guest accounts cannot create referral cases.");
    if (!a.name.trim()) throw new Error("Give the case a name.");
    if (a.issueDate && !dateOnly(a.issueDate)) throw new Error("Enter a valid referral issue date.");
    if (a.expiryDate && (!dateOnly(a.expiryDate) || (a.issueDate && a.expiryDate < a.issueDate))) throw new Error("Enter a valid expiry date after the issue date, or leave it blank.");
    if (a.maxSessions !== undefined && (!Number.isInteger(a.maxSessions) || a.maxSessions < 1 || a.maxSessions > 200)) throw new Error("Sessions must be a whole number from 1 to 200.");
    if (!a.sourceKey.trim() || a.sourceKey.length > 500) throw new Error("Missing case creation reference.");
    const patient = await cliniko.getPatient(a.patientId);
    if (patient.archived_at) throw new Error("This patient is archived.");
    if (a.attachmentIds?.length) {
      const attachments = await cliniko.patientAttachments(a.patientId);
      if (a.attachmentIds.some((id) => !attachments.some((f) => f.id === id && !f.archived_at))) throw new Error("Attachments must belong to this patient.");
    }
    const job = await ctx.runMutation(internal.rebateData.reserveCase, { key: a.sourceKey, patientId: a.patientId });
    if (job.caseId) return { id: job.caseId, url: cliniko.clinikoWebUrl(`/patients/${a.patientId}`) };
    // A timeout after this POST is ambiguous. Keep the reservation; do not silently create another case.
    const c = await cliniko.createPatientCase({ patient_id: a.patientId, name: a.name.trim(), notes: a.notes?.trim() || undefined,
      issue_date: a.issueDate || undefined, expiry_date: a.expiryDate || undefined,
      referral: true, referral_type: "medicare", max_sessions: a.maxSessions,
      contact_id: a.contactId || undefined, patient_attachment_ids: a.attachmentIds,
      include_cancelled_attendees: false, include_dna_attendees: false });
    await ctx.runMutation(internal.rebateData.finishCase, { id: job.id, caseId: c.id });
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "cliniko.caseCreate", subjectId: c.id });
    return { id: c.id, url: cliniko.clinikoWebUrl(`/patients/${a.patientId}`) };
}
async function extractPlan(ctx: ActionCtx, token: string, a: PlanAttachment): Promise<Record<string, string | null>> {
  if (!["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"].includes(a.mime)) throw new Error("Unsupported referral attachment.");
  const data = await gmail.getAttachment(token, a.gmailMessageId, a.attachmentId);
  if (data.size > 12 * 1024 * 1024) throw new Error("Referral exceeds the 12 MB limit.");
  const base64 = data.data.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
  const fields = await ctx.runAction(internal.ai.extractMentalHealthPlan, { base64, mime: a.mime, filename: a.filename });
  return { ...fields, sourceKey: `plan:${digest}` };
}

async function matchAndCreate(ctx: ActionCtx, f: Record<string, string | null>, a: PlanAttachment, me: { _id: Id<"users">; email: string }): Promise<{ id: string; url: string }> {
    if (!f.patientName || !f.dateOfBirth || !dateOnly(f.dateOfBirth)) throw new Error("Automatic matching needs the patient's full name and date of birth. Create the case manually.");
    const normalize = (x: string) => x.trim().toLowerCase().replace(/\s+/g, " ");
    const candidates = await cliniko.searchPatients(f.patientName, 100);
    const matches = candidates.filter((p) => !p.archived_at && p.date_of_birth === f.dateOfBirth && normalize(`${p.first_name} ${p.last_name}`) === normalize(f.patientName!));
    if (matches.length !== 1 || candidates.length === 100) throw new Error("No unique exact patient match. Choose the patient manually.");
    const sessions = f.sessionsReferred && /^\d+$/.test(f.sessionsReferred) ? Number(f.sessionsReferred) : undefined;
    return await createInCliniko(ctx, {
      patientId: matches[0].id, name: `${f.planType || "Mental health referral"} — needs review`,
      notes: ["Automatically imported by HappyDays. Verify the original referral before claiming.", f.referrerName && `Referrer: ${f.referrerName}`, f.referrerProviderNumber && `Provider: ${f.referrerProviderNumber}`, `Source email: ${a.gmailMessageId}; attachment: ${a.filename}`].filter(Boolean).join("\n"),
      issueDate: f.referralDate && dateOnly(f.referralDate) ? f.referralDate : undefined,
      maxSessions: sessions && sessions <= 200 ? sessions : undefined,
      sourceKey: f.sourceKey!,
    }, me);
}

/** Opt-in Gmail filter workflow. Only new messages already labelled HappyDays/Referrals are inspected. */
export const onNewInbound = internalAction({
  args: { accountId: v.id("googleAccounts"), messages: v.array(v.object({ threadId: v.id("threads"), gmailMessageId: v.string(), gmailThreadId: v.string() })) },
  handler: async (ctx, a): Promise<void> => {
    const setting = await ctx.runQuery(internal.rebateData.importConfig, {});
    if (!setting?.enabled) return;
    const account = await ctx.runQuery(internal.googleData.accountById, { accountId: a.accountId });
    if (!account || account.status !== "connected" || !allowedEmails().includes(account.email.toLowerCase()) || account.email.startsWith("guest@")) return;
    const token = await accessTokenFor(ctx, a.accountId);
    const label = (await gmail.listLabels(token)).find((l) => l.name === "HappyDays/Referrals");
    if (!label) return;
    for (const m of a.messages) {
      const message = await gmail.getMessage(token, m.gmailMessageId, "full");
      if (!message.labelIds?.includes(label.id) || !Number.isFinite(Number(message.internalDate)) || Number(message.internalDate) < setting.enabledAt) continue;
      const key = `${a.accountId}:${m.gmailMessageId}`;
      const job = await ctx.runMutation(internal.rebateData.reserveImport, { key, userId: account.userId });
      if (!job) continue;
      const attachments: PlanAttachment[] = [];
      const walk = (p: gmail.GmailPart | undefined) => {
        if (!p) return;
        if (p.filename && p.body?.attachmentId && ["application/pdf", "image/jpeg", "image/png"].includes(p.mimeType ?? "")) attachments.push({ gmailMessageId: m.gmailMessageId, attachmentId: p.body.attachmentId, filename: p.filename, mime: p.mimeType! });
        p.parts?.forEach(walk);
      };
      walk(message.payload);
      try {
        // Multiple documents may describe different referrals. Require manual selection in that situation.
        if (attachments.length !== 1) throw new Error("Select one referral document manually.");
        const f = await extractPlan(ctx, token, attachments[0]);
        await matchAndCreate(ctx, f, attachments[0], { _id: account.userId, email: account.email });
        await ctx.runMutation(internal.rebateData.finishImport, { id: job, success: true });
      } catch {
        await ctx.runMutation(internal.rebateData.finishImport, { id: job, success: false });
      }
    }
  },
});
