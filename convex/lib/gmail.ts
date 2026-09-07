/**
 * Gmail REST client. Plain fetch, no SDK: it runs inside Convex actions. Nothing here persists mail;
 * every function returns what Gmail returned, shaped for the UI, and the caller decides what headers to index.
 */

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/userinfo.email",
];

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new GmailError(json.error_description ?? json.error ?? "Could not refresh the Google token", res.status);
  return { accessToken: json.access_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000 };
}

export async function exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: number; scope: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string; error?: string };
  if (!res.ok || !json.access_token) throw new GmailError(json.error_description ?? json.error ?? "Google did not accept the sign-in code", res.status);
  if (!json.refresh_token) throw new GmailError("Google did not return a refresh token. Remove Happy Days from your Google account's third-party access and connect again.", 400);
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000, scope: json.scope ?? "" };
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body && !(init.headers as Record<string, string> | undefined)?.["Content-Type"] ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) } });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text; } catch { /* raw */ }
    throw new GmailError(msg || `Gmail returned ${res.status}`, res.status);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

/* ------------------------------ types ------------------------------ */

export type GmailHeader = { name: string; value: string };
export type GmailPart = { partId?: string; mimeType?: string; filename?: string; headers?: GmailHeader[]; body?: { attachmentId?: string; size?: number; data?: string }; parts?: GmailPart[] };
export type GmailMessage = { id: string; threadId: string; labelIds?: string[]; snippet?: string; historyId?: string; internalDate?: string; sizeEstimate?: number; payload?: GmailPart; raw?: string };
export type GmailThread = { id: string; historyId?: string; messages?: GmailMessage[]; snippet?: string };
export type GmailLabel = { id: string; name: string; type: "system" | "user"; messagesUnread?: number; threadsUnread?: number; messagesTotal?: number; labelListVisibility?: string; messageListVisibility?: string; color?: { textColor?: string; backgroundColor?: string } };

export const METADATA_HEADERS = ["From", "To", "Cc", "Bcc", "Subject", "Date", "Message-ID", "In-Reply-To", "References", "Precedence", "Auto-Submitted", "List-Unsubscribe", "List-Id", "Reply-To"];

/* ------------------------------ reads ------------------------------ */

export const profile = (token: string) => call<{ emailAddress: string; historyId: string; messagesTotal: number; threadsTotal: number }>(token, "/profile");

export const listLabels = async (token: string) => (await call<{ labels: GmailLabel[] }>(token, "/labels")).labels ?? [];
export const getLabel = (token: string, id: string) => call<GmailLabel>(token, `/labels/${encodeURIComponent(id)}`);

export async function listThreadIds(token: string, opts: { labelIds?: string[]; q?: string; pageToken?: string; maxResults?: number }) {
  const p = new URLSearchParams();
  for (const l of opts.labelIds ?? []) p.append("labelIds", l);
  if (opts.q) p.set("q", opts.q);
  if (opts.pageToken) p.set("pageToken", opts.pageToken);
  p.set("maxResults", String(opts.maxResults ?? 25));
  const r = await call<{ threads?: Array<{ id: string; snippet?: string; historyId?: string }>; nextPageToken?: string; resultSizeEstimate?: number }>(token, `/threads?${p}`);
  return { ids: (r.threads ?? []).map((t) => t.id), nextPageToken: r.nextPageToken, estimate: r.resultSizeEstimate ?? 0 };
}

export function getThread(token: string, id: string, format: "metadata" | "full" | "minimal" = "full") {
  const p = new URLSearchParams({ format });
  if (format === "metadata") for (const h of METADATA_HEADERS) p.append("metadataHeaders", h);
  return call<GmailThread>(token, `/threads/${id}?${p}`);
}

export function getMessage(token: string, id: string, format: "metadata" | "full" | "raw" = "full") {
  const p = new URLSearchParams({ format });
  if (format === "metadata") for (const h of METADATA_HEADERS) p.append("metadataHeaders", h);
  return call<GmailMessage>(token, `/messages/${id}?${p}`);
}

export const getAttachment = (token: string, messageId: string, attachmentId: string) => call<{ size: number; data: string }>(token, `/messages/${messageId}/attachments/${encodeURIComponent(attachmentId)}`);

