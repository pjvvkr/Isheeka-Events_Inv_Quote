// RFQ module (staff side) — list, New-RFQ form, share card, and the detail page
// (approve→quote with dedupe, request-changes, revisions compare, activity).
// Ported verbatim from isheeka-erp-v22.html.
import React from 'react';
import { supabase } from '../lib/supabase';
import { notify, runDb } from '../lib/toast.jsx';
import { _currentUid } from '../lib/session.js';
import { fmtDate } from '../lib/format.js';
import { RFQ_STATUS, RFQ_ACTION_LABEL } from '../lib/constants.js';
import { useEventTypes } from '../lib/data.js';
import { rfqLink, createRfq, genRfqToken, genRfqPin, sha256Hex, approveRfqToQuote, findClientMatch } from '../lib/rfq.js';
import { waLink } from '../lib/share.js';
import { createVendorRfqs, loadVendorRfqs, loadVendorRfqItems, bumpReminder, regenerateVendorLink, vendorRfqLink, buildVendorRfqMsg } from '../lib/vendorRfq.js';
import { CostingScreen } from './CostingScreen.jsx';

function RFQShareCard({ created, contact, onDone }) {
  const link = rfqLink(created.token);
  const msg = 'Hello' + (contact && contact.name ? (' ' + contact.name) : '') + ',\n\nPlease share your event requirements with Isheeka Events here:\n' + link + (created.pin ? ('\n\nYour access PIN: ' + created.pin) : '') + '\n\nThank you!';
  const copy = (t, what) => { try { navigator.clipboard.writeText(t); notify(what + ' copied.', 'success'); } catch (e) { notify('Copy failed — select and copy manually.', 'error'); } };
  return (
    <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: '18px 20px', maxWidth: 560 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 4 }}>RFQ {created.ref_number} created — share it</div>
      <div style={{ fontSize: 12, color: 'var(--grey-400)', marginBottom: 14 }}>Send the link{created.pin ? ' + PIN' : ''} to the client. They open it, verify, and fill their requirements.</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--grey-50)', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-md)', padding: '9px 12px', marginBottom: 8 }}>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--grey-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link}</span>
        <button className="btn sm" onClick={() => copy(link, 'Link')}>Copy link</button>
      </div>
      {created.pin && <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--grey-400)' }}>PIN</span>
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: 3, color: 'var(--pink)', background: 'var(--pink-light)', borderRadius: 6, padding: '3px 14px' }}>{created.pin}</span>
        <button className="btn sm" onClick={() => copy(created.pin, 'PIN')}>Copy PIN</button>
      </div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <a className="btn sm" style={{ background: 'var(--green-light)', color: 'var(--green)', borderColor: '#86EFAC', textDecoration: 'none' }} href={waLink(contact && contact.phone, msg)} target="_blank" rel="noreferrer">💬 Share on WhatsApp</a>
        <button className="btn sm primary" onClick={onDone}>Done</button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 12 }}>⚠ The PIN is shown once. If the client loses it, open the RFQ and use “Regenerate link &amp; PIN”.</div>
    </div>
  );
}

function NewRFQForm({ prefill, onCreated, onCancel, onNavigate }) {
  const eventTypes = useEventTypes();
  const [existingRfqs, setExistingRfqs] = React.useState([]);
  React.useEffect(() => { (async () => {
    if (!prefill || (!prefill.client_id && !prefill.lead_id)) return;
    let q = supabase.from('rfqs').select('rfq_id,ref_number,status').eq('is_deleted', false).eq('party_type', 'client').not('status', 'in', '("converted","withdrawn")');
    q = prefill.client_id ? q.eq('client_id', prefill.client_id) : q.eq('lead_id', prefill.lead_id);
    const { data } = await q.order('created_at', { ascending: false });
    setExistingRfqs(data || []);
  })(); }, []);
  const pn = (prefill?.contact_name || '').trim().split(/\s+/);
  const [f, setF] = React.useState({
    contact_first_name: prefill?.contact_first_name || (pn[0] || ''), contact_last_name: prefill?.contact_last_name || (pn.slice(1).join(' ') || ''),
    contact_phone: prefill?.contact_phone || '', contact_email: prefill?.contact_email || '',
    secondary_contact_name: prefill?.secondary_contact_name || '', secondary_contact_phone: prefill?.secondary_contact_phone || '',
    event_type: prefill?.event_type || '',
    event_date: prefill?.event_date || '',
    guest_count: prefill?.guest_count ? String(prefill.guest_count) : '',
    budget: prefill?.budget ? String(prefill.budget) : '',
    location: prefill?.location || '', city: prefill?.city || (prefill?.lead_city || 'Hyderabad'), access_mode: 'pin',
  });
  const [saving, setSaving] = React.useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const submit = async () => {
    if (!f.contact_first_name.trim()) { notify('Enter the client first name.', 'error'); return; }
    if (!f.contact_last_name.trim()) { notify('Enter the client last name.', 'error'); return; }
    if (f.access_mode === 'email_otp' && !f.contact_email.trim()) { notify('Email is required for the email-OTP option.', 'error'); return; }
    setSaving(true);
    try {
      const created = await createRfq({ ...f, client_id: prefill?.client_id || null, lead_id: prefill?.lead_id || null });
      onCreated(created, { name: (f.contact_first_name + ' ' + f.contact_last_name).trim(), phone: f.contact_phone });
    } catch (e) { /* runDb already toasted */ }
    setSaving(false);
  };
  return (
    <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: '18px 20px', maxWidth: 600 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 2 }}>New RFQ</div>
      <div style={{ fontSize: 12, color: 'var(--grey-400)', marginBottom: 14 }}>{prefill?.client_id ? 'Linked to this client.' : prefill?.lead_id ? 'Linked to this lead.' : 'A link the client opens to share their event requirements.'}</div>
      {existingRfqs.length > 0 && <div style={{ background: 'var(--orange-light)', color: '#854F0B', borderRadius: 'var(--radius-md)', padding: '10px 12px', marginBottom: 14, fontSize: 12.5 }}>
        ⚠ This {prefill && prefill.lead_id && !prefill.client_id ? 'lead' : 'client'} already has {existingRfqs.length} open RFQ{existingRfqs.length > 1 ? 's' : ''}: {existingRfqs.map((x, i) => (<span key={x.rfq_id}>{i > 0 ? ', ' : ''}<a onClick={() => onNavigate && onNavigate('rfqs', { rfqId: x.rfq_id, label: x.ref_number })} style={{ color: 'var(--pink)', cursor: 'pointer', textDecoration: 'underline' }}>{x.ref_number}</a> ({(RFQ_STATUS[x.status] || {}).l || x.status})</span>))}. You can still create a new one below (e.g. for a different event).
      </div>}
      <div className="form-grid">
        <div><label className="field-label">First name *</label><input className="field-input" value={f.contact_first_name} onChange={(e) => set('contact_first_name', e.target.value)} /></div>
        <div><label className="field-label">Last name *</label><input className="field-input" value={f.contact_last_name} onChange={(e) => set('contact_last_name', e.target.value)} /></div>
        <div><label className="field-label">Phone</label><input className="field-input" value={f.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} /></div>
        <div><label className="field-label">Email{f.access_mode === 'email_otp' ? ' *' : ''}</label><input className="field-input" value={f.contact_email} onChange={(e) => set('contact_email', e.target.value)} /></div>
        <div>
          <label className="field-label">Event type</label>
          <select className="field-input" value={f.event_type} onChange={(e) => set('event_type', e.target.value)}>
            <option value="">— Select —</option>
            {eventTypes.map((t) => <option key={t.value} value={t.label}>{t.label}</option>)}
          </select>
        </div>
        <div><label className="field-label">Tentative date</label><input className="field-input" type="date" value={f.event_date} onChange={(e) => set('event_date', e.target.value)} /></div>
        <div><label className="field-label">Guest count (approx)</label><input className="field-input" type="number" value={f.guest_count} onChange={(e) => set('guest_count', e.target.value)} placeholder="e.g. 300" /></div>
        <div><label className="field-label">Budget (₹ approx)</label><input className="field-input" type="number" value={f.budget} onChange={(e) => set('budget', e.target.value)} placeholder="e.g. 1200000" /></div>
        <div><label className="field-label">Venue</label><input className="field-input" value={f.location} onChange={(e) => set('location', e.target.value)} /></div>
        <div><label className="field-label">City</label><input className="field-input" value={f.city} onChange={(e) => set('city', e.target.value)} /></div>
        <div><label className="field-label">Access</label><select className="field-input" value={f.access_mode} onChange={(e) => set('access_mode', e.target.value)}><option value="pin">Shared PIN (no email needed)</option><option value="email_otp">Email OTP</option></select></div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={saving} onClick={submit}>{saving ? 'Creating…' : 'Create RFQ & get link'}</button>
      </div>
    </div>
  );
}

