# Happy Days — Build Plan

Practice operations app for Barbara Fraser's practice. Two users: Barbara Fraser
(barbara@barbarafraser.net) and Luke Chable (luke@barbarafraser.net). It replaces
Outlook for mail, wraps Cliniko for bookings, and adds tasks/help desk, file
delivery by download code, PDF signing and page tools, and a money/report table.

Dated 7 Sep 2026, updated the same day after Luke's answers. Phases are ordered by dependency and by how much day-to-day
pain each one removes.

---

## 1. Decisions and expansions

These are the calls I recommend beyond the feature list. Each is reversible, but
they shape the data model, so they are worth settling before Phase 1.

### 1.1 Gmail API instead of IMAP
The brief says "Google Workspace IMAP". I recommend the Gmail API (OAuth) with
IMAP kept only as a fallback:

- Next.js and Convex have no long-lived process to hold an IMAP IDLE
  connection, so IMAP means polling. The Gmail API has push notifications
  (Pub/Sub to a Convex HTTP action) and `history.list` for cheap incremental
  sync.
- Gmail labels come through as labels, which is exactly the "Outlook treats
  Gmail labels as folders" behaviour you asked for. Over IMAP they are folders
  with copies, and moving mail between them is lossy.
- Replies thread correctly when sent through the API (`threadId`,
  `In-Reply-To`, `References` handled for us).
- Because barbarafraser.net is a Google Workspace domain, the OAuth app can be
  registered as **Internal**. Internal apps skip Google's restricted-scope
  verification entirely, which is otherwise a multi-week review for Gmail
  scopes.

### 1.2 Two mailboxes, one database, nothing copied
Each user connects their own Google account. Luke's rule (7 Sep 2026): Happy Days holds no
copies of Gmail or Cliniko data. So the database stores only what the two of you add on top,
plus a header-only index of messages (Gmail ids, RFC Message-ID, sender, recipients, date,
direction). That index is what lets the app say "Luke replied" or "overdue" across both
mailboxes without a second round-trip to Gmail. Bodies, attachments and search results are
fetched live from Gmail every time and never written down. Sharing is by thread, not mailbox.

### 1.3 Matters as a first-class object
Court matters are the thing subpoenas, reports, invoices and tasks all hang off.
A `Matter` record holds the matter name, court file number, parties, linked
Cliniko patients, linked threads, tasks, files and Stripe invoices. Subpoena
export becomes "export this matter", and the money/report table becomes a view
over matters. Tags stay separate for lightweight labelling such as
"Family Report" or "Medicare Rebate".

### 1.4 Cliniko is read live, never mirrored
Patients, appointments, practitioners, appointment types, availability and attachments are
fetched from the Cliniko API on every screen that shows them. The only Cliniko-related rows in
our database are the pricing decision per appointment type (full fee, deposit, not online) and
the id of an appointment created by a paid online booking. Patient files open through
Cliniko's own links. Shard `au1`, subdomain `barbara-fraser-and-associates`, API key owned by
Luke. Known ids: business 77991, practitioner 160550, appointment type 375022 (Full Family Report).

### 1.5 Stripe is the only payment path
Cliniko invoicing is bypassed. Each Cliniko appointment type maps to a Stripe
Price. Public booking runs through Stripe Checkout, and the Cliniko appointment
is created by the Stripe webhook only once payment succeeds, so nothing is
booked unpaid. For invoiced work (reports), Stripe Invoices are created from
Happy Days against the matter, and their status drives the "Invoice paid"
column.

### 1.6 "Report delivered" has a definition
A matter's report is marked delivered when any of these happen: a file tagged
Report on that matter is downloaded through its download code; a message with
a Report-tagged attachment is sent on a thread linked to the matter; or a user
ticks it manually. The dashboard shows which one it was.

### 1.7 Privacy and access
This is health-adjacent data for an Australian practice, so:

- Sign-in restricted to the two Workspace emails via Clerk allowlist, with MFA
  required.
- Every read of a patient record, every export and every download is written
  to an audit log table with user, time and IP.
- Attachments and uploaded files live in Convex file storage; download codes
  are unguessable (8 characters from a 32-symbol alphabet), expire, and can be
  PIN-protected.