/** One HTTP round-trip for up to 100 thread metadata reads. Gmail's batch endpoint speaks multipart/mixed. */
export async function batchGetThreads(token: string, ids: string[], format: "metadata" | "full" = "metadata"): Promise<GmailThread[]> {
  if (!ids.length) return [];
  const boundary = `hd_${Math.random().toString(36).slice(2)}`;
  const p = new URLSearchParams({ format });
  if (format === "metadata") for (const h of METADATA_HEADERS) p.append("metadataHeaders", h);
  const body = ids.map((id, i) => `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <t${i}>\r\n\r\nGET /gmail/v1/users/me/threads/${id}?${p}\r\n\r\n`).join("") + `--${boundary}--`;
  const res = await fetch("https://gmail.googleapis.com/batch/gmail/v1", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/mixed; boundary=${boundary}` }, body });
  const text = await res.text();
  if (!res.ok) throw new GmailError(`Gmail batch failed: ${res.status} ${text.slice(0, 200)}`, res.status);
  const ct = res.headers.get("content-type") ?? "";
  const rb = /boundary=([^;]+)/.exec(ct)?.[1]?.replace(/^"|"$/g, "");
  if (!rb) throw new GmailError("Gmail batch response had no boundary", 502);
  const out: GmailThread[] = [];
  for (const chunk of text.split(`--${rb}`)) {
    const start = chunk.indexOf("{");
    const end = chunk.lastIndexOf("}");
    if (start === -1 || end === -1) continue;
    try {
      const json = JSON.parse(chunk.slice(start, end + 1)) as GmailThread & { error?: unknown };
      if (json.id && !json.error) out.push(json);
    } catch { /* skip malformed part */ }
  }
  // Preserve the order the caller asked for.
  const byId = new Map(out.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter((t): t is GmailThread => !!t);
}

export async function listHistory(token: string, startHistoryId: string, pageToken?: string) {
  const p = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded" });
  p.append("historyTypes", "labelAdded");
  p.append("historyTypes", "labelRemoved");
  if (pageToken) p.set("pageToken", pageToken);
  return call<{ history?: Array<{ id: string; messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }> }>; nextPageToken?: string; historyId: string }>(token, `/history?${p}`);
}

/* ------------------------------ writes ------------------------------ */

export const modifyThread = (token: string, id: string, add: string[], remove: string[]) => call<GmailThread>(token, `/threads/${id}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) });
export const modifyMessage = (token: string, id: string, add: string[], remove: string[]) => call<GmailMessage>(token, `/messages/${id}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) });
export const trashThread = (token: string, id: string) => call<GmailThread>(token, `/threads/${id}/trash`, { method: "POST" });
export const untrashThread = (token: string, id: string) => call<GmailThread>(token, `/threads/${id}/untrash`, { method: "POST" });
export const deleteThreadForever = (token: string, id: string) => call<void>(token, `/threads/${id}`, { method: "DELETE" });

export const sendRaw = (token: string, raw: string, threadId?: string) => call<GmailMessage>(token, "/messages/send", { method: "POST", body: JSON.stringify({ raw, threadId }) });
export const createDraft = (token: string, raw: string, threadId?: string) => call<{ id: string; message: GmailMessage }>(token, "/drafts", { method: "POST", body: JSON.stringify({ message: { raw, threadId } }) });
export const updateDraft = (token: string, draftId: string, raw: string, threadId?: string) => call<{ id: string; message: GmailMessage }>(token, `/drafts/${draftId}`, { method: "PUT", body: JSON.stringify({ message: { raw, threadId } }) });
export const sendDraft = (token: string, draftId: string) => call<GmailMessage>(token, "/drafts/send", { method: "POST", body: JSON.stringify({ id: draftId }) });
export const deleteDraft = (token: string, draftId: string) => call<void>(token, `/drafts/${draftId}`, { method: "DELETE" });
export const getDraft = (token: string, draftId: string) => call<{ id: string; message: GmailMessage }>(token, `/drafts/${draftId}?format=full`);
export const listDrafts = (token: string) => call<{ drafts?: Array<{ id: string; message: { id: string; threadId: string } }> }>(token, "/drafts?maxResults=100");

export const createLabel = (token: string, name: string, color?: { textColor: string; backgroundColor: string }) => call<GmailLabel>(token, "/labels", { method: "POST", body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show", color }) });
export const deleteLabel = (token: string, id: string) => call<void>(token, `/labels/${encodeURIComponent(id)}`, { method: "DELETE" });
export const renameLabel = (token: string, id: string, name: string) => call<GmailLabel>(token, `/labels/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) });

