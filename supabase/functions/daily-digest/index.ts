// daily-digest (Phase 4) — runs once a day (pg_cron). Computes time-based alerts
// (invoices that just went overdue, events tomorrow, follow-ups due) + a morning
// digest, and fans out in-app / push / email per each owner-admin's prefs.
// Auth: x-internal-secret (set by the cron job). Deploy: --no-verify-jwt.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "Isheeka Events <onboarding@resend.dev>";
const ERP_URL = Deno.env.get("ERP_URL") ?? "https://app.isheekaevents.com";
const PUSH_INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-internal-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const inr = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const num = (n: any) => parseFloat(n) || 0;

function prefOn(prefs: any, ev: string, ch: string): boolean {
  const p = prefs && prefs[ev];
  if (p && typeof p[ch] === "boolean") return p[ch];
  const DEF: any = { overdue_followup: { inapp: true, push: true, email: false }, digest: { inapp: false, push: true, email: true } };
  return (DEF[ev] && typeof DEF[ev][ch] === "boolean") ? DEF[ev][ch] : true;
}
function istYmd(offsetDays = 0): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}
async function sendEmail(to: string, subject: string, html: string, text: string) {
  if (!RESEND_API_KEY) return;
  try { await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html, text }) }); } catch (e) { /* noop */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if ((req.headers.get("x-internal-secret") || "") !== PUSH_INTERNAL_SECRET || !PUSH_INTERNAL_SECRET) return json({ error: "unauthorized" }, 401);

  const today = istYmd(0), yesterday = istYmd(-1), tomorrow = istYmd(1), in7 = istYmd(7);

  // Audience + prefs.
  const { data: us } = await db.from("users").select("user_id,email,role,is_owner,notify_prefs").eq("is_deleted", false);
  const aud = (us || []).filter((u: any) => u.is_owner || u.role === "admin");
  if (!aud.length) return json({ ok: true, note: "no audience" });

  // Fan-out helper: in-app (insert) + push (push-send) + email (Resend), each per prefs.
  async function emit(evKey: string, n: { title: string; body: string; doc_ref?: string; link_page?: string; link_opts?: any; url?: string }, email?: { subject: string; html: string; text: string }) {
    const inappIds = aud.filter((u: any) => prefOn(u.notify_prefs, evKey, "inapp")).map((u: any) => u.user_id);
    const pushIds = aud.filter((u: any) => prefOn(u.notify_prefs, evKey, "push")).map((u: any) => u.user_id);
    const emails = aud.filter((u: any) => prefOn(u.notify_prefs, evKey, "email")).map((u: any) => u.email).filter(Boolean);
    if (inappIds.length) { try { await db.from("notifications").insert(inappIds.map((uid: string) => ({ recipient_user_id: uid, type: evKey, title: n.title, body: n.body, doc_ref: n.doc_ref || null, link_page: n.link_page || null, link_opts: n.link_opts || null }))); } catch (e) { /* noop */ } }
    if (pushIds.length && PUSH_INTERNAL_SECRET) { try { await fetch(SUPABASE_URL + "/functions/v1/push-send", { method: "POST", headers: { "Content-Type": "application/json", "x-internal-secret": PUSH_INTERNAL_SECRET }, body: JSON.stringify({ user_ids: pushIds, payload: { title: n.title, body: n.body, url: n.url || ERP_URL, tag: n.doc_ref || evKey } }) }); } catch (e) { /* noop */ } }
    if (email && emails.length) { for (const to of emails) await sendEmail(String(to), email.subject, email.html, email.text); }
  }

  // 1) Invoices that just went overdue (due yesterday, still open).
  const { data: justOverdue } = await db.from("invoices").select("invoice_id,ref_number,client_name,total_outstanding,due_date,status").eq("is_deleted", false).eq("due_date", yesterday).neq("status", "cancelled").neq("status", "paid");
  for (const i of (justOverdue || [])) {
    if (num(i.total_outstanding) <= 0) continue;
    await emit("overdue_followup", { title: "Invoice overdue", body: (i.client_name || "Client") + " · " + inr(num(i.total_outstanding)) + " outstanding", doc_ref: i.ref_number || "", link_page: "invoices", link_opts: { invoiceId: i.invoice_id }, url: ERP_URL + "/?inv=" + i.invoice_id });
  }

  // 2) Events happening tomorrow.
  const { data: evs } = await db.from("events").select("event_id,ref_number,name,client_name,main_date,status").eq("is_deleted", false).eq("main_date", tomorrow);
  for (const e of (evs || [])) {
    if (["cancelled", "completed"].includes(String(e.status || "").toLowerCase())) continue;
    await emit("overdue_followup", { title: "Event tomorrow", body: (e.name || e.ref_number || "Event") + (e.client_name ? (" · " + e.client_name) : ""), doc_ref: e.ref_number || "", link_page: "events", link_opts: { eventId: e.event_id } });
  }

  // 3) Lead follow-ups due today.
  const { data: leads } = await db.from("leads").select("lead_id,first_name,last_name,stage,follow_up_date").eq("is_deleted", false).eq("follow_up_date", today);
  for (const l of (leads || [])) {
    if (["lost", "converted", "event_triggered", "completed"].includes(String(l.stage || ""))) continue;
    await emit("overdue_followup", { title: "Follow-up due", body: (((l.first_name || "") + " " + (l.last_name || "")).trim() || "Lead"), doc_ref: "", link_page: "leads", link_opts: { leadId: l.lead_id } });
  }

  // 4) Morning digest summary.
  const { count: rfqWaiting } = await db.from("rfqs").select("rfq_id", { count: "exact", head: true }).eq("is_deleted", false).eq("party_type", "client").eq("status", "submitted");
  const { data: openInv } = await db.from("invoices").select("total_outstanding,due_date,status").eq("is_deleted", false).neq("status", "cancelled").neq("status", "paid");
  let overdueTotal = 0, overdueCount = 0;
  (openInv || []).forEach((i: any) => { const o = num(i.total_outstanding); if (o > 0 && i.due_date && i.due_date < today) { overdueTotal += o; overdueCount++; } });
  const { count: upcoming } = await db.from("events").select("event_id", { count: "exact", head: true }).eq("is_deleted", false).gte("main_date", today).lte("main_date", in7);

  const lines = [
    (rfqWaiting || 0) + " RFQ" + ((rfqWaiting || 0) === 1 ? "" : "s") + " awaiting review",
    overdueCount + " overdue invoice" + (overdueCount === 1 ? "" : "s") + " · " + inr(overdueTotal),
    (upcoming || 0) + " event" + ((upcoming || 0) === 1 ? "" : "s") + " in the next 7 days",
  ];
  const digestBody = lines.join(" · ");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#2a2723"><p style="font-weight:600">Good morning — here's your Isheeka snapshot for ${today}:</p><ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul><p><a href="${ERP_URL}" style="display:inline-block;background:#e8185a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open the app →</a></p></div>`;
  await emit("digest", { title: "Daily summary", body: digestBody, link_page: "dashboard", url: ERP_URL }, { subject: "[Isheeka] Daily summary — " + today, html, text: "Daily summary — " + today + "\n\n" + lines.join("\n") + "\n\n" + ERP_URL });

  return json({ ok: true, overdue: (justOverdue || []).length, events: (evs || []).length, followups: (leads || []).length });
});