- Convex deployment region should be chosen deliberately. Confirm what regions
  are on offer for your plan before Phase 1; if AU is unavailable, note it in
  the practice's privacy policy.

---

## 2. Stack and layout

| Layer | Choice | Notes |
|---|---|---|
| App | Next.js 16 App Router, React 19, TypeScript | Same versions as EventBase |
| Styling | Tailwind v4, shadcn (Base UI flavour, `base-nova`), lucide icons | Port EventBase `globals.css` tokens verbatim |
| Data | Convex (DB, file storage, scheduled functions, HTTP actions, full-text search) | One project, `dev` and `prod` deployments |
| Auth | Clerk, single organisation, two members | Allowlist + MFA |
| Payments | Stripe Checkout, Invoices, Customer Portal, webhooks | Products/Prices managed in Stripe dashboard |
| Mail | Gmail API + Google Pub/Sub push | Internal OAuth app on the Workspace |
| Bookings | Cliniko API v1 (`api.<shard>.cliniko.com`) | Basic auth with a per-user API key |
| AI | Claude API (classification, auto-reply drafting, smart inbox) | Never auto-sends without a rule that says so |
| PDF | `pdf-lib` (edit/merge/flatten), `pdfjs-dist` (render), `@react-pdf/renderer` (subpoena export) | All in Convex Node actions or the browser |
| Email rendering | DOMPurify-sanitised HTML in a sandboxed iframe | Blocks remote images by default |
| Hosting | Railway or Vercel for Next, Convex Cloud | Match EventBase |

Design system: copy from EventBase `web/src/app/globals.css`, `layout.tsx`
(Libre Baskerville loader), `components.json`, `lib/utils.ts`,
`components/admin/primitives.tsx` (PageHeader, Panel, Kpi, Pill, DataTable,
Empty, Loading, Facts, statusTone), and `components/admin/shell.tsx` plus
`lib/admin-nav.ts` and `command-palette.tsx`. The **admin panel is the Happy
Days shell**: black rail on the left with grouped navigation and count badges,
slim top bar with ⌘K search, page area max 1320px. Every UI phase starts by
invoking the `frontend-design` and `design-taste-frontend` skills against the
screens in that phase.

Repo layout:

```
happydays/
  src/app/                (app)/mail, (app)/tasks, (app)/bookings, (app)/files,
                          (app)/pdf, (app)/matters, (app)/money, (app)/settings
                          book/[slug]  (public booking)   d/[code] (public download)
                          sign/[token] (public signing)
  src/components/         ui/ (shadcn), shell/, mail/, tasks/, bookings/, files/,
                          pdf/, matters/, money/, primitives.tsx
  src/lib/                gmail/, cliniko/, stripe/, pdf/, ai/, format.ts
  convex/                 schema.ts, mail/, tasks/, bookings/, files/, pdf/,
                          matters/, money/, http.ts (webhooks), crons.ts
  docs/                   PLAN.md, DECISIONS.md
```

---

## 3. Data model (Convex)

Core tables. Names are final; fields are the important ones, not exhaustive.

