// RFQ module (staff side) — list, New-RFQ form, share card, and the detail page
// (approve→quote with dedupe, request-changes, revisions compare, activity).
// Ported verbatim from isheeka-erp-v22.html.
import React from 'react';
import { supabase } from '../lib/supabase';
import { notify, runDb } from '../lib/toast.jsx';
import { _currentUid } from '../lib/session.js';
import { fmtDate } from '../lib/format.js';
import { RFQ_STATUS, RFQ_ACTION_LABEL } from '../lib/constants.js';
import { rfqLink, createRfq, genRfqToken, genRfqPin, sha256Hex, approveRfqToQuote, findClientMatch } from '../lib/rfq.js';
import { waLink } from '../lib/share.js';

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
  const [existingRfqs, setExistingRfqs] = React.useState([]);
  React.useEffect(() => { (async () => {
    if (!prefill || (!prefill.client_id && !prefill.lead_id)) return;
    let q = supabase.from('rfqs').select('rfq_id,ref_number,status').eq('is_deleted', false).not('status', 'in', '("converted","withdrawn")');
    q = prefill.client_id ? q.eq('client_id', prefill.client_id) : q.eq('lead_id', prefill.lead_id);
    const { data } = await q.order('created_at', { ascending: false });
    setExistingRfqs(data || []);
  })(); }, []);
  const pn = (prefill?.contact_name || '').trim().split(/\s+/);
  const [f, setF] = React.useState({
    contact_first_name: prefill?.contact_first_name || (pn[0] || ''), contact_last_name: prefill?.contact_last_name || (pn.slice(1).join(' ') || ''),
    contact_phone: prefill?.contact_phone || '', contact_email: prefill?.contact_email || '',
    secondary_contact_name: prefill?.secondary_contact_name || '', secondary_contact_phone: prefill?.secondary_contact_phone || '',
    event_type: prefill?.event_type || '', location: prefill?.location || '', city: prefill?.city || 'Hyderabad', access_mode: 'pin',
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
        <div><label className="field-label">Event type</label><input className="field-input" value={f.event_type} onChange={(e) => set('event_type', e.target.value)} placeholder="e.g. Wedding" /></div>
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

  const load = async () => { setLoading(true); const { data } = await supabase.from('rfqs').select('rfq_id,ref_number,status,client_id,contact_name,event_type,created_at,client_submitted_at').eq('is_deleted', false).order('created_at', { ascending: false }); setRfqs(data || []); setLoading(false); };
  React.useEffect(() => { if (!detailId && !isNew && !created) load(); }, [detailId, isNew, created]);

  if (created) { return <div><div style={{ marginBottom: 12 }}><button className="btn sm" onClick={() => { setCreated(null); }}>← All RFQs</button></div><RFQShareCard created={created} contact={created.contact} onDone={() => { setCreated(null); }} /></div>; }
  if (isNew) { return <div><div style={{ marginBottom: 12 }}><button className="btn sm" onClick={onBack}>← Back</button></div><NewRFQForm prefill={nav && nav.prefill} onCreated={(c, contact) => { setCreated({ ...c, contact }); }} onCancel={onBack} onNavigate={onNavigate} /></div>; }
  if (detailId) { return <RFQDetail rfqId={detailId} onBack={onBack} onShare={(c, contact) => setCreated({ ...c, contact })} onNavigate={onNavigate} />; }

  const needsReview = rfqs.filter((r) => r.status === 'submitted').length;
  const list = rfqs.filter((r) => !statusFilter || r.status === statusFilter);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--grey-800)' }}>RFQs</div>
          {needsReview > 0 && <div style={{ fontSize: 12, color: 'var(--pink)', fontWeight: 500, marginTop: 2 }}>⏳ {needsReview} submitted · awaiting review</div>}
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
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--pink)', width: 120 }}>{r.ref_number}</span>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--grey-800)' }}>{r.contact_name || '—'}{r.event_type ? (' · ' + r.event_type) : ''}</span>
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
  const load = async () => { setLoading(true);
    // #6: there is no `rfq_revisions` table in the schema — querying it 404s on every RFQ
    // open (the panel was always empty). Dropped the dead query; revisions stays [].
    const [{ data: rfq }, { data: its }, { data: act }] = await Promise.all([
      supabase.from('rfqs').select('*').eq('rfq_id', rfqId).single(),
      supabase.from('rfq_items').select('*').eq('rfq_id', rfqId).eq('is_deleted', false).order('sort_order'),
      supabase.from('rfq_activity').select('*').eq('rfq_id', rfqId).order('created_at', { ascending: false }),
    ]);
    // Self-heal a stale quote pointer: walk forward through the revision chain to the newest quote.
    if (rfq && rfq.quotation_id) {
      let cur = rfq.quotation_id, guard = 0;
      while (guard++ < 25) {
        const { data: child } = await supabase.from('quotations').select('quotation_id').eq('parent_quotation_id', cur).eq('is_deleted', false).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (child && child.quotation_id) cur = child.quotation_id; else break;
      }
      if (cur !== rfq.quotation_id) { try { await supabase.from('rfqs').update({ quotation_id: cur, updated_at: new Date().toISOString() }).eq('rfq_id', rfqId); } catch (e) { /* noop */ } rfq.quotation_id = cur; }
    }
    setR(rfq || null); setItems(its || []); setActivity(act || []); setRevisions([]); setLoading(false);
  };
  React.useEffect(() => { load(); }, [rfqId]);
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
      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: '18px 22px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--grey-800)' }}>{r.ref_number} <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 500, background: sc.bg, color: sc.c, marginLeft: 6 }}>{sc.l}</span></div>
            <div style={{ fontSize: 13, color: 'var(--grey-400)', marginTop: 3 }}>{r.contact_name || '—'}{r.contact_phone ? (' · ' + r.contact_phone) : ''}{r.event_type ? (' · ' + r.event_type) : ''}{r.city ? (' · ' + r.city) : ''}</div>
            {(r.secondary_contact_name || r.secondary_contact_phone) && <div style={{ fontSize: 12, color: 'var(--grey-400)', marginTop: 2 }}>2nd contact: {r.secondary_contact_name || ''} {r.secondary_contact_phone || ''}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {canApprove && revisions.length > 1 && <select className="field-input" style={{ width: 150, fontSize: 12, padding: '6px 8px' }} value={basisRev == null ? '' : String(basisRev)} onChange={(e) => setBasisRev(e.target.value === '' ? null : parseInt(e.target.value, 10))} title="Which version to quote">
              <option value="">Latest (v{r.revision_number || revisions[0].revision_number})</option>
              {revisions.map((rv) => <option key={rv.revision_id} value={rv.revision_number}>Use v{rv.revision_number}</option>)}
            </select>}
            {canApprove && <button className="btn sm" style={{ background: 'var(--green-light)', color: 'var(--green)', borderColor: '#86EFAC' }} disabled={approving} onClick={approve}>{approving ? 'Approving…' : '✅ Approve → create quote'}</button>}
            {r.status === 'submitted' && <button className="btn sm" style={{ color: 'var(--red)', borderColor: 'rgba(163,45,45,0.3)' }} onClick={requestChanges}>↩ Request changes</button>}
            {r.quotation_id && <button className="btn sm" onClick={() => onNavigate && onNavigate('quotations', { quotId: r.quotation_id, label: 'Quote' })}>📄 Go to quote →</button>}
            <button className="btn sm" onClick={regenerate}>🔗 Regenerate link & PIN</button>
          </div>
        </div>
        {subs.length > 0 && <div style={{ fontSize: 12, color: 'var(--grey-600)', marginTop: 10, background: 'var(--grey-50)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' }}>{subs.map((s) => s.name + (s.planned_date ? (' ' + fmtDate(s.planned_date, { day: 'numeric', month: 'short' })) : '')).join(' · ')}</div>}
        {r.notes && <div style={{ fontSize: 13, color: 'var(--grey-700)', marginTop: 10, background: 'var(--grey-50)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', overflowWrap: 'anywhere', wordBreak: 'break-word' }}><b style={{ color: 'var(--grey-800)' }}>Notes:</b> {r.notes}</div>}
      </div>

      {/* Requested items */}
      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 10 }}>Requested items {items.length > 0 ? ('(' + items.length + ')') : ''}</div>
        {items.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>Nothing submitted yet — the client hasn’t added items.</div>
          : Object.keys(groups).map((k) => (
            <div key={k} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: 'var(--gold)', marginBottom: 4 }}>{k.toUpperCase()}</div>
              {groups[k].map((it) => (<div key={it.rfq_item_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, fontSize: 13, padding: '3px 0' }}><span style={{ overflowWrap: 'anywhere', wordBreak: 'break-word', minWidth: 0 }}>{it.description}</span><span style={{ color: 'var(--grey-400)', whiteSpace: 'nowrap' }}>×{it.quantity}</span></div>))}
            </div>
          ))}
      </div>

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
        {actGroups.map((g, gi) => (
          <div key={gi} style={{ borderBottom: '1px solid var(--grey-50)' }}>
            <div onClick={() => setOpenAct(openAct === gi ? -1 : gi)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '9px 0', fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: 'var(--grey-800)' }}>{g.label}</span>
              <span style={{ color: 'var(--grey-400)', fontSize: 12 }}>{g.entries.length} event{g.entries.length > 1 ? 's' : ''} {openAct === gi ? '▾' : '▸'}</span>
            </div>
            {openAct === gi && g.entries.map((a) => (
              <div key={a.activity_id} style={{ display: 'flex', gap: 10, fontSize: 12, padding: '4px 0 4px 12px' }}>
                <span style={{ color: 'var(--grey-700)', fontWeight: 500, minWidth: 160 }}>{RFQ_ACTION_LABEL[a.action] || a.action}</span>
                <span style={{ flex: 1, color: 'var(--grey-400)', overflowWrap: 'anywhere' }}>{a.notes || ''}</span>
                <span style={{ color: 'var(--grey-400)', whiteSpace: 'nowrap' }}>{fmtDate(a.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        ))}
      </div>}

      <div style={{ marginTop: 4 }}><button className="btn sm" onClick={onBack}>← All RFQs</button></div>
    </div>
  );
}
