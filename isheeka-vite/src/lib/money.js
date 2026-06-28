// Money-path helpers (ported verbatim from isheeka-erp-v22.html) — the highest-risk
// logic, so kept byte-for-byte identical to the live app. Quote→event→invoice
// conversion, installment reconciliation, client/vendor refunds, and quote close-out.
import { supabase } from './supabase';
import { notify } from './toast.jsx';
import { _currentUid, logInvoiceActivity } from './session.js';
import { getNextClientRef, getNextEventRef, getNextInvoiceRef } from './refs.js';
import { defaultEventName, todayLocalStr, mapLostReason } from './format.js';
import { REJECT_REASONS } from './constants.js';

// ── Close a quote as not-proceeding ───────────────────────────────────────────
// quote→rejected, log the reason, and (lead-origin) mark the lead lost.
export async function closeQuoteNotProceeding(quot, opts) {
  const outcome = (opts && opts.outcome) || 'client', reason = (opts && opts.reason) || 'other', notes = ((opts && opts.notes) || '').trim();
  const list = REJECT_REASONS[outcome] || REJECT_REASONS.client; const rLabel = (list.find((r) => r.value === reason) || {}).label || reason;
  const who = outcome === 'us' ? 'We withdrew' : 'Client declined'; const summary = who + ' — ' + rLabel + (notes ? (': ' + notes) : '');
  const { error } = await supabase.from('quotations').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('quotation_id', quot.quotation_id); if (error) throw error;
  try { await supabase.from('quotation_activity_log').insert({ quotation_id: quot.quotation_id, action: 'rejected', notes: summary, logged_by: await _currentUid() }); } catch (e) { /* non-fatal */ }
  if (quot.lead_id) { try { await supabase.from('leads').update({ stage: 'lost', lost_reason: mapLostReason(outcome, reason), lost_notes: summary, updated_at: new Date().toISOString() }).eq('lead_id', quot.lead_id); } catch (e) { /* non-fatal */ } }
  return summary;
}

// ── Vendor installments / payments / refunds ──────────────────────────────────
export async function _ensureVendorInstallment(eventVendorId, agreedAmount) {
  const { data: ex } = await supabase.from('vendor_installments').select('installment_id').eq('event_vendor_id', eventVendorId).order('installment_number').limit(1);
  if (ex && ex.length) return ex[0].installment_id;
  const ag = parseFloat(agreedAmount) || 0;
  const { data: ins, error } = await supabase.from('vendor_installments').insert({ event_vendor_id: eventVendorId, installment_number: 1, amount_due: ag, amount_paid: 0, balance: ag, status: 'pending', created_at: new Date().toISOString() }).select('installment_id').single();
  if (error) throw error; return ins.installment_id;
}

export async function addEventVendor({ eventId, vendorId, vendorName, category, service, agreed }) {
  let vid = vendorId, vname = vendorName;
  if (!vid) {
    const { data: v, error } = await supabase.from('vendors').insert({ name: vendorName, category: category || null, status: 'active', created_by: await _currentUid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_deleted: false }).select('vendor_id,name').single();
    if (error) throw error; vid = v.vendor_id; vname = v.name;
  }
  const ag = parseFloat(agreed) || 0;
  const { data: ev, error: ee } = await supabase.from('event_vendors').insert({ event_id: eventId, vendor_id: vid, vendor_name: vname || null, service_description: service || null, agreed_amount: ag, total_paid: 0, outstanding: ag, status: 'pending', created_by: await _currentUid(), created_at: new Date().toISOString(), is_deleted: false }).select('*').single();
  if (ee) throw ee;
  await _ensureVendorInstallment(ev.event_vendor_id, ag);
  return ev;
}

