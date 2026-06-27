// RFQ helpers (M3) — crypto, creation, client dedupe, and approve→draft-quote.
// Ported verbatim from isheeka-erp-v22.html.
import { supabase } from './supabase';
import { notify, runDb } from './toast.jsx';
import { _currentUid } from './session.js';
import { getNextRfqRef, getNextClientRef, getNextQuotRef } from './refs.js';
import { defaultEventName } from './format.js';

export async function sha256Hex(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
export function genRfqToken() { const a = new Uint8Array(18); crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, '0')).join(''); }
export function genRfqPin() { return String(Math.floor(1000 + Math.random() * 9000)); }
// Builds the client-facing RFQ portal link. rfq.html may live on a DIFFERENT origin
// from this app (e.g. ERP on Netlify, portal still on GitHub Pages), so we resolve
// against VITE_RFQ_BASE_URL when set, falling back to the current origin for local/dev.
export function rfqLink(token) {
  try {
    const raw = (import.meta.env && import.meta.env.VITE_RFQ_BASE_URL) || '';
    const base = raw ? (raw.endsWith('/') ? raw : raw + '/') : location.href;
    return new URL('rfq.html?t=' + token, base).href;
  } catch (e) { return 'rfq.html?t=' + token; }
}

// Create an RFQ + its access token/PIN. Returns {rfq_id, ref_number, token, pin}.
// Raw token/PIN are shown once; only hashes are stored.
export async function createRfq(opts = {}) {
  const ref_number = await getNextRfqRef();
  const token = genRfqToken();
  const pin = (opts.access_mode === 'email_otp') ? null : genRfqPin();
  const uid = await _currentUid();
  const fullName = opts.contact_name || [opts.contact_first_name, opts.contact_last_name].filter(Boolean).join(' ').trim() || null;
  const row = {
    ref_number, status: 'sent',
    client_id: opts.client_id || null, lead_id: opts.lead_id || null,
    contact_first_name: opts.contact_first_name || null, contact_last_name: opts.contact_last_name || null,
    contact_name: fullName, contact_email: opts.contact_email || null, contact_phone: opts.contact_phone || null,
    secondary_contact_name: opts.secondary_contact_name || null, secondary_contact_phone: opts.secondary_contact_phone || null,
    event_type: opts.event_type || null, event_date: opts.event_date || null,
    guest_count: opts.guest_count ? parseInt(opts.guest_count) : null,
    budget: opts.budget ? parseFloat(opts.budget) : null,
    budget_range: opts.budget_range || null,
    location: opts.location || null, city: opts.city || null,
    access_mode: opts.access_mode || 'pin',
    access_pin_hash: pin ? await sha256Hex(pin) : null,
    token_hash: await sha256Hex(token),
    token_expires_at: new Date(Date.now() + 21 * 24 * 3600 * 1000).toISOString(),
    created_by: uid || null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_deleted: false,
  };
  const { data, error } = await runDb(supabase.from('rfqs').insert(row).select('rfq_id,ref_number').single(), 'create RFQ');
  if (error || !data) throw error || new Error('create rfq failed');
  try { await supabase.from('rfq_activity').insert({ rfq_id: data.rfq_id, actor: uid || 'staff', action: 'created' }); } catch (e) { /* non-fatal */ }
  return { rfq_id: data.rfq_id, ref_number: data.ref_number, token, pin };
}

// Look for an existing client matching this RFQ's phone/email (a match may be a
// different person sharing a number — staff decides via the modal).
export async function findClientMatch(r) {
  const orParts = [];
  if (r.contact_phone) orParts.push('phone_1.eq.' + r.contact_phone);
  if (r.contact_email) orParts.push('email_1.eq.' + r.contact_email);
  if (!orParts.length) return null;
  const { data } = await supabase.from('clients').select('client_id,first_name,last_name,phone_1,email_1').eq('is_deleted', false).or(orParts.join(','));
  return (data && data.length) ? data[0] : null;
}

// forced: {client_id, client_name} to reuse an existing client; otherwise a new client is created.
export async function ensureClientForRfq(r, forced) {
  if (r.client_id) return { client_id: r.client_id, client_name: r.contact_name || '' };
  if (forced && forced.client_id) return { client_id: forced.client_id, client_name: forced.client_name || '' };
  const ref = await getNextClientRef();
  const fn = r.contact_first_name || ((r.contact_name || '').trim().split(/\s+/)[0] || '');
  const ln = r.contact_last_name || ((r.contact_name || '').trim().split(/\s+/).slice(1).join(' ') || '');
  const { data: c, error } = await runDb(supabase.from('clients').insert({ ref_number: ref, first_name: fn, last_name: ln, phone_1: r.contact_phone || null, email_1: r.contact_email || null, city: r.city || null, source: 'referral', status: 'active', client_since: new Date().toISOString().slice(0, 10), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_deleted: false }).select('client_id').single(), 'create client');
  if (error || !c) throw error || new Error('client create failed');
  return { client_id: c.client_id, client_name: (fn + ' ' + ln).trim() };
}

// Approve flow: ensure a client (reuse/dedupe or create), then create a DRAFT quote
// with the RFQ items item-for-item (price blank), and mark the RFQ converted.
export async function approveRfqToQuote(r, items, forced) {
  const { client_id, client_name } = await ensureClientForRfq(r, forced);
  const refNum = await getNextQuotRef();
  const evName = (r.event_type) ? defaultEventName(r.event_type) : ((r.event_type || 'Event') + ' Event');
  const { data: q, error: qe } = await runDb(supabase.from('quotations').insert({
    ref_number: refNum, status: 'draft', client_id, client_name, lead_id: r.lead_id || null, event_id: null,
    event_name: evName, doc_date: new Date().toISOString().slice(0, 10), valid_until: null,
    subtotal: 0, discount_pct: 0, discount_amount: 0, grand_total: 0,
    additional_notes: r.notes || null, payment_terms: null, additional_terms: null,
    payment_schedule: '[]', display_options: '{}', parent_quotation_id: null, revision_number: 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_deleted: false,
  }).select('quotation_id,ref_number').single(), 'create draft quote');
  if (qe || !q) throw qe || new Error('quote create failed');
  const li = (items || []).filter((it) => (it.description || '').trim()).map((it, i) => ({ quotation_id: q.quotation_id, sub_event_name: it.sub_event_name || null, description: it.description, quantity: parseFloat(it.quantity) || 1, unit_price: 0, sort_order: i }));
  if (li.length) { const { error: lie } = await runDb(supabase.from('quotation_line_items').insert(li), 'add quote items'); if (lie) throw lie; }
  const uid = await _currentUid();
  await runDb(supabase.from('rfqs').update({ status: 'converted', client_id, quotation_id: q.quotation_id, staff_approved_at: new Date().toISOString(), approved_by: uid || null, updated_at: new Date().toISOString() }).eq('rfq_id', r.rfq_id), 'approve rfq');
  try { await supabase.from('rfq_activity').insert({ rfq_id: r.rfq_id, actor: uid || 'staff', action: 'approved', notes: '→ ' + q.ref_number }); } catch (e) { /* non-fatal */ }
  return q;
}
