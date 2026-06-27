// Vendors module (master data — modeled on Clients): list, detail, form with
// dup-check, status toggle, archive guard, engagements rollup. Ported verbatim.
import React from 'react';
import { supabase } from '../lib/supabase';
import { notify, runDb } from '../lib/toast.jsx';
import { _currentUid } from '../lib/session.js';
import { VENDOR_CATS } from '../lib/constants.js';
import { sha256Hex } from '../lib/rfq.js';
import { VENDOR_TEMPLATES, sendWhatsApp } from '../lib/messaging.js';

const GATEWAY = 'https://jlcssesetnxulnkbrmyp.supabase.co/functions/v1/rfq-gateway';

function onboardingLink(token) {
  try {
    const raw = (import.meta.env && import.meta.env.VITE_RFQ_BASE_URL) || '';
    const base = raw ? (raw.endsWith('/') ? raw : raw + '/') : location.href;
    return new URL('vendor-onboarding.html?t=' + token, base).href;
  } catch (e) { return 'vendor-onboarding.html?t=' + token; }
}

export function VendorsModule({ nav, onNavigate, onBack }) {
  const [vendors, setVendors] = React.useState([]);
  const detailId = nav && nav.vendorId; // stack-driven detail target
  const [evs, setEvs] = React.useState([]);
  const [events, setEvents] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [catF, setCatF] = React.useState('');
  const [statusF, setStatusF] = React.useState('');
  const [showForm, setShowForm] = React.useState(false);
  const [editV, setEditV] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  // Tabs: 'vendors' | 'onboarding'
  const [activeTab, setActiveTab] = React.useState('vendors');
  // Invite modal state
  const [showInvite, setShowInvite] = React.useState(false);
  const [inviteFor, setInviteFor] = React.useState(null); // vendor object or null for generic
  const [invitePin, setInvitePin] = React.useState('');
  const [inviteSaving, setInviteSaving] = React.useState(false);
  const [inviteResult, setInviteResult] = React.useState(null); // {token, link}
  // Onboarding requests state
  const [onboardings, setOnboardings] = React.useState([]);
  const [obLoading, setObLoading] = React.useState(false);
  const [obStatusF, setObStatusF] = React.useState('submitted');
  const [reviewItem, setReviewItem] = React.useState(null);
  const [dupCandidates, setDupCandidates] = React.useState([]);
  const [linkTo, setLinkTo] = React.useState(null); // existing vendor to link
  const [reviewSaving, setReviewSaving] = React.useState(false);
  // Vendor messaging state
  const [showVMsgModal, setShowVMsgModal] = React.useState(false);
  const [vMsgTemplate, setVMsgTemplate] = React.useState(VENDOR_TEMPLATES[0].id);
  const [vMsgBody, setVMsgBody] = React.useState('');
  const [vMsgPhone, setVMsgPhone] = React.useState('');
  const [vMsgSent, setVMsgSent] = React.useState(false);
  const [vMsgLog, setVMsgLog] = React.useState([]);
  const [vMsgLogLoading, setVMsgLogLoading] = React.useState(false);
  const [vMsgPartyId, setVMsgPartyId] = React.useState(null);

  const loadVendorMsgLog = React.useCallback((vendorId) => {
    setVMsgLogLoading(true);
    supabase.from('message_log').select('*').eq('party_type', 'vendor').eq('party_id', vendorId).order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => { setVMsgLog(data || []); setVMsgLogLoading(false); });
  }, []);

  const openVMsgModal = (v) => {
    setVMsgTemplate(VENDOR_TEMPLATES[0].id);
    setVMsgBody(VENDOR_TEMPLATES[0].body(v));
    setVMsgPhone(v.phone_1 || '');
    setVMsgSent(false);
    setVMsgPartyId(v.vendor_id);
    setShowVMsgModal(true);
  };

  const handleVTemplateChange = (id, v) => {
    setVMsgTemplate(id);
    const tpl = VENDOR_TEMPLATES.find((t) => t.id === id) || VENDOR_TEMPLATES[0];
    setVMsgBody(v ? tpl.body(v) : '');
  };

  const handleVSendWA = () => {
    sendWhatsApp({ phone: vMsgPhone, body: vMsgBody, party_type: 'vendor', party_id: vMsgPartyId, template: vMsgTemplate });
    setVMsgSent(true);
    if (vMsgPartyId) {
      setTimeout(() => {
        supabase.from('message_log').select('*').eq('party_type', 'vendor').eq('party_id', vMsgPartyId).order('created_at', { ascending: false }).limit(50)
          .then(({ data }) => setVMsgLog(data || []));
      }, 1200);
    }
  };

  const emptyV = { name: '', category: 'other', contact_person: '', phone_1: '+91 ', phone_2: '', phone_3: '', email_1: '', email_2: '', email_3: '', street_address: '', city: 'Hyderabad', state: '', gst_number: '', pan_number: '', bank_name: '', account_number: '', ifsc_code: '', upi_id: '', payment_terms: '', rating: '', is_preferred: false, status: 'active', notes: '' };
  const [form, setForm] = React.useState(emptyV);
  const [dupWarn, setDupWarn] = React.useState(null);
  const setF = (k, v) => { if (dupWarn) setDupWarn(null); setForm((f) => ({ ...f, [k]: v })); };
  const phoneDigits = (p) => (p || '').replace(/\D/g, '').replace(/^91(\d{10})$/, '$1');

  const load = React.useCallback(async () => {
    setLoading(true);
    const [{ data: v }, { data: ev }, { data: e }] = await Promise.all([
      supabase.from('vendors').select('*').eq('is_deleted', false).order('name'),
      supabase.from('event_vendors').select('*').eq('is_deleted', false),
      supabase.from('events').select('event_id,ref_number,name').eq('is_deleted', false),
    ]);
    setVendors(v || []); setEvs(ev || []); setEvents(e || []); setLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => { if (!detailId) load(); }, [detailId]);
  React.useEffect(() => { if (detailId) loadVendorMsgLog(detailId); }, [detailId, loadVendorMsgLog]);

  const loadOnboardings = React.useCallback(async () => {
    setObLoading(true);
    let q = supabase.from('vendor_onboarding').select('*').order('created_at', { ascending: false });
    if (obStatusF) q = q.eq('status', obStatusF);
    const { data } = await q;
    setOnboardings(data || []);
    setObLoading(false);
  }, [obStatusF]);
  React.useEffect(() => { if (activeTab === 'onboarding') loadOnboardings(); }, [activeTab, loadOnboardings]);

  const eMap = {}; events.forEach((x) => { eMap[x.event_id] = x; });
  const catLabel = (c) => { const f = VENDOR_CATS.find((x) => x[0] === c); return f ? f[1] : (c || '—'); };
  const filtered = vendors.filter((v) => { const q = search.toLowerCase(); const ms = !q || `${v.name || ''} ${v.contact_person || ''} ${v.phone_1 || ''} ${v.gst_number || ''} ${v.city || ''}`.toLowerCase().includes(q); const mc = !catF || v.category === catF; const msx = !statusF || v.status === statusF; return ms && mc && msx; });
  const cnt = (f) => vendors.filter(f).length;
  const stColor = (s) => ({ active: { bg: 'var(--green-light)', color: 'var(--green)' }, inactive: { bg: 'var(--grey-100)', color: 'var(--grey-400)' } }[s] || { bg: 'var(--grey-100)', color: 'var(--grey-400)' });

  const openNew = () => { setEditV(null); setDupWarn(null); setForm({ ...emptyV }); setShowForm(true); };
  // Arriving with mode:'new' (e.g. from the Sourcing "Add a vendor" shortcut) opens the form straight away.
  React.useEffect(() => { if (nav && nav.mode === 'new' && !detailId) openNew(); }, [nav && nav.mode]);
  const openEdit = (v) => { setEditV(v); setDupWarn(null); setForm({ ...emptyV, ...v, rating: v.rating || '', is_preferred: !!v.is_preferred, phone_1: v.phone_1 || '+91 ', email_1: v.email_1 || '' }); setShowForm(true); };
  const cleanEmail = (e) => { const t = (e || '').trim(); return (t === '' || t === '@gmail.com') ? null : t; };
  const save = async (force) => {
    if (!form.name.trim()) { notify('Vendor name is required.', 'error'); return; }
    if (phoneDigits(form.phone_1).length !== 10) { notify('Enter a valid 10-digit phone number for Phone 1.', 'error'); return; }
    if (!editV && !force) {
      const np = phoneDigits(form.phone_1), nn = form.name.trim().toLowerCase();
      const dup = vendors.find((v) => (np && phoneDigits(v.phone_1) === np) || (v.name || '').trim().toLowerCase() === nn);
      if (dup) { setDupWarn(dup); return; }
    }
    setSaving(true);
    const payload = { name: form.name.trim(), category: form.category || null, contact_person: form.contact_person || null, phone_1: (form.phone_1 || '').trim() || null, phone_2: form.phone_2 || null, phone_3: form.phone_3 || null, email_1: cleanEmail(form.email_1), email_2: cleanEmail(form.email_2), email_3: cleanEmail(form.email_3), street_address: form.street_address || null, city: form.city || null, state: form.state || null, gst_number: form.gst_number || null, pan_number: form.pan_number || null, bank_name: form.bank_name || null, account_number: form.account_number || null, ifsc_code: form.ifsc_code || null, upi_id: form.upi_id || null, payment_terms: form.payment_terms || null, rating: form.rating ? parseFloat(form.rating) : null, is_preferred: !!form.is_preferred, status: form.status || 'active', notes: form.notes || null, updated_at: new Date().toISOString() };
    let err;
    if (editV) { const { error } = await runDb(supabase.from('vendors').update(payload).eq('vendor_id', editV.vendor_id), 'update vendor'); err = error; }
    else { payload.created_at = new Date().toISOString(); payload.is_deleted = false; payload.created_by = await _currentUid(); const { error } = await runDb(supabase.from('vendors').insert(payload), 'add vendor'); err = error; }
    setSaving(false); if (err) return;
    setDupWarn(null); notify(editV ? 'Vendor updated.' : 'Vendor added.', 'success'); setShowForm(false); load();
  };
  const openDupVendor = () => { const d = dupWarn; setShowForm(false); setDupWarn(null); if (d) { onNavigate('vendors', { vendorId: d.vendor_id, label: d.name || 'Vendor' }); } };
  const setStatus = async (v, st) => { if (st === v.status) return; const { error } = await runDb(supabase.from('vendors').update({ status: st, updated_at: new Date().toISOString() }).eq('vendor_id', v.vendor_id), 'update vendor status'); if (!error) { notify('Vendor status updated.', 'success'); load(); } };
  const del = async (v) => { const used = evs.filter((x) => x.vendor_id === v.vendor_id).length; if (used > 0) { notify('Cannot delete — this vendor is on ' + used + ' event' + (used > 1 ? 's' : '') + '. Set them Inactive instead.', 'error'); return; } if (!window.confirm('Delete (archive) ' + v.name + '? Recoverable in the database.')) return; const { error } = await runDb(supabase.from('vendors').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('vendor_id', v.vendor_id), 'delete vendor'); if (!error) { notify('Vendor archived.', 'success'); load(); onBack && onBack(); } };

  const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');

  // ── Invite helpers ─────────────────────────────────────────────────────────
  const openInvite = (v = null) => { setInviteFor(v); setInvitePin(''); setInviteResult(null); setShowInvite(true); };
  const sendInvite = async () => {
    if (invitePin && !/^\d{4,6}$/.test(invitePin)) { notify('PIN must be 4–6 digits.', 'error'); return; }
    setInviteSaving(true);
    const arr = new Uint8Array(16); crypto.getRandomValues(arr);
    const token = [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
    const uid = await _currentUid();
    const payload = {
      token_hash: await sha256Hex(token),
      pin_hash: invitePin ? await sha256Hex(invitePin) : null,
      status: 'pending',
      invited_by: uid,
      vendor_id: inviteFor ? inviteFor.vendor_id : null,
    };
    const { error } = await runDb(supabase.from('vendor_onboarding').insert(payload), 'create onboarding invite');
    setInviteSaving(false);
    if (error) return;
    const link = onboardingLink(token);
    setInviteResult({ token, link });
  };
  const waLink = (link) => 'https://wa.me/?text=' + encodeURIComponent('Please fill in your business details here: ' + link);

  // ── Review helpers ─────────────────────────────────────────────────────────
  const openReview = (ob) => {
    setReviewItem(ob);
    setLinkTo(null);
    // fuzzy: simple normalized name comparison
    const name = ((ob.submitted_fields || {}).name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (name.length > 2) {
      const matches = vendors.filter((v) => {
        const vn = (v.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        // crude substring / prefix match
        return vn.includes(name) || name.includes(vn) || (name.length > 4 && vn.slice(0, 4) === name.slice(0, 4));
      });
      setDupCandidates(matches);
    } else { setDupCandidates([]); }
  };
  const approveOnboarding = async (createNew) => {
    if (!reviewItem) return;
    setReviewSaving(true);
    const uid = await _currentUid();
    const sf = reviewItem.submitted_fields || {};
    let vid = linkTo ? linkTo.vendor_id : reviewItem.vendor_id;
    if (createNew && !linkTo) {
      const np = { name: sf.name || 'Unknown', category: sf.category || 'other', contact_person: sf.contact_person || null, phone_1: sf.phone || null, email_1: sf.email || null, street_address: sf.address || null, gst_number: sf.gstin || null, pan_number: sf.pan || null, bank_name: sf.bank_name || null, account_number: sf.account_number || null, ifsc_code: sf.ifsc || null, status: 'active', is_deleted: false, created_at: new Date().toISOString(), created_by: uid };
      const { data: nv, error: nve } = await supabase.from('vendors').insert(np).select('vendor_id').single();
      if (nve) { notify('Failed to create vendor: ' + nve.message, 'error'); setReviewSaving(false); return; }
      vid = nv.vendor_id;
      load();
    }
    const { error } = await runDb(supabase.from('vendor_onboarding').update({ status: 'approved', vendor_id: vid, reviewed_at: new Date().toISOString(), reviewed_by: uid }).eq('onboarding_id', reviewItem.onboarding_id), 'approve onboarding');
    setReviewSaving(false);
    if (!error) { notify('Onboarding approved.', 'success'); setReviewItem(null); loadOnboardings(); }
  };
  const rejectOnboarding = async () => {
    if (!reviewItem) return;
    setReviewSaving(true);
    const uid = await _currentUid();
    const { error } = await runDb(supabase.from('vendor_onboarding').update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: uid }).eq('onboarding_id', reviewItem.onboarding_id), 'reject onboarding');
    setReviewSaving(false);
    if (!error) { notify('Onboarding rejected.', 'success'); setReviewItem(null); loadOnboardings(); }
  };

  const obStatusColor = (s) => ({ pending: { bg: 'var(--blue-light)', color: 'var(--blue)' }, submitted: { bg: 'var(--orange-light)', color: 'var(--orange)' }, approved: { bg: 'var(--green-light)', color: 'var(--green)' }, rejected: { bg: 'var(--grey-100)', color: 'var(--grey-400)' } }[s] || { bg: 'var(--grey-100)', color: 'var(--grey-400)' });

  // ── Invite modal ───────────────────────────────────────────────────────────
  const inviteModal = showInvite && (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={(e) => { if (e.target === e.currentTarget) { setShowInvite(false); } }}>
      <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 460 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>📨 Send Onboarding Link{inviteFor ? ' — ' + inviteFor.name : ''}</div>
          <button className="btn sm" onClick={() => setShowInvite(false)}>✕</button>
        </div>
        <div style={{ padding: 20 }}>
          {!inviteResult ? (
            <>
              <div style={{ fontSize: 13, color: 'var(--grey-400)', marginBottom: 14 }}>Generate a secure link the vendor can use to submit their business details.</div>
              <label className="field-label">Optional PIN (4–6 digits) — vendor must enter this to open the form</label>
              <input className="field-input" type="text" inputMode="numeric" maxLength={6} placeholder="Leave blank for no PIN" value={invitePin} onChange={(e) => setInvitePin(e.target.value.replace(/\D/g, ''))} />
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: 'var(--grey-400)', marginBottom: 10 }}>Share this link with the vendor:</div>
              <div style={{ background: 'var(--grey-50)', border: '1px solid var(--grey-100)', borderRadius: 8, padding: '10px 12px', fontSize: 12, wordBreak: 'break-all', color: 'var(--grey-800)', marginBottom: 14 }}>{inviteResult.link}</div>
              {invitePin && <div style={{ fontSize: 12, color: 'var(--grey-400)', marginBottom: 12 }}>PIN: <b>{invitePin}</b></div>}
              <a href={waLink(inviteResult.link)} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', background: '#25D366', color: '#fff', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, textDecoration: 'none', marginBottom: 8 }}>📱 Share on WhatsApp</a>
              <button className="btn sm" style={{ marginLeft: 10 }} onClick={() => { navigator.clipboard.writeText(inviteResult.link).then(() => notify('Link copied!', 'success')); }}>📋 Copy link</button>
            </>
          )}
        </div>
        {!inviteResult && (
          <div style={{ padding: '14px 24px', borderTop: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setShowInvite(false)}>Cancel</button>
            <button className="btn primary" disabled={inviteSaving} onClick={sendInvite}>{inviteSaving ? 'Generating…' : 'Generate & show link'}</button>
          </div>
        )}
      </div>
    </div>
  );

  // ── Review panel ───────────────────────────────────────────────────────────
  const reviewPanel = reviewItem && (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) setReviewItem(null); }}>
      <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 560 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Review Onboarding — {(reviewItem.submitted_fields || {}).name || '(no name)'}</div>
          <button className="btn sm" onClick={() => setReviewItem(null)}>✕</button>
        </div>
        <div style={{ padding: 20 }}>
          {[['Business name', 'name'], ['Contact person', 'contact_person'], ['Phone', 'phone'], ['Email', 'email'], ['Category', 'category'], ['Address', 'address'], ['GSTIN', 'gstin'], ['PAN', 'pan'], ['Bank name', 'bank_name'], ['Account number', 'account_number'], ['IFSC', 'ifsc']].map(([label, key]) => {
            const val = (reviewItem.submitted_fields || {})[key];
            if (!val) return null;
            return <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--grey-100)', fontSize: 13 }}><span style={{ color: 'var(--grey-400)', minWidth: 130 }}>{label}</span><span style={{ textAlign: 'right', fontWeight: 500 }}>{val}</span></div>;
          })}
          {dupCandidates.length > 0 && (
            <div style={{ marginTop: 16, background: 'var(--orange-light)', border: '1px solid rgba(230,81,0,0.25)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--orange)', marginBottom: 8 }}>⚠ Possible duplicate vendors found:</div>
              {dupCandidates.map((v) => (
                <div key={v.vendor_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 13 }}>{v.name} {v.phone_1 ? '· ' + v.phone_1 : ''}</span>
                  <button className="btn sm" style={{ background: linkTo && linkTo.vendor_id === v.vendor_id ? 'var(--green)' : undefined, color: linkTo && linkTo.vendor_id === v.vendor_id ? '#fff' : undefined }} onClick={() => setLinkTo(linkTo && linkTo.vendor_id === v.vendor_id ? null : v)}>{linkTo && linkTo.vendor_id === v.vendor_id ? '✓ Selected' : 'Link to this'}</button>
                </div>
              ))}
              {linkTo && <div style={{ fontSize: 12, color: 'var(--grey-400)', marginTop: 6 }}>Approving will link to <b>{linkTo.name}</b> (no new vendor created).</div>}
            </div>
          )}
        </div>
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn sm" style={{ color: 'var(--red)', borderColor: 'rgba(163,45,45,0.3)' }} disabled={reviewSaving} onClick={rejectOnboarding}>Reject</button>
          <button className="btn" onClick={() => setReviewItem(null)}>Cancel</button>
          <button className="btn primary" disabled={reviewSaving} onClick={() => approveOnboarding(!linkTo)}>{reviewSaving ? 'Saving…' : linkTo ? 'Approve & link' : 'Approve & create vendor'}</button>
        </div>
      </div>
    </div>
  );

  const formModal = (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
      <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 620 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)' }}>{editV ? 'Edit vendor' : 'New vendor'}</div><button className="btn sm" onClick={() => setShowForm(false)}>✕</button></div>
        <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {dupWarn && <div style={{ gridColumn: '1 / -1', background: 'var(--orange-light)', border: '1px solid rgba(230,81,0,0.3)', borderRadius: 'var(--radius-md)', padding: '10px 12px', fontSize: 13, color: 'var(--orange)' }}>⚠ A vendor <b>"{dupWarn.name}"</b>{dupWarn.phone_1 ? (' (' + dupWarn.phone_1 + ')') : ''} already exists. <span onClick={openDupVendor} style={{ textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 }}>Open it</span>, change the details, or <span onClick={() => save(true)} style={{ textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 }}>add anyway</span>.</div>}
          <div style={{ gridColumn: '1 / -1' }}><label className="field-label">Vendor name <span style={{ color: 'var(--pink)' }}>*</span></label><input className="field-input" value={form.name} onChange={(e) => setF('name', e.target.value)} placeholder="e.g. Blooms Decor" /></div>
          <div><label className="field-label">Category</label><select className="field-input" value={form.category} onChange={(e) => setF('category', e.target.value)}>{VENDOR_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="field-label">Contact person</label><input className="field-input" value={form.contact_person} onChange={(e) => setF('contact_person', e.target.value)} /></div>
          <div><label className="field-label">Phone 1 <span style={{ color: 'var(--pink)' }}>*</span></label><input className="field-input" value={form.phone_1} onChange={(e) => setF('phone_1', e.target.value)} onFocus={(e) => { const t = e.target; setTimeout(() => { try { t.setSelectionRange(t.value.length, t.value.length); } catch (_) { /* noop */ } }, 0); }} placeholder="+91 98765 43210" /></div>
          <div><label className="field-label">Phone 2</label><input className="field-input" value={form.phone_2} onChange={(e) => setF('phone_2', e.target.value)} /></div>
          <div><label className="field-label">Email 1</label><input className="field-input" value={form.email_1} onChange={(e) => setF('email_1', e.target.value)} onFocus={(e) => { const t = e.target; if (!t.value) { setF('email_1', '@gmail.com'); setTimeout(() => { try { t.setSelectionRange(0, 0); } catch (_) { /* noop */ } }, 0); } }} placeholder="name@gmail.com" /></div>
          <div><label className="field-label">Email 2</label><input className="field-input" value={form.email_2} onChange={(e) => setF('email_2', e.target.value)} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label className="field-label">Street address</label><input className="field-input" value={form.street_address} onChange={(e) => setF('street_address', e.target.value)} /></div>
          <div><label className="field-label">City</label><input className="field-input" value={form.city} onChange={(e) => setF('city', e.target.value)} /></div>
          <div><label className="field-label">State</label><input className="field-input" value={form.state} onChange={(e) => setF('state', e.target.value)} /></div>
          <div><label className="field-label">GSTIN</label><input className="field-input" value={form.gst_number} onChange={(e) => setF('gst_number', e.target.value)} /></div>
          <div><label className="field-label">PAN</label><input className="field-input" value={form.pan_number} onChange={(e) => setF('pan_number', e.target.value)} /></div>
          <div><label className="field-label">Bank name</label><input className="field-input" value={form.bank_name} onChange={(e) => setF('bank_name', e.target.value)} /></div>
          <div><label className="field-label">Account number</label><input className="field-input" value={form.account_number} onChange={(e) => setF('account_number', e.target.value)} /></div>
          <div><label className="field-label">IFSC</label><input className="field-input" value={form.ifsc_code} onChange={(e) => setF('ifsc_code', e.target.value)} /></div>
          <div><label className="field-label">UPI ID</label><input className="field-input" value={form.upi_id} onChange={(e) => setF('upi_id', e.target.value)} /></div>
          <div><label className="field-label">Payment terms</label><input className="field-input" value={form.payment_terms} onChange={(e) => setF('payment_terms', e.target.value)} placeholder="e.g. 50% advance" /></div>
          <div><label className="field-label">Rating (0–5)</label><input type="number" min="0" max="5" step="0.1" className="field-input" value={form.rating} onChange={(e) => setF('rating', e.target.value)} /></div>
          <div><label className="field-label">Status</label><select className="field-input" value={form.status} onChange={(e) => setF('status', e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 22 }}><input type="checkbox" checked={form.is_preferred} onChange={(e) => setF('is_preferred', e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--pink)' }} /><span style={{ fontSize: 13 }}>Preferred vendor</span></div>
          <div style={{ gridColumn: '1 / -1' }}><label className="field-label">Notes</label><textarea className="field-textarea" rows={2} value={form.notes} onChange={(e) => setF('notes', e.target.value)} /></div>
        </div>
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button className="btn" onClick={() => setShowForm(false)}>Cancel</button><button className="btn primary" disabled={saving} onClick={() => save()}>{saving ? 'Saving…' : (editV ? 'Save changes' : 'Add vendor')}</button></div>
      </div>
    </div>
  );

  if (detailId) {
    const v = vendors.find((x) => x.vendor_id === detailId);
    if (!v) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--grey-400)' }}>Vendor not found. <button className="btn sm" onClick={onBack}>← Back</button></div>;
    const eng = evs.filter((x) => x.vendor_id === v.vendor_id);
    const sc = stColor(v.status);
    return (
      <div>
        {showForm && formModal}
        {inviteModal}
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '16px 20px', border: '1px solid var(--grey-100)', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--grey-800)' }}>{v.name} {v.is_preferred && <span title="Preferred" style={{ color: 'var(--orange)' }}>★</span>}</div>
            <div style={{ fontSize: 13, color: 'var(--grey-400)', marginTop: 2 }}>{catLabel(v.category)}{v.rating ? (' · ★ ' + v.rating) : ''}</div>
            <div style={{ marginTop: 6 }}><span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 12, background: sc.bg, color: sc.color }}>{(v.status || '').toUpperCase()}</span></div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn sm" style={{ background: 'var(--pink-light)', color: 'var(--pink)', borderColor: 'var(--pink-light)' }} onClick={() => openInvite(v)}>📨 Send Onboarding Link</button>
            <button className="btn sm" onClick={() => openVMsgModal(v)}>💬 Send Message</button>
            <select className="field-input" style={{ width: 120, fontSize: 13, padding: '6px 10px' }} value={v.status} onChange={(e) => setStatus(v, e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select>
            <button className="btn sm primary" onClick={() => openEdit(v)}>✏️ Edit</button>
            <button className="btn sm" style={{ color: 'var(--red)', borderColor: 'rgba(163,45,45,0.3)' }} onClick={() => del(v)}>🗑 Delete</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div style={{ background: 'white', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-lg)', padding: '14px 18px' }}>
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Contact</div>
            {[['Contact person', v.contact_person], ['Phones', [v.phone_1, v.phone_2, v.phone_3].filter(Boolean).join(' · ')], ['Emails', [v.email_1, v.email_2, v.email_3].filter(Boolean).join(' · ')], ['Address', [v.street_address, v.city, v.state].filter(Boolean).join(', ')]].map(([l, val]) => <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 0', fontSize: 13 }}><span style={{ color: 'var(--grey-400)' }}>{l}</span><span style={{ textAlign: 'right' }}>{val || '—'}</span></div>)}
          </div>
          <div style={{ background: 'white', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-lg)', padding: '14px 18px' }}>
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Tax &amp; payment</div>
            {[['GSTIN', v.gst_number], ['PAN', v.pan_number], ['Bank', [v.bank_name, v.account_number, v.ifsc_code].filter(Boolean).join(' · ')], ['UPI', v.upi_id], ['Payment terms', v.payment_terms]].map(([l, val]) => <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 0', fontSize: 13 }}><span style={{ color: 'var(--grey-400)' }}>{l}</span><span style={{ textAlign: 'right' }}>{val || '—'}</span></div>)}
          </div>
        </div>
        <div style={{ background: 'white', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <div style={{ fontWeight: 600, padding: '12px 16px', fontSize: 13 }}>Engagements <span style={{ fontWeight: 400, color: 'var(--grey-400)', fontSize: 12 }}>({eng.length})</span></div>
          {eng.length === 0 && <div style={{ padding: '0 16px 14px', fontSize: 13, color: 'var(--grey-400)' }}>Not engaged on any event yet.</div>}
          {eng.length > 0 && <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 100px', gap: 8, padding: '8px 16px', background: 'var(--grey-50)', fontSize: 11, fontWeight: 600, color: 'var(--grey-400)', textTransform: 'uppercase', letterSpacing: '.04em' }}><div>Event</div><div style={{ textAlign: 'right' }}>Agreed</div><div style={{ textAlign: 'right' }}>Paid</div><div style={{ textAlign: 'right' }}>Balance</div></div>
            {eng.map((x) => { const e = eMap[x.event_id]; return <div key={x.event_vendor_id} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 100px', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--grey-100)', fontSize: 13 }}><div>{e ? <a onClick={() => onNavigate && onNavigate('events', { eventId: e.event_id })} style={{ color: 'var(--pink)', cursor: 'pointer', fontWeight: 500 }}>{e.ref_number}</a> : '—'}{e ? (' · ' + e.name) : ''}{x.service_description ? (' · ' + x.service_description) : ''}</div><div style={{ textAlign: 'right' }}>{inr(x.agreed_amount)}</div><div style={{ textAlign: 'right' }}>{inr(x.total_paid)}</div><div style={{ textAlign: 'right', color: (parseFloat(x.outstanding) || 0) > 0 ? 'var(--red)' : 'var(--grey-800)' }}>{inr(x.outstanding)}</div></div>; })}
          </>}
        </div>

        {/* Message history */}
        <div style={{ marginTop: 12, background: 'white', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-lg)', padding: '14px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Message history</div>
            <button className="btn sm" onClick={() => openVMsgModal(v)}>💬 Send Message</button>
          </div>
          {vMsgLogLoading ? <div style={{ textAlign: 'center', padding: '10px 0' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>
            : vMsgLog.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)', textAlign: 'center', padding: '8px 0' }}>No messages sent yet.</div>
              : vMsgLog.map((m) => (
                <div key={m.id || m.created_at} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--grey-100)', fontSize: 13 }}>
                  <span style={{ fontSize: 15 }}>{m.channel === 'whatsapp' ? '📲' : '📧'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 500, color: 'var(--grey-700)' }}>{(VENDOR_TEMPLATES.find((t) => t.id === m.template) || {}).label || m.template || 'Custom'}</span>
                    {m.body && <span style={{ color: 'var(--grey-400)', marginLeft: 8 }}>{m.body.slice(0, 40)}{m.body.length > 40 ? '…' : ''}</span>}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--grey-400)', whiteSpace: 'nowrap' }}>{m.created_at ? new Date(m.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : ''}</span>
                </div>
              ))}
        </div>

        {/* Vendor compose modal */}
        {showVMsgModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '24px 28px', width: 480, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)' }}>💬 Send Message to {v.name}</div>
                <button className="btn sm" onClick={() => setShowVMsgModal(false)}>✕ Close</button>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--grey-500)', display: 'block', marginBottom: 4 }}>Template</label>
                <select className="field-input" value={vMsgTemplate} onChange={(e) => handleVTemplateChange(e.target.value, v)} style={{ width: '100%' }}>
                  {VENDOR_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--grey-500)', display: 'block', marginBottom: 4 }}>Message</label>
                <textarea className="field-input" value={vMsgBody} onChange={(e) => setVMsgBody(e.target.value)} rows={5} style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} placeholder="Type your message…" />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--grey-500)', display: 'block', marginBottom: 4 }}>Phone number (for this send)</label>
                <input className="field-input" value={vMsgPhone} onChange={(e) => setVMsgPhone(e.target.value)} style={{ width: '100%' }} placeholder="+91 98765 43210" />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn primary" onClick={handleVSendWA} disabled={!vMsgPhone || !vMsgBody}>📲 Send on WhatsApp</button>
                {vMsgSent && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500 }}>✅ Sent</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {showForm && formModal}
      {inviteModal}
      {reviewPanel}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--grey-800)' }}>Vendors</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn sm" style={{ background: 'var(--pink-light)', color: 'var(--pink)', borderColor: 'var(--pink-light)' }} onClick={() => openInvite()}>📨 Send Onboarding Link</button>
          <button className="btn primary" onClick={openNew}>+ New vendor</button>
        </div>
      </div>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 18, borderBottom: '2px solid var(--grey-100)' }}>
        {[['vendors', '🔧 Vendors'], ['onboarding', '📨 Onboarding requests']].map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '8px 18px', fontSize: 13, fontWeight: activeTab === tab ? 600 : 400, color: activeTab === tab ? 'var(--pink)' : 'var(--grey-400)', background: 'none', border: 'none', borderBottom: activeTab === tab ? '2px solid var(--pink)' : '2px solid transparent', marginBottom: -2, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>

      {activeTab === 'vendors' && <>
        <div className="metrics-grid" style={{ marginBottom: 18 }}>
          <div className="metric-card pink"><div className="metric-icon">🔧</div><div className="metric-value">{vendors.length}</div><div className="metric-label">Total</div></div>
          <div className="metric-card green"><div className="metric-icon">✅</div><div className="metric-value">{cnt((v) => v.status === 'active')}</div><div className="metric-label">Active</div></div>
          <div className="metric-card orange"><div className="metric-icon">⭐</div><div className="metric-value">{cnt((v) => v.is_preferred)}</div><div className="metric-label">Preferred</div></div>
          <div className="metric-card blue"><div className="metric-icon">🚫</div><div className="metric-value">{cnt((v) => v.status === 'inactive')}</div><div className="metric-label">Inactive</div></div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 180, position: 'relative' }}><span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--grey-400)', pointerEvents: 'none' }}>🔍</span><input className="field-input" style={{ paddingLeft: 36 }} placeholder="Search name, contact, phone, GST…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <select className="field-input" style={{ width: 160 }} value={catF} onChange={(e) => setCatF(e.target.value)}><option value="">All categories</option>{VENDOR_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className="field-input" style={{ width: 130 }} value={statusF} onChange={(e) => setStatusF(e.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        </div>
        {loading ? <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          : filtered.length === 0 ? <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: 50, textAlign: 'center', border: '1px solid var(--grey-100)', color: 'var(--grey-400)' }}>No vendors. <button className="btn sm" onClick={openNew}>+ Add one</button></div>
            : <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', overflow: 'hidden' }}>
              {filtered.map((v, i) => { const sc = stColor(v.status); const used = evs.filter((x) => x.vendor_id === v.vendor_id).length; return (
                <div key={v.vendor_id} onClick={() => onNavigate('vendors', { vendorId: v.vendor_id, label: v.name })} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 130px 1fr auto 20px', gap: 12, alignItems: 'center', padding: '12px 16px', borderTop: i > 0 ? '1px solid var(--grey-100)' : 'none', cursor: 'pointer', opacity: v.status === 'inactive' ? 0.6 : 1 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--pink-light)', color: 'var(--pink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>{(v.name || '?').slice(0, 2).toUpperCase()}</div>
                  <div><div style={{ fontSize: 14, fontWeight: 500, color: 'var(--grey-800)' }}>{v.name} {v.is_preferred && <span style={{ color: 'var(--orange)' }}>★</span>}</div><div style={{ fontSize: 12, color: 'var(--grey-400)' }}>{v.rating ? ('★ ' + v.rating) : ''}{used > 0 ? ((v.rating ? ' · ' : '') + used + ' event' + (used > 1 ? 's' : '')) : ''}</div></div>
                  <div><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: 'var(--blue-light)', color: 'var(--blue)' }}>{catLabel(v.category)}</span></div>
                  <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>{[v.contact_person, v.phone_1, v.city].filter(Boolean).join(' · ') || '—'}</div>
                  <div><span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 12, background: sc.bg, color: sc.color }}>{(v.status || '').toUpperCase()}</span></div>
                  <div style={{ color: 'var(--grey-400)' }}>›</div>
                </div>
              ); })}
            </div>}
      </>}

      {activeTab === 'onboarding' && <>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
          <select className="field-input" style={{ width: 160 }} value={obStatusF} onChange={(e) => setObStatusF(e.target.value)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <button className="btn sm" onClick={loadOnboardings}>↻ Refresh</button>
        </div>
        {obLoading ? <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          : onboardings.length === 0 ? <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: 50, textAlign: 'center', border: '1px solid var(--grey-100)', color: 'var(--grey-400)' }}>No onboarding requests{obStatusF ? ' with status "' + obStatusF + '"' : ''}.</div>
            : <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px auto', gap: 10, padding: '8px 16px', background: 'var(--grey-50)', fontSize: 11, fontWeight: 600, color: 'var(--grey-400)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                <div>Vendor</div><div>Category</div><div>Status</div><div />
              </div>
              {onboardings.map((ob, i) => {
                const sf = ob.submitted_fields || {};
                const sc = obStatusColor(ob.status);
                return (
                  <div key={ob.onboarding_id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px auto', gap: 10, padding: '12px 16px', borderTop: i > 0 ? '1px solid var(--grey-100)' : 'none', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{sf.name || '(not submitted)'}</div>
                      <div style={{ fontSize: 11, color: 'var(--grey-400)' }}>Invited {ob.created_at ? new Date(ob.created_at).toLocaleDateString('en-IN') : '—'}{ob.submitted_at ? ' · Submitted ' + new Date(ob.submitted_at).toLocaleDateString('en-IN') : ''}</div>
                    </div>
                    <div><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: 'var(--blue-light)', color: 'var(--blue)' }}>{catLabel(sf.category) || '—'}</span></div>
                    <div><span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 12, background: sc.bg, color: sc.color }}>{(ob.status || '').toUpperCase()}</span></div>
                    <div>{ob.status === 'submitted' && <button className="btn sm primary" onClick={() => openReview(ob)}>Review</button>}</div>
                  </div>
                );
              })}
            </div>}
      </>}
    </div>
  );
}