export async function recordVendorPayment(ev, pay) {
  const instId = (pay && pay.installmentId) || await _ensureVendorInstallment(ev.event_vendor_id, ev.agreed_amount);
  const amt = parseFloat(pay.amount) || 0;
  const { error: pe } = await supabase.from('vendor_payments').insert({ event_vendor_id: ev.event_vendor_id, installment_id: instId, vendor_id: ev.vendor_id, event_id: ev.event_id, amount: amt, payment_date: pay.date, payment_mode: pay.mode || null, reference_number: pay.reference || null, notes: pay.notes || null, recorded_by: await _currentUid(), recorded_at: new Date().toISOString() });
  if (pe) throw pe;
  const { data: inst } = await supabase.from('vendor_installments').select('amount_due,amount_paid').eq('installment_id', instId).single();
  const ip = (parseFloat(inst && inst.amount_paid) || 0) + amt, idue = parseFloat(inst && inst.amount_due) || 0, ibal = Math.max(0, idue - ip);
  await supabase.from('vendor_installments').update({ amount_paid: ip, balance: ibal, status: ibal <= 0 ? 'paid' : 'partially_paid', updated_at: new Date().toISOString() }).eq('installment_id', instId);
  const newPaid = (parseFloat(ev.total_paid) || 0) + amt, agreed = parseFloat(ev.agreed_amount) || 0, out = Math.max(0, agreed - newPaid);
  await supabase.from('event_vendors').update({ total_paid: newPaid, outstanding: out, status: newPaid <= 0 ? 'pending' : (out <= 0 ? 'paid' : 'partially_paid'), updated_at: new Date().toISOString() }).eq('event_vendor_id', ev.event_vendor_id);
}

// Record a vendor refund (money the vendor returned) as a negative is_refund row + roll back totals.
export async function recordVendorRefund(ev, refund) {
  const amt = parseFloat(refund.amount) || 0; if (amt <= 0) return;
  const instId = (refund.installmentId) || await _ensureVendorInstallment(ev.event_vendor_id, ev.agreed_amount);
  const { error: pe } = await supabase.from('vendor_payments').insert({ event_vendor_id: ev.event_vendor_id, installment_id: instId, vendor_id: ev.vendor_id, event_id: ev.event_id, amount: -amt, payment_date: refund.date || todayLocalStr(), payment_mode: null, reference_number: refund.reference || null, notes: ('Refund: ' + (refund.reason || '')), is_refund: true, recorded_by: await _currentUid(), recorded_at: new Date().toISOString() });
  if (pe) throw pe;
  const { data: inst } = await supabase.from('vendor_installments').select('amount_due,amount_paid').eq('installment_id', instId).single();
  const ip = Math.max(0, (parseFloat(inst && inst.amount_paid) || 0) - amt), idue = parseFloat(inst && inst.amount_due) || 0, ibal = Math.max(0, idue - ip);
  await supabase.from('vendor_installments').update({ amount_paid: ip, balance: ibal, status: ip <= 0 ? 'pending' : (ibal <= 0 ? 'paid' : 'partially_paid'), updated_at: new Date().toISOString() }).eq('installment_id', instId);
  const newPaid = Math.max(0, (parseFloat(ev.total_paid) || 0) - amt), agreed = parseFloat(ev.agreed_amount) || 0, out = Math.max(0, agreed - newPaid);
  await supabase.from('event_vendors').update({ total_paid: newPaid, outstanding: out, status: newPaid <= 0 ? 'pending' : (out <= 0 ? 'paid' : 'partially_paid'), updated_at: new Date().toISOString() }).eq('event_vendor_id', ev.event_vendor_id);
}