export const watch = (token: string, topicName: string) => call<{ historyId: string; expiration: string }>(token, "/watch", { method: "POST", body: JSON.stringify({ topicName, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" }) });
export const stopWatch = (token: string) => call<void>(token, "/stop", { method: "POST" });

/* ------------------------------ parsing ------------------------------ */

export const header = (m: GmailMessage | GmailPart | undefined, name: string) => (("payload" in (m ?? {}) ? (m as GmailMessage).payload?.headers : (m as GmailPart | undefined)?.headers) ?? []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

export type Address = { name: string; email: string };
/** "Barbara Fraser <barbara@…>, luke@…" → [{name, email}] */
export function parseAddresses(value: string): Address[] {
  if (!value) return [];
  const out: Address[] = [];
  const re = /(?:"?([^"<,]*?)"?\s*)?<([^>]+)>|([^\s,<>]+@[^\s,<>]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    const email = (m[2] ?? m[3] ?? "").trim().toLowerCase();
    if (!email) continue;
    const name = (m[1] ?? "").trim().replace(/^"|"$/g, "");
    out.push({ name: name || email.split("@")[0], email });
  }
  return out;
}
export const normaliseMessageId = (id: string) => id.trim().replace(/^<|>$/g, "").toLowerCase();

export function decodeBase64Url(data: string): Uint8Array {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((data.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
export const decodeText = (data: string) => new TextDecoder("utf-8").decode(decodeBase64Url(data));
export function encodeBase64Url(bytes: Uint8Array | string): string {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type Attachment = { attachmentId: string; filename: string; mime: string; size: number; contentId?: string; inline: boolean };
export type ParsedBody = { html?: string; text?: string; attachments: Attachment[] };

/** Walk the MIME tree Gmail already parsed for us. Inline images keep their Content-ID so the UI can map cid: URLs. */
export function parseBody(payload: GmailPart | undefined): ParsedBody {
  const out: ParsedBody = { attachments: [] };
  const walk = (p: GmailPart | undefined) => {
    if (!p) return;
    const mime = (p.mimeType ?? "").toLowerCase();
    const disposition = header(p, "Content-Disposition").toLowerCase();
    const cid = header(p, "Content-ID").replace(/^<|>$/g, "");
    if (p.filename && p.body?.attachmentId) {
      out.attachments.push({ attachmentId: p.body.attachmentId, filename: p.filename, mime: mime || "application/octet-stream", size: p.body.size ?? 0, contentId: cid || undefined, inline: disposition.startsWith("inline") || !!cid });
    } else if (mime === "text/html" && p.body?.data && !out.html) out.html = decodeText(p.body.data);
    else if (mime === "text/plain" && p.body?.data && !out.text) out.text = decodeText(p.body.data);
    else if (p.body?.data && p.body.attachmentId === undefined && mime.startsWith("image/") && cid) {
      out.attachments.push({ attachmentId: "", filename: p.filename || "image", mime, size: p.body.size ?? 0, contentId: cid, inline: true });
    }
    p.parts?.forEach(walk);
  };
  walk(payload);
  return out;
}

export function isAutoSubmitted(m: GmailMessage): boolean {
  const auto = header(m, "Auto-Submitted").toLowerCase();
  const prec = header(m, "Precedence").toLowerCase();
  return (auto !== "" && auto !== "no") || prec === "bulk" || prec === "list" || prec === "junk" || header(m, "List-Id") !== "";
}

/* ------------------------------ composing ------------------------------ */

export type OutgoingAttachment = { filename: string; mime: string; base64: string };
export type Outgoing = {
  from: Address;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: OutgoingAttachment[];
  extraHeaders?: Record<string, string>;
};

const fmtAddr = (a: Address) => (a.name && a.name !== a.email ? `${encodeHeaderWord(a.name)} <${a.email}>` : a.email);
const encodeHeaderWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? (/[",]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s) : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`);
const b64lines = (s: string) => s.replace(/.{76}/g, "$&\r\n");
const toBase64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

/** Build an RFC 2822 message and return it base64url-encoded for messages.send. */
export function buildRaw(msg: Outgoing): string {
  const boundaryMixed = `hdmixed_${Math.random().toString(36).slice(2)}`;
  const boundaryAlt = `hdalt_${Math.random().toString(36).slice(2)}`;
  const text = msg.text ?? htmlToText(msg.html);
  const headers: string[] = [
    `From: ${fmtAddr(msg.from)}`,
    `To: ${msg.to.map(fmtAddr).join(", ")}`,
    ...(msg.cc?.length ? [`Cc: ${msg.cc.map(fmtAddr).join(", ")}`] : []),
    ...(msg.bcc?.length ? [`Bcc: ${msg.bcc.map(fmtAddr).join(", ")}`] : []),
    ...(msg.replyTo ? [`Reply-To: ${msg.replyTo}`] : []),
    `Subject: ${encodeHeaderWord(msg.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    ...(msg.inReplyTo ? [`In-Reply-To: <${normaliseMessageId(msg.inReplyTo)}>`] : []),
    ...(msg.references?.length ? [`References: ${msg.references.map((r) => `<${normaliseMessageId(r)}>`).join(" ")}`] : []),
    ...Object.entries(msg.extraHeaders ?? {}).map(([k, v]) => `${k}: ${v}`),
    "MIME-Version: 1.0",
  ];
  const alt = [
    `--${boundaryAlt}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64lines(toBase64(text)),
    `--${boundaryAlt}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64lines(toBase64(msg.html)),
    `--${boundaryAlt}--`,
  ].join("\r\n");
  let body: string;
  if (msg.attachments?.length) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundaryMixed}"`);
    const parts = [`--${boundaryMixed}`, `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`, "", alt];
    for (const a of msg.attachments) {
      parts.push(`--${boundaryMixed}`, `Content-Type: ${a.mime}; name="${a.filename.replace(/"/g, "")}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${a.filename.replace(/"/g, "")}"`, "", b64lines(a.base64));
    }
    parts.push(`--${boundaryMixed}--`);
    body = parts.join("\r\n");
  } else {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundaryAlt}"`);
    body = alt;
  }
  return encodeBase64Url(`${headers.join("\r\n")}\r\n\r\n${body}`);
}

/** Good-enough plain-text alternative: strips tags, keeps paragraph breaks and link targets. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => `${label.replace(/<[^>]+>/g, "")} (${href})`)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}
