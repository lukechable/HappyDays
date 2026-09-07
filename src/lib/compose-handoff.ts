import type { ComposeDraft } from "@/components/mail/compose";

/** Hand a prepared message to the mail page: it opens the compose window with these fields filled. */
export function openCompose(router: { push: (href: string) => void }, draft: Partial<ComposeDraft> & { mode?: ComposeDraft["mode"] }) {
  sessionStorage.setItem("hd-compose", JSON.stringify({ mode: "new", to: [], cc: [], bcc: [], subject: "", html: "", ...draft }));
  router.push("/mail?compose=handoff");
}

export async function fileToBase64(file: File | Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function sha256(file: File | Blob): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}
