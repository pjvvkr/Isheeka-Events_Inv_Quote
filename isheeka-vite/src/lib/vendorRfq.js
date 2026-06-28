// Milestone S · S2a — vendor RFQ logic.
// A vendor RFQ is an `rfqs` row with party_type='vendor', parent_rfq_id (the client RFQ
// it sources) and vendor_id. It reuses the client RFQ token/PIN machinery and the same
// public portal link (the gateway detects vendor mode by party_type). See
// docs/milestone-s-vendor-rfq-spec.md §3-§4.
import { supabase } from './supabase';
import { runDb } from './toast.jsx';
import { _currentUid } from './session.js';
import { getNextRfqRef } from './refs.js';
import { sha256Hex, genRfqToken, genRfqPin, rfqLink, createRfq } from './rfq.js';

// Spin up one vendor RFQ per selected vendor from an (approved) client RFQ.
// Freezes the client RFQ's item list as the sourcing basis (copied item-for-item,
// costs blank). Returns [{ vendor_id, vendor_name, rfq_id, ref_number, token, pin }].
// Optional: pass selectedItems (array of rfq_item rows) to scope to a subset;
// each vendor rfq_item gets source_item_id set to the client rfq_item's rfq_item_id.
export async function createVendorRfqs(parentRfq, vendors, selectedItems) {
  if (!parentRfq || !parentRfq.rfq_id) throw new Error('parent RFQ required');
  const list = (vendors || []).filter((v) => v && v.vendor_id);
  if (!list.length) return [];
  const uid = await _currentUid();

  // Freeze the parent's item list (the sourcing basis), or use caller-supplied subset.
  let baseItems;
  if (selectedItems && selectedItems.length > 0) {
    baseItems = selectedItems;
  } else {
    const { data: parentItems } = await supabase.from('rfq_items')
      .select('rfq_item_id,sub_event_name,description,quantity,unit,source,sort_order,sub_items')
      .eq('rfq_id', parentRfq.rfq_id).eq('is_deleted', false).order('sort_order');
    baseItems = parentItems || [];
  }

  const out = [];
  for (const v of list) {
    const ref_number = await getNextRfqRef();
    const token = genRfqToken();
    const pin = genRfqPin();
    const now = new Date().toISOString();
    const { data: rfq, error } = await runDb(supabase.from('rfqs').insert({
      ref_number, status: 'sent', party_type: 'vendor',
      parent_rfq_id: parentRfq.rfq_id, vendor_id: v.vendor_id,
      // vendor's own contact — never the client's identity
      contact_name: v.contact_person || v.name || null,
      contact_phone: v.phone_1 || null, contact_email: v.email_1 || null,
      // event basics copied from the client RFQ so the vendor has context
      event_type: parentRfq.event_type || null, event_date: parentRfq.event_date || null,
      location: parentRfq.location || null, city: parentRfq.city || null,
      access_mode: 'pin',
      access_pin_hash: await sha256Hex(pin),
      token_hash: await sha256Hex(token),
      token_expires_at: new Date(Date.now() + 21 * 24 * 3600 * 1000).toISOString(),
      created_by: uid || null, created_at: now, updated_at: now, is_deleted: false,
    }).select('rfq_id,ref_number').single(), 'create vendor RFQ');
    if (error || !rfq) throw error || new Error('vendor RFQ create failed');

    if (baseItems.length) {
      const rows = baseItems.map((it, i) => ({
        rfq_id: rfq.rfq_id, sub_event_name: it.sub_event_name || null,
        description: it.description, quantity: it.quantity ?? 1, unit: it.unit || null,
        source: it.source || 'custom', sort_order: it.sort_order ?? i,
        source_item_id: it.rfq_item_id || null,   // back-link to the client rfq_item
        sub_items: it.sub_items || [],
        can_supply: true, is_deleted: false, created_at: now,
      }));
      await runDb(supabase.from('rfq_items').insert(rows), 'copy items to vendor RFQ');
    }
    try { await supabase.from('rfq_activity').insert({ rfq_id: rfq.rfq_id, actor: uid || 'staff', action: 'created', notes: 'Vendor RFQ → ' + (v.name || '') }); } catch (e) { /* non-fatal */ }
    out.push({ vendor_id: v.vendor_id, vendor_name: v.name || '', rfq_id: rfq.rfq_id, ref_number: rfq.ref_number, token, pin });
  }
  return out;
}