- `users` — clerkId, email, name, signatureHtml, defaultSignatureId, prefs
- `mailboxes` — userId, googleEmail, refreshToken (encrypted), historyId, watchExpiry, syncState
- `threads` — canonicalKey (from Message-IDs), subject, participants[], lastMessageAt, firstInboundAt, mailboxIds[], hasReplyFrom[] (userIds), tagIds[], matterId?, assignedTo?, assignedBy?, assignedAt?, smartCategory (primary | newsletter | notification | receipt | calendar), snoozedUntil?
- `messages` — threadId, mailboxId, gmailId, messageId (RFC), inReplyTo, references[], from, to[], cc[], bcc[], date, snippet, bodyTextStorageId, bodyHtmlStorageId, labelIds[], isUnread, isDraft, direction (in | out), autoSubmitted (bool), sentBy? (userId)
- `attachments` — messageId, filename, mime, size, storageId, previewStorageId?, inline (bool)
- `labels` — mailboxId, gmailLabelId, name, type (system | user), color
- `tags` — orgwide: name, color, aiHint (text used by the classifier)
- `assignments` — threadId, toUserId, fromUserId, note, status (open | done), createdAt
- `autoReplyRules` — name, enabled, trigger (firstInThread | followUp | any), contentCondition (none | keywords | aiPrompt), keywords[], aiPrompt, template, mode (send | draft), addTagIds[], stopAfterMatch, hours (business hours window)
- `autoReplyLog` — ruleId, threadId, messageId, action, sentAt
- `matters` — name, courtFileNo, court, parties[], clinikoPatientIds[], status, reportDeliveredAt?, reportDeliveredVia?, notes
- `matterLinks` — matterId, kind (thread | task | file | invoice), refId
- `tasks` — title, notes, listId, assigneeId, creatorId, dueAt?, priority (none | low | med | high), status, completedAt?, parentTaskId?, order, tagIds[], recurrence?, sourceThreadId?, matterId?
- `taskLists` — name, color, order
- `taskComments` — taskId, userId, body, createdAt
- `patients` (mirror) — clinikoId, firstName, lastName, email, phone, dob, clinikoUrl, updatedAt
- `practitioners`, `businesses`, `appointmentTypes` (mirror, with stripePriceId on appointment types)
- `appointments` (mirror) — clinikoId, patientId, practitionerId, appointmentTypeId, businessId, startsAt, endsAt, cancelledAt?, didNotArrive, notes, telehealthUrl?, paymentId?
- `bookingSessions` — public booking in progress: chosen slot, patient details, stripeCheckoutSessionId, status, clinikoAppointmentId?
- `files` — name, mime, size, storageId, uploadedBy, matterId?, tagIds[], sha256
- `downloadCodes` — code, fileIds[], expiresAt, maxDownloads, pinHash?, downloadsCount, createdBy, revokedAt?
- `downloadEvents` — codeId, at, ip, userAgent, success
- `pdfDocs` — sourceFileId, pages (order/rotation state), annotations (JSON), signedStorageId?
- `signatureRequests` — fileId, signerEmail, signerName, token, fields[] (page, x, y, w, h, kind), status, signedStorageId?, auditTrail[]
- `stripeInvoices` — stripeId, matterId?, customerEmail, amount, currency, status, hostedUrl, paidAt?
- `stripePayments` — stripeId, bookingSessionId?, amount, status
- `auditLog` — userId, action, subjectKind, subjectId, at, ip

Search indexes: `messages` full-text on subject + bodyText + fromName, filtered by mailboxId. `tasks` on title + notes. `patients` on name.

---

## 4. Phases

### Phase 0 — Foundation
Ships: a running app the two of you can sign into, wearing the EventBase admin skin.

- Scaffold Next 16 + Tailwind v4 + shadcn (Base UI). Copy EventBase tokens, fonts, primitives, admin shell, command palette.
- Convex project with the schema above. Clerk org, two members, MFA, allowlist. Clerk → Convex identity mapping.
- Shell: black rail with groups **Today** (Dashboard), **Mail** (Inbox, Unread, Smart, Overdue, Assigned to me, Matters), **Work** (Tasks, Bookings), **Documents** (Files, PDF tools, Signatures), **Money**, **Settings**. Count badges wired to Convex queries.
- ⌘K palette searching threads, tasks, patients, matters, pages.
- Settings pages for connecting Google, Cliniko API key, Stripe keys, signatures.
- Audit log writer used by every later phase.

Done when: both users sign in, see the shell with live badge counts (zero is fine), and can connect their Google account (token stored, nothing synced yet).

### Phase 1 — Mail core
Ships: a usable replacement for Outlook for one mailbox, then both.

