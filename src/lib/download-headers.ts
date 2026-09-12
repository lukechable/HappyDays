/** RFC 6266: ASCII fallback plus RFC 5987 UTF-8 filename; reject control/header characters. */
export function contentDisposition(name: string, disposition: "inline" | "attachment" = "attachment") {
  const clean = name.replace(/[\u0000-\u001f\u007f"\\]/g, "_").slice(0, 200).toWellFormed();
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
