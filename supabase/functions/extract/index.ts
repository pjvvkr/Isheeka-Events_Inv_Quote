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
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";   // shared with the gateway (owner-expense alerts)
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "Isheeka Events <onboarding@resend.dev>";
const ERP_URL = Deno.env.get("ERP_URL") ?? "https://isheeka-events-erp.netlify.app";

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

// Resend send (shared secret with the gateway). Stub-safe: no key → logs only.
async function sendEmail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!RESEND_API_KEY) { console.log("[extract:email STUB]", { to, subject }); return false; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html, text }),
    });
    if (!r.ok) { console.error("[extract:email] resend", r.status, await r.text()); return false; }
    return true;
  } catch (e) { console.error("[extract:email] exception", e); return false; }
}
const inr = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

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
  const action = (typeof body.action === "string") ? body.action : "items";

  // ── notify: email the owners that an owner-funded expense was recorded ──────
  if (action === "notify") {
    const recipients: string[] = (Array.isArray(body.to) ? body.to : [])
      .filter((e: any) => typeof e === "string" && /\S+@\S+\.\S+/.test(e)).slice(0, 6);
    if (!recipients.length) return json({ error: "no_recipients" }, 400);
    const ex = body.expense || {};
    const amtStr = inr(Number(ex.amount) || 0);
    const who = String(ex.paid_by_name || "An owner").slice(0, 80);
    const desc = String(ex.description || "a business expense").slice(0, 200);
    const cat = ex.category ? (" (" + String(ex.category).slice(0, 60) + ")") : "";
    const when = ex.date ? (" on " + String(ex.date).slice(0, 40)) : "";
    const subject = "[Isheeka] Expense recorded — " + amtStr + " by " + who;
    const line = who + " paid " + amtStr + " for " + desc + cat + when + ". Reimbursement requested.";
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#2a2723"><p>${line}</p><p><a href="${ERP_URL}/?go=owner" style="display:inline-block;background:#e8185a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open Owner Account →</a></p><p style="color:#888;font-size:12px">${ERP_URL}</p></div>`;
    const text2 = line + "\n\nOpen: " + ERP_URL + "/?go=owner";
    let sent = 0;
    for (const to of recipients) { if (await sendEmail(to, subject, html, text2)) sent++; }
    return json({ ok: true, sent });
  }

  const text = (typeof body.text === "string") ? body.text.trim() : "";
  const files = Array.isArray(body.files) ? body.files : (body.file ? [body.file] : []);
  if (!text && !files.length) return json({ error: "no_input" }, 400);
  if (text && text.length > 20000) return json({ error: "too_large" }, 413);
  if (!text) { const v = validateFiles(files); if (v) return json({ error: v }, v === "bad_type" ? 415 : 413); }

  const itemsPrompt =
    "You are reading an event-requirements list (typed, printed, or handwritten; may be a phone photo or a pasted message). " +
    "Extract the requested items. Return ONLY a JSON array — no prose, no code fences — of objects: " +
    "{\"description\": string, \"quantity\": number, \"sub_event\": string|null}. " +
    "description = the item/service requested. quantity = number requested (1 if not stated). " +
    "sub_event = the function/section it belongs to if the list is grouped (e.g. \"Mehendi\", \"Reception\"), else null. " +
    "The list may be in English, Telugu, Hindi or a mix and may be handwritten — read it faithfully; short clear English label where obvious, else keep the original. " +
    "Read counts like \"2 tubs\", \"200 chairs\", \"8x12 backdrop\" as the number and keep any size/spec in the description. " +
    "Ignore prices, money, totals, headings and contact details. If you cannot read any items, return [].";

  // expense mode: read a single receipt/bill/note → one expense object.
  const expensePrompt =
    "You are reading a receipt, bill, or a short typed/pasted note about ONE business expense (may be a phone photo, possibly handwritten, English/Telugu/Hindi or a mix). " +
    "Return ONLY a JSON object — no prose, no code fences: " +
    "{\"amount\": number|null, \"date\": string|null, \"category\": string|null, \"merchant\": string|null, \"description\": string|null}. " +
    "amount = the total paid as a plain number (no currency symbols; the grand total if several lines). " +
    "date = the bill/expense date as YYYY-MM-DD if visible, else null. " +
    "category = the single best fit from EXACTLY this list: marketing, operations, travel, staff, event_incidentals, professional, banking, miscellaneous. " +
    "merchant = the shop/vendor/payee name if visible. " +
    "description = a short plain-English label of what it was for (e.g. \"Mandap flowers\", \"Cab to venue\"). " +
    "If you cannot read it, return {}.";

  const prompt = action === "expense" ? expensePrompt : itemsPrompt;
  const content: any[] = text
    ? [{ type: "text", text: prompt + "\n\nHere is what to read:\n\n" + text }]
    : [...files.map(fileBlock), { type: "text", text: prompt }];

  let aiText = "";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 8000, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) { console.error("[extract] anthropic", r.status, await r.text()); return json({ error: "extract_failed", status: r.status }, 502); }
    const d = await r.json();
    aiText = ((d?.content || []) as any[]).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  } catch (e) { console.error("[extract] fetch", e); return json({ error: "extract_failed" }, 502); }

  // expense mode → one object
  if (action === "expense") {
    let obj: any = {};
    try {
      let t = aiText.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
      const a = t.indexOf("{"), b = t.lastIndexOf("}");
      if (a >= 0 && b > a) t = t.slice(a, b + 1);
      obj = JSON.parse(t) || {};
    } catch (e) { console.error("[extract] expense parse", aiText); return json({ error: "extract_unreadable" }, 422); }
    const cats = ["marketing", "operations", "travel", "staff", "event_incidentals", "professional", "banking", "miscellaneous"];
    const cat = (obj.category && cats.includes(String(obj.category))) ? String(obj.category) : null;
    const amount = (obj.amount == null || obj.amount === "") ? null : Math.max(0, Math.round(Number(String(obj.amount).replace(/[,\s]/g, "")) || 0));
    const date = (typeof obj.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.date.trim())) ? obj.date.trim() : null;
    return json({ ok: true, expense: {
      amount,
      date,
      category: cat,
      merchant: obj.merchant ? String(obj.merchant).trim().slice(0, 120) : null,
      description: obj.description ? String(obj.description).trim().slice(0, 200) : (obj.merchant ? String(obj.merchant).trim().slice(0, 120) : null),
    } });
  }

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
