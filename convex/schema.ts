import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Happy Days holds metadata, never the data. Email bodies and attachments stay in Gmail, patient records and
 * files stay in Cliniko, money stays in Stripe. What lives here is what the two users add on top: tags,
 * assignments, replied flags, tasks, matters, download codes, and enough message headers (ids, sender, date,
 * direction) to compute "Luke replied" and "Overdue" across both mailboxes without a second round-trip to Gmail.
 */

export const direction = v.union(v.literal("in"), v.literal("out"));
export const tone = v.union(v.literal("neutral"), v.literal("blue"), v.literal("green"), v.literal("amber"), v.literal("red"), v.literal("purple"));

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
    imageUrl: v.optional(v.string()),
    lastSeenAt: v.number(),
    prefs: v.optional(v.object({
      signatureAbove: v.optional(v.boolean()),
      overdueHours: v.optional(v.number()),
      showImages: v.optional(v.boolean()),
      signatureImage: v.optional(v.string()),
      initialsImage: v.optional(v.string()),
    })),
  }).index("by_clerk", ["clerkId"]).index("by_email", ["email"]),

  /** Non-secret organisation settings (Cliniko ids, business hours). Secrets are Convex env vars. */
  settings: defineTable({ key: v.string(), value: v.any(), updatedBy: v.optional(v.id("users")), updatedAt: v.number() }).index("by_key", ["key"]),

  /** One connected Google account per user. Refresh token is AES-GCM encrypted with TOKEN_ENCRYPTION_KEY. */
  googleAccounts: defineTable({
    userId: v.id("users"),
    email: v.string(),
    refreshTokenEnc: v.string(),
    accessToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    scopes: v.array(v.string()),
    historyId: v.optional(v.string()),
    watchExpiresAt: v.optional(v.number()),
    lastSyncAt: v.optional(v.number()),
    status: v.union(v.literal("connected"), v.literal("needs_reauth"), v.literal("disconnected")),
    connectedAt: v.number(),
  }).index("by_user", ["userId"]).index("by_email", ["email"]),

  /** Per-user email signatures. HTML is authored in the app and inserted at compose time. */
  signatures: defineTable({
    userId: v.id("users"),
    name: v.string(),
    html: v.string(),
    isDefaultNew: v.boolean(),
    isDefaultReply: v.boolean(),
  }).index("by_user", ["userId"]),

  /**
   * One row per conversation, shared across both mailboxes. `key` is the RFC Message-ID of the earliest message
   * we have seen (normalised), which is the same in both Gmail accounts even though Gmail thread ids differ.
   */
  threads: defineTable({
    key: v.string(),
    subject: v.string(),
    participants: v.array(v.string()),
    mailboxes: v.array(v.object({ accountId: v.id("googleAccounts"), gmailThreadId: v.string() })),
    firstMessageAt: v.number(),
    lastMessageAt: v.number(),
    lastInboundAt: v.optional(v.number()),
    lastDirection: direction,
    repliedBy: v.array(v.id("users")),
    /** Org addresses that replied after the last inbound message; works before that person has signed in. */
    repliedByEmails: v.optional(v.array(v.string())),
    autoRepliedAt: v.optional(v.number()),
    rescheduleRequest: v.optional(v.object({ senderEmail: v.string(), fromDate: v.optional(v.string()), toDate: v.optional(v.string()), detectedAt: v.number() })),
    rescheduledAt: v.optional(v.number()),
    bothIncluded: v.boolean(),
    tagIds: v.array(v.id("tags")),
    matterId: v.optional(v.id("matters")),
    assignedTo: v.optional(v.id("users")),
    assignedBy: v.optional(v.id("users")),
    assignedAt: v.optional(v.number()),
    assignmentNote: v.optional(v.string()),
    assignmentDoneAt: v.optional(v.number()),
    smartCategory: v.optional(v.union(v.literal("primary"), v.literal("newsletter"), v.literal("notification"), v.literal("receipt"), v.literal("calendar"), v.literal("social"))),
    aiSummary: v.optional(v.string()),
    aiSuggestedTagIds: v.optional(v.array(v.id("tags"))),
    snoozedUntil: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    .index("by_lastMessage", ["lastMessageAt"])
    .index("by_assignee", ["assignedTo", "assignmentDoneAt"])
    .index("by_matter", ["matterId"])
    .index("by_overdue", ["bothIncluded", "lastDirection", "lastInboundAt"])
    .index("by_reschedule", ["rescheduledAt", "lastMessageAt"])
    .searchIndex("search_subject", { searchField: "subject", filterFields: ["matterId"] }),

  /** Header index only: enough to know who wrote when. Nothing from the body is stored. */
  messageIndex: defineTable({
    threadId: v.id("threads"),
    accountId: v.id("googleAccounts"),
    gmailMessageId: v.string(),
    gmailThreadId: v.string(),
    rfcMessageId: v.string(),
    from: v.string(),
    to: v.array(v.string()),
    cc: v.array(v.string()),
    date: v.number(),
    direction: direction,
    sentByUserId: v.optional(v.id("users")),
    autoSubmitted: v.boolean(),
    hasAttachments: v.boolean(),
  })
    .index("by_thread", ["threadId", "date"])
    .index("by_account_gmailId", ["accountId", "gmailMessageId"])
    .index("by_rfc", ["rfcMessageId"])
    .index("by_from_date", ["from", "date"]),

  /** Gmail thread id → our thread, per account. Kept separate so lookups are a single indexed get. */
  threadLookup: defineTable({ accountId: v.id("googleAccounts"), gmailThreadId: v.string(), threadId: v.id("threads") })
    .index("by_account_gmail", ["accountId", "gmailThreadId"]).index("by_thread", ["threadId"]),

  tags: defineTable({ name: v.string(), color: tone, aiHint: v.optional(v.string()), createdBy: v.id("users"), order: v.number() }).index("by_name", ["name"]),

  autoReplyRules: defineTable({
    name: v.string(),
    enabled: v.boolean(),
    order: v.number(),
    trigger: v.union(v.literal("first"), v.literal("followUp"), v.literal("any")),
    contentMode: v.union(v.literal("none"), v.literal("keywords"), v.literal("ai")),
    keywords: v.array(v.string()),
    aiPrompt: v.optional(v.string()),
    senderDomains: v.array(v.string()),
    businessHoursOnly: v.boolean(),
    mode: v.union(v.literal("send"), v.literal("draft")),
    subjectTemplate: v.optional(v.string()),
    bodyTemplate: v.string(),
    addTagIds: v.array(v.id("tags")),
    assignTo: v.optional(v.id("users")),
    stopAfterMatch: v.boolean(),
    appliesToAccountIds: v.array(v.id("googleAccounts")),
    createdBy: v.id("users"),
  }).index("by_order", ["order"]),

  /** Folder filing rules. Learned from where staff file mail (sender, sender's domain, matter) or set by hand. Only ever adds Gmail labels. */
  labelRules: defineTable({
    accountId: v.id("googleAccounts"),
    kind: v.union(v.literal("sender"), v.literal("domain"), v.literal("matter"), v.literal("subject")),
    value: v.string(),
    labelId: v.string(),
    labelName: v.string(),
    count: v.number(),
    lastAt: v.number(),
    enabled: v.boolean(),
    source: v.union(v.literal("learned"), v.literal("manual")),
  }).index("by_account_kind_value", ["accountId", "kind", "value"]).index("by_account", ["accountId", "lastAt"]),

  labelRuleLog: defineTable({
    ruleId: v.id("labelRules"),
    threadId: v.id("threads"),
    accountId: v.id("googleAccounts"),
    labelId: v.string(),
    labelName: v.string(),
    at: v.number(),
  }).index("by_thread", ["threadId"]).index("by_rule", ["ruleId"]),

  autoReplyLog: defineTable({
    ruleId: v.id("autoReplyRules"),
    threadId: v.id("threads"),
    accountId: v.id("googleAccounts"),
    inboundGmailMessageId: v.string(),
    action: v.union(v.literal("sent"), v.literal("drafted"), v.literal("skipped")),
    reason: v.optional(v.string()),
    at: v.number(),
  }).index("by_thread", ["threadId"]).index("by_rule", ["ruleId", "at"]),

  matters: defineTable({
    name: v.string(),
    courtFileNo: v.optional(v.string()),
    court: v.optional(v.string()),
    parties: v.array(v.string()),
    clinikoPatientIds: v.array(v.string()),
    clinikoCases: v.optional(v.array(v.object({ patientId: v.string(), caseId: v.string(), name: v.string() }))),
    status: v.union(v.literal("open"), v.literal("report_due"), v.literal("delivered"), v.literal("closed")),
    notes: v.optional(v.string()),
    reportDeliveredAt: v.optional(v.number()),
    reportDeliveredVia: v.optional(v.union(v.literal("download"), v.literal("email"), v.literal("manual"))),
    reportDeliveredBy: v.optional(v.id("users")),
    createdBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_status", ["status"]).searchIndex("search_name", { searchField: "name" }),

  matterLinks: defineTable({
    matterId: v.id("matters"),
    kind: v.union(v.literal("thread"), v.literal("task"), v.literal("file"), v.literal("invoice"), v.literal("appointment")),
    refId: v.string(),
    createdAt: v.number(),
  }).index("by_matter", ["matterId", "kind"]).index("by_ref", ["kind", "refId"]),

  taskLists: defineTable({ name: v.string(), color: tone, order: v.number(), createdBy: v.id("users") }).index("by_order", ["order"]),

  tasks: defineTable({
    title: v.string(),
    notes: v.optional(v.string()),
    listId: v.optional(v.id("taskLists")),
    assigneeId: v.optional(v.id("users")),
    creatorId: v.id("users"),
    dueAt: v.optional(v.number()),
    allDay: v.boolean(),
    priority: v.union(v.literal("none"), v.literal("low"), v.literal("medium"), v.literal("high")),
    status: v.union(v.literal("open"), v.literal("doing"), v.literal("done")),
    completedAt: v.optional(v.number()),
    parentId: v.optional(v.id("tasks")),
    order: v.number(),
    tagIds: v.array(v.id("tags")),
    recurrence: v.optional(v.object({ freq: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly"), v.literal("yearly")), interval: v.number(), byWeekday: v.optional(v.array(v.number())) })),
    sourceThreadId: v.optional(v.id("threads")),
    matterId: v.optional(v.id("matters")),
    updatedAt: v.number(),
  })
    .index("by_list", ["listId", "status", "order"])
    .index("by_assignee", ["assigneeId", "status", "dueAt"])
    .index("by_due", ["status", "dueAt"])
    .index("by_parent", ["parentId", "order"])
    .index("by_thread", ["sourceThreadId"])
    .index("by_matter", ["matterId"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["status", "assigneeId"] }),

  taskComments: defineTable({ taskId: v.id("tasks"), userId: v.id("users"), body: v.string(), createdAt: v.number() }).index("by_task", ["taskId", "createdAt"]),

  /** In-app notifications (assignment, task handed over, first download of a code). */
  notifications: defineTable({
    userId: v.id("users"),
    kind: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    href: v.optional(v.string()),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_user", ["userId", "readAt", "createdAt"]),

  /** How each Cliniko appointment type is charged. Cliniko is the source for the type itself. */
  appointmentPricing: defineTable({
    clinikoAppointmentTypeId: v.string(),
    name: v.string(),
    durationMinutes: v.number(),
    mode: v.union(v.literal("full"), v.literal("deposit"), v.literal("none")),
    feeCents: v.number(),
    depositCents: v.optional(v.number()),
    stripePriceId: v.optional(v.string()),
    stripeDepositPriceId: v.optional(v.string()),
    bookableOnline: v.boolean(),
    updatedAt: v.number(),
  }).index("by_cliniko", ["clinikoAppointmentTypeId"]),

  /** A public booking in flight: slot chosen, Stripe Checkout started, Cliniko appointment created on payment. */
  bookingSessions: defineTable({
    businessId: v.string(),
    practitionerId: v.string(),
    appointmentTypeId: v.string(),
    startsAt: v.string(),
    endsAt: v.string(),
    patient: v.object({ firstName: v.string(), lastName: v.string(), email: v.string(), phone: v.optional(v.string()), dob: v.optional(v.string()), notes: v.optional(v.string()) }),
    amountCents: v.number(),
    mode: v.union(v.literal("full"), v.literal("deposit")),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("paid"), v.literal("booked"), v.literal("failed"), v.literal("expired")),
    clinikoPatientId: v.optional(v.string()),
    clinikoAppointmentId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  }).index("by_status", ["status", "expiresAt"]).index("by_checkout", ["stripeCheckoutSessionId"]),

  /** Files the practice itself uploads for delivery (reports, signed forms). These are ours and are stored. */
  files: defineTable({
    name: v.string(),
    mime: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
    sha256: v.string(),
    uploadedBy: v.id("users"),
    matterId: v.optional(v.id("matters")),
    tagIds: v.array(v.id("tags")),
    isReport: v.boolean(),
    version: v.number(),
    previousVersionId: v.optional(v.id("files")),
    annotations: v.optional(v.any()),
    createdAt: v.number(),
  }).index("by_matter", ["matterId"]).index("by_created", ["createdAt"]).searchIndex("search_name", { searchField: "name" }),

  downloadCodes: defineTable({
    code: v.string(),
    fileIds: v.array(v.id("files")),
    recipientName: v.optional(v.string()),
    recipientEmail: v.optional(v.string()),
    note: v.optional(v.string()),
    pinHash: v.optional(v.string()),
    expiresAt: v.number(),
    maxDownloads: v.optional(v.number()),
    downloadCount: v.number(),
    firstDownloadedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    matterId: v.optional(v.id("matters")),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_code", ["code"]).index("by_matter", ["matterId"]).index("by_created", ["createdAt"]),

  downloadEvents: defineTable({
    codeId: v.id("downloadCodes"),
    fileId: v.optional(v.id("files")),
    at: v.number(),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    outcome: v.union(v.literal("ok"), v.literal("bad_pin"), v.literal("expired"), v.literal("revoked"), v.literal("limit")),
  }).index("by_code", ["codeId", "at"]),

  signatureRequests: defineTable({
    fileId: v.id("files"),
    signerName: v.string(),
    signerEmail: v.string(),
    token: v.string(),
    message: v.optional(v.string()),
    fields: v.array(v.object({ id: v.string(), kind: v.union(v.literal("signature"), v.literal("initials"), v.literal("date"), v.literal("text")), page: v.number(), x: v.number(), y: v.number(), w: v.number(), h: v.number(), label: v.optional(v.string()) })),
    status: v.union(v.literal("sent"), v.literal("viewed"), v.literal("signed"), v.literal("declined"), v.literal("cancelled")),
    signedFileId: v.optional(v.id("files")),
    audit: v.array(v.object({ at: v.number(), event: v.string(), ip: v.optional(v.string()), userAgent: v.optional(v.string()) })),
    matterId: v.optional(v.id("matters")),
    createdBy: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]).index("by_status", ["status", "createdAt"]).index("by_matter", ["matterId"]),

  stripeInvoices: defineTable({
    stripeId: v.string(),
    number: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    customerName: v.optional(v.string()),
    amountDueCents: v.number(),
    amountPaidCents: v.number(),
    currency: v.string(),
    status: v.string(),
    hostedUrl: v.optional(v.string()),
    pdfUrl: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    paidAt: v.optional(v.number()),
    createdAt: v.number(),
    matterId: v.optional(v.id("matters")),
    description: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_stripe", ["stripeId"]).index("by_matter", ["matterId"]).index("by_created", ["createdAt"]),

  stripePayments: defineTable({
    stripeId: v.string(),
    kind: v.union(v.literal("checkout"), v.literal("payment_intent"), v.literal("charge")),
    amountCents: v.number(),
    currency: v.string(),
    status: v.string(),
    customerEmail: v.optional(v.string()),
    description: v.optional(v.string()),
    bookingSessionId: v.optional(v.id("bookingSessions")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_stripe", ["stripeId"]).index("by_created", ["createdAt"]),

  auditLog: defineTable({
    userId: v.optional(v.id("users")),
    action: v.string(),
    subjectKind: v.string(),
    subjectId: v.optional(v.string()),
    detail: v.optional(v.string()),
    ip: v.optional(v.string()),
    at: v.number(),
  }).index("by_at", ["at"]).index("by_subject", ["subjectKind", "subjectId"]),
});
