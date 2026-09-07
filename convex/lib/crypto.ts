/** AES-GCM at rest for Google refresh tokens. TOKEN_ENCRYPTION_KEY is 32 random bytes, base64. */
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = {
  encode: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
  decode: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

async function key(): Promise<CryptoKey> {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set on the Convex deployment.");
  const bytes = b64.decode(raw);
  if (bytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), enc.encode(plain)));
  return `${b64.encode(iv)}.${b64.encode(ct)}`;
}

export async function decrypt(packed: string): Promise<string> {
  const [ivB, ctB] = packed.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.decode(ivB) }, await key(), b64.decode(ctB));
  return dec.decode(pt);
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const raw = typeof input === "string" ? enc.encode(input) : input;
  const data = new Uint8Array(raw.byteLength); data.set(raw);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Unguessable download codes: 8 characters from a 32-symbol alphabet with no ambiguous glyphs. */
export function randomCode(length = 8): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function randomToken(bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return b64.encode(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