- **Sync**: initial backfill (last 12 months, then older in background), Gmail `watch` renewed daily by a cron, Pub/Sub push to a Convex HTTP action, `history.list` incremental sync, label sync both ways. Bodies stored in file storage when over 200KB.
- **Folders**: label tree in the rail (Inbox, Sent, Drafts, Starred, Archive, Spam, Trash, then user labels). Move/apply/remove labels; archive; star; mark read/unread; delete to Trash. Keyboard shortcuts (j/k, e, r, a, f, /).
- **Reading**: three-pane layout (folders, thread list, message). Threaded conversation view with collapsed earlier messages. Sanitised HTML in a sandboxed iframe, remote images blocked with a "Show images" bar. Attachment strip with preview (PDF, images, Office via server-side conversion to PDF thumbnails) and download.
- **Composing**: new, reply, reply all, forward with quoted history. Rich text editor (TipTap) with bold/italic/lists/links/inline images. Attachments by drag-and-drop or file picker, up to 25MB. Drafts autosaved to Convex and pushed to Gmail Drafts. Send via Gmail API so it lands in Sent on the real account.
- **Signatures**: multiple per user, default for new vs reply, HTML with images, inserted above or below quoted text per preference.
- **Search**: Convex full-text over subject/body/from with filters (mailbox, label, has attachment, date range, from/to). Results in the same thread list.
- **Contacts**: address autocomplete from previously seen addresses.

Done when: Barbara and Luke each run a full working day in Happy Days without opening Outlook, and nothing is missing from Gmail afterwards.

### Phase 2 — Tasks and help desk
Ships: a TickTick-style list that also acts as the practice's help desk.

- Lists (with colour), smart lists (Inbox, Today, Next 7 days, Assigned to me, Assigned by me, Overdue, Completed).
- Tasks with title, notes (markdown), due date and time, priority, tags, subtasks, recurrence (daily/weekly/monthly/custom), attachments, comments.
- Assign to the other user; assignee gets an in-app notification and an optional email digest.
- Views: list, kanban by status, calendar (day/week/month) of due dates.
- Quick add with natural language ("Call Smith re: report Friday 2pm !high").
- **Help desk hooks**: "Turn into task" from any email thread (keeps a link both ways), "Create task" from a matter or patient. Task shows the source email inline.
- Keyboard-first: n new, cmd+enter save, arrow navigation, space complete.

Done when: both users manage a week's follow-ups in it, and every task created from an email links back to the thread.

### Phase 3 — Mail collaboration and AI
Ships: the features that make two people share one practice's mail safely.

