// ============================================================================
// Isheeka ERP — rfq-gateway  (Supabase Edge Function, Deno)
//
// The ONLY public door to the RFQ tables. The public page (rfq.html) calls this
// and nothing else; it holds no keys. This function validates a per-link token
// + a PIN (staff-shared) or an email OTP, mints a short-lived signed session,
// and uses the service_role key to read/write — always scoped to ONE rfq_id.
//
// Deploy PUBLIC (no JWT): supabase functions deploy rfq-gateway --no-verify-jwt
// (the function does its own auth; clients have no Supabase JWT).
//
// Auto-injected env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Secrets to set:    SESSION_SECRET (required), RESEND_API_KEY + EMAIL_FROM (email),
//                    ANTHROPIC_API_KEY (for extract_items: attachment/photo → item list),
//                    optional: LINK_TTL_DAYS=21, OTP_TTL_MIN=10, MAX_ATTEMPTS=5,
//                    ALLOWED_ORIGIN (CORS; default "*").
// Spec: docs/rfq-portal-spec.md §F.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, otpEmail } from "./email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SESSION_SECRET = Deno.env.get("SESSION_SECRET") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const LINK_TTL_DAYS = parseInt(Deno.env.get("LINK_TTL_DAYS") ?? "21", 10);
const OTP_TTL_MIN = parseInt(Deno.env.get("OTP_TTL_MIN") ?? "10", 10);
const MAX_ATTEMPTS = parseInt(Deno.env.get("MAX_ATTEMPTS") ?? "5", 10);
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";   // for extract_items (attachment → item list)
const ERP_URL = Deno.env.get("ERP_URL") ?? "https://isheeka-events-erp.netlify.app";   // deep-link base for staff submission alerts
const PUSH_INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";   // server-to-server auth for push-send
const SESSION_TTL_MIN = 120;

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// ── helpers ────────────────────────────────────────────────────────────────
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
const enc = new TextEncoder();

// Per-user notification pref (server mirror of lib/notifyPrefs.js). Submissions default ON.
function prefOn(prefs: any, ev: string, ch: string): boolean {
  const p = prefs && prefs[ev];
  if (p && typeof p[ch] === "boolean") return p[ch];
  return true;
}