// ── Invoice installment reconciliation + client refund ────────────────────────
// Reconcile an invoice's installment ledger from the header's total_received.
// Allocates the received amount across installments in number order (advance → … → balance),
// so amount_paid / balance / status always agree with the invoice header. Idempotent.
export async function reconcileInvoiceInstallments(installments, totalReceived) {
  let remaining = Math.max(0, parseFloat(totalReceived) || 0);
  for (const it of [...(installments || [])].sort((a, b) => (a.installment_number || 0) - (b.installment_number || 0))) {
    const due = parseFloat(it.amount_due) || 0;
    const paid = Math.min(due, remaining); remaining -= paid;
    const bal = Math.max(0, due - paid);
    const ist = paid <= 0 ? 'pending' : (bal <= 0 ? 'paid' : 'partially_paid');
    if ((parseFloat(it.amount_paid) || 0) !== paid || (parseFloat(it.balance) || 0) !== bal || it.status !== ist) {
      await supabase.from('invoice_installments').update({ amount_paid: paid, balance: bal, status: ist, updated_at: new Date().toISOString() }).eq('installment_id', it.installment_id);
    }
  }
}

export async function recordClientRefund(inv, refund) {
  const amt = parseFloat(refund.amount) || 0; if (amt <= 0) return;
  let instId = refund.installmentId || null;
  // Un-apply the refund against installments from last to first, so paid balances re-open to
  // match the lowered header (otherwise the installment ledger reads "paid" while the header
  // shows an outstanding amount — and a new payment then has no installment to land on).
  const { data: insts } = await supabase.from('invoice_installments').select('*').eq('invoice_id', inv.invoice_id).eq('is_deleted', false).order('installment_number', { ascending: false });
  let remaining = amt;
  for (const it of (insts || [])) {
    if (remaining <= 0.5) break;
    const paid = parseFloat(it.amount_paid) || 0; if (paid <= 0) continue;
    const take = Math.min(paid, remaining);
    const newPaid = paid - take; const due = parseFloat(it.amount_due) || 0; const bal = Math.max(0, due - newPaid);
    const ist = newPaid <= 0 ? 'pending' : (bal <= 0 ? 'paid' : 'partially_paid');
    await supabase.from('invoice_installments').update({ amount_paid: newPaid, balance: bal, status: ist, updated_at: new Date().toISOString() }).eq('installment_id', it.installment_id);
    if (!instId) instId = it.installment_id; // attribute the refund row to the first installment reversed
    remaining -= take;
  }
  if (!instId) { const { data: ins } = await supabase.from('invoice_installments').select('installment_id').eq('invoice_id', inv.invoice_id).eq('is_deleted', false).order('installment_number').limit(1); instId = (ins && ins[0] && ins[0].installment_id) || null; }
  const { error: pe } = await supabase.from('invoice_payments').insert({ invoice_id: inv.invoice_id, installment_id: instId, amount: -amt, payment_date: refund.date || todayLocalStr(), payment_mode: null, reference_number: refund.reference || null, notes: ('Refund: ' + (refund.reason || '')), is_refund: true, recorded_by: await _currentUid() });
  if (pe) throw pe;
  const newRecv = Math.max(0, (parseFloat(inv.total_received) || 0) - amt), grand = parseFloat(inv.grand_total) || 0, out = Math.max(0, grand - newRecv);
  const st = (inv.status === 'cancelled') ? 'cancelled' : (newRecv <= 0 ? 'sent' : (out <= 0 ? 'paid' : 'partially_paid'));
  await supabase.from('invoices').update({ total_received: newRecv, total_outstanding: out, status: st, updated_at: new Date().toISOString() }).eq('invoice_id', inv.invoice_id);
}