- **Tags**: org-wide, coloured, applied to threads. Shown in thread list and message header. Filter and search by tag. Bulk tag.
- **Assignment**: assign a thread to the other user with a note. Assignee's rail badge increments. "Assigned to me" view. Mark done. Optionally convert to a task.
- **Replied pills**: "Luke replied" / "Barbara replied" green pill on any thread where an outbound message from that user exists after the last inbound. Computed from `hasReplyFrom` at sync time so lists stay fast.
- **Inbox views**: Standard (newest first), Unread, Smart (Primary, Newsletters, Notifications, Receipts, Calendar via Gmail category labels plus a Claude fallback for uncategorised mail), Overdue (threads where both users were recipients, last message is inbound, no reply from either user within N business hours, N configurable, default 48).
- **Auto-reply rules**: rule builder with conditions (first message in thread vs follow-up vs any; content condition as keyword list or a plain-English prompt Claude evaluates; sender domain; business hours), actions (send template reply, or create a draft for review; add tags; assign). Templates support merge fields (first name, matter name, next available appointment). Guard rails: never reply to auto-submitted or bulk mail, never to ourselves, at most one auto-reply per thread per sender per 7 days, log every action.
- **AI classification**: on arrival, Claude proposes tags (using each tag's `aiHint`) and a one-line summary. Proposed tags show as hollow pills until accepted, or auto-apply if the rule says so.
- **Matters**: create a matter; link threads (by drag onto the rail, from the thread header, or by rule); matter page shows timeline of emails, tasks, files, invoices.
- **Subpoena export**: from a matter or an ad-hoc filter (participants, date range, keywords, tags). Review screen lists every message with a checkbox to exclude, and a per-attachment include toggle. Export produces one PDF: cover page (matter details, date range, who exported, exclusions count), chronological messages with full headers, then an attachments appendix with PDF attachments merged in and other files listed by name and hash. Also a ZIP with the PDF plus original attachments and an index CSV. Export recorded in the audit log.

Done when: an overdue thread surfaces without anyone looking for it, an auto-reply rule handles a first-contact enquiry correctly in draft mode, and a subpoena export for a real matter is reviewed by Barbara and accepted.

### Phase 4 — Bookings
Ships: Cliniko's calendar and patient views inside Happy Days, paid through Stripe.

- **Cliniko sync**: practitioners, businesses, appointment types, patients (minimal fields), appointments past 6 months and future 12 months. Cron every 5 minutes using `updated_at` filters; manual "Refresh" button. Conflict-safe writes (create, reschedule, cancel go straight to Cliniko, then the mirror updates).
- **Calendar**: day, week and practitioner-column views modelled on Cliniko; drag to reschedule; click to create; appointment type colours; cancelled and did-not-arrive states; telehealth link shown when present. Availability blocks and unavailable blocks rendered from the API.
- **Patient panel**: search, patient summary (contact, DOB, upcoming and past appointments, linked matters), "Open in Cliniko" and a list of Cliniko attachments that open via their temporary URLs. No documents stored here.
- **Public booking page** (`/book/<business>`): choose appointment type, practitioner, slot (from Available Times), enter details, pay via Stripe Checkout (full fee or deposit per appointment type). On `checkout.session.completed` the Convex webhook creates the patient if new and the appointment in Cliniko, then emails a confirmation from the practice mailbox. Failed or abandoned sessions hold the slot for 10 minutes only.
- **Internal booking with payment**: staff create an appointment and either send a Stripe payment link or mark as invoiced later.
- Reminders: email 48h and 24h before, using the practice mailbox, with a manage link. SMS is out of scope unless you want Twilio added.

Done when: a test patient books and pays online, the appointment appears in Cliniko within a minute, and Barbara reschedules it from the Happy Days calendar.

### Phase 5 — Files, download codes, PDF tools
Ships: secure delivery of reports and the PDF workbench.

- **Files**: upload (drag-and-drop, multiple), folders by matter, tags, versioning (re-upload keeps history), preview.
- **Download codes**: create a code for one or more files; set expiry (default 14 days), max downloads, optional 4-digit PIN, recipient note. Public page `/d/<code>` shows the practice name, file names and sizes, asks for the PIN if set, and streams the files. Every attempt logged; the owner sees a delivery timeline and gets a notification on first download. Code can be revoked. "Copy code" and "Email code" (opens compose with the code and PIN in separate emails by default).
- **PDF page tools** (Preview-style): thumbnail grid, drag to reorder, rotate, delete, insert from another PDF, split, merge. Save as new version or overwrite. Runs in-browser with `pdf-lib`, no upload until save.
- **PDF markup**: highlight, underline, strike, free text, sticky note, freehand pen, rectangles, redaction (true removal, re-rasterised page region). Annotations stored as JSON and flattened on export.
- **Signing**: sign yourself (draw, type, or upload a saved signature; date stamp; initials) and place on any page. **Sign from mail**: "Sign and reply" on a PDF attachment opens the signer and attaches the signed copy to a reply. **Request a signature**: pick signer, drop fields (signature, initials, date, text), send a link; signer sees `/sign/<token>` with no login, signs, and both parties receive the completed PDF with an audit page (timestamps, IP, email verification).

Done when: a report is delivered by code and the matter flips to "Report delivered" automatically, and a consent form goes out for signature and comes back signed.

### Phase 6 — Money and reports, cutover
Ships: the paid/delivered table, and the switch off Outlook.

- Stripe webhooks for invoices and payments stored in Convex. Invoices can be created from a matter (line items, due date) and sent via Stripe's hosted invoice.
- **Money table** on the dashboard: one row per matter (and per paid booking): client, matter, invoice number, amount, invoice status (draft, sent, paid, overdue, void), paid date, report delivered (yes/no, how, when), days between invoice and delivery. Filters, sort, CSV export. Badges on the rail for "Paid, report not delivered" and "Delivered, unpaid".
- Dashboard: today's appointments, overdue emails, tasks due, money highlights.
- Cutover checklist: Gmail labels tidy, Outlook signature parity, auto-reply rules enabled in send mode, Cliniko online booking page pointed at `/book`, both users on MFA.

Done when: the table reconciles with Stripe for the last 90 days and Outlook is closed.

---

## 5. Cliniko API — what we can use

Confirmed against docs.api.cliniko.com. Base URL `https://api.<shard>.cliniko.com/v1`, Basic auth with an API key (inherits the key owner's permissions), 200 requests per minute per user, pagination up to 100 per page, filtering on most fields including `updated_at`. No webhooks, so we poll.

**Recommend using**

| Resource | Use in Happy Days |
|---|---|
| Patients (list, get, create, update) | Patient search, summary panel, create on first online booking |
| Individual Appointments (list, get, create, update, cancel, conflicts) | Calendar, booking, reschedule, cancel; conflicts check before writing |
| Practitioners, Businesses | Calendar columns, booking page choices |
| Appointment Types | Booking options, colours, durations, Stripe price mapping |
| Available Times | Slot picker on the public booking page |
| Availability Blocks, Unavailable Blocks | Render working hours and time off on the calendar |
| Patient Attachments (list, get temporary URL) | "Files in Cliniko" list on the patient panel, opened via Cliniko, never copied |
| Users | Map Cliniko users to Barbara and Luke for audit |

**Worth considering**

| Resource | Why |
|---|---|
| Patient Cases | Could mirror a Happy Days matter into Cliniko so both systems agree on the case |
| Invoices (read only) | Show historic Cliniko invoices next to Stripe ones during the transition |
| Treatment Notes (read only, link only) | "Open latest note in Cliniko" shortcut on the patient panel |
| Medical Alerts | Show alert badge on patient panel and calendar entry |
| Recalls | Turn Cliniko recalls into Happy Days tasks |
| Communications | Log emails sent from Happy Days back into the Cliniko patient record |
| Patient Forms and Templates | Pre-appointment intake via Cliniko forms, linked from confirmation email |
| Referral Sources | Capture on booking for reporting |
| Relationships, Contacts | Show related parties (parents, solicitors) on the patient panel |

**Skip**

Products, Product Suppliers, Stock Adjustments, Billable Items, Concession Types and Prices, Taxes, Group Appointments, Attendees, Bookings (the group-booking record), Signatures (Cliniko's own), Settings, Public Settings, Practitioner Reference Numbers.

---

## 7. Environment variables (Convex deployment)

Set with `npx convex env set NAME value`. Never commit them.

| Variable | Purpose |
|---|---|
| CLERK_JWT_ISSUER_DOMAIN | Clerk JWT template "convex" issuer |
| ALLOWED_EMAILS | The two staff addresses |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | Internal OAuth app on the Workspace |
| TOKEN_ENCRYPTION_KEY | 32 random bytes, base64 |
| GOOGLE_PUBSUB_TOPIC / GOOGLE_PUBSUB_VERIFICATION_TOKEN | Optional Gmail push |
| CLINIKO_API_KEY / CLINIKO_SHARD / CLINIKO_SUBDOMAIN | Cliniko |
| STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET | Stripe |
| ANTHROPIC_API_KEY | Claude |
| APP_URL | Public URL of the app (OAuth redirect) |

Railway staging (project 0815e81e-df8a-4371-838d-3dc174a5fc34) builds only the Next app against
Convex dev deployment adept-dotterel-438; Convex functions are pushed from the repo with
`npx convex dev --once`. No deploy key is needed for staging.

## 6. Open questions

1. Cliniko: which of the "worth considering" resources do you want? Also your shard (probably `au1`), the Cliniko subdomain, and whose user the API key will belong to (the key inherits their permissions; a dedicated "Happy Days" Cliniko user is cleanest).
2. Gmail API rather than IMAP: OK? You will need to be a Workspace admin to register the Internal OAuth app.
3. Public booking: full fee, deposit, or per appointment type? Should the Cliniko online booking page be retired?
4. Report delivered: does the definition in 1.6 match how you work?
5. Cliniko screens: none came through with the message. Attach them and I will align the calendar and patient views to them.
6. Data region: is a US-hosted database acceptable for this data, or should I check Convex's region options first?