export function RFQsModule({ nav, onNavigate, onBack }) {
  const [rfqs, setRfqs] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState('');
  const [created, setCreated] = React.useState(null);   // {ref_number, token, pin, contact}
  const detailId = nav && nav.rfqId;
  const isNew = !!(nav && nav.mode === 'new');

  const load = async () => { setLoading(true); const { data } = await supabase.from('rfqs').select('rfq_id,ref_number,status,client_id,contact_name,event_type,event_date,created_at,client_submitted_at,revision_number').eq('is_deleted', false).eq('party_type', 'client').eq('is_sourcing_anchor', false).order('created_at', { ascending: false }); setRfqs(data || []); setLoading(false); };
  React.useEffect(() => { if (!detailId && !isNew && !created) load(); }, [detailId, isNew, created]);

  if (created) { return <div><div style={{ marginBottom: 12 }}><button className="btn sm" onClick={() => { setCreated(null); }}>← All RFQs</button></div><RFQShareCard created={created} contact={created.contact} onDone={() => { setCreated(null); }} /></div>; }
  if (isNew) { return <div><div style={{ marginBottom: 12 }}><button className="btn sm" onClick={onBack}>← Back</button></div><NewRFQForm prefill={nav && nav.prefill} onCreated={(c, contact) => { setCreated({ ...c, contact }); }} onCancel={onBack} onNavigate={onNavigate} /></div>; }
  if (nav && nav.costingRfqId) { return <CostingScreen rfqId={nav.costingRfqId} onBack={onBack} onNavigate={onNavigate} />; }
  if (detailId) { return <RFQDetail rfqId={detailId} onBack={onBack} onShare={(c, contact) => setCreated({ ...c, contact })} onNavigate={onNavigate} />; }

  const needsReview = rfqs.filter((r) => r.status === 'submitted').length;
  const revisedReview = rfqs.filter((r) => r.status === 'submitted' && (r.revision_number || 0) > 1).length;
  const list = rfqs.filter((r) => !statusFilter || r.status === statusFilter);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--grey-800)' }}>RFQs</div>
          {needsReview > 0 && <div style={{ fontSize: 12, color: 'var(--pink)', fontWeight: 500, marginTop: 2 }}>⏳ {needsReview} submitted · awaiting review{revisedReview > 0 ? (' · 🔄 ' + revisedReview + ' revised') : ''}</div>}
        </div>
        <button className="btn primary" onClick={() => onNavigate('rfqs', { mode: 'new', label: 'New RFQ' })}>+ New RFQ</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select className="field-input" style={{ width: 200, fontSize: 13 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.keys(RFQ_STATUS).map((s) => <option key={s} value={s}>{RFQ_STATUS[s].l}</option>)}
        </select>
      </div>
      {loading ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>
        : list.length === 0 ? <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: 40, textAlign: 'center', color: 'var(--grey-400)' }}>No RFQs yet. Click “+ New RFQ” to send a client their requirements link.</div>
          : <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', overflow: 'hidden' }}>
            {list.map((r, i) => { const sc = RFQ_STATUS[r.status] || RFQ_STATUS.sent; return (
              <div key={r.rfq_id} onClick={() => onNavigate('rfqs', { rfqId: r.rfq_id, label: r.ref_number })} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i > 0 ? '1px solid var(--grey-100)' : 'none', cursor: 'pointer' }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--pink)', width: 120, flexShrink: 0 }}>{r.ref_number}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--grey-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.contact_name || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--grey-400)', marginTop: 1 }}>{r.event_type || 'Event'}{r.event_date ? (' · ' + fmtDate(r.event_date, { day: 'numeric', month: 'short', year: 'numeric' })) : ''}</div>
                </div>
                {(r.revision_number || 0) > 1 && <span title={'Client revised this ' + r.revision_number + '×'} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600, background: 'var(--orange-light)', color: 'var(--orange)' }}>🔄 Rev {r.revision_number}</span>}
                <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 500, background: sc.bg, color: sc.c }}>{sc.l}</span>
              </div>
            ); })}
          </div>}
    </div>
  );
}

function rfqItemsGrouped(list) { const g = {}; (list || []).forEach((it) => { const k = it.sub_event_name || 'General'; (g[k] = g[k] || []).push(it); }); return g; }
// diff two item arrays by sub_event_name+description
function diffRevItems(aItems, bItems) {
  const key = (it) => (it.sub_event_name || '') + '||' + (it.description || '');
  const am = {}, bm = {}; (aItems || []).forEach((i) => am[key(i)] = i); (bItems || []).forEach((i) => bm[key(i)] = i);
  const added = [], removed = [], changed = [];
  Object.keys(bm).forEach((k) => { if (!am[k]) added.push(bm[k]); else if ((parseFloat(am[k].quantity) || 0) !== (parseFloat(bm[k].quantity) || 0)) changed.push({ from: am[k], to: bm[k] }); });
  Object.keys(am).forEach((k) => { if (!bm[k]) removed.push(am[k]); });
  return { added, removed, changed };
}