// ── Lead/quote → event → draft invoice ────────────────────────────────────────
// Resolve/create client → create event → seed sub-events → mark the quote converted
// → draft invoice (best-effort) → link the lead. Returns {eventId, clientOutcome, clientName}.
export async function createEventFromQuote(lead, opts = {}) {
  let clientId = (opts.forcedClientId !== undefined ? opts.forcedClientId : null) || lead.client_id || null;
  let clientOutcome = clientId ? 'reused' : 'created';
  if (!clientId) {
    const ref_number = await getNextClientRef();
    const { data: client, error: ce } = await supabase.from('clients').insert({
      ref_number,
      first_name: lead.first_name, last_name: lead.last_name,
      phone_1: lead.phone, phone_2: lead.phone_2 || null,
      email_1: lead.email || null, source: lead.source || 'referral', status: 'active',
      client_since: new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_deleted: false,
    }).select().single();
    if (ce) throw ce;
    clientId = client.client_id; clientOutcome = 'created';
  }
  let approvedQuot = opts.quot || null;
  if (!approvedQuot && lead.active_quotation_id) {
    const { data: q } = await supabase.from('quotations').select('*').eq('quotation_id', lead.active_quotation_id).single();
    approvedQuot = q;
  }
  const evRef = await getNextEventRef();
  const { data: event, error: ee } = await supabase.from('events').insert({
    ref_number: evRef,
    lead_id: lead.lead_id,
    name: (approvedQuot && approvedQuot.event_name) || defaultEventName(lead.event_type),
    type: lead.event_type || null, status: 'planning',
    main_date: lead.tentative_date || null,
    location: lead.location || null,
    guest_count: lead.guest_count || null,
    budget: lead.budget || null,
    client_id: clientId,
    client_name: lead.first_name + ' ' + lead.last_name,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_deleted: false,
  }).select().single();
  if (ee) throw ee;
  if (approvedQuot) {
    const { data: li } = await supabase.from('quotation_line_items').select('sub_event_name,description,quantity,unit_price,sort_order').eq('quotation_id', approvedQuot.quotation_id).eq('is_deleted', false).order('sort_order');
    const names = [...new Set((li || []).map((x) => x.sub_event_name).filter((n) => n && n.trim() && n !== 'General Items'))];
    // Fetch the RFQ's sub_events JSONB so we can copy planned_date + venue into the sub_events table rows
    const rfqSeMap = {};
    try {
      const { data: rfqRow } = await supabase.from('rfqs').select('sub_events').eq('quotation_id', approvedQuot.quotation_id).eq('is_deleted', false).maybeSingle();
      ((rfqRow && Array.isArray(rfqRow.sub_events)) ? rfqRow.sub_events : []).forEach((s) => { if (s.name) rfqSeMap[s.name] = { date: s.planned_date || null, location: s.venue || null }; });
    } catch (e) { /* non-fatal */ }
    const nameToId = {};
    let so = 0;
    for (const name of names) {
      const rfqSe = rfqSeMap[name] || {};
      const { data: seRow, error: sie } = await supabase.from('sub_events').insert({ event_id: event.event_id, name, date: rfqSe.date || null, location: rfqSe.location || null, sort_order: so++, created_at: new Date().toISOString(), is_deleted: false }).select().single(); if (sie) throw sie;
      if (seRow) nameToId[name] = seRow.sub_event_id;
    }
    // Copy the quote's line items onto the event so they appear under their sub-events
    // (items with no/General sub-event fall under the event's main group). Without this the
    // event shows empty sub-events even though the quote/invoice carry the items.
    if (li && li.length) {
      const itemRows = li.map((it, idx) => ({
        sub_event_id: (it.sub_event_name && nameToId[it.sub_event_name]) ? nameToId[it.sub_event_name] : null,
        event_id: event.event_id,
        description: it.description || '—',
        quantity: it.quantity, unit_price: it.unit_price,
        sort_order: (it.sort_order != null ? it.sort_order : idx),
        created_at: new Date().toISOString(), is_deleted: false,
      }));
      const { error: siie } = await supabase.from('sub_event_items').insert(itemRows); if (siie) throw siie;
    }
    const { error: cve } = await supabase.from('quotations').update({ status: 'converted', event_id: event.event_id, updated_at: new Date().toISOString() }).eq('quotation_id', approvedQuot.quotation_id); if (cve) throw cve;
    try { await createInvoiceFromQuote(approvedQuot.quotation_id, { eventId: event.event_id }); }
    catch (invErr) { console.error('[Isheeka ERP] invoice auto-create failed:', invErr); notify('Event created, but the draft invoice couldn\'t be generated automatically — use "Generate invoice" on the event.', 'error'); }
  }
  if (lead.lead_id) {
    const { error: lue } = await supabase.from('leads').update({
      stage: 'event_triggered', client_id: clientId,
      event_id: event.event_id, converted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('lead_id', lead.lead_id);
    if (lue) throw lue;
  }
  return { eventId: event.event_id, clientOutcome, clientName: lead.first_name + ' ' + lead.last_name };
}

// ── Quote → draft invoice ─────────────────────────────────────────────────────
// Create (or refresh an unpaid draft) invoice from a confirmed/approved quotation.
// Guarded multi-table write — child failures roll back so no orphan header is left.
export async function createInvoiceFromQuote(quotationId, opts = {}) {
  const { data: quot, error: qe } = await supabase.from('quotations').select('*').eq('quotation_id', quotationId).single();
  if (qe || !quot) { notify('Could not load the quotation to invoice.', 'error'); return null; }
  const eventId = opts.eventId || quot.event_id;
  if (!eventId) { notify('No event linked yet — the invoice will be created when the event is.', 'info'); return null; }
  const { data: exArr } = await supabase.from('invoices').select('invoice_id,ref_number,status,total_received,gst_applicable,gst_pct,discount_amount,revision_number,grand_total').eq('event_id', eventId).eq('is_deleted', false).neq('status', 'cancelled').limit(1);
  const existing = exArr && exArr[0];
  if (existing) {
    // Issued (sent+) or any payment recorded → keep it as a snapshot, do not touch.
    if (existing.status !== 'draft' || (parseFloat(existing.total_received) || 0) > 0) return existing;
    // Draft + unpaid → refresh it in place from the newly-confirmed quote (decision #12).
    const { data: qitems } = await supabase.from('quotation_line_items').select('*').eq('quotation_id', quotationId).eq('is_deleted', false).order('sort_order');
    const rSub = parseFloat(quot.subtotal || 0), rDisc = parseFloat(quot.discount_amount || 0);
    const rTaxable = Math.max(0, rSub - rDisc);
    const rTax = existing.gst_applicable ? Math.round(rTaxable * (parseFloat(existing.gst_pct) || 0) / 100) : 0;
    const rGrand = rTaxable + rTax;
    await supabase.from('invoice_line_items').update({ is_deleted: true }).eq('invoice_id', existing.invoice_id);
    if (qitems && qitems.length) { await supabase.from('invoice_line_items').insert(qitems.map((it, idx) => ({ invoice_id: existing.invoice_id, description: it.description || '—', sub_event_name: it.sub_event_name || null, quantity: it.quantity, unit_price: it.unit_price, amount: it.amount, sort_order: (it.sort_order != null ? it.sort_order : idx), sub_items: it.sub_items || [] }))); }
    await supabase.from('invoice_installments').update({ is_deleted: true }).eq('invoice_id', existing.invoice_id);
    let rps = quot.payment_schedule; if (typeof rps === 'string') { try { rps = JSON.parse(rps || '[]'); } catch (e) { rps = []; } } rps = Array.isArray(rps) ? rps : [];
    if (rps.length) { await supabase.from('invoice_installments').insert(rps.map((p, idx) => { const pct = parseFloat(p.pct) || 0; const amt = (parseFloat(p.amount) > 0) ? Math.round(parseFloat(p.amount)) : Math.round(rGrand * pct / 100); return { invoice_id: existing.invoice_id, installment_number: idx + 1, percentage: pct, label: p.label || ('Installment ' + (idx + 1)), when_text: p.when || '', amount_due: amt, amount_paid: 0, balance: amt, status: 'pending' }; })); }
    const { error: rue } = await supabase.from('invoices').update({ quotation_id: quotationId, event_name: quot.event_name || null, client_name: quot.client_name || null, subtotal: rSub, discount_amount: rDisc, tax_amount: rTax, grand_total: rGrand, total_outstanding: rGrand, source_quote_total: parseFloat(quot.grand_total || 0), additional_notes: quot.additional_notes || null, updated_at: new Date().toISOString() }).eq('invoice_id', existing.invoice_id);
    if (rue) { notify('Could not refresh the draft invoice: ' + (rue.message || ''), 'error'); return existing; }
    try { await logInvoiceActivity(existing.invoice_id, { action: 'auto_refresh', field: 'grand_total', old_value: '₹' + (parseFloat(existing.grand_total) || 0).toLocaleString('en-IN'), new_value: '₹' + rGrand.toLocaleString('en-IN'), reason: 'Synced to confirmed quote ' + (quot.ref_number || ''), revision_number: existing.revision_number || 0 }); } catch (e) { /* non-fatal */ }
    notify('Draft invoice ' + existing.ref_number + ' refreshed from the updated quote.', 'success');
    return existing;
  }
  const { data: items } = await supabase.from('quotation_line_items').select('*').eq('quotation_id', quotationId).eq('is_deleted', false).order('sort_order');
  let ref; try { ref = await getNextInvoiceRef(); } catch (e) { return null; }
  const subtotal = parseFloat(quot.subtotal || 0);
  const discount = parseFloat(quot.discount_amount || 0);
  const grand = Math.max(0, subtotal - discount); // GST stays off until toggled on the invoice
  const { data: inv, error: ie } = await supabase.from('invoices').insert({
    event_id: eventId, event_name: quot.event_name || null, quotation_id: quotationId,
    client_id: quot.client_id || null, client_name: quot.client_name || null,
    ref_number: ref, status: 'draft', revision_number: 0,
    subtotal, discount_amount: discount, tax_amount: 0,
    gst_applicable: false, gst_pct: 0, grand_total: grand,
    total_received: 0, total_outstanding: grand,
    source_quote_total: parseFloat(quot.grand_total || 0),
    payment_terms: quot.payment_terms || null,
    additional_notes: quot.additional_notes || null,
  }).select().single();
  if (ie || !inv) { notify('Failed to create the invoice. ' + ((ie && ie.message) || ''), 'error'); return null; }
  if (items && items.length) {
    const liRows = items.map((it, idx) => ({ invoice_id: inv.invoice_id, description: it.description || '—', sub_event_name: it.sub_event_name || null, quantity: it.quantity, unit_price: it.unit_price, amount: it.amount, sort_order: (it.sort_order != null ? it.sort_order : idx), sub_items: it.sub_items || [] }));
    const { error: lie } = await supabase.from('invoice_line_items').insert(liRows);
    if (lie) { await supabase.from('invoices').delete().eq('invoice_id', inv.invoice_id); notify('Failed to copy line items — invoice rolled back. ' + (lie.message || ''), 'error'); return null; }
  }
  let ps = quot.payment_schedule; if (typeof ps === 'string') { try { ps = JSON.parse(ps || '[]'); } catch (e) { ps = []; } }
  ps = Array.isArray(ps) ? ps : [];
  if (ps.length) {
    const instRows = ps.map((p, idx) => { const pct = parseFloat(p.pct) || 0; const amt = (parseFloat(p.amount) > 0) ? Math.round(parseFloat(p.amount)) : Math.round(grand * pct / 100); return { invoice_id: inv.invoice_id, installment_number: idx + 1, percentage: pct, label: p.label || ('Installment ' + (idx + 1)), when_text: p.when || '', amount_due: amt, amount_paid: 0, balance: amt, status: 'pending' }; });
    const { error: ine } = await supabase.from('invoice_installments').insert(instRows);
    if (ine) { await supabase.from('invoice_line_items').delete().eq('invoice_id', inv.invoice_id); await supabase.from('invoices').delete().eq('invoice_id', inv.invoice_id); notify('Failed to create installments — invoice rolled back. ' + (ine.message || ''), 'error'); return null; }
  }
  notify('Draft invoice ' + ref + ' created.', 'success');
  return inv;
}
