"use client";

import DOMPurify from "dompurify";

/**
 * Email HTML is untrusted. We strip scripts, forms and event handlers, block remote images unless the reader
 * asks for them, and rewrite cid: references to the attachment proxy so inline images still show.
 */
export function sanitiseEmailHtml(html: string, opts: { showImages: boolean; cidMap: Record<string, string> }): { html: string; blockedImages: number } {
  let blocked = 0;
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "meta", "link", "base", "video", "audio", "source", "track", "picture", "svg", "math"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "srcset", "poster", "ping"],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ["target"],
  });
  const doc = new DOMParser().parseFromString(`<div id="root">${clean}</div>`, "text/html");
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    if (src.startsWith("cid:")) {
      const mapped = opts.cidMap[src.slice(4).replace(/^<|>$/g, "")];
      if (mapped) img.setAttribute("src", mapped); else img.remove();
      return;
    }
    if (src.startsWith("data:image/")) return;
    if (!opts.showImages) { blocked++; img.setAttribute("data-blocked-src", src); img.removeAttribute("src"); img.setAttribute("alt", img.getAttribute("alt") || "Image blocked"); img.style.cssText = "display:inline-block;min-width:24px;min-height:24px;background:#f3f3f3;border:1px dashed #ccc"; }
  });
  doc.querySelectorAll("[background]").forEach((el) => { const bg = el.getAttribute("background") ?? ""; if (!opts.showImages || /^\s*(https?:)?\/\//i.test(bg)) { el.removeAttribute("background"); if (!opts.showImages) blocked++; } });
  doc.querySelectorAll("a").forEach((a) => { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener noreferrer nofollow"); const href = a.getAttribute("href") ?? ""; if (/^\s*javascript:/i.test(href)) a.removeAttribute("href"); });
  doc.querySelectorAll("[style]").forEach((el) => { const st = el.getAttribute("style") ?? ""; if (!opts.showImages && /url\(/i.test(st)) { el.setAttribute("style", st.replace(/background(-image)?\s*:[^;]*url\([^)]*\)[^;]*;?/gi, "")); } if (/position\s*:\s*fixed/i.test(st)) el.setAttribute("style", st.replace(/position\s*:\s*fixed/gi, "position:static")); });
  return { html: doc.getElementById("root")?.innerHTML ?? "", blockedImages: blocked };
}

/** For HTML that will be placed inside the compose editor: no scripts, forms, iframes or event handlers. */
export const sanitiseForEditor = (html: string) => DOMPurify.sanitize(html, { FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "meta", "link", "base", "svg", "math"], FORBID_ATTR: ["onerror", "onload", "onclick", "srcset"], ALLOW_DATA_ATTR: false });

export const textToHtml = (text: string) => `<div style="white-space:pre-wrap;font-family:inherit">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</div>`;

/** Quoted history for replies and forwards, Gmail-style. */
export function quoteHtml(opts: { from: string; date: number; to?: string; subject?: string; html: string; mode: "reply" | "forward" }): string {
  const when = new Date(opts.date).toLocaleString("en-AU", { dateStyle: "full", timeStyle: "short" });
  if (opts.mode === "forward") {
    return `<br><br><div class="hd-quote">---------- Forwarded message ---------<br>From: ${escape(opts.from)}<br>Date: ${when}<br>Subject: ${escape(opts.subject ?? "")}<br>To: ${escape(opts.to ?? "")}<br><br>${opts.html}</div>`;
  }
  return `<br><br><div class="hd-quote">On ${when}, ${escape(opts.from)} wrote:<br><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${opts.html}</blockquote></div>`;
}
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
