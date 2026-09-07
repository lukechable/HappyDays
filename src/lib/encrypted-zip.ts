/**
 * Send Documents bundles: an AES-256 password-protected zip built in the browser, so the bytes that reach Convex
 * storage and Gmail are already encrypted. zip.js is loaded on first use; it is not part of the page bundle.
 */
export async function encryptedZip(files: File[], password: string, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  if (!password || password.length < 8) throw new Error("The password needs at least 8 characters.");
  const zip = await import("@zip.js/zip.js");
  zip.configure({ useWebWorkers: false });
  const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"), { password, encryptionStrength: 3, zipCrypto: false, level: 6 });
  const names = new Set<string>();
  for (const [i, f] of files.entries()) {
    let name = f.name.replace(/[\\/:*?"<>|]/g, "_");
    let n = 2;
    while (names.has(name)) name = f.name.replace(/(\.[^.]*)?$/, ` (${n++})$1`);
    names.add(name);
    await writer.add(name, new zip.BlobReader(f), { lastModDate: new Date(f.lastModified || Date.now()) });
    onProgress?.(i + 1, files.length);
  }
  return await writer.close();
}

/** 16 characters from an alphabet without look-alikes, in groups of four so it survives being read out over the phone. */
export function randomPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const raw = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(raw, (b) => alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

/** What the zip is called: "smith-documents-2026-09-08.zip". */
export function bundleName(recipient: string): string {
  const slug = recipient.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "documents";
  return `${slug}-documents-${new Date().toISOString().slice(0, 10)}.zip`;
}
