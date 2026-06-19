// Staff-side extraction endpoint (authenticated). The ERP calls this to turn a
// photo / PDF / pasted message into a structured item list, inside the app.
// Deployed with --no-verify-jwt so the CORS preflight works; we verify the
// caller's Supabase JWT manually below (staff-only, prevents abuse of the AI key).
// Secret required: ANTHROPIC_API_KEY (shared with the rfq-gateway).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
function fileBlock(f: any) {
  return f.media_type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
    : { type: "image", source: { type: "base64", media_type: f.media_type, data: f.data } };
}
function validateFiles(files: any[]): string | null {
  if (files.length > 6) return "too_many";
  const ok = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  for (const f of files) {
    if (!f || !f.data || !f.media_type) return "no_file";
    if (!ok.includes(f.media_type)) return "bad_type";
    if (f.data.length > 8_000_000) return "too_large";
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "extract_unavailable" }, 503);

  // verify the caller is a signed-in staff user
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "unauthorized" }, 401);
  try {
    const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);
  } catch { return json({ error: "unauthorized" }, 401); }

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const text = (typeof body.text === "string") ? body.text.trim() : "";
  const files = Array.isArray(body.files) ? body.files : (body.file ? [body.file] : []);
  if (!text && !files.length) return json({ error: "no_input" }, 400);
  if (text && text.length > 20000) return json({ error: "too_large" }, 413);
  if (!text) { const v = validateFiles(files); if (v) return json({ error: v }, v === "bad_type" ? 415 : 413); }

  const prompt =
    "You are reading an event-requirements list (typed, printed, or handwritten; may be a phone photo or a pasted message). " +
    "Extract the requested items. Return ONLY a JSON array — no prose, no code fences — of objects: " +
    "{\"description\": string, \"quantity\": number, \"sub_event\": string|null}. " +
    "description = the item/service requested. quantity = number requested (1 if not stated). " +
    "sub_event = the function/section it belongs to if the list is grouped (e.g. \"Mehendi\", \"Reception\"), else null. " +
    "The list may be in English, Telugu, Hindi or a mix and may be handwritten — read it faithfully; short clear English label where obvious, else keep the original. " +
    "Read counts like \"2 tubs\", \"200 chairs\", \"8x12 backdrop\" as the number and keep any size/spec in the description. " +
    "Ignore prices, money, totals, headings and contact details. If you cannot read any items, return [].";

  const content: any[] = text
    ? [{ type: "text", text: prompt + "\n\nHere is the list to read:\n\n" + text }]
    : [...files.map(fileBlock), { type: "text", text: prompt }];

  let aiText = "";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) { console.error("[extract] anthropic", r.status, await r.text()); return json({ error: "extract_failed", status: r.status }, 502); }
    const d = await r.json();
    aiText = ((d?.content || []) as any[]).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  } catch (e) { console.error("[extract] fetch", e); return json({ error: "extract_failed" }, 502); }

  let items: any[] = [];
  try {
    let t = aiText.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    const a = t.indexOf("["), b = t.lastIndexOf("]");
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    const p = JSON.parse(t);
    if (Array.isArray(p)) items = p;
  } catch (e) { console.error("[extract] parse", aiText); return json({ error: "extract_unreadable" }, 422); }

  const clean = items.map((it: any) => ({
    description: String(it.description ?? it.item ?? "").trim().slice(0, 300),
    quantity: Math.max(1, Math.round(Number(it.quantity) || 1)),
    sub_event: it.sub_event ? String(it.sub_event).trim().slice(0, 80) : null,
  })).filter((it: any) => it.description);
  return json({ ok: true, items: clean });
});
