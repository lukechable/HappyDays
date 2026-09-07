"use node";
import Anthropic from "@anthropic-ai/sdk";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

/**
 * Claude reads mail only when a rule or classifier asks it to. Nothing is retained by us; the request carries the
 * subject, sender and up to 6,000 characters of body text and returns a summary, tag ids and a category.
 */

const MODEL = "claude-opus-5";
const client = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const textOf = (r: Anthropic.Beta.BetaMessage | Anthropic.Message) => r.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");

function parseJson<T>(s: string, fallback: T): T {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return fallback;
  try { return JSON.parse(m[0]) as T; } catch { return fallback; }
}

export const classifyEmail = internalAction({
  args: { subject: v.string(), from: v.string(), text: v.string(), tags: v.array(v.object({ id: v.string(), name: v.string(), hint: v.string() })) },
  handler: async (_ctx, { subject, from, text, tags }): Promise<{ summary: string; tagIds: string[]; category: "primary" | "newsletter" | "notification" | "receipt" | "calendar" | "social" }> => {
    const tagList = tags.map((t) => `- id "${t.id}": ${t.name}${t.hint ? ` — ${t.hint}` : ""}`).join("\n");
    const res = await client().beta.messages.create({
      model: MODEL,
      max_tokens: 1024,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: "You triage email for a small Australian family-assessment psychology practice (Barbara Fraser & Associates). Be factual and brief. Reply with JSON only.",
      messages: [{ role: "user", content: `Subject: ${subject}\nFrom: ${from}\n\n${text}\n\n---\nAvailable tags:\n${tagList || "(none)"}\n\nReturn JSON: {"summary": "<one sentence, max 20 words, what the sender wants>", "tagIds": [<ids of tags that clearly apply, may be empty>], "category": "primary" | "newsletter" | "notification" | "receipt" | "calendar" | "social"}` }],
    });
    if (res.stop_reason === "refusal") return { summary: "", tagIds: [], category: "primary" };
    const out = parseJson<{ summary?: string; tagIds?: string[]; category?: string }>(textOf(res), {});
    const valid = new Set(tags.map((t) => t.id));
    const cats = ["primary", "newsletter", "notification", "receipt", "calendar", "social"] as const;
    return { summary: (out.summary ?? "").slice(0, 200), tagIds: (out.tagIds ?? []).filter((id) => valid.has(id)), category: (cats as readonly string[]).includes(out.category ?? "") ? (out.category as (typeof cats)[number]) : "primary" };
  },
});

export const matchesCondition = internalAction({
  args: { condition: v.string(), subject: v.string(), from: v.string(), text: v.string() },
  handler: async (_ctx, { condition, subject, from, text }): Promise<{ matches: boolean; reason: string }> => {
    const res = await client().beta.messages.create({
      model: MODEL,
      max_tokens: 512,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: "You decide whether an email matches a plain-English condition written by the practice. Reply with JSON only.",
      messages: [{ role: "user", content: `Condition: ${condition}\n\nSubject: ${subject}\nFrom: ${from}\n\n${text}\n\nReturn JSON: {"matches": true|false, "reason": "<max 15 words>"}` }],
    });
    if (res.stop_reason === "refusal") return { matches: false, reason: "declined" };
    const out = parseJson<{ matches?: boolean; reason?: string }>(textOf(res), {});
    return { matches: !!out.matches, reason: out.reason ?? "" };
  },
});

/** Drafts a reply in the practice's voice for the compose window's "Suggest a reply" button. */
export const draftReply = internalAction({
  args: { subject: v.string(), from: v.string(), text: v.string(), instruction: v.optional(v.string()), signOff: v.string() },
  handler: async (_ctx, { subject, from, text, instruction, signOff }): Promise<string> => {
    const res = await client().beta.messages.create({
      model: MODEL,
      max_tokens: 2048,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: `You draft email replies for a family-assessment psychology practice in Australia. Warm, plain, professional. Australian spelling. Never invent appointment times, fees or clinical facts; leave a [bracketed placeholder] where the sender must fill one in. Sign off exactly as: ${signOff}. Return the reply body as simple HTML paragraphs only.`,
      messages: [{ role: "user", content: `Reply to this email.${instruction ? ` Guidance: ${instruction}` : ""}\n\nSubject: ${subject}\nFrom: ${from}\n\n${text}` }],
    });
    if (res.stop_reason === "refusal") return "";
    return textOf(res).trim();
  },
});