// Milestone S · S2b — Sourcing panel: send/track vendor RFQs from an approved client RFQ.
function SourcingPanel({ clientRfq, itemCount, onNavigate, dealClosed }) {
  const [vrfqs, setVrfqs] = React.useState([]);
  const [vendorMap, setVendorMap] = React.useState({});
  const [summ, setSumm] = React.useState({});
  const [settings, setSettings] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [showSend, setShowSend] = React.useState(false);
  const [allVendors, setAllVendors] = React.useState([]);
  const [picked, setPicked] = React.useState({});
  const [sending, setSending] = React.useState(false);
  const [justSent, setJustSent] = React.useState([]);
  const [viewBid, setViewBid] = React.useState(null);
  const [bidItems, setBidItems] = React.useState([]);

  const load = async () => {
    setLoading(true);
    const [vs, vendorsRes, setRes] = await Promise.all([
      loadVendorRfqs(clientRfq.rfq_id),
      supabase.from('vendors').select('vendor_id,name,contact_person,phone_1,email_1,status').eq('is_deleted', false).order('name'),
      supabase.from('settings').select('company_name,default_markup_pct').limit(1).maybeSingle(),
    ]);
    setVrfqs(vs);
    const vmap = {}; (vendorsRes.data || []).forEach((v) => { vmap[v.vendor_id] = v; });
    setVendorMap(vmap);
    setAllVendors((vendorsRes.data || []).filter((v) => v.status === 'active'));
    setSettings(setRes.data || null);
    const ids = vs.map((x) => x.rfq_id);
    if (ids.length) {
      const { data: its } = await supabase.from('rfq_items').select('rfq_id,unit_cost,can_supply').in('rfq_id', ids).eq('is_deleted', false);
      const s = {};
      (its || []).forEach((it) => { const e = s[it.rfq_id] || { priced: 0, cant: 0, total: 0 }; e.total++; if (it.can_supply === false) e.cant++; else if (it.unit_cost != null) e.priced++; s[it.rfq_id] = e; });
      setSumm(s);
    } else setSumm({});
    setLoading(false);
  };
  React.useEffect(() => { load(); }, [clientRfq.rfq_id]);

  const copy = (t, what) => { try { navigator.clipboard.writeText(t); notify(what + ' copied.', 'success'); } catch (e) { notify('Copy failed.', 'error'); } };
  const markup = (settings && settings.default_markup_pct != null) ? settings.default_markup_pct : 30;

  const doSend = async () => {
    const chosen = allVendors.filter((v) => picked[v.vendor_id]);
    if (!chosen.length) { notify('Pick at least one vendor.', 'error'); return; }
    setSending(true);
    try { const created = await createVendorRfqs(clientRfq, chosen); setJustSent(created); setShowSend(false); setPicked({}); notify('Sent ' + created.length + ' vendor RFQ' + (created.length > 1 ? 's' : '') + '.', 'success'); load(); }
    catch (e) { /* toasted */ }
    setSending(false);
  };

  const remind = async (vr) => {
    const v = vendorMap[vr.vendor_id] || {};
    try {
      const { token, pin } = await regenerateVendorLink(vr.rfq_id);
      const n = await bumpReminder(vr.rfq_id);
      const link = vendorRfqLink(token);
      const msg = buildVendorRfqMsg({ vendor_name: v.name, pin }, settings, link, { reminder: true });
      window.open(waLink(v.phone_1, msg), '_blank');
      notify('Reminder #' + n + ' — fresh link opened.', 'success'); load();
    } catch (e) { notify('Could not send reminder.', 'error'); }
  };

  const remindAll = async () => {
    const pending = vrfqs.filter((v) => v.status !== 'submitted');
    if (!pending.length) { notify('No pending vendors to remind.', 'success'); return; }
    for (const vr of pending) { await remind(vr); } // eslint-disable-line no-await-in-loop
  };

  const openBid = async (rfqId) => { if (viewBid === rfqId) { setViewBid(null); return; } setViewBid(rfqId); setBidItems(await loadVendorRfqItems(rfqId)); };

  const chip = (st) => ({ sent: { l: 'Sent', bg: 'var(--grey-100)', c: 'var(--grey-400)' }, in_progress: { l: 'Opened', bg: 'var(--orange-light)', c: 'var(--orange)' }, submitted: { l: 'Submitted', bg: 'var(--green-light)', c: 'var(--green)' } }[st] || { l: 'Sent', bg: 'var(--grey-100)', c: 'var(--grey-400)' });
  const respondedN = vrfqs.filter((v) => v.status === 'submitted').length;

  return (
    <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: '16px 20px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)' }}>Sourcing — vendor RFQs</div>
          <div style={{ fontSize: 12, color: 'var(--grey-400)', marginTop: 2 }}>Item list frozen · {itemCount} item{itemCount === 1 ? '' : 's'} · default markup {markup}%</div>
        </div>
        {!dealClosed && <button className="btn sm primary" onClick={() => { setShowSend(true); setJustSent([]); }}>+ Send vendor RFQ</button>}
      </div>
      {dealClosed && <div style={{ background: 'var(--grey-50)', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-md)', padding: '8px 12px', marginTop: 10, fontSize: 12.5, color: 'var(--grey-600)' }}>🔒 The event for this RFQ is completed or cancelled — sourcing is read-only. You can still view bids and the costing summary.</div>}

      {justSent.length > 0 && (
        <div style={{ background: 'var(--green-light)', border: '1px solid #86EFAC', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginTop: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--green)', marginBottom: 8 }}>Share these links — the PIN is shown once</div>
          {justSent.map((c) => { const v = vendorMap[c.vendor_id] || {}; const link = vendorRfqLink(c.token); const msg = buildVendorRfqMsg({ vendor_name: c.vendor_name, pin: c.pin }, settings, link, {}); return (
            <div key={c.rfq_id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '5px 0', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
              <span style={{ fontSize: 13, fontWeight: 500, minWidth: 120 }}>{c.vendor_name}</span>
              <span style={{ fontSize: 12, color: 'var(--grey-600)' }}>PIN <b>{c.pin}</b></span>
              <button className="btn sm" onClick={() => copy(link, 'Link')}>Copy link</button>
              <a className="btn sm" style={{ background: 'white', textDecoration: 'none' }} href={waLink(v.phone_1, msg)} target="_blank" rel="noreferrer">💬 WhatsApp</a>
            </div>
          ); })}
        </div>
      )}

      {loading ? <div style={{ padding: 20, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        : vrfqs.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)', marginTop: 12 }}>No vendor RFQs yet. Click “+ Send vendor RFQ” to request pricing.</div>
          : <div style={{ border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-md)', marginTop: 12, overflow: 'hidden' }}>
            {vrfqs.map((vr, i) => { const v = vendorMap[vr.vendor_id] || {}; const sc = chip(vr.status); const s = summ[vr.rfq_id] || { priced: 0, cant: 0, total: 0 }; return (
              <div key={vr.rfq_id} style={{ borderTop: i > 0 ? '1px solid var(--grey-100)' : 'none' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', padding: '11px 14px' }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--grey-800)' }}>{v.name || '—'}</div>
                    <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>{vr.status === 'submitted' ? (s.priced + ' priced' + (s.cant ? (' · ' + s.cant + " can't supply") : '')) : (s.total + ' items')}{vr.reminder_count > 0 ? (' · reminded ' + vr.reminder_count + '×') : ''}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 500, background: sc.bg, color: sc.c }}>{sc.l}</span>
                    {vr.status === 'submitted'
                      ? <button className="btn sm" onClick={() => openBid(vr.rfq_id)}>{viewBid === vr.rfq_id ? 'Hide' : 'View bid'}</button>
                      : <button className="btn sm" onClick={() => remind(vr)} title="Send a fresh link + reminder on WhatsApp">Remind</button>}
                  </div>
                </div>
                {viewBid === vr.rfq_id && (
                  <div style={{ background: 'var(--grey-50)', padding: '8px 14px' }}>
                    {bidItems.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--grey-400)' }}>No items.</div> : bidItems.map((it) => (
                      <div key={it.rfq_item_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '3px 0' }}>
                        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{it.description} <span style={{ color: 'var(--grey-400)' }}>×{it.quantity}</span>{it.item_note ? <span style={{ color: 'var(--grey-400)' }}> · {it.item_note}</span> : ''}</span>
                        <span style={{ whiteSpace: 'nowrap', color: it.can_supply === false ? 'var(--red)' : 'var(--grey-800)' }}>{it.can_supply === false ? "can't supply" : (it.unit_cost != null ? ('₹' + Number(it.unit_cost).toLocaleString('en-IN')) : '—')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ); })}
          </div>}

      {vrfqs.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--grey-400)' }}>{respondedN} of {vrfqs.length} responded</span>
            {vrfqs.some((v) => v.status !== 'submitted') && <button className="btn sm" onClick={remindAll}>Remind all pending</button>}
          </div>
          <button className="btn sm primary" disabled={respondedN === 0} onClick={() => onNavigate && onNavigate('rfqs', { costingRfqId: clientRfq.rfq_id, label: 'Costing & markup' })}>{dealClosed ? 'View costing (read-only) →' : 'Open costing & markup →'}</button>
        </div>
      )}

      {showSend && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) setShowSend(false); }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 460 }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Send vendor RFQ</div>
              <button className="btn sm" onClick={() => setShowSend(false)}>✕</button>
            </div>
            <div style={{ padding: '14px 20px' }}>
              <div style={{ fontSize: 12.5, color: 'var(--grey-400)', marginBottom: 10 }}>Pick vendors to request pricing from — each gets a secure link with the frozen {itemCount}-item list.</div>
              {allVendors.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>
                  No active vendors yet.
                  <div style={{ marginTop: 10 }}><button className="btn sm primary" onClick={() => { setShowSend(false); onNavigate && onNavigate('vendors', { mode: 'new', label: 'New vendor' }); }}>＋ Add a vendor →</button></div>
                  <div style={{ marginTop: 6, fontSize: 11.5 }}>You'll go to Vendors to add one — then use the breadcrumb above to come back here and resume sourcing.</div>
                </div>
                : <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-md)' }}>
                  {allVendors.map((v, i) => (
                    <label key={v.vendor_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: i > 0 ? '1px solid var(--grey-50)' : 'none', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!picked[v.vendor_id]} onChange={(e) => setPicked((p) => ({ ...p, [v.vendor_id]: e.target.checked }))} />
                      <span style={{ fontSize: 13 }}>{v.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--grey-400)', marginLeft: 'auto' }}>{v.phone_1 || v.email_1 || ''}</span>
                    </label>
                  ))}
                </div>}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <button className="btn sm" onClick={() => { setShowSend(false); onNavigate && onNavigate('vendors', { mode: 'new', label: 'New vendor' }); }}>＋ New vendor</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setShowSend(false)}>Cancel</button>
                <button className="btn primary" disabled={sending} onClick={doSend}>{sending ? 'Sending…' : 'Send'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RFQDetail({ rfqId, onBack, onShare, onNavigate }) {
  const [r, setR] = React.useState(null);
  const [items, setItems] = React.useState([]);
  const [activity, setActivity] = React.useState([]);
  const [revisions, setRevisions] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [approving, setApproving] = React.useState(false);
  const [basisRev, setBasisRev] = React.useState(null);   // revision_number used as quote basis (null = latest/current)
  const [cmpA, setCmpA] = React.useState('');
  const [cmpB, setCmpB] = React.useState('');
  const [viewRev, setViewRev] = React.useState(null);
  const [openAct, setOpenAct] = React.useState(0);
  const [dupe, setDupe] = React.useState(null);
  const [eventClosed, setEventClosed] = React.useState(false);   // linked event completed/cancelled → sourcing/costing read-only
  // Item 6 + 7: staff edit mode
  const [editMode, setEditMode] = React.useState(false);
  const [editItems, setEditItems] = React.useState([]);
  const [editFields, setEditFields] = React.useState({});
  const [saving, setSaving] = React.useState(false);
  const [editSaved, setEditSaved] = React.useState(false);
  const [dragIdx, setDragIdx] = React.useState(null);
  // Item 10: selective sourcing panel + vendor picker
  const [selectedItemIds, setSelectedItemIds] = React.useState([]);
  const [showSourcingPanel, setShowSourcingPanel] = React.useState(false);
  const [showVendorPicker, setShowVendorPicker] = React.useState(false);
  const [allVendors, setAllVendors] = React.useState([]);
  const [pickedVendors, setPickedVendors] = React.useState({});
  const [sendingVendors, setSendingVendors] = React.useState(false);
  const [settings, setSettings] = React.useState(null);
  const load = async () => { setLoading(true);
    const [{ data: rfq }, { data: its }, { data: act }] = await Promise.all([
      supabase.from('rfqs').select('*').eq('rfq_id', rfqId).single(),
      supabase.from('rfq_items').select('*').eq('rfq_id', rfqId).eq('is_deleted', false).order('sort_order'),
      supabase.from('rfq_activity').select('*').eq('rfq_id', rfqId).order('created_at', { ascending: false }),
    ]);
    // Revision snapshots (one per client/vendor submission), newest first. Guarded so a
    // missing table never breaks the detail load — revisions just stays empty.
    let revs = [];
    try { const { data: rv } = await supabase.from('rfq_revisions').select('*').eq('rfq_id', rfqId).order('revision_number', { ascending: false }); revs = rv || []; } catch (e) { revs = []; }
    // Self-heal a stale quote pointer: walk forward through the revision chain to the newest quote.
    if (rfq && rfq.quotation_id) {
      let cur = rfq.quotation_id, guard = 0;
      while (guard++ < 25) {
        const { data: child } = await supabase.from('quotations').select('quotation_id').eq('parent_quotation_id', cur).eq('is_deleted', false).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (child && child.quotation_id) cur = child.quotation_id; else break;
      }
      if (cur !== rfq.quotation_id) { try { await supabase.from('rfqs').update({ quotation_id: cur, updated_at: new Date().toISOString() }).eq('rfq_id', rfqId); } catch (e) { /* noop */ } rfq.quotation_id = cur; }
    }
    // Is the deal closed? (linked event completed/cancelled) → sourcing + costing go read-only.
    let evClosed = false;
    if (rfq && rfq.quotation_id) {
      try {
        const { data: q } = await supabase.from('quotations').select('event_id').eq('quotation_id', rfq.quotation_id).maybeSingle();
        if (q && q.event_id) { const { data: ev } = await supabase.from('events').select('status').eq('event_id', q.event_id).maybeSingle(); evClosed = !!(ev && ['completed', 'cancelled'].includes((ev.status || '').toLowerCase())); }
      } catch (e) { evClosed = false; }
    }
    setEventClosed(evClosed);
    setR(rfq || null); setItems(its || []); setActivity(act || []); setRevisions(revs); setLoading(false);
  };
  React.useEffect(() => { load(); }, [rfqId]);
  // Load vendors + settings for selective sourcing panel (Item 10)
  React.useEffect(() => {
    (async () => {
      const [vRes, sRes] = await Promise.all([
        supabase.from('vendors').select('vendor_id,name,contact_person,phone_1,email_1,status').eq('is_deleted', false).order('name'),
        supabase.from('settings').select('company_name,default_markup_pct').limit(1).maybeSingle(),
      ]);
      setAllVendors((vRes.data || []).filter((v) => v.status === 'active'));
      setSettings(sRes.data || null);
    })();
  }, [rfqId]);
  const regenerate = async () => {
    if (!window.confirm('Generate a NEW link & PIN? The previous link will stop working.')) return;
    const token = genRfqToken(), pin = (r.access_mode === 'email_otp') ? null : genRfqPin();
    const { error } = await runDb(supabase.from('rfqs').update({ token_hash: await sha256Hex(token), access_pin_hash: pin ? await sha256Hex(pin) : null, token_expires_at: new Date(Date.now() + 21 * 24 * 3600 * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('rfq_id', rfqId), 'regenerate link');
    if (error) return;
    onShare({ ref_number: r.ref_number, token, pin }, { name: r.contact_name, phone: r.contact_phone });
  };
  const requestChanges = async () => {
    const note = window.prompt('What should the client change? (optional — shown to them)', '');
    if (note === null) return;
    const uid = await _currentUid();
    const { error } = await runDb(supabase.from('rfqs').update({ status: 'changes_requested', updated_at: new Date().toISOString() }).eq('rfq_id', rfqId), 'request changes');
    if (error) return;
    try { await supabase.from('rfq_activity').insert({ rfq_id: rfqId, actor: uid || 'staff', action: 'changes_requested', notes: note || null }); } catch (e) { /* noop */ }
    notify('Sent back to the client — their link reopens for edits.', 'success'); load();
  };
  const doApprove = async (basisItems, forced) => {
    setDupe(null); setApproving(true);
    try { const q = await approveRfqToQuote(r, basisItems, forced); notify('Approved — draft quote ' + q.ref_number + ' created.', 'success'); onNavigate && onNavigate('quotations', { quotId: q.quotation_id, label: q.ref_number }); }
    catch (e) { /* runDb toasted */ }
    setApproving(false);
  };
  const approve = async () => {
    const basisItems = (basisRev != null) ? ((revisions.find((x) => x.revision_number === basisRev) || {}).snapshot || {}).items || items : items;
    if (!basisItems || basisItems.length === 0) { if (!window.confirm('This RFQ has no items. Create an empty draft quote anyway?')) return; }
    if (!r.client_id) {
      const match = await findClientMatch(r);
      if (match) { setDupe({ match, items: basisItems }); return; }   // staff decides via the modal
    }
    if (!window.confirm('Approve and create a draft quote' + (basisRev != null ? (' from revision ' + basisRev) : '') + '?\n\nThis creates the client and opens the quote for you to price.')) return;
    doApprove(basisItems, null);
  };

  // Item 6A: start edit mode for submitted RFQ
  const startEdit = () => {
    setEditItems(items.map((it, idx) => ({ ...it, _tmpId: idx })));
    setEditFields({ event_date: r.event_date || '', location: r.location || '', city: r.city || '', guest_count: r.guest_count != null ? String(r.guest_count) : '', notes: r.notes || '' });
    setEditMode(true);
    setEditSaved(false);
  };
  const setEF = (k, v) => setEditFields((f) => ({ ...f, [k]: v }));
  const setEI = (idx, k, v) => setEditItems((arr) => arr.map((it, i) => i === idx ? { ...it, [k]: v } : it));
  // Sub-item helpers
  const setSI = (itemIdx, siIdx, k, v) => setEditItems((arr) => arr.map((it, i) => i !== itemIdx ? it : { ...it, sub_items: (it.sub_items || []).map((si, j) => j === siIdx ? { ...si, [k]: v } : si) }));
  const addSI = (itemIdx) => setEditItems((arr) => arr.map((it, i) => i !== itemIdx ? it : { ...it, sub_items: [...(it.sub_items || []), { name: '', qty: 0, note: '' }] }));
  const removeSI = (itemIdx, siIdx) => setEditItems((arr) => arr.map((it, i) => i !== itemIdx ? it : { ...it, sub_items: (it.sub_items || []).filter((_, j) => j !== siIdx) }));
  const moveSIUp = (itemIdx, siIdx) => { if (siIdx === 0) return; setEditItems((arr) => arr.map((it, i) => { if (i !== itemIdx) return it; const sis = [...(it.sub_items || [])]; [sis[siIdx - 1], sis[siIdx]] = [sis[siIdx], sis[siIdx - 1]]; return { ...it, sub_items: sis }; })); };
  const moveSIDown = (itemIdx, siIdx) => setEditItems((arr) => arr.map((it, i) => { if (i !== itemIdx) return it; const sis = [...(it.sub_items || [])]; if (siIdx >= sis.length - 1) return it; [sis[siIdx], sis[siIdx + 1]] = [sis[siIdx + 1], sis[siIdx]]; return { ...it, sub_items: sis }; }));
  const moveSIToItem = (fromIdx, siIdx, toIdx) => setEditItems((arr) => { const r = arr.map((it) => ({ ...it, sub_items: [...(it.sub_items || [])] })); const [si] = r[fromIdx].sub_items.splice(siIdx, 1); r[toIdx].sub_items.push(si); return r; });
  const copyItem = (itemIdx) => setEditItems((arr) => { const it = arr[itemIdx]; const cp = { ...it, _tmpId: Date.now(), sub_items: (it.sub_items || []).map((si) => ({ ...si })) }; const next = [...arr]; next.splice(itemIdx + 1, 0, cp); return next; });

  // Item 6A: save staff edits
  const saveEdits = async () => {
    setSaving(true);
    const uid = await _currentUid();
    const newRevNum = (r.revision_number || 1) + 1;
    // 1. Update rfqs schedule fields + bump revision
    const { error: rfqErr } = await runDb(supabase.from('rfqs').update({
      event_date: editFields.event_date || null,
      location: editFields.location || null,
      city: editFields.city || null,
      guest_count: editFields.guest_count ? parseInt(editFields.guest_count, 10) : null,
      notes: editFields.notes || null,
      revision_number: newRevNum,
      updated_at: new Date().toISOString(),
    }).eq('rfq_id', rfqId), 'save edits');
    if (rfqErr) { setSaving(false); return; }
    // 2. Soft-delete old items and re-insert
    await runDb(supabase.from('rfq_items').update({ is_deleted: true }).eq('rfq_id', rfqId).eq('is_deleted', false), 'delete items');
    const newItems = editItems.map((it, idx) => ({
      rfq_id: rfqId,
      sub_event_name: it.sub_event_name || null,
      description: it.description || '',
      quantity: parseFloat(it.quantity) || 1,
      sort_order: idx,
      source: it.source || 'custom',
      sub_items: (it.sub_items || []).filter((si) => si && String(si.name || '').trim()),
    }));
    if (newItems.length > 0) await runDb(supabase.from('rfq_items').insert(newItems), 'insert items');
    // 3. Log activity
    try { await supabase.from('rfq_activity').insert({ rfq_id: rfqId, actor: uid || 'staff', action: 'staff_edited', notes: 'Revision ' + newRevNum }); } catch (e) { /* noop */ }
    notify('Changes saved — revision ' + newRevNum, 'success');
    setSaving(false);
    setEditSaved(true);
    setEditMode(false);
    load();
  };

  // Item 6B: request client confirmation via WhatsApp
  const requestConfirmation = async () => {
    const uid = await _currentUid();
    // Regenerate a fresh token so we have the plaintext to build the link
    const newToken = genRfqToken();
    const newPin = (r.access_mode === 'email_otp') ? null : genRfqPin();
    const { error } = await runDb(supabase.from('rfqs').update({
      confirmation_status: 'pending',
      confirmation_requested_at: new Date().toISOString(),
      token_hash: await sha256Hex(newToken),
      access_pin_hash: newPin ? await sha256Hex(newPin) : null,
      token_expires_at: new Date(Date.now() + 21 * 24 * 3600 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('rfq_id', rfqId), 'request confirmation');
    if (error) return;
    try { await supabase.from('rfq_activity').insert({ rfq_id: rfqId, actor: uid || 'staff', action: 'confirmation_requested', notes: null }); } catch (e) { /* noop */ }
    // Open WhatsApp with the fresh link
    const contactName = r.contact_name || 'there';
    const link = rfqLink(newToken);
    const msg = 'Hi ' + contactName + ', we\'ve updated your event requirements (' + r.ref_number + '). Please review and confirm:\n' + link + (newPin ? '\n\nAccess PIN: ' + newPin : '');
    window.open(waLink(r.contact_phone, msg), '_blank');
    notify('Confirmation request sent — fresh link generated.', 'success');
    load();
  };

  // Item 7: drag-and-drop reorder handlers
  const onDragStart = (idx) => setDragIdx(idx);
  const onDragOver = (e) => e.preventDefault();
  const onDrop = (targetIdx) => {
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); return; }
    const arr = [...editItems];
    const [moved] = arr.splice(dragIdx, 1);
    arr.splice(targetIdx, 0, moved);
    setEditItems(arr.map((it, i) => ({ ...it, sort_order: i })));
    setDragIdx(null);
  };
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>;
  if (!r) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--grey-400)' }}>RFQ not found.</div>;
  const sc = RFQ_STATUS[r.status] || RFQ_STATUS.sent;
  const subs = Array.isArray(r.sub_events) ? r.sub_events : [];
  const canApprove = ['submitted', 'changes_requested'].includes(r.status);
  const groups = rfqItemsGrouped(items);
  const actGroups = (() => { const asc = [...activity].reverse(); const gs = []; let buf = []; asc.forEach((a) => { buf.push(a); if (a.action === 'submitted') { gs.push({ label: (a.notes && /Revision/i.test(a.notes)) ? a.notes : 'Submitted', entries: buf }); buf = []; } }); if (buf.length) gs.push({ label: 'In progress', entries: buf }); return gs.reverse(); })();
  return (
    <div>
      {dupe && (() => { const m = dupe.match; const mnm = ((m.first_name || '') + ' ' + (m.last_name || '')).trim(); return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={() => setDupe(null)}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', maxWidth: 440, padding: '20px 22px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 8 }}>An existing client matches this contact</div>
            <div style={{ fontSize: 13, color: 'var(--grey-600)', lineHeight: 1.6, marginBottom: 6 }}>This RFQ is for <b>{r.contact_name || '—'}</b> ({r.contact_phone || r.contact_email || 'no contact'}).</div>
            <div style={{ fontSize: 13, color: 'var(--grey-600)', lineHeight: 1.6, background: 'var(--grey-50)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', marginBottom: 6 }}>Matched by phone/email: <b>{mnm || '(unnamed client)'}</b> · {m.phone_1 || m.email_1 || ''}</div>
            <div style={{ fontSize: 12, color: 'var(--grey-400)', marginBottom: 16 }}>Same person? Link them. A different person who happens to share a number? Create a new client.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn primary" disabled={approving} onClick={() => doApprove(dupe.items, { client_id: m.client_id, client_name: mnm })}>🔗 Link to {mnm || 'existing client'}</button>
              <button className="btn" disabled={approving} onClick={() => doApprove(dupe.items, null)}>＋ Create a new client ({(r.contact_name || 'this contact').trim()})</button>
              <button className="btn" disabled={approving} style={{ color: 'var(--grey-400)' }} onClick={() => setDupe(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ); })()}
      {/* Item 10: vendor picker modal for selective sourcing */}
      {showVendorPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) setShowVendorPicker(false); }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 460 }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>Send vendor RFQ</div>
                <div style={{ fontSize: 12, color: 'var(--grey-400)', marginTop: 2 }}>{selectedItemIds.length} item{selectedItemIds.length === 1 ? '' : 's'} selected</div>
              </div>
              <button className="btn sm" onClick={() => setShowVendorPicker(false)}>✕</button>
            </div>
            <div style={{ padding: '14px 20px' }}>
              <div style={{ fontSize: 12.5, color: 'var(--grey-400)', marginBottom: 10 }}>Pick vendors — each gets a secure link with only the {selectedItemIds.length} selected items.</div>
              {allVendors.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>No active vendors yet. <button className="btn sm primary" style={{ marginTop: 8 }} onClick={() => { setShowVendorPicker(false); onNavigate && onNavigate('vendors', { mode: 'new', label: 'New vendor' }); }}>＋ Add a vendor →</button></div>
                : <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-md)' }}>
                  {allVendors.map((v, i) => (
                    <label key={v.vendor_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: i > 0 ? '1px solid var(--grey-50)' : 'none', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!pickedVendors[v.vendor_id]} onChange={(e) => setPickedVendors((p) => ({ ...p, [v.vendor_id]: e.target.checked }))} />
                      <span style={{ fontSize: 13 }}>{v.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--grey-400)', marginLeft: 'auto' }}>{v.phone_1 || v.email_1 || ''}</span>
                    </label>
                  ))}
                </div>}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setShowVendorPicker(false)}>Cancel</button>
              <button className="btn primary" disabled={sendingVendors || !Object.values(pickedVendors).some(Boolean)} onClick={async () => {
                const chosen = allVendors.filter((v) => pickedVendors[v.vendor_id]);
                if (!chosen.length) { notify('Pick at least one vendor.', 'error'); return; }
                setSendingVendors(true);
                try {
                  const selectedItems = items.filter((it) => selectedItemIds.includes(it.rfq_item_id));
                  const created = await createVendorRfqs(r, chosen, selectedItems);
                  setShowVendorPicker(false); setPickedVendors({});
                  notify('Sent ' + created.length + ' vendor RFQ' + (created.length > 1 ? 's' : '') + ' with ' + selectedItemIds.length + ' items.', 'success');
                } catch (e) { /* toasted */ }
                setSendingVendors(false);
              }}>{sendingVendors ? 'Sending…' : 'Send'}</button>
            </div>
          </div>
        </div>
      )}

      {viewRev && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={() => setViewRev(null)}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', maxWidth: 480, width: '100%', maxHeight: '80vh', overflowY: 'auto', padding: '20px 22px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 4 }}>Revision v{viewRev.revision_number}</div>
            <div style={{ fontSize: 12, color: 'var(--grey-400)', marginBottom: 12 }}>Submitted by {viewRev.submitted_by || 'client'} · {fmtDate(viewRev.submitted_at || viewRev.created_at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            {(() => { const g = rfqItemsGrouped((viewRev.snapshot || {}).items || []); const keys = Object.keys(g); return keys.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>No items in this revision.</div> : keys.map((k) => (
              <div key={k} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: 'var(--gold)', marginBottom: 4 }}>{k.toUpperCase()}</div>
                {g[k].map((it, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '3px 0' }}><span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{it.description}</span><span style={{ color: 'var(--grey-400)', whiteSpace: 'nowrap' }}>×{it.quantity}</span></div>)}
              </div>
            )); })()}
            <div style={{ marginTop: 12, textAlign: 'right' }}><button className="btn sm" onClick={() => setViewRev(null)}>Close</button></div>
          </div>
        </div>
      )}
      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: '18px 22px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--grey-800)' }}>{r.ref_number} <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 500, background: sc.bg, color: sc.c, marginLeft: 6 }}>{sc.l}</span>{(r.revision_number || 0) > 1 && <span title={'Revised ' + r.revision_number + '× by the ' + (r.party_type === 'vendor' ? 'vendor' : 'client')} style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 600, background: 'var(--orange-light)', color: 'var(--orange)', marginLeft: 6 }}>🔄 Rev {r.revision_number}</span>}</div>
            <div style={{ fontSize: 13, color: 'var(--grey-400)', marginTop: 3 }}>{r.contact_name || '—'}{r.contact_phone ? (' · ' + r.contact_phone) : ''}{r.event_type ? (' · ' + r.event_type) : ''}{r.city ? (' · ' + r.city) : ''}</div>
            {(r.secondary_contact_name || r.secondary_contact_phone) && <div style={{ fontSize: 12, color: 'var(--grey-400)', marginTop: 2 }}>2nd contact: {r.secondary_contact_name || ''} {r.secondary_contact_phone || ''}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {canApprove && revisions.length > 1 && <select className="field-input" style={{ width: 150, fontSize: 12, padding: '6px 8px' }} value={basisRev == null ? '' : String(basisRev)} onChange={(e) => setBasisRev(e.target.value === '' ? null : parseInt(e.target.value, 10))} title="Which version to quote">
              <option value="">Latest (v{r.revision_number || revisions[0].revision_number})</option>
              {revisions.map((rv) => <option key={rv.revision_id} value={rv.revision_number}>Use v{rv.revision_number}</option>)}
            </select>}
            {canApprove && r.confirmation_status !== 'pending' && <button className="btn sm" style={{ background: 'var(--green-light)', color: 'var(--green)', borderColor: '#86EFAC' }} disabled={approving} onClick={approve}>{approving ? 'Approving…' : '✅ Approve → create quote'}</button>}
            {canApprove && r.confirmation_status === 'pending' && <button className="btn sm" style={{ background: 'var(--orange-light)', color: 'var(--orange)', borderColor: '#FCD34D' }} disabled={approving} onClick={approve}>{approving ? 'Approving…' : '✅ Approve anyway (verbal)'}</button>}
            {r.status === 'submitted' && !editMode && <button className="btn sm" onClick={startEdit}>✏️ Edit</button>}
            {r.status === 'submitted' && <button className="btn sm" style={{ color: 'var(--red)', borderColor: 'rgba(163,45,45,0.3)' }} onClick={requestChanges}>↩ Request changes</button>}
            {editSaved && r.status === 'submitted' && <button className="btn sm" style={{ background: 'var(--green-light)', color: 'var(--green)', borderColor: '#86EFAC' }} onClick={requestConfirmation}>📲 Request Confirmation</button>}
            {r.lead_id && <button className="btn sm" title="Open the source lead" onClick={() => onNavigate && onNavigate('leads', { leadId: r.lead_id, label: r.contact_name || 'Lead' })}>🎯 View lead →</button>}
            {r.client_id && <button className="btn sm" title="Open the client 360" onClick={() => onNavigate && onNavigate('clients', { clientId: r.client_id, label: r.contact_name || 'Client' })}>👤 View client →</button>}
            {r.quotation_id && <button className="btn sm" onClick={() => onNavigate && onNavigate('quotations', { quotId: r.quotation_id, label: 'Quote' })}>📄 Go to quote →</button>}
            {!eventClosed && !['withdrawn', 'expired'].includes(r.status) && <button className="btn sm" onClick={regenerate}>🔗 Regenerate link & PIN</button>}
          </div>
        </div>
        {subs.length > 0 && (
          <div style={{ marginTop: 10, background: 'var(--grey-50)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', color: 'var(--gold)', marginBottom: 6 }}>SCHEDULE</div>
            {subs.map((s, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.4fr', gap: 8, fontSize: 12.5, color: 'var(--grey-700)', padding: '4px 0', borderTop: i ? '1px solid var(--grey-100)' : 'none' }}>
                <span>{s.name}</span>
                <span style={{ color: 'var(--grey-500)' }}>{s.planned_date ? fmtDate(s.planned_date, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span>
                <span style={{ color: s.venue ? 'var(--grey-700)' : 'var(--grey-400)' }}>{s.venue ? ('📍 ' + s.venue) : 'TBD'}</span>
              </div>
            ))}
          </div>
        )}
        {r.notes && <div style={{ fontSize: 13, color: 'var(--grey-700)', marginTop: 10, background: 'var(--grey-50)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', overflowWrap: 'anywhere', wordBreak: 'break-word' }}><b style={{ color: 'var(--grey-800)' }}>Notes:</b> {r.notes}</div>}
      </div>

      {/* Item 6C: Confirmation status banner */}
      {r.confirmation_status === 'pending' && (
        <div style={{ background: '#FFFBEB', border: '1.5px solid #F59E0B', borderRadius: 'var(--radius-lg)', padding: '12px 16px', marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#92400E' }}>⏳ Waiting for client to confirm the revised requirements.</span>
          <span style={{ fontSize: 12, color: '#78350F', marginLeft: 8 }}>You can still approve — use "Approve anyway (verbal)" above.</span>
        </div>
      )}
      {r.confirmation_status === 'confirmed' && (
        <div style={{ background: '#ECFDF5', border: '1.5px solid #34D399', borderRadius: 'var(--radius-lg)', padding: '12px 16px', marginBottom: 16, fontSize: 13, fontWeight: 600, color: '#065F46' }}>
          ✅ Client confirmed the revisions.
        </div>
      )}
      {r.confirmation_status === 'declined' && (
        <div style={{ background: '#FEF2F2', border: '1.5px solid #FCA5A5', borderRadius: 'var(--radius-lg)', padding: '12px 16px', marginBottom: 16, fontSize: 13, fontWeight: 600, color: '#991B1B' }}>
          ❌ Client declined the revisions — please review.{r.client_confirm_note ? (' Note: ' + r.client_confirm_note) : ''}
        </div>
      )}

      {/* Requested items — with staff edit mode (Item 6A+7) */}
      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: editMode ? '2px solid var(--pink)' : '1px solid var(--grey-100)', padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)' }}>Requested items {items.length > 0 ? ('(' + items.length + ')') : ''}</div>
          {editMode && <span style={{ fontSize: 11, color: 'var(--pink)', fontWeight: 600 }}>✏️ Edit mode — drag ⠿ to reorder</span>}
        </div>

        {editMode ? (
          <div>
            {/* Schedule fields */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px 12px', marginBottom: 12, padding: '10px 12px', background: 'var(--grey-50)', borderRadius: 'var(--radius-md)' }}>
              <div><label className="field-label">Event date</label><input className="field-input" type="date" value={editFields.event_date || ''} onChange={(e) => setEF('event_date', e.target.value)} /></div>
              <div><label className="field-label">Location / Venue</label><input className="field-input" value={editFields.location || ''} onChange={(e) => setEF('location', e.target.value)} /></div>
              <div><label className="field-label">City</label><input className="field-input" value={editFields.city || ''} onChange={(e) => setEF('city', e.target.value)} /></div>
              <div><label className="field-label">Guest count</label><input className="field-input" type="number" value={editFields.guest_count || ''} onChange={(e) => setEF('guest_count', e.target.value)} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label className="field-label">Notes</label><textarea className="field-input" rows={2} value={editFields.notes || ''} onChange={(e) => setEF('notes', e.target.value)} style={{ resize: 'vertical' }} /></div>
            </div>
            {/* Item 7: draggable item rows with sub-items */}
            {editItems.map((it, idx) => (
              <div key={it._tmpId !== undefined ? it._tmpId : idx}
                style={{ marginBottom: 8, border: dragIdx === idx ? '1.5px dashed var(--pink)' : '1px solid var(--grey-150)', borderRadius: 'var(--radius-sm)', background: dragIdx === idx ? 'var(--grey-50)' : 'white', overflow: 'hidden' }}>
                {/* Item header row — draggable */}
                <div
                  draggable
                  onDragStart={() => onDragStart(idx)}
                  onDragOver={onDragOver}
                  onDrop={() => onDrop(idx)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'grab' }}>
                  <span title="Drag to reorder item (moves with all its details)" style={{ fontSize: 16, color: 'var(--grey-300)', cursor: 'grab', userSelect: 'none' }}>⠿</span>
                  <input className="field-input" style={{ flex: 2, fontSize: 12, padding: '4px 8px' }} value={it.description || ''} placeholder="Description" onChange={(e) => setEI(idx, 'description', e.target.value)} />
                  <input className="field-input" style={{ width: 60, fontSize: 12, padding: '4px 8px' }} type="number" value={it.quantity || 1} min={1} onChange={(e) => setEI(idx, 'quantity', e.target.value)} />
                  <input className="field-input" style={{ width: 110, fontSize: 12, padding: '4px 8px' }} value={it.sub_event_name || ''} placeholder="Function" onChange={(e) => setEI(idx, 'sub_event_name', e.target.value)} />
                  <button className="btn sm" title="Duplicate item with all its details" style={{ color: 'var(--grey-400)', flexShrink: 0, padding: '2px 7px', fontSize: 13 }} onClick={() => copyItem(idx)}>⧉</button>
                  <button className="btn sm" style={{ color: 'var(--red)', flexShrink: 0 }} onClick={() => setEditItems((arr) => arr.filter((_, i) => i !== idx))}>✕</button>
                </div>
                {/* Sub-item rows */}
                {(it.sub_items || []).map((si, siIdx) => (
                  <div key={siIdx} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px 3px 26px', borderTop: '1px solid var(--grey-50)', background: '#FAFAFA' }}>
                    <span style={{ color: 'var(--grey-300)', fontSize: 11, flexShrink: 0 }}>↳</span>
                    <input className="field-input" style={{ flex: 2, fontSize: 11, padding: '2px 6px' }} value={si.name || ''} placeholder="Detail name" onChange={(e) => setSI(idx, siIdx, 'name', e.target.value)} />
                    <input className="field-input" style={{ width: 46, fontSize: 11, padding: '2px 6px' }} type="number" value={si.qty ?? 0} min={0} onChange={(e) => setSI(idx, siIdx, 'qty', Math.max(0, parseFloat(e.target.value) || 0))} />
                    <input className="field-input" style={{ width: 84, fontSize: 11, padding: '2px 6px' }} value={si.note || ''} placeholder="Note" onChange={(e) => setSI(idx, siIdx, 'note', e.target.value)} />
                    <select
                      title="Move to a different item"
                      style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--grey-200)', borderRadius: 4, color: 'var(--grey-400)', background: 'white', cursor: 'pointer', flexShrink: 0 }}
                      value=""
                      onChange={(e) => { const toIdx = parseInt(e.target.value, 10); if (!isNaN(toIdx)) moveSIToItem(idx, siIdx, toIdx); }}>
                      <option value="">⇄</option>
                      {editItems.map((other, oIdx) => oIdx !== idx
                        ? <option key={oIdx} value={oIdx}>{other.description ? other.description.substring(0, 22) : ('Item ' + (oIdx + 1))}</option>
                        : null)}
                    </select>
                    <button className="btn sm" title="Move up" style={{ padding: '1px 5px', fontSize: 10, flexShrink: 0 }} onClick={() => moveSIUp(idx, siIdx)} disabled={siIdx === 0}>↑</button>
                    <button className="btn sm" title="Move down" style={{ padding: '1px 5px', fontSize: 10, flexShrink: 0 }} onClick={() => moveSIDown(idx, siIdx)} disabled={siIdx === (it.sub_items || []).length - 1}>↓</button>
                    <button className="btn sm" style={{ color: 'var(--red)', padding: '1px 5px', flexShrink: 0 }} onClick={() => removeSI(idx, siIdx)}>✕</button>
                  </div>
                ))}
                {/* Add detail link */}
                <div style={{ padding: '3px 8px 5px 26px', borderTop: '1px solid var(--grey-50)', background: '#FAFAFA' }}>
                  <button style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--grey-400)', cursor: 'pointer', padding: 0 }} onClick={() => addSI(idx)}>＋ add detail</button>
                </div>
              </div>
            ))}
            <button className="btn sm" style={{ marginTop: 4 }} onClick={() => setEditItems((arr) => [...arr, { _tmpId: Date.now(), description: '', quantity: 1, sub_event_name: arr.length > 0 ? arr[arr.length - 1].sub_event_name : '', source: 'custom', sort_order: arr.length, sub_items: [] }])}>+ Add item</button>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => { setEditMode(false); }}>Cancel</button>
              <button className="btn primary" disabled={saving} onClick={saveEdits}>{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </div>
        ) : (
          items.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>Nothing submitted yet — the client hasn't added items.</div>
          : Object.keys(groups).map((k) => (
            <div key={k} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: 'var(--gold)', marginBottom: 4 }}>{k.toUpperCase()}</div>
              {groups[k].map((it) => (
                <div key={it.rfq_item_id} style={{ padding: '3px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, fontSize: 13 }}>
                    <span style={{ overflowWrap: 'anywhere', wordBreak: 'break-word', minWidth: 0 }}>{it.description}</span>
                    <span style={{ color: 'var(--grey-400)', whiteSpace: 'nowrap' }}>×{it.quantity}</span>
                  </div>
                  {Array.isArray(it.sub_items) && it.sub_items.length > 0 && (
                    <div style={{ paddingLeft: 12, marginTop: 2 }}>
                      {it.sub_items.map((si, si_i) => (
                        <div key={si_i} style={{ fontSize: 12, color: 'var(--grey-400)', lineHeight: 1.5 }}>
                          • {si.name}{si.qty > 0 ? ' × ' + si.qty : ''}{si.note ? <span> ({si.note})</span> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Revision history + diff — one snapshot per client/vendor submission. */}
      {revisions.length > 0 && (
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 6 }}>Revision history ({revisions.length})</div>
          <div>
            {revisions.map((rv) => { const n = ((rv.snapshot && rv.snapshot.items) || []).length; return (
              <div key={rv.revision_id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '7px 0', borderTop: '1px solid var(--grey-100)' }}>
                <span style={{ fontWeight: 600, color: 'var(--grey-800)', width: 44 }}>v{rv.revision_number}</span>
                <span style={{ flex: 1, color: 'var(--grey-600)' }}>by {rv.submitted_by || 'client'} · {n} item{n === 1 ? '' : 's'}</span>
                <span style={{ color: 'var(--grey-400)', fontSize: 12 }}>{fmtDate(rv.submitted_at || rv.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                <button className="btn sm" onClick={() => setViewRev(rv)}>View</button>
              </div>
            ); })}
          </div>
          {revisions.length > 1 && (() => {
            const a = cmpA || String(revisions[1].revision_number);
            const b = cmpB || String(revisions[0].revision_number);
            const ra = revisions.find((x) => String(x.revision_number) === a);
            const rb = revisions.find((x) => String(x.revision_number) === b);
            const d = (ra && rb) ? diffRevItems((ra.snapshot || {}).items, (rb.snapshot || {}).items) : { added: [], removed: [], changed: [] };
            return (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--grey-100)', paddingTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--grey-600)', marginBottom: 8 }}>
                  <span>Compare</span>
                  <select className="field-input" style={{ width: 80, fontSize: 12, padding: '4px 6px' }} value={a} onChange={(e) => setCmpA(e.target.value)}>{revisions.map((x) => <option key={x.revision_id} value={x.revision_number}>v{x.revision_number}</option>)}</select>
                  <span>→</span>
                  <select className="field-input" style={{ width: 80, fontSize: 12, padding: '4px 6px' }} value={b} onChange={(e) => setCmpB(e.target.value)}>{revisions.map((x) => <option key={x.revision_id} value={x.revision_number}>v{x.revision_number}</option>)}</select>
                </div>
                {(d.added.length + d.removed.length + d.changed.length) === 0
                  ? <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>No item differences between these versions.</div>
                  : <div style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {d.added.map((it, i) => <div key={'a' + i} style={{ color: 'var(--green)' }}>+ {it.description} ×{it.quantity}</div>)}
                      {d.removed.map((it, i) => <div key={'r' + i} style={{ color: 'var(--red)' }}>− {it.description} ×{it.quantity}</div>)}
                      {d.changed.map((c, i) => <div key={'c' + i} style={{ color: 'var(--orange)' }}>~ {c.to.description}: ×{c.from.quantity} → ×{c.to.quantity}</div>)}
                    </div>}
              </div>
            );
          })()}
        </div>
      )}

      {/* Item 10: Selective Sourcing Panel — visible when submitted or approved */}
      {r.party_type !== 'vendor' && ['submitted', 'approved', 'converted'].includes(r.status) && items.length > 0 && (
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)' }}>🎯 Source vendors</div>
              <div style={{ fontSize: 12, color: 'var(--grey-400)', marginTop: 2 }}>{selectedItemIds.length} of {items.length} item{items.length === 1 ? '' : 's'} selected</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn sm" onClick={() => setSelectedItemIds(items.map((it) => it.rfq_item_id))}>Select all</button>
              <button className="btn sm" onClick={() => setSelectedItemIds([])}>Deselect all</button>
              <button className="btn sm" onClick={() => setShowSourcingPanel((v) => !v)}>{showSourcingPanel ? 'Hide ▲' : 'Show ▼'}</button>
            </div>
          </div>
          {showSourcingPanel && (
            <div>
              {Object.keys(groups).map((grp) => (
                <div key={grp} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: 'var(--gold)' }}>{grp.toUpperCase()}</div>
                    <button className="btn sm" style={{ fontSize: 10, padding: '1px 8px' }} onClick={() => {
                      const grpIds = groups[grp].map((it) => it.rfq_item_id);
                      const allSelected = grpIds.every((id) => selectedItemIds.includes(id));
                      setSelectedItemIds((prev) => allSelected ? prev.filter((id) => !grpIds.includes(id)) : [...new Set([...prev, ...grpIds])]);
                    }}>
                      {groups[grp].every((it) => selectedItemIds.includes(it.rfq_item_id)) ? 'Deselect function' : 'Select function'}
                    </button>
                  </div>
                  {groups[grp].map((it) => (
                    <label key={it.rfq_item_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={selectedItemIds.includes(it.rfq_item_id)} onChange={(e) => setSelectedItemIds((prev) => e.target.checked ? [...prev, it.rfq_item_id] : prev.filter((id) => id !== it.rfq_item_id))} />
                      <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{it.description}</span>
                      <span style={{ color: 'var(--grey-400)', whiteSpace: 'nowrap' }}>×{it.quantity}</span>
                    </label>
                  ))}
                </div>
              ))}
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn sm primary" disabled={selectedItemIds.length === 0} onClick={() => { setPickedVendors({}); setShowVendorPicker(true); }}>
                  Create vendor RFQ ({selectedItemIds.length} item{selectedItemIds.length === 1 ? '' : 's'})
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sourcing — vendor RFQs (Milestone S, S2b). Appears once the client RFQ is approved.
          Behind VITE_ENABLE_VENDOR_RFQ so the in-progress feature stays hidden in prod until the
          full loop (S1 migration + gateway + portal + costing) ships. On locally for testing. */}
      {(import.meta.env && import.meta.env.VITE_ENABLE_VENDOR_RFQ === 'true') && r.party_type !== 'vendor' && r.status === 'converted' && <SourcingPanel clientRfq={r} itemCount={items.length} onNavigate={onNavigate} dealClosed={eventClosed} />}

      {/* Revisions */}
      {revisions.length > 0 && <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 10 }}>Revisions ({revisions.length})</div>
        {revisions.map((rv) => (
          <div key={rv.revision_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--grey-50)', fontSize: 13 }}>
            <span style={{ fontWeight: 500, color: 'var(--grey-800)', width: 46 }}>v{rv.revision_number}</span>
            <span style={{ flex: 1, color: 'var(--grey-400)' }}>{fmtDate(rv.submitted_at, { day: 'numeric', month: 'short', year: 'numeric' })} · {((rv.snapshot || {}).items || []).length} items</span>
            <button className="btn sm" onClick={() => setViewRev(viewRev === rv.revision_number ? null : rv.revision_number)}>{viewRev === rv.revision_number ? 'Hide' : 'View'}</button>
          </div>
        ))}
        {viewRev != null && (() => { const rv = revisions.find((x) => x.revision_number === viewRev); const g = rfqItemsGrouped((rv.snapshot || {}).items); return (
          <div style={{ marginTop: 10, background: 'var(--grey-50)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
            {Object.keys(g).map((k) => (<div key={k} style={{ marginBottom: 6 }}><div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold)' }}>{k.toUpperCase()}</div>{g[k].map((it, i) => (<div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}><span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{it.description}</span><span style={{ color: 'var(--grey-400)' }}>×{it.quantity}</span></div>))}</div>))}
          </div>
        ); })()}
        {revisions.length > 1 && <div style={{ marginTop: 12, borderTop: '1px solid var(--grey-100)', paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--grey-600)', marginBottom: 6 }}>Compare</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="field-input" style={{ width: 90, fontSize: 12, padding: '5px 8px' }} value={cmpA} onChange={(e) => setCmpA(e.target.value)}><option value="">From…</option>{revisions.map((rv) => <option key={rv.revision_id} value={rv.revision_number}>v{rv.revision_number}</option>)}</select>
            <span style={{ color: 'var(--grey-400)' }}>→</span>
            <select className="field-input" style={{ width: 90, fontSize: 12, padding: '5px 8px' }} value={cmpB} onChange={(e) => setCmpB(e.target.value)}><option value="">To…</option>{revisions.map((rv) => <option key={rv.revision_id} value={rv.revision_number}>v{rv.revision_number}</option>)}</select>
          </div>
          {cmpA && cmpB && cmpA !== cmpB && (() => { const a = (revisions.find((x) => String(x.revision_number) === cmpA) || {}).snapshot || {}; const b = (revisions.find((x) => String(x.revision_number) === cmpB) || {}).snapshot || {}; const d = diffRevItems(a.items, b.items); return (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              {d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0 && <div style={{ color: 'var(--grey-400)' }}>No item differences.</div>}
              {d.added.map((it, i) => <div key={'a' + i} style={{ color: 'var(--green)' }}>+ {it.sub_event_name ? it.sub_event_name + ' · ' : ''}{it.description} ×{it.quantity}</div>)}
              {d.removed.map((it, i) => <div key={'r' + i} style={{ color: 'var(--red)' }}>− {it.sub_event_name ? it.sub_event_name + ' · ' : ''}{it.description} ×{it.quantity}</div>)}
              {d.changed.map((c, i) => <div key={'c' + i} style={{ color: '#854F0B' }}>~ {c.to.sub_event_name ? c.to.sub_event_name + ' · ' : ''}{c.to.description}: ×{c.from.quantity} → ×{c.to.quantity}</div>)}
            </div>
          ); })()}
        </div>}
      </div>}

      {/* Activity timeline */}
      {actGroups.length > 0 && <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 6 }}>Activity</div>
        {actGroups.map((g, gi) => {
          // collapse consecutive autosaves ("saved") into one row with a count — they're not
          // duplicate data, the client portal just logs every autosave.
          const collapsed = [];
          g.entries.forEach((a) => { const last = collapsed[collapsed.length - 1]; if (last && last.action === a.action && a.action === 'saved' && !a.notes) { last.count++; last.created_at = a.created_at; } else collapsed.push({ ...a, count: 1 }); });
          return (
            <div key={gi} style={{ borderBottom: '1px solid var(--grey-50)' }}>
              <div onClick={() => setOpenAct(openAct === gi ? -1 : gi)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '9px 0', fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: 'var(--grey-800)' }}>{g.label}</span>
                <span style={{ color: 'var(--grey-400)', fontSize: 12 }}>{collapsed.length} event{collapsed.length > 1 ? 's' : ''} {openAct === gi ? '▾' : '▸'}</span>
              </div>
              {openAct === gi && collapsed.map((a) => (
                <div key={a.activity_id} style={{ display: 'flex', gap: 10, fontSize: 12, padding: '4px 0 4px 12px' }}>
                  <span style={{ color: 'var(--grey-700)', fontWeight: 500, minWidth: 160 }}>{RFQ_ACTION_LABEL[a.action] || a.action}{a.count > 1 ? (' ×' + a.count) : ''}</span>
                  <span style={{ flex: 1, color: 'var(--grey-400)', overflowWrap: 'anywhere' }}>{a.notes || ''}</span>
                  <span style={{ color: 'var(--grey-400)', whiteSpace: 'nowrap' }}>{fmtDate(a.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>}

      <div style={{ marginTop: 4 }}><button className="btn sm" onClick={onBack}>← All RFQs</button></div>
    </div>
  );
}