// Fuzzy name match (for mapping a function/sub-event to a matching template).
function normName(s: string): string {
  return String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function nameScore(a: string, b: string): number {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const bg = (s: string) => { const t = s.replace(/\s/g, ""); const o: string[] = []; for (let i = 0; i < t.length - 1; i++) o.push(t.slice(i, i + 2)); return o; };
  const ba = bg(na), bb = bg(nb); if (!ba.length || !bb.length) return 0;
  const m = new Map<string, number>(); ba.forEach((g) => m.set(g, (m.get(g) || 0) + 1));
  let inter = 0; bb.forEach((g) => { const c = m.get(g) || 0; if (c > 0) { inter++; m.set(g, c - 1); } });
  return (2 * inter) / (ba.length + bb.length);
}

// extract_* helpers: build a Claude content block per file, and validate an uploaded set.
function fileBlock(f: any) {
  return f.media_type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
    : { type: "image", source: { type: "base64", media_type: f.media_type, data: f.data } };
}
function validateFiles(files: any[]): string | null {
  if (files.length > 6) return "too_many";
  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  for (const f of files) {
    if (!f || !f.data || !f.media_type) return "no_file";
    if (!allowed.includes(f.media_type)) return "bad_type";
    if (f.data.length > 8_000_000) return "too_large";
  }
  return null;
}
function fileErrStatus(code: string): number {
  return code === "bad_type" ? 415 : (code === "too_large" || code === "too_many") ? 413 : 400;
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64url(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return b64url(new Uint8Array(sig));
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function mintSession(rfqId: string): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MIN * 60_000;
  const payload = b64url(enc.encode(JSON.stringify({ rfq_id: rfqId, exp })));
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}
async function readSession(token: string): Promise<{ rfq_id: string } | null> {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expect = await hmac(payload);
  if (!timingSafeEqual(sig, expect)) return null;
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (!data.exp || Date.now() > data.exp) return null;
    return { rfq_id: data.rfq_id };
  } catch {
    return null;
  }
}
function gen6(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
async function logActivity(rfqId: string, actor: string, action: string, notes?: string) {
  await db.from("rfq_activity").insert({ rfq_id: rfqId, actor, action, notes: notes ?? null });
}
// Public-safe projection of an RFQ (never leak hashes/tokens).
function publicRfq(r: Record<string, unknown>) {
  return {
    rfq_id: r.rfq_id, ref_number: r.ref_number, status: r.status,
    contact_name: r.contact_name, contact_first_name: r.contact_first_name, contact_last_name: r.contact_last_name,
    contact_email: r.contact_email, contact_phone: r.contact_phone,
    secondary_contact_name: r.secondary_contact_name, secondary_contact_phone: r.secondary_contact_phone,
    event_type: r.event_type, event_date: r.event_date, location: r.location, city: r.city,
    guest_count: r.guest_count, budget: r.budget, budget_range: r.budget_range,
    sub_events: r.sub_events, notes: r.notes,
    revision_number: r.revision_number,
    party_type: r.party_type ?? "client",
    confirmation_status: r.confirmation_status ?? null,
    confirmation_requested_at: r.confirmation_requested_at ?? null,
  };
}
// Public-safe projection of a quotation for the approval page.
function publicQuote(q: Record<string, unknown>) {
  return {
    quotation_id: q.quotation_id, ref_number: q.ref_number, status: q.status,
    client_name: q.client_name, event_name: q.event_name,
    doc_date: q.doc_date, valid_until: q.valid_until,
    grand_total: q.grand_total, subtotal: q.subtotal,
    payment_schedule: q.payment_schedule,
    additional_notes: q.additional_notes, additional_terms: q.additional_terms,
    approval_status: q.approval_status ?? null,
    approver_name: q.approver_name ?? null,
    client_approved_at: q.client_approved_at ?? null,
  };
}
async function rfqByToken(token: string) {
  if (!token) return null;
  const token_hash = await sha256hex(token);
  const { data } = await db.from("rfqs").select("*").eq("token_hash", token_hash).eq("is_deleted", false).maybeSingle();
  return data;
}
function linkExpired(r: Record<string, unknown>): boolean {
  return !!r.token_expires_at && new Date(r.token_expires_at as string).getTime() < Date.now();
}

// ── main ─────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SESSION_SECRET) return json({ error: "server_misconfigured", detail: "SESSION_SECRET not set" }, 500);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const action = String(body.action ?? "");

  try {
    switch (action) {
      case "ping":
        return json({ ok: true, ts: Date.now() });

      // ── request an emailed OTP ───────────────────────────────────────────
      case "request_otp": {
        const r = await rfqByToken(body.token);
        if (!r) return json({ error: "invalid_link" }, 404);
        if (linkExpired(r)) return json({ error: "link_expired" }, 410);
        const email = String(body.email ?? "").trim().toLowerCase();
        if (!email) return json({ error: "email_required" }, 400);
        if (!r.contact_email || email !== String(r.contact_email).trim().toLowerCase())
          return json({ error: "email_mismatch" }, 403); // OTP only to the address on file
        // rate limit: max 3 codes / 15 min for this rfq
        const since = new Date(Date.now() - 15 * 60_000).toISOString();
        const { count } = await db.from("rfq_otp").select("otp_id", { count: "exact", head: true })
          .eq("rfq_id", r.rfq_id).gte("created_at", since);
        if ((count ?? 0) >= 3) return json({ error: "rate_limited" }, 429);

        const code = gen6();
        await db.from("rfq_otp").insert({
          rfq_id: r.rfq_id, email, code_hash: await sha256hex(code),
          expires_at: new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString(),
        });
        const tpl = otpEmail(code, r.ref_number as string | null);
        const sent = await sendEmail({ to: email, ...tpl });
        await logActivity(r.rfq_id as string, "client", "otp_sent", sent.stubbed ? "stub (no provider key)" : email);
        return json({ ok: true, stubbed: sent.stubbed });
      }

      // ── verify an emailed OTP → session ──────────────────────────────────
      case "verify_otp": {
        const r = await rfqByToken(body.token);
        if (!r) return json({ error: "invalid_link" }, 404);
        if (linkExpired(r)) return json({ error: "link_expired" }, 410);
        const email = String(body.email ?? "").trim().toLowerCase();
        const code = String(body.code ?? "").trim();
        const { data: otp } = await db.from("rfq_otp").select("*")
          .eq("rfq_id", r.rfq_id).eq("email", email).is("consumed_at", null)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!otp) return json({ error: "no_code" }, 400);
        if (new Date(otp.expires_at).getTime() < Date.now()) return json({ error: "code_expired" }, 410);
        if (otp.attempts >= MAX_ATTEMPTS) return json({ error: "locked" }, 429);
        if (!timingSafeEqual(otp.code_hash, await sha256hex(code))) {
          await db.from("rfq_otp").update({ attempts: otp.attempts + 1 }).eq("otp_id", otp.otp_id);
          return json({ error: "wrong_code", attempts_left: Math.max(0, MAX_ATTEMPTS - otp.attempts - 1) }, 401);
        }
        await db.from("rfq_otp").update({ consumed_at: new Date().toISOString() }).eq("otp_id", otp.otp_id);
        await logActivity(r.rfq_id as string, "client", "otp_verified");
        return json({ ok: true, session: await mintSession(r.rfq_id as string), rfq: publicRfq(r) });
      }

      // ── verify a staff-shared PIN → session (no email needed) ────────────
      case "verify_pin": {
        const r = await rfqByToken(body.token);
        if (!r) return json({ error: "invalid_link" }, 404);
        if (linkExpired(r)) return json({ error: "link_expired" }, 410);
        if (r.access_mode !== "pin" || !r.access_pin_hash) return json({ error: "pin_not_set" }, 400);
        // lock after MAX_ATTEMPTS failures in 15 min (tracked via activity log)
        const since = new Date(Date.now() - 15 * 60_000).toISOString();
        const { count: fails } = await db.from("rfq_activity").select("activity_id", { count: "exact", head: true })
          .eq("rfq_id", r.rfq_id).eq("action", "pin_failed").gte("created_at", since);
        if ((fails ?? 0) >= MAX_ATTEMPTS) return json({ error: "locked" }, 429);
        const pin = String(body.pin ?? "").trim();
        if (!pin || !timingSafeEqual(r.access_pin_hash as string, await sha256hex(pin))) {
          await logActivity(r.rfq_id as string, "client", "pin_failed");
          return json({ error: "wrong_pin", attempts_left: Math.max(0, MAX_ATTEMPTS - (fails ?? 0) - 1) }, 401);
        }
        await logActivity(r.rfq_id as string, "client", "pin_verified");
        return json({ ok: true, session: await mintSession(r.rfq_id as string), rfq: publicRfq(r) });
      }

      // ── fetch the RFQ + items (+ catalog) for the form ───────────────────
      case "get_rfq": {
        const s = await readSession(body.session);
        if (!s) return json({ error: "no_session" }, 401);
        const { data: r } = await db.from("rfqs").select("*").eq("rfq_id", s.rfq_id).eq("is_deleted", false).maybeSingle();
        if (!r) return json({ error: "not_found" }, 404);
        const { data: items } = await db.from("rfq_items").select("*").eq("rfq_id", s.rfq_id).eq("is_deleted", false).order("sort_order");
        // catalog = template items for this RFQ's event type (grouped client-side by sub_event_name)
        let catalog: unknown[] = [];
        try {
          const { data: tpls } = await db.from("event_templates")
            .select("template_id,event_type").eq("is_deleted", false).eq("is_active", true);
          let chosen = tpls ?? [];
          const et = String(r.event_type || "").toLowerCase().trim();
          if (et) { const m = chosen.filter((t: any) => String(t.event_type || "").toLowerCase().trim() === et); if (m.length) chosen = m; }
          const ids = chosen.map((t: any) => t.template_id);
          if (ids.length) {
            const { data: tis } = await db.from("event_template_items")
              .select("sub_event_name,description,default_quantity").in("template_id", ids).order("sort_order");
            catalog = tis ?? [];
          }
        } catch { /* templates optional */ }
        let change_note: string | null = null;
        try {
          const { data: ca } = await db.from("rfq_activity").select("notes")
            .eq("rfq_id", s.rfq_id).eq("action", "changes_requested").order("created_at", { ascending: false }).limit(1).maybeSingle();
          change_note = ca ? ca.notes : null;
        } catch { /* ignore */ }
        // configured sub-event suggestions for this event type (Settings → Sub-events)
        let subevent_suggestions: string[] = [];
        try {
          if (r.event_type) {
            const { data: et } = await db.from("event_types").select("event_type_id").ilike("label", String(r.event_type)).limit(1).maybeSingle();
            if (et) {
              const { data: subs } = await db.from("event_type_subevents").select("name").eq("event_type_id", et.event_type_id).eq("is_active", true).order("name");
              subevent_suggestions = (subs ?? []).map((x: any) => x.name);
            }
          }
        } catch { /* optional */ }
        // Smart catalog: any configured function with no preset items of its own
        // borrows them from the best-matching template (by name), re-tagged to the
        // function. e.g. a wedding's "Haldi"/"Reception" reuse the Haldi / Wedding
        // Reception templates so the client sees a real checklist, not "no presets".
        try {
          const covered = new Set((catalog as any[]).map((c) => normName(String(c.sub_event_name || ""))));
          const wanted = (subevent_suggestions || []).filter((fn) => fn && !covered.has(normName(fn)));
          if (wanted.length) {
            const { data: allT } = await db.from("event_templates").select("template_id,name").eq("is_deleted", false).eq("is_active", true);
            const picks: { fn: string; tid: any }[] = [];
            for (const fn of wanted) {
              let best: any = null, bestScore = 0;
              for (const t of (allT ?? [])) { const sc = nameScore(fn, String(t.name || "")); if (sc > bestScore) { bestScore = sc; best = t; } }
              if (best && bestScore >= 0.6) picks.push({ fn, tid: best.template_id });
            }
            if (picks.length) {
              const tids = [...new Set(picks.map((p) => p.tid))];
              const { data: extra } = await db.from("event_template_items").select("template_id,description,default_quantity,sort_order").in("template_id", tids).order("sort_order");
              for (const p of picks) {
                for (const it of (extra ?? []).filter((x: any) => x.template_id === p.tid)) {
                  (catalog as any[]).push({ sub_event_name: p.fn, description: it.description, default_quantity: it.default_quantity });
                }
              }
            }
          }
        } catch { /* optional */ }
        let event_types: string[] = [];
        try { const { data: ets } = await db.from("event_types").select("label").eq("is_active", true).order("label"); event_types = (ets ?? []).map((x: any) => x.label).filter(Boolean); } catch { /* optional */ }
        // Vendor portal: surface the parent client RFQ's schedule (dates + venues) read-only,
        // so the vendor knows when/where the functions they're pricing happen.
        let schedule: any = null;
        try { if (r.party_type === "vendor" && r.parent_rfq_id) { const { data: p } = await db.from("rfqs").select("sub_events,location,event_date").eq("rfq_id", r.parent_rfq_id).maybeSingle(); if (p) schedule = { sub_events: p.sub_events || [], location: p.location || null, event_date: p.event_date || null }; } } catch { /* optional */ }
        return json({ ok: true, rfq: publicRfq(r), items: items ?? [], catalog, change_note, subevent_suggestions, event_types, schedule });
      }

      // ── autosave / resume: write details + replace items ─────────────────
      case "save_rfq": {
        const s = await readSession(body.session);
        if (!s) return json({ error: "no_session" }, 401);
        const { data: r } = await db.from("rfqs").select("status, party_type").eq("rfq_id", s.rfq_id).eq("is_deleted", false).maybeSingle();
        if (!r) return json({ error: "not_found" }, 404);
        // editable until staff lock it; clients may revise even after submitting
        if (["approved", "converted", "withdrawn"].includes(r.status))
          return json({ error: "not_editable", status: r.status }, 409);

        // ── vendor mode: update per-item costs only; the frozen item list is never replaced ──
        if (r.party_type === "vendor") {
          if (Array.isArray(body.items)) {
            for (const it of body.items) {
              if (!it || !it.rfq_item_id) continue;
              const supplies = it.can_supply !== false;
              await db.from("rfq_items").update({
                can_supply: supplies,
                unit_cost: (!supplies || it.unit_cost === "" || it.unit_cost == null) ? null : Number(it.unit_cost),
                item_note: (it.item_note ?? "") === "" ? null : String(it.item_note),
              }).eq("rfq_item_id", it.rfq_item_id).eq("rfq_id", s.rfq_id);
            }
          }
          const vf = body.fields ?? {};
          const vpatch: Record<string, unknown> = { status: "in_progress" };
          if ("notes" in vf) vpatch.notes = vf.notes === "" ? null : vf.notes; // vendor's overall note
          await db.from("rfqs").update(vpatch).eq("rfq_id", s.rfq_id);
          await logActivity(s.rfq_id, "vendor", "saved");
          return json({ ok: true });
        }

        const f = body.fields ?? {};
        const patch: Record<string, unknown> = { status: "in_progress" };
        for (const k of ["contact_name", "contact_first_name", "contact_last_name", "contact_phone", "secondary_contact_name", "secondary_contact_phone",
                         "event_type", "event_date", "location", "city", "guest_count", "budget", "budget_range", "notes"]) {
          if (k in f) patch[k] = f[k] === "" ? null : f[k];
        }
        if ("sub_events" in f) patch.sub_events = f.sub_events ?? null; // jsonb [{name, planned_date}]
        await db.from("rfqs").update(patch).eq("rfq_id", s.rfq_id);

        if (Array.isArray(body.items)) {
          await db.from("rfq_items").delete().eq("rfq_id", s.rfq_id); // simple replace; revision snapshots are M4
          const rows = body.items
            .filter((it: any) => (it?.description ?? "").trim())
            .map((it: any, i: number) => ({
              rfq_id: s.rfq_id,
              sub_event_name: it.sub_event_name ?? null,
              description: String(it.description).trim(),
              quantity: it.quantity ?? 1,
              unit: it.unit ?? null,
              source: it.source ?? "custom",
              sort_order: it.sort_order !== undefined ? it.sort_order : i,
              sub_items: Array.isArray(it.sub_items) ? it.sub_items : [],
              source_item_id: it.source_item_id ?? null,
            }));
          if (rows.length) await db.from("rfq_items").insert(rows);
        }
        await logActivity(s.rfq_id, "client", "saved");
        return json({ ok: true });
      }

      // ── client submits → locks editing pending staff review ──────────────
      case "submit_rfq": {
        const s = await readSession(body.session);
        if (!s) return json({ error: "no_session" }, 401);
        const { data: r } = await db.from("rfqs").select("*").eq("rfq_id", s.rfq_id).eq("is_deleted", false).maybeSingle();
        if (!r) return json({ error: "not_found" }, 404);
        if (["approved", "converted", "withdrawn"].includes(r.status))
          return json({ error: "not_submittable", status: r.status }, 409);
        // snapshot this submission as a revision (item-for-item history)
        const { data: its } = await db.from("rfq_items")
          .select("sub_event_name,description,quantity,unit,source,sort_order,unit_cost,can_supply,item_note").eq("rfq_id", s.rfq_id).eq("is_deleted", false).order("sort_order");
        const revNo = (r.revision_number || 0) + 1;
        const snapshot = {
          details: {
            contact_name: r.contact_name, contact_first_name: r.contact_first_name, contact_last_name: r.contact_last_name,
            contact_phone: r.contact_phone, contact_email: r.contact_email,
            secondary_contact_name: r.secondary_contact_name, secondary_contact_phone: r.secondary_contact_phone,
            event_type: r.event_type, event_date: r.event_date, location: r.location, city: r.city,
            guest_count: r.guest_count, budget_range: r.budget_range, notes: r.notes,
          },
          sub_events: r.sub_events || [],
          items: its || [],
        };
        const who = (r.party_type === "vendor") ? "vendor" : "client";
        await db.from("rfq_revisions").insert({ rfq_id: s.rfq_id, revision_number: revNo, snapshot, submitted_by: who });
        await db.from("rfqs").update({ status: "submitted", revision_number: revNo, client_submitted_at: new Date().toISOString() }).eq("rfq_id", s.rfq_id);
        await logActivity(s.rfq_id, who, "submitted", "Revision " + revNo);
        // ── Who is this about? Resolve client + vendor names once (used by all channels). ──
        const isVendor = r.party_type === "vendor";
        const docId = r.ref_number || s.rfq_id;
        const targetRfq = isVendor ? (r.parent_rfq_id || s.rfq_id) : s.rfq_id;
        const url = ERP_URL + "/?rfq=" + targetRfq;
        let clientName = isVendor ? "" : (r.contact_name || "");
        let vendorName = "";
        let evType = r.event_type || "";
        if (isVendor) {
          try {
            if (r.vendor_id) { const { data: v } = await db.from("vendors").select("name").eq("vendor_id", r.vendor_id).maybeSingle(); vendorName = (v && v.name) || r.contact_name || ""; }
            else vendorName = r.contact_name || "";
            if (r.parent_rfq_id) { const { data: p } = await db.from("rfqs").select("contact_name,event_type").eq("rfq_id", r.parent_rfq_id).maybeSingle(); if (p) { clientName = p.contact_name || ""; if (!evType) evType = p.event_type || ""; } }
          } catch (e) { /* names best-effort */ }
        }
        const headline = isVendor ? "Vendor bid received" : "Client RFQ submitted";
        const emailLine = isVendor
          ? ((vendorName || "A vendor") + " submitted pricing for " + docId + (clientName ? (" (client: " + clientName + ")") : "") + ".")
          : ((clientName || "A client") + " submitted requirements for " + docId + (revNo > 1 ? " (revision " + revNo + ")" : "") + ".");
        const inappBody = isVendor
          ? ((vendorName || "A vendor") + " priced" + (clientName ? (" — client " + clientName) : "") + (evType ? (" · " + evType) : ""))
          : ((clientName || "A client") + (evType ? (" · " + evType) : "") + (revNo > 1 ? (" · rev " + revNo) : ""));

        const evKey = isVendor ? "vendor_bid" : "rfq_submitted";
        // Audience (owners/admins) partitioned by each user's notification prefs.
        let inappIds: string[] = [], pushIds: string[] = [], personalEmails: string[] = [];
        try {
          const { data: us } = await db.from("users").select("user_id,email,role,is_owner,notify_prefs").eq("is_deleted", false);
          const aud = (us || []).filter((u: any) => u.is_owner || u.role === "admin");
          inappIds = aud.filter((u: any) => prefOn(u.notify_prefs, evKey, "inapp")).map((u: any) => u.user_id);
          pushIds = aud.filter((u: any) => prefOn(u.notify_prefs, evKey, "push")).map((u: any) => u.user_id);
          personalEmails = aud.filter((u: any) => prefOn(u.notify_prefs, evKey, "email")).map((u: any) => u.email).filter(Boolean);
        } catch (e) { console.error("[submit_rfq] audience", e); }

        // Email — company inbox (always) + owners who opted into email, deduped.
        try {
          const { data: st } = await db.from("settings").select("email,notify_email_2").limit(1).maybeSingle();
          const recips = [...new Set([st?.email, st?.notify_email_2, ...personalEmails].filter((e: any) => e && /\S+@\S+\.\S+/.test(String(e))).map((e: any) => String(e).toLowerCase()))];
          if (recips.length) {
            const subject = "[Isheeka] " + headline + " — " + docId;
            const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#2a2723"><p>${emailLine}</p><p><a href="${url}" style="display:inline-block;background:#e8185a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open ${docId} →</a></p><p style="color:#888;font-size:12px">${url}</p></div>`;
            const text = emailLine + "\n\nOpen: " + url;
            for (const to of recips) { try { await sendEmail({ to: String(to), subject, html, text }); } catch (e) { /* per-recipient */ } }
          }
        } catch (e) { console.error("[submit_rfq] notify", e); }

        // In-app notifications.
        try {
          if (inappIds.length) {
            const link_opts = { rfqId: targetRfq };
            const rows = inappIds.map((uid: string) => ({ recipient_user_id: uid, type: evKey, title: headline, body: inappBody, doc_ref: docId, link_page: "rfqs", link_opts }));
            await db.from("notifications").insert(rows);
          }
        } catch (e) { console.error("[submit_rfq] notify-inapp", e); }

        // Web push.
        try {
          if (pushIds.length && PUSH_INTERNAL_SECRET) {
            await fetch(SUPABASE_URL + "/functions/v1/push-send", { method: "POST", headers: { "Content-Type": "application/json", "x-internal-secret": PUSH_INTERNAL_SECRET }, body: JSON.stringify({ user_ids: pushIds, payload: { title: headline + " — " + docId, body: inappBody, url, tag: docId } }) });
          }
        } catch (e) { /* push best-effort */ }
        return json({ ok: true, revision_number: revNo });
      }

      // ── attachment → item list (Claude vision). Session-gated; returns items for REVIEW. ──
      case "extract_items": {
        const s = await readSession(body.session);
        if (!s) return json({ error: "no_session" }, 401);
        if (!ANTHROPIC_API_KEY) return json({ error: "extract_unavailable" }, 503);
        const text = (typeof body.text === "string") ? body.text.trim() : "";   // pasted message / list — optional
        const files = Array.isArray(body.files) ? body.files : (body.file ? [body.file] : []);  // one or more photos/PDFs
        if (!text && !files.length) return json({ error: "no_input" }, 400);
        if (text && text.length > 20000) return json({ error: "too_large" }, 413);
        if (!text) { const v = validateFiles(files); if (v) return json({ error: v }, fileErrStatus(v)); }

        const prompt =
          "You are reading a customer's event-requirements list for an Indian event. " +
          "The list may be typed, handwritten, photographed, or copy-pasted from WhatsApp — any format. " +
          "Return ONLY a JSON array — no prose, no code fences — of objects: " +
          "{\"description\": string, \"quantity\": number, \"sub_event\": string|null, \"sub_items\": [{\"name\": string, \"qty\": number, \"note\": string|null}]}. " +
          "FIELD RULES: " +
          "description = the main item/service (concise English label). " +
          "quantity = count requested (use 1 if not stated; \"300 magnets\" → qty 300, \"4 members\" → qty 4; keep sizes/specs in description). " +
          "sub_event = the function/section it belongs to if the list is grouped (e.g. \"Mehendi\", \"Reception\"), else null. " +
          "sub_items = specifications, details, variants, or nested requirements of this item ([] if none). " +
          "HIERARCHY DETECTION — use ALL of the following signals to find parent items and their sub_items: " +
          "1. INDENTATION: indented lines (leading spaces/tabs) are sub_items of the nearest preceding flush-left line. " +
          "2. CAPS/BOLD HEADERS: a word or phrase in ALL CAPS acting as a section label, followed by plain lines, is the parent item; plain lines below it (until the next caps header or blank line) are its sub_items. " +
          "3. BULLETS/NUMBERS: sub-bullets (-, –, a., i., *) under a top-level bullet are sub_items of that bullet. " +
          "4. COLON LISTS: \"Stage: backdrop, steps, lights\" → Stage is the item, the comma-separated parts are sub_items. " +
          "5. BLANK LINE RESET: a blank line usually signals a new top-level item; lines within the same block belong to the same parent. " +
          "6. SPECIFICATION LANGUAGE — even with NO formatting cues, if a line reads as a dimension, color, material, design note, or instruction about the item immediately above it, make it a sub_item. " +
          "Words/phrases that almost always signal a sub_item of the line above: \"instead of\", \"as per\", \"size\", \"height\", \"width\", \"color\", \"cloth\", \"do not\", \"no \", \"with \", \"design\", \"as given by us\", \"approximately\", \"straight\", \"circular\", \"reverse\". " +
          "7. SEMANTIC CONTEXT (most powerful — applies to all input types including photos): when a line feels like a detail, spec, or note about the service mentioned in the line above rather than a new independent service, prefer making it a sub_item over creating a new top-level item. " +
          "EXAMPLES: " +
          "\"Decoration\\n  4x8 frame flexi at gate\\n  Entrance Arch\" → [{description:\"Decoration\",quantity:1,sub_event:null,sub_items:[{name:\"4x8 frame flexi at gate\",qty:1,note:null},{name:\"Entrance Arch\",qty:1,note:null}]}]. " +
          "\"MAIN STAGE\\nCream cloth, gold strips draping\\nWarm lighting\\nSize 43x20 height 2.5\" → [{description:\"Main Stage\",quantity:1,sub_event:null,sub_items:[{name:\"Cream cloth, gold strips draping\",qty:1,note:null},{name:\"Warm lighting\",qty:1,note:null},{name:\"43x20, height 2.5\",qty:1,note:null}]}]. " +
          "\"Fridge Magnet Stall - 300 magnets, size 2x2\" → [{description:\"Fridge Magnet Stall\",quantity:300,sub_event:null,sub_items:[{name:\"Magnet size 2x2\",qty:1,note:null}]}]. " +
          "The list may mix English, Telugu, Hindi, Hinglish or Tenglish — read faithfully, give descriptions in English where meaning is clear. " +
          "Ignore prices, money amounts, totals, page numbers, and contact details. If no items found, return [].";

        const content: any[] = text
          ? [{ type: "text", text: prompt + "\n\nHere is the message / list to read:\n\n" + text }]
          : [...files.map(fileBlock), { type: "text", text: prompt }];

        let aiText = "";
        try {
          const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 8000,
              messages: [{ role: "user", content }],
            }),
          });
          if (!resp.ok) { const t = await resp.text(); console.error("[extract_items] anthropic", resp.status, t); return json({ error: "extract_failed", status: resp.status }, 502); }
          const data = await resp.json();
          aiText = ((data?.content || []) as any[]).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
        } catch (e) { console.error("[extract_items] fetch", e); return json({ error: "extract_failed" }, 502); }

        let items: any[] = [];
        try {
          let t = aiText.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
          const a = t.indexOf("["), b = t.lastIndexOf("]");
          if (a >= 0 && b > a) t = t.slice(a, b + 1);
          const parsed = JSON.parse(t);
          if (Array.isArray(parsed)) items = parsed;
        } catch (e) { console.error("[extract_items] parse", aiText); return json({ error: "extract_unreadable" }, 422); }

        const clean = items.map((it: any) => ({
          description: String(it.description ?? it.item ?? "").trim().slice(0, 300),
          quantity: Math.max(1, Math.round(Number(it.quantity) || 1)),
          sub_event: it.sub_event ? String(it.sub_event).trim().slice(0, 80) : null,
          sub_items: Array.isArray(it.sub_items)
            ? it.sub_items.map((s: any) => ({
                name: String(s.name ?? "").trim().slice(0, 200),
                qty: Math.max(1, Math.round(Number(s.qty) || 1)),
                note: s.note ? String(s.note).trim().slice(0, 200) : null,
              })).filter((s: any) => s.name)
            : [],
        })).filter((it: any) => it.description);

        return json({ ok: true, items: clean });
      }

      // ── vendor: price list (photo/PDF/text) → match to the fixed items, fill costs (for REVIEW) ──
      case "extract_costs": {
        const s = await readSession(body.session);
        if (!s) return json({ error: "no_session" }, 401);
        if (!ANTHROPIC_API_KEY) return json({ error: "extract_unavailable" }, 503);
        const text = (typeof body.text === "string") ? body.text.trim() : "";
        const files = Array.isArray(body.files) ? body.files : (body.file ? [body.file] : []);
        if (!text && !files.length) return json({ error: "no_input" }, 400);
        if (text && text.length > 20000) return json({ error: "too_large" }, 413);
        if (!text) { const v = validateFiles(files); if (v) return json({ error: v }, fileErrStatus(v)); }
        // the fixed items the vendor is pricing
        const { data: its } = await db.from("rfq_items").select("rfq_item_id,description,quantity").eq("rfq_id", s.rfq_id).eq("is_deleted", false).order("sort_order");
        const itemRows = its || [];
        if (!itemRows.length) return json({ error: "no_items" }, 400);
        const itemList = itemRows.map((it) => ({ id: it.rfq_item_id, description: it.description, quantity: it.quantity }));

        // Batch the items (≤50/call) so a large client list never overflows the model's output.
        const buildPrompt = (batch: any[]) =>
          "You are matching a vendor's price list to a FIXED list of items the customer needs. " +
          "ITEMS (JSON): " + JSON.stringify(batch) + ". " +
          "Read the vendor's price document/message and, for each item id above, find the vendor's matching PER-UNIT price. " +
          "The vendor's list may be in English, Telugu, Hindi or a mix and may be handwritten — read it faithfully. " +
          "Return ONLY a JSON array (no prose, no code fences) of objects: " +
          "{\"rfq_item_id\": string, \"unit_cost\": number|null, \"can_supply\": boolean, \"confidence\": \"high\"|\"low\", \"source\": string}. " +
          "IMPORTANT: include an entry ONLY for items you can actually match to something in the vendor's list (or that the vendor explicitly marks unavailable). " +
          "OMIT every item you can't match — do not return null-price rows for unmatched items. " +
          "unit_cost = per-unit price as a plain number (no currency symbols); if only a line total is given, divide by that item's quantity. " +
          "source = a short snippet of the vendor's own line the price came from (e.g. \"Stage decor - 45k\"). " +
          "confidence = \"high\" when the vendor's line clearly corresponds to the item; \"low\" when the wording differs a lot. " +
          "If the vendor marks an item unavailable, include it with can_supply=false and unit_cost=null. " +
          "Use ONLY the rfq_item_id values provided — never invent items.";

        const batches: any[][] = [];
        for (let i = 0; i < itemList.length; i += 50) batches.push(itemList.slice(i, i + 50));

        const callBatch = async (batch: any[]): Promise<{ ok: boolean; rows: any[] }> => {
          const p = buildPrompt(batch);
          const content2: any[] = text
            ? [{ type: "text", text: p + "\n\nVendor's price list:\n\n" + text }]
            : [...files.map(fileBlock), { type: "text", text: p }];
          try {
            const resp = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
              body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 8000, messages: [{ role: "user", content: content2 }] }),
            });
            if (!resp.ok) { console.error("[extract_costs] anthropic", resp.status, await resp.text()); return { ok: false, rows: [] }; }
            const data = await resp.json();
            const aiText2 = ((data?.content || []) as any[]).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
            let t = aiText2.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
            const a = t.indexOf("["), b = t.lastIndexOf("]");
            if (a >= 0 && b > a) t = t.slice(a, b + 1);
            const arr = JSON.parse(t);
            return { ok: true, rows: Array.isArray(arr) ? arr : [] };
          } catch (e) { console.error("[extract_costs] batch", e); return { ok: false, rows: [] }; }
        };

        const batchResults = await Promise.all(batches.map(callBatch));
        if (!batchResults.some((r) => r.ok)) return json({ error: "extract_unreadable" }, 422);
        const parsed2 = batchResults.flatMap((r) => r.rows);

        const valid = new Set(itemRows.map((it) => String(it.rfq_item_id)));
        const byId = new Map<string, any>();
        for (const c of parsed2) {
          if (!c) continue; const id = String(c.rfq_item_id);
          if (!valid.has(id) || byId.has(id)) continue;
          byId.set(id, {
            rfq_item_id: id,
            unit_cost: (c.unit_cost == null || c.unit_cost === "") ? null : Math.max(0, Math.round(Number(c.unit_cost) || 0)),
            can_supply: c.can_supply !== false,
            confidence: (c.confidence === "low") ? "low" : "high",
            source: c.source ? String(c.source).trim().slice(0, 120) : "",
          });
        }
        const costs = [...byId.values()];
        return json({ ok: true, costs, matched: costs.filter((c) => c.unit_cost != null).length, total: itemRows.length });
      }

      // ── view a quotation by its approval token (public, no staff JWT) ────────
      case "view_quote_by_token": {
        const token = String(body.token ?? "").trim();
        if (!token) return json({ error: "token_required" }, 400);
        const token_hash = await sha256hex(token);
        const { data: q } = await db.from("quotations")
          .select("*").eq("approval_token_hash", token_hash).eq("is_deleted", false).maybeSingle();
        if (!q) return json({ error: "invalid_link" }, 404);
        await db.from("quote_approvals").insert({
          quotation_id: q.quotation_id,
          action: "opened",
          ip: req.headers.get("x-forwarded-for") ?? null,
        });
        const { data: lines } = await db.from("quotation_line_items")
          .select("line_item_id,sub_event_name,description,quantity,unit_price,amount,sort_order,sub_items")
          .eq("quotation_id", q.quotation_id).eq("is_deleted", false).order("sort_order");
        return json({ ok: true, quote: publicQuote(q), lines: lines ?? [] });
      }

      // ── client signs or declines the quote ────────────────────────────────────
      case "submit_quote_approval": {
        const token = String(body.token ?? "").trim();
        const pin   = String(body.pin  ?? "").trim();
        const signer_name = String(body.signer_name ?? "").trim();
        const act   = String(body.approval_action ?? "").trim(); // "signed" | "declined"
        if (!token) return json({ error: "token_required" }, 400);
        if (!pin)   return json({ error: "pin_required" }, 400);
        if (act === "signed" && !signer_name) return json({ error: "signer_name_required" }, 400);
        if (!["signed", "declined"].includes(act)) return json({ error: "invalid_action" }, 400);

        const token_hash = await sha256hex(token);
        const { data: q } = await db.from("quotations")
          .select("quotation_id,ref_number,client_name,event_name,grand_total,approval_pin_hash,approval_status")
          .eq("approval_token_hash", token_hash).eq("is_deleted", false).maybeSingle();
        if (!q) return json({ error: "invalid_link" }, 404);
        if (q.approval_status === "approved") return json({ error: "already_approved" }, 409);
        if (!q.approval_pin_hash) return json({ error: "pin_not_set" }, 400);

        const since15 = new Date(Date.now() - 15 * 60_000).toISOString();
        const { count: pinFails } = await db.from("quote_approvals")
          .select("approval_id", { count: "exact", head: true })
          .eq("quotation_id", q.quotation_id).eq("action", "pin_failed").gte("created_at", since15);
        if ((pinFails ?? 0) >= MAX_ATTEMPTS) return json({ error: "locked" }, 429);

        if (!timingSafeEqual(q.approval_pin_hash, await sha256hex(pin))) {
          await db.from("quote_approvals").insert({ quotation_id: q.quotation_id, action: "pin_failed", ip: req.headers.get("x-forwarded-for") ?? null });
          return json({ error: "wrong_pin", attempts_left: Math.max(0, MAX_ATTEMPTS - (pinFails ?? 0) - 1) }, 401);
        }

        const now = new Date().toISOString();
        const newApprovalStatus = act === "signed" ? "approved" : "declined";
        await db.from("quotations").update({
          approval_status: newApprovalStatus,
          approver_name: signer_name,
          ...(act === "signed" ? { client_approved_at: now, approved_at: now, approved_via: "link" } : {}),
        }).eq("quotation_id", q.quotation_id);

        await db.from("quote_approvals").insert({
          quotation_id: q.quotation_id, action: act, signer_name,
          ip: req.headers.get("x-forwarded-for") ?? null,
        });

        try {
          await db.from("quotation_activity_log").insert({
            quotation_id: q.quotation_id, actor: signer_name,
            action: act === "signed" ? "client_approved" : "client_declined",
            notes: `Signed as: ${signer_name}`,
          });
        } catch { /* best-effort */ }

        try {
          const { data: st } = await db.from("settings").select("email,notify_email_2").limit(1).maybeSingle();
          const CC_ISHEEKA = "isheekaevents@gmail.com";
          const recips = [...new Set([st?.email, st?.notify_email_2, CC_ISHEEKA]
            .filter((e: any) => e && /\S+@\S+\.\S+/.test(String(e)))
            .map((e: any) => String(e).toLowerCase()))];
          const ref = q.ref_number || q.quotation_id;
          const verb = act === "signed" ? "approved" : "declined";
          const subject = `[Isheeka] Quote ${verb} — ${ref}`;
          const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#2a2723"><p><b>${signer_name}</b> has <b>${verb}</b> quotation <b>${ref}</b>${q.client_name ? ` for ${q.client_name}` : ""}.</p>${q.grand_total ? `<p>Total: &#8377;${Number(q.grand_total).toLocaleString("en-IN")}</p>` : ""}<p style="color:#888;font-size:12px">Signed at ${new Date(now).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})}</p></div>`;
          const text = `${signer_name} has ${verb} quotation ${ref}${q.client_name ? ` for ${q.client_name}` : ""}. Signed at ${now}.`;
          for (const to of recips) { try { await sendEmail({ to: String(to), subject, html, text }); } catch { /* per-recipient */ } }
        } catch (e) { console.error("[submit_quote_approval] email", e); }

        return json({ ok: true, action: act });
      }

      // ── fetch vendor onboarding form context (public) ─────────────────────────
      case "get_vendor_onboarding": {
        const token = String(body.token ?? "").trim();
        if (!token) return json({ error: "token_required" }, 400);
        const token_hash = await sha256hex(token);
        const { data: ob } = await db.from("vendor_onboarding")
          .select("onboarding_id,status,submitted_at").eq("token_hash", token_hash).maybeSingle();
        if (!ob) return json({ error: "invalid_link" }, 404);
        if (ob.status === "submitted" || ob.status === "approved")
          return json({ error: "already_submitted", status: ob.status }, 409);
        let categories: string[] = [];
        try {
          const { data: vc } = await db.from("vendor_categories").select("name").order("name");
          categories = (vc ?? []).map((c: any) => c.name).filter(Boolean);
        } catch { /* optional */ }
        return json({ ok: true, categories });
      }

      // ── vendor submits onboarding form (public) ───────────────────────────────
      case "submit_vendor_onboarding": {
        const token = String(body.token ?? "").trim();
        const pin   = String(body.pin   ?? "").trim();
        const fields = body.fields && typeof body.fields === "object" ? body.fields : {};
        if (!token) return json({ error: "token_required" }, 400);

        const token_hash = await sha256hex(token);
        const { data: ob } = await db.from("vendor_onboarding")
          .select("onboarding_id,status,pin_hash").eq("token_hash", token_hash).maybeSingle();
        if (!ob) return json({ error: "invalid_link" }, 404);
        if (ob.status === "submitted" || ob.status === "approved")
          return json({ error: "already_submitted", status: ob.status }, 409);

        if (ob.pin_hash) {
          if (!pin) return json({ error: "pin_required" }, 400);
          if (!timingSafeEqual(ob.pin_hash, await sha256hex(pin)))
            return json({ error: "wrong_pin" }, 401);
        }

        const REQUIRED = ["name", "contact_person", "phone", "email", "category"];
        const missing = REQUIRED.filter((k) => !String(fields[k] ?? "").trim());
        if (missing.length) return json({ error: "missing_fields", fields: missing }, 400);

        const now = new Date().toISOString();
        await db.from("vendor_onboarding").update({
          submitted_fields: fields, status: "submitted", submitted_at: now,
        }).eq("onboarding_id", ob.onboarding_id);

        try {
          const { data: st } = await db.from("settings").select("email,notify_email_2").limit(1).maybeSingle();
          const recips = [st?.email, st?.notify_email_2].filter((e: any) => e && /\S+@\S+\.\S+/.test(String(e)));
          if (recips.length) {
            const vname = String(fields.name ?? "A vendor").trim();
            const subject = `[Isheeka] New vendor application — ${vname}`;
            const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#2a2723"><p><b>${vname}</b> has submitted a vendor onboarding application.</p><p>Category: ${fields.category ?? "—"} &middot; Contact: ${fields.contact_person ?? "—"} &middot; Phone: ${fields.phone ?? "—"}</p><p>Review in the Vendors module &rarr; Onboarding requests.</p></div>`;
            const text = `${vname} submitted a vendor application. Category: ${fields.category ?? "—"}. Review in the Vendors module.`;
            for (const to of recips) { try { await sendEmail({ to: String(to), subject, html, text }); } catch { /* per-recipient */ } }
          }
        } catch (e) { console.error("[submit_vendor_onboarding] email", e); }

        return json({ ok: true });
      }

      // ── client confirms revised RFQ (session-gated) ───────────────────────────
      case "confirm_rfq_changes": {
        const s = await readSession(body.session);
        if (!s) return json({ error: "no_session" }, 401);
        const confirmed = body.confirmed !== false;
        const note = body.note ? String(body.note).trim().slice(0, 500) : null;
        const cfmStatus = confirmed ? "confirmed" : "declined";
        const now = new Date().toISOString();

        const { data: r } = await db.from("rfqs")
          .select("rfq_id,ref_number,confirmation_status").eq("rfq_id", s.rfq_id).eq("is_deleted", false).maybeSingle();
        if (!r) return json({ error: "not_found" }, 404);
        if (r.confirmation_status === "confirmed") return json({ error: "already_confirmed" }, 409);

        await db.from("rfqs").update({
          confirmation_status: cfmStatus,
          client_confirmed_at: now,
          client_confirm_note: note,
        }).eq("rfq_id", s.rfq_id);

        await logActivity(s.rfq_id, "client", confirmed ? "changes_confirmed" : "changes_declined", note ?? undefined);

        try {
          const { data: st } = await db.from("settings").select("email,notify_email_2").limit(1).maybeSingle();
          const recips = [st?.email, st?.notify_email_2].filter((e: any) => e && /\S+@\S+\.\S+/.test(String(e)));
          if (recips.length) {
            const ref = r.ref_number || s.rfq_id;
            const verb = confirmed ? "confirmed" : "declined";
            const subject = `[Isheeka] Client ${verb} RFQ changes — ${ref}`;
            const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#2a2723"><p>Client has <b>${verb}</b> the revised requirements for <b>${ref}</b>.</p>${note ? `<p>Note: &ldquo;${note}&rdquo;</p>` : ""}</div>`;
            const text = `Client ${verb} revised requirements for ${ref}.${note ? ` Note: "${note}"` : ""}`;
            for (const to of recips) { try { await sendEmail({ to: String(to), subject, html, text }); } catch { /* per-recipient */ } }
          }
        } catch (e) { console.error("[confirm_rfq_changes] email", e); }

        return json({ ok: true, confirmation_status: cfmStatus });
      }

      default:
        return json({ error: "unknown_action", action }, 400);
    }
  } catch (e) {
    console.error("[rfq-gateway] error", action, e);
    return json({ error: "server_error" }, 500);
  }
});