// Universal sourcing bridge: ensure a quote has a client-RFQ to source against.
// Reuses the quote's existing client RFQ if it has one; otherwise creates a hidden
// "sourcing anchor" (is_sourcing_anchor=true, status=converted) seeded from the
// quote's line items, so the Sourcing panel + costing screen work off any quote.
// Returns the rfq_id to open. Idempotent per quote.
export async function ensureSourcingAnchor(quote) {
  if (!quote || !quote.quotation_id) throw new Error('No quote to source from.');
  const { data: existing } = await supabase.from('rfqs')
    .select('rfq_id').eq('party_type', 'client').eq('quotation_id', quote.quotation_id).eq('is_deleted', false)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (existing && existing.rfq_id) return existing.rfq_id;

  const { data: li } = await supabase.from('quotation_line_items')
    .select('description,quantity,sub_event_name,sort_order,sub_items').eq('quotation_id', quote.quotation_id).eq('is_deleted', false).order('sort_order');
  if (!li || !li.length) throw new Error('Add at least one line item before sourcing vendors.');

  const created = await createRfq({ client_id: quote.client_id || null, lead_id: quote.lead_id || null, contact_name: quote.client_name || null, event_type: quote.event_type || null });
  const { error: ue } = await runDb(supabase.from('rfqs').update({ status: 'converted', party_type: 'client', is_sourcing_anchor: true, quotation_id: quote.quotation_id, updated_at: new Date().toISOString() }).eq('rfq_id', created.rfq_id), 'link sourcing anchor');
  if (ue) throw ue;
  const items = li.map((x, i) => ({ rfq_id: created.rfq_id, description: x.description, quantity: x.quantity || 1, sub_event_name: x.sub_event_name || null, sort_order: (x.sort_order != null ? x.sort_order : i), source: 'quote', sub_items: x.sub_items || [], is_deleted: false }));
  const { error: lie } = await runDb(supabase.from('rfq_items').insert(items), 'seed sourcing items');
  if (lie) throw lie;
  return created.rfq_id;
}

// All vendor RFQs under a client RFQ (for the Sourcing panel).
export async function loadVendorRfqs(parentRfqId) {
  const { data } = await supabase.from('rfqs')
    .select('rfq_id,ref_number,status,vendor_id,reminder_count,last_reminded_at,client_submitted_at,updated_at,revision_number')
    .eq('parent_rfq_id', parentRfqId).eq('party_type', 'vendor').eq('is_deleted', false)
    .order('created_at', { ascending: true });
  return data || [];
}

// A vendor RFQ's items + cost state (for "View bid" + the priced/can't-supply summary).
export async function loadVendorRfqItems(rfqId) {
  const { data } = await supabase.from('rfq_items')
    .select('rfq_item_id,sub_event_name,description,quantity,unit,unit_cost,can_supply,item_note,sort_order,sub_items')
    .eq('rfq_id', rfqId).eq('is_deleted', false).order('sort_order');
  return data || [];
}

// Manual reminder: bump the counter + timestamp + log it (the UI then opens WhatsApp/email).
export async function bumpReminder(rfqId) {
  const { data: cur } = await supabase.from('rfqs').select('reminder_count').eq('rfq_id', rfqId).maybeSingle();
  const n = ((cur && cur.reminder_count) || 0) + 1;
  await runDb(supabase.from('rfqs').update({ reminder_count: n, last_reminded_at: new Date().toISOString() }).eq('rfq_id', rfqId), 'log reminder');
  try { const uid = await _currentUid(); await supabase.from('rfq_activity').insert({ rfq_id: rfqId, actor: uid || 'staff', action: 'reminded', notes: 'Reminder #' + n }); } catch (e) { /* non-fatal */ }
  return n;
}

// Issue a fresh token+PIN for a vendor RFQ (only the hash is stored, so re-sharing a
// reminder needs a new working link). Old link stops working. Returns { token, pin }.
export async function regenerateVendorLink(rfqId) {
  const token = genRfqToken();
  const pin = genRfqPin();
  const { error } = await runDb(supabase.from('rfqs').update({
    token_hash: await sha256Hex(token), access_pin_hash: await sha256Hex(pin),
    token_expires_at: new Date(Date.now() + 21 * 24 * 3600 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('rfq_id', rfqId), 'regenerate vendor link');
  if (error) throw error;
  return { token, pin };
}

// Remove a vendor from sourcing: soft-delete its vendor RFQ so it drops from the
// sourcing list and the costing grid. Frees the vendor to be re-sent later.
export async function removeVendorRfq(rfqId) {
  const uid = await _currentUid();
  const { error } = await runDb(supabase.from('rfqs').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('rfq_id', rfqId), 'remove vendor RFQ');
  if (error) throw error;
  try { await supabase.from('rfq_activity').insert({ rfq_id: rfqId, actor: uid || 'staff', action: 'withdrawn', notes: 'Removed from sourcing' }); } catch (e) { /* non-fatal */ }
}

// The vendor opens the SAME portal link; the gateway renders vendor mode by party_type.
export function vendorRfqLink(token) { return rfqLink(token); }

// WhatsApp/email body for a vendor RFQ send or reminder.
export function buildVendorRfqMsg(vendorRfq, settings, link, opts = {}) {
  const company = (settings && settings.company_name) || 'Isheeka Events';
  const lead = opts.reminder ? 'Gentle reminder — your pricing is awaited.\n\n' : '';
  return lead
    + 'Hello' + (vendorRfq.vendor_name ? ' ' + vendorRfq.vendor_name : '') + ',\n\n'
    + company + ' would like your pricing for an upcoming event. Please open the secure link '
    + 'and enter your unit cost for each item (or mark any you can\'t supply):\n\n'
    + link + '\n'
    + (vendorRfq.pin ? ('Access PIN: ' + vendorRfq.pin + '\n') : '')
    + '\nThank you,\n' + company;
}
