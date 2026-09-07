"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sanitiseEmailHtml, textToHtml } from "@/lib/sanitise";
import { Button } from "@/components/ui/button";

const FRAME_CSS = `
  :root { color-scheme: light; }
  body { margin: 0; padding: 0 2px; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #1a1a1a; background: transparent; word-break: break-word; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  blockquote { margin: 0 0 0 .8ex; border-left: 1px solid #ccc; padding-left: 1ex; color: #4d4d4d; }
  pre { white-space: pre-wrap; }
  a { color: #0081f2; }
`;

/**
 * Renders one message body inside a sandboxed iframe (no scripts, no forms, no top navigation). The frame
 * reports its height so the thread reads as one page. Remote images stay blocked until the reader opts in.
 */
export function MessageFrame({ html, text, cidMap, showImagesDefault }: { html?: string; text?: string; cidMap: Record<string, string>; showImagesDefault: boolean }) {
  const [showImages, setShowImages] = useState(showImagesDefault);
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const { html: safe, blockedImages } = useMemo(() => sanitiseEmailHtml(html ?? textToHtml(text ?? ""), { showImages, cidMap }), [html, text, showImages, cidMap]);
  const srcDoc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>${FRAME_CSS}</style></head><body>${safe}<script>
    (function(){ var send=function(){ parent.postMessage({hd:'h', h: document.documentElement.scrollHeight}, '*'); }; send(); new ResizeObserver(send).observe(document.body); Array.prototype.forEach.call(document.images, function(i){ i.addEventListener('load', send); }); })();
  </script></body></html>`, [safe]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.source === ref.current?.contentWindow && e.data?.hd === "h") setHeight(Math.min(20000, Math.max(40, Number(e.data.h) + 8))); };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  return (
    <div>
      {blockedImages > 0 && !showImages && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-1.5 text-xs text-fg-secondary">
          <span>{blockedImages} remote image{blockedImages === 1 ? "" : "s"} blocked to protect your privacy.</span>
          <Button size="xs" variant="outline" onClick={() => setShowImages(true)}>Show images</Button>
        </div>
      )}
      <iframe ref={ref} title="Message" className="hd-mail-frame" style={{ height }} sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin" srcDoc={srcDoc} />
    </div>
  );
}
