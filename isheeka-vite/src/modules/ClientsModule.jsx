// Clients module — list, 360 detail (events/quotes/invoices rollup), client form,
// alternative contacts, and Excel bulk upload. Ported verbatim from isheeka-erp-v22.html.
import React, { useState, useEffect } from 'react';
import { readAoa, downloadAoa } from '../lib/xlsxIO.js';
import { supabase } from '../lib/supabase';
import { notify, runDb } from '../lib/toast.jsx';
import { getNextClientRef } from '../lib/refs.js';
import { InputField, SelectField, AutocompleteInput } from '../components/fields.jsx';
import { fmtDate, eventTypeLabel, leadStageDisplay } from '../lib/format.js';
import { EVENT_STATUS_COLORS, EVENT_STATUS_LABELS, QUOT_STATUS_COLORS, QUOT_STATUS_LABELS } from '../lib/constants.js';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { CLIENT_TEMPLATES, logEmail, sendWhatsApp } from '../lib/messaging.js';

export function ClientForm({ initial = {}, onSave, onCancel, title = 'New client' }) {
  const empty = { first_name: '', last_name: '', phone_1: '', phone_2: '', phone_3: '',
    email_1: '', email_2: '', email_3: '', street_address: '', city: 'Hyderabad', state: '', pincode: '',
    gst_number: '', source: '', status: 'active', preferred_contact: '', notes: '' };
  const [form, setForm] = useState({ ...empty, ...initial });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const set = (field, val) => {
    setForm((f) => ({ ...f, [field]: val }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: '' }));
    setSaveError('');
  };

  const validate = () => {
    const e = {};
    if (!form.first_name?.trim()) e.first_name = 'First name is required';
    if (!form.last_name?.trim()) e.last_name = 'Last name is required';
    if (!form.phone_1?.trim()) e.phone_1 = 'Primary phone is required';
    if (!form.email_1?.trim()) e.email_1 = 'Primary email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email_1.trim())) e.email_1 = 'Enter a valid email';
    if (form.email_2?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email_2.trim())) e.email_2 = 'Enter a valid email';
    if (form.email_3?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email_3.trim())) e.email_3 = 'Enter a valid email';
    if (!form.source) e.source = 'Please select a source';
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); setSaveError('Please fill in all required fields.'); return; }
    setSaving(true); setSaveError('');
    const norm = { ...form };
    ['first_name', 'last_name', 'email_1', 'email_2', 'email_3', 'phone_1', 'phone_2', 'phone_3', 'city', 'state', 'pincode', 'street_address', 'gst_number'].forEach((k) => { if (typeof norm[k] === 'string') norm[k] = norm[k].trim(); });
    try { await onSave(norm); }
    catch (err) { setSaveError('Could not save client. Please try again.'); }
    finally { setSaving(false); }
  };

  const sourceOpts = [{ value: 'referral', label: 'Referral' }, { value: 'website', label: 'Website' }, { value: 'manual', label: 'Manual' }];
  const statusOpts = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'vip', label: 'VIP' }];
  const contactOpts = [{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'phone', label: 'Phone' }, { value: 'email', label: 'Email' }];

  return (
    <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--grey-800)' }}>{title}</div>
        <button className="btn sm" onClick={onCancel}>✕ Cancel</button>
      </div>
      <div style={{ padding: 24 }}>
        {saveError && <div style={{ background: 'var(--red-light)', color: 'var(--red)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 13, marginBottom: 16, border: '1px solid rgba(163,45,45,0.2)' }}>⚠️ {saveError}</div>}

        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-600)', marginBottom: 12 }}>Personal details</div>
        <div className="form-grid" style={{ marginBottom: 16 }}>
          <InputField label="First name" required value={form.first_name} onChange={(v) => set('first_name', v)} placeholder="e.g. Priya" error={errors.first_name} />
          <InputField label="Last name" required value={form.last_name} onChange={(v) => set('last_name', v)} placeholder="e.g. Sharma" error={errors.last_name} />
        </div>
        <div className="form-grid three" style={{ marginBottom: 16 }}>
          <InputField label="Phone 1" required value={form.phone_1} onChange={(v) => set('phone_1', v)} placeholder="+91 98765 43210" error={errors.phone_1} />
          <InputField label="Phone 2" value={form.phone_2} onChange={(v) => set('phone_2', v)} placeholder="+91 XXXXX XXXXX" />
          <InputField label="Phone 3" value={form.phone_3} onChange={(v) => set('phone_3', v)} placeholder="+91 XXXXX XXXXX" />
        </div>
        <div className="form-grid three" style={{ marginBottom: 16 }}>
          <InputField label="Email 1" required value={form.email_1} onChange={(v) => set('email_1', v)} placeholder="priya@email.com" error={errors.email_1} />
          <InputField label="Email 2" value={form.email_2} onChange={(v) => set('email_2', v)} placeholder="alt@email.com" error={errors.email_2} />
          <InputField label="Email 3" value={form.email_3} onChange={(v) => set('email_3', v)} placeholder="alt2@email.com" error={errors.email_3} />
        </div>
        <div style={{ height: 1, background: 'var(--grey-100)', margin: '16px 0' }} />
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-600)', marginBottom: 12 }}>Address</div>
        <div className="form-grid one" style={{ marginBottom: 16 }}>
          <InputField label="Street address" value={form.street_address} onChange={(v) => set('street_address', v)} placeholder="e.g. 123 MG Road" />
        </div>
        <div className="form-grid three" style={{ marginBottom: 16 }}>
          <AutocompleteInput label="City" value={form.city} onChange={(v) => set('city', v)} placeholder="Hyderabad" table="clients" column="city" />
          <AutocompleteInput label="State" value={form.state} onChange={(v) => set('state', v)} placeholder="Telangana" table="clients" column="state" />
          <InputField label="Pincode" value={form.pincode} onChange={(v) => set('pincode', v)} placeholder="500001" />
        </div>
        <div style={{ height: 1, background: 'var(--grey-100)', margin: '16px 0' }} />
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-600)', marginBottom: 12 }}>Additional details</div>
        <div className="form-grid three" style={{ marginBottom: 16 }}>
          <SelectField label="Source" required value={form.source} onChange={(v) => set('source', v)} options={sourceOpts} error={errors.source} placeholder="How did they find us?" />
          <SelectField label="Status" value={form.status} onChange={(v) => set('status', v)} options={statusOpts} />
          <SelectField label="Preferred contact" value={form.preferred_contact} onChange={(v) => set('preferred_contact', v)} options={contactOpts} placeholder="Select..." />
        </div>
        <div className="form-grid" style={{ marginBottom: 16 }}>
          <InputField label="GST number" value={form.gst_number} onChange={(v) => set('gst_number', v)} placeholder="Optional" />
          <div />
        </div>
        <div className="form-grid one">
          <InputField label="Notes" type="textarea" value={form.notes} onChange={(v) => set('notes', v)} placeholder="Any additional notes about this client..." />
        </div>
      </div>
      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--grey-50)' }}>
        <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>Fields marked <span style={{ color: 'var(--pink)' }}>*</span> are required</div>
        <button className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? '⏳ Saving...' : '💾 Save client'}
        </button>
      </div>
    </div>
  );
}

function AltContactForm({ clientId, initial = {}, onSave, onCancel }) {
  const empty = { first_name: '', last_name: '', relationship: '', phone: '', email: '', notes: '' };
  const [form, setForm] = useState({ ...empty, ...initial });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (field, val) => { setForm((f) => ({ ...f, [field]: val })); if (errors[field]) setErrors((e) => ({ ...e, [field]: '' })); };

  const validate = () => {
    const e = {};
    if (!form.first_name?.trim()) e.first_name = 'First name is required';
    if (!form.last_name?.trim()) e.last_name = 'Last name is required';
    if (!form.relationship) e.relationship = 'Please select relationship';
    if (!form.phone?.trim()) e.phone = 'Phone is required';
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    setSaving(true);
    try { await onSave({ ...form, client_id: clientId }); }
    finally { setSaving(false); }
  };

  const relOpts = [{ value: 'spouse', label: 'Spouse' }, { value: 'parent', label: 'Parent' }, { value: 'sibling', label: 'Sibling' }, { value: 'friend', label: 'Friend' }, { value: 'other', label: 'Other' }];

  return (
    <div style={{ background: 'var(--grey-50)', borderRadius: 'var(--radius-md)', padding: 16, border: '1px solid var(--grey-200)', marginTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-800)', marginBottom: 12 }}>
        {initial.contact_id ? 'Edit alternative contact' : 'Add alternative contact'}
      </div>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <InputField label="First name" required value={form.first_name} onChange={(v) => set('first_name', v)} error={errors.first_name} placeholder="First name" />
        <InputField label="Last name" required value={form.last_name} onChange={(v) => set('last_name', v)} error={errors.last_name} placeholder="Last name" />
      </div>
      <div className="form-grid three" style={{ marginBottom: 12 }}>
        <SelectField label="Relationship" required value={form.relationship} onChange={(v) => set('relationship', v)} options={relOpts} error={errors.relationship} placeholder="Select..." />
        <InputField label="Phone" required value={form.phone} onChange={(v) => set('phone', v)} error={errors.phone} placeholder="+91 XXXXX XXXXX" />
        <InputField label="Email" value={form.email} onChange={(v) => set('email', v)} placeholder="email@example.com" />
      </div>
      <div className="form-grid one" style={{ marginBottom: 12 }}>
        <InputField label="Notes" type="textarea" value={form.notes} onChange={(v) => set('notes', v)} placeholder="Any notes..." />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn sm" onClick={onCancel}>Cancel</button>
        <button className="btn sm primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save contact'}</button>
      </div>
    </div>
  );
}

function ClientDetail({ clientId, onBack, onNavigate }) {
  const [client, setClient] = useState(null);
  const [altContacts, setAltContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showAltForm, setShowAltForm] = useState(false);
  const [editingAlt, setEditingAlt] = useState(null);

  // Client 360 — read-only, event-grouped relationship view (derived live, nothing stored).
  const [c360, setC360] = useState(null);
  const [c360Loading, setC360Loading] = useState(true);
  const [expanded, setExpanded] = useState({}); // event_id -> bool

  useEffect(() => { loadClient(); load360(); }, [clientId]);

  const load360 = async () => {
    setC360Loading(true);
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: events }, { data: quotes }, { data: invoices }, { data: leads }] = await Promise.all([
      supabase.from('events').select('event_id,ref_number,name,type,status,main_date,location').eq('client_id', clientId).eq('is_deleted', false),
      supabase.from('quotations').select('quotation_id,ref_number,status,grand_total,event_id,lead_id,revision_number,doc_date,created_at').eq('client_id', clientId).eq('is_deleted', false),
      supabase.from('invoices').select('invoice_id,ref_number,status,grand_total,total_received,total_outstanding,event_id,revision_number,doc_date').eq('client_id', clientId).eq('is_deleted', false),
      supabase.from('leads').select('lead_id,ref_number,stage,event_id,budget,created_at').eq('client_id', clientId).eq('is_deleted', false),
    ]);
    const evs = events || [], qs = quotes || [], invs = invoices || [], lds = leads || [];
    const eventIds = evs.map((e) => e.event_id), invoiceIds = invs.map((i) => i.invoice_id);
    const [{ data: vendors }, { data: vpays }, { data: ipays }] = await Promise.all([
      eventIds.length ? supabase.from('event_vendors').select('event_id,outstanding').in('event_id', eventIds).eq('is_deleted', false) : Promise.resolve({ data: [] }),
      eventIds.length ? supabase.from('vendor_payments').select('amount,event_id,is_voided').in('event_id', eventIds) : Promise.resolve({ data: [] }),
      invoiceIds.length ? supabase.from('invoice_payments').select('invoice_id').in('invoice_id', invoiceIds) : Promise.resolve({ data: [] }),
    ]);
    const isActive = (i) => (i.status || '').toLowerCase() !== 'cancelled';
    const num = (v) => parseFloat(v) || 0;
    const invOut = (i) => num(i.total_outstanding != null ? i.total_outstanding : (num(i.grand_total) - num(i.total_received)));
    const payCountByInv = {}; (ipays || []).forEach((p) => { payCountByInv[p.invoice_id] = (payCountByInv[p.invoice_id] || 0) + 1; });
    const vendOutByEvt = {}; (vendors || []).forEach((v) => { vendOutByEvt[v.event_id] = (vendOutByEvt[v.event_id] || 0) + num(v.outstanding); });
    const eventCards = evs.map((e) => {
      const eq = qs.filter((q) => q.event_id === e.event_id);
      const ei = invs.filter((i) => i.event_id === e.event_id);
      const eiActive = ei.filter(isActive);
      const invoiced = eiActive.reduce((s, i) => s + num(i.grand_total), 0);
      const received = eiActive.reduce((s, i) => s + num(i.total_received), 0);
      const outstanding = eiActive.reduce((s, i) => s + invOut(i), 0);
      const payCount = ei.reduce((s, i) => s + (payCountByInv[i.invoice_id] || 0), 0);
      return { ...e, quotes: eq, invoices: ei, invoiced, received, outstanding, vendorOut: vendOutByEvt[e.event_id] || 0, payCount };
    }).sort((a, b) => String(b.main_date || '').localeCompare(String(a.main_date || '')));
    const activeInvs = invs.filter(isActive);
    const kpis = {
      events: evs.length,
      upcoming: evs.filter((e) => e.main_date && e.main_date >= today && !['completed', 'cancelled'].includes((e.status || '').toLowerCase())).length,
      invoiced: activeInvs.reduce((s, i) => s + num(i.grand_total), 0),
      received: activeInvs.reduce((s, i) => s + num(i.total_received), 0),
      outstanding: activeInvs.reduce((s, i) => s + invOut(i), 0),
      vendorDue: (vendors || []).reduce((s, v) => s + num(v.outstanding), 0),
    };
    const liveQuote = (q) => !['superseded', 'rejected', 'expired', 'converted', 'invoiced'].includes((q.status || '').toLowerCase());
    const openQuotes = qs.filter((q) => !q.event_id && liveQuote(q)).map((q) => ({ kind: 'quote', id: q.quotation_id, ref: q.ref_number, status: q.status, amount: num(q.grand_total), lead_id: q.lead_id }));
    const openLeads = lds.filter((l) => !l.event_id && !openQuotes.some((q) => q.lead_id === l.lead_id)).map((l) => ({ kind: 'lead', id: l.lead_id, ref: l.ref_number, stage: l.stage, amount: num(l.budget) }));
    const opportunities = [...openQuotes, ...openLeads];
    setC360({ eventCards, kpis, opportunities });
    if (eventCards.length) setExpanded({ [eventCards[0].event_id]: true });
    setC360Loading(false);
  };

  const loadClient = async () => {
    setLoading(true);
    const [{ data: c }, { data: ac }] = await Promise.all([
      supabase.from('clients').select('*').eq('client_id', clientId).single(),
      supabase.from('alternative_contacts').select('*').eq('client_id', clientId).eq('is_deleted', false).order('created_at'),
    ]);
    if (c) setClient(c);
    if (ac) setAltContacts(ac);
    setLoading(false);
  };

  const handleSaveClient = async (form) => {
    const { error } = await supabase.from('clients').update({ ...form, updated_at: new Date().toISOString() }).eq('client_id', clientId);
    if (error) throw error;
    setClient({ ...client, ...form });
    setEditing(false);
  };

  const handleSaveAlt = async (form) => {
    if (editingAlt) {
      const { error: aue } = await runDb(supabase.from('alternative_contacts').update({ ...form, updated_at: new Date().toISOString() }).eq('contact_id', editingAlt.contact_id), 'update contact');
      if (aue) return;
      setAltContacts((ac) => ac.map((a) => a.contact_id === editingAlt.contact_id ? { ...a, ...form } : a));
    } else {
      const { data, error: aie } = await runDb(supabase.from('alternative_contacts').insert({ ...form, client_id: clientId, created_at: new Date().toISOString() }).select().single(), 'add contact');
      if (aie) return;
      if (data) setAltContacts((ac) => [...ac, data]);
    }
    setShowAltForm(false); setEditingAlt(null);
  };

  const handleDeleteAlt = async (contactId) => {
    if (!window.confirm('Remove this alternative contact?')) return;
    const { error: ade } = await runDb(supabase.from('alternative_contacts').update({ is_deleted: true }).eq('contact_id', contactId), 'remove contact');
    if (ade) return;
    setAltContacts((ac) => ac.filter((a) => a.contact_id !== contactId));
  };

  // Messaging composer state
  const [showMsgModal, setShowMsgModal] = useState(false);
  const [msgTemplate, setMsgTemplate] = useState(CLIENT_TEMPLATES[0].id);
  const [msgBody, setMsgBody] = useState('');
  const [msgPhone, setMsgPhone] = useState('');
  const [msgSent, setMsgSent] = useState(false);
  const [msgEmail, setMsgEmail] = useState('');
  const [msgLog, setMsgLog] = useState([]);
  const [msgLogLoading, setMsgLogLoading] = useState(false);

  // Load message history for this client
  useEffect(() => {
    if (!clientId) return;
    setMsgLogLoading(true);
    supabase.from('message_log').select('*').eq('party_type', 'client').eq('party_id', clientId).order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => { setMsgLog(data || []); setMsgLogLoading(false); });
  }, [clientId]);

  const openMsgModal = () => {
    setMsgTemplate(CLIENT_TEMPLATES[0].id);
    const tpl = CLIENT_TEMPLATES[0];
    setMsgBody(client ? tpl.body(client) : '');
    setMsgPhone(client ? (client.phone_1 || '') : '');
    setMsgEmail(client ? (client.email_1 || '') : '');
    setMsgSent(false);
    setShowMsgModal(true);
  };

  const handleTemplateChange = (id) => {
    setMsgTemplate(id);
    const tpl = CLIENT_TEMPLATES.find((t) => t.id === id) || CLIENT_TEMPLATES[0];
    setMsgBody(client ? tpl.body(client) : '');
  };

  const handleSendEmail = () => {
    if (!msgEmail || !msgBody) return;
    const subject = encodeURIComponent('Isheeka Events — ' + (CLIENT_TEMPLATES.find((t) => t.id === msgTemplate) || {}).label || 'Message');
    const body = encodeURIComponent(msgBody);
    window.open('mailto:' + encodeURIComponent(msgEmail) + '?subject=' + subject + '&body=' + body, '_blank');
    logEmail({ to: msgEmail, subject: decodeURIComponent(subject), body: msgBody, party_type: 'client', party_id: clientId, template: msgTemplate }).catch(() => {});
    setMsgSent(true);
    setTimeout(() => {
      supabase.from('message_log').select('*').eq('party_type', 'client').eq('party_id', clientId).order('created_at', { ascending: false }).limit(50)
        .then(({ data }) => setMsgLog(data || []));
    }, 1200);
  };

  const handleSendWA = () => {
    sendWhatsApp({ phone: msgPhone, body: msgBody, party_type: 'client', party_id: clientId, template: msgTemplate });
    setMsgSent(true);
    // Refresh log after short delay to let the insert settle
    setTimeout(() => {
      supabase.from('message_log').select('*').eq('party_type', 'client').eq('party_id', clientId).order('created_at', { ascending: false }).limit(50)
        .then(({ data }) => setMsgLog(data || []));
    }, 1200);
  };

  const [statusSaving, setStatusSaving] = useState(false);
  const handleSetStatus = async (newStatus) => {
    if (!newStatus || newStatus === client.status) return;
    setStatusSaving(true);
    const { error: cse } = await runDb(supabase.from('clients').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('client_id', clientId), 'update client status');
    setStatusSaving(false);
    if (cse) return;
    setClient((c) => ({ ...c, status: newStatus }));
    notify(newStatus === 'inactive' ? 'Client set to Inactive — they won\'t appear when creating new leads, quotes, or events.' : 'Client status updated.', 'success');
  };

  // Soft-delete (archive). Blocked when the client is referenced by any non-deleted record.
  const handleDeleteClient = async () => {
    const checks = await Promise.all([
      supabase.from('leads').select('lead_id', { count: 'exact', head: true }).eq('client_id', clientId).eq('is_deleted', false),
      supabase.from('quotations').select('quotation_id', { count: 'exact', head: true }).eq('client_id', clientId).eq('is_deleted', false),
      supabase.from('events').select('event_id', { count: 'exact', head: true }).eq('client_id', clientId).eq('is_deleted', false),
      supabase.from('invoices').select('invoice_id', { count: 'exact', head: true }).eq('client_id', clientId).eq('is_deleted', false),
    ]);
    const labels = ['lead', 'quotation', 'event', 'invoice'];
    const linked = checks.map((r, i) => ({ label: labels[i], n: r.count || 0 })).filter((x) => x.n > 0);
    if (linked.length > 0) {
      const summary = linked.map((x) => x.n + ' ' + x.label + (x.n > 1 ? 's' : '')).join(', ');
      notify('Cannot delete — this client is linked to ' + summary + '. Set them Inactive instead to stop using them on new records.', 'error');
      return;
    }
    if (!window.confirm('Delete (archive) ' + client.first_name + ' ' + client.last_name + '? They will be removed from the Clients list. This can be undone in the database if needed.')) return;
    const { error: cde } = await runDb(supabase.from('clients').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('client_id', clientId), 'delete client');
    if (cde) return;
    notify('Client archived.', 'success');
    onBack && onBack();
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>;
  if (!client) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--grey-400)' }}>Client not found.</div>;

  if (editing) return <ClientForm initial={client} title="Edit client" onSave={handleSaveClient} onCancel={() => setEditing(false)} />;

  const statusColors = { active: { bg: 'var(--green-light)', color: 'var(--green)' }, inactive: { bg: 'var(--grey-100)', color: 'var(--grey-400)' }, vip: { bg: 'var(--pink-light)', color: 'var(--pink)' } };
  const sc = statusColors[client.status?.toLowerCase()] || statusColors.active;
  const relLabels = { spouse: 'Spouse', parent: 'Parent', sibling: 'Sibling', friend: 'Friend', other: 'Other' };
  const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
  const inrShort = (n) => { n = Math.round(n || 0); if (n >= 10000000) return '₹' + (n / 10000000).toFixed(n % 10000000 ? 2 : 0) + 'Cr'; if (n >= 100000) return '₹' + (n / 100000).toFixed(n % 100000 ? 2 : 1) + 'L'; if (n >= 1000) return '₹' + (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k'; return '₹' + n.toLocaleString('en-IN'); };

  return (
    <div>
      {/* Header */}
      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--grey-100)', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--pink-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: 'var(--pink)', flexShrink: 0 }}>
            {client.first_name?.charAt(0)}{client.last_name?.charAt(0)}
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--grey-800)' }}>{client.first_name} {client.last_name}{client.ref_number && <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--grey-400)', marginLeft: 8 }}>{client.ref_number}</span>}</div>
            <div style={{ fontSize: 13, color: 'var(--grey-400)', marginTop: 2 }}>{client.email_1} · {client.phone_1}</div>
            <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
              <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: sc.bg, color: sc.color }}>
                {client.status?.toUpperCase()}
              </span>
              <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: 'var(--blue-light)', color: 'var(--blue)' }}>
                {client.source}
              </span>
              {c360 && c360.kpis.events > 1 && <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: 'var(--pink-light)', color: 'var(--pink)' }}>Repeat client</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="field-input" style={{ width: 130, fontSize: 13, padding: '6px 10px' }} value={client.status || 'active'} disabled={statusSaving} onChange={(e) => handleSetStatus(e.target.value)} title="Client status">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="vip">VIP</option>
          </select>
          <button className="btn sm" onClick={() => onNavigate && onNavigate('rfqs', { mode: 'new', label: 'New RFQ', prefill: { client_id: clientId, contact_first_name: client.first_name, contact_last_name: client.last_name, contact_phone: client.phone_1, contact_email: client.email_1, city: client.city } })} title="Send this client a requirements link">📝 New RFQ</button>
          <button className="btn sm" onClick={openMsgModal}>💬 Send Message</button>
          <button className="btn sm primary" onClick={() => setEditing(true)}>✏️ Edit client</button>
          <button className="btn sm" style={{ color: 'var(--red)', borderColor: 'rgba(163,45,45,0.3)' }} onClick={handleDeleteClient}>🗑 Delete</button>
        </div>
      </div>

      {/* Client 360 (relationship view) */}
      {c360Loading ? (
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '28px', border: '1px solid var(--grey-100)', marginBottom: 16, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>
      ) : c360 && (c360.kpis.events > 0 || c360.opportunities.length > 0) ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 16 }}>
            {[
              { l: 'Events', v: c360.kpis.events, sub: c360.kpis.upcoming > 0 ? c360.kpis.upcoming + ' upcoming' : null, c: 'var(--grey-800)' },
              { l: 'Invoiced', v: inrShort(c360.kpis.invoiced), c: 'var(--grey-800)' },
              { l: 'Received', v: inrShort(c360.kpis.received), c: 'var(--green)' },
              { l: 'Outstanding', v: inrShort(c360.kpis.outstanding), c: c360.kpis.outstanding > 0 ? 'var(--red)' : 'var(--grey-800)' },
              { l: 'Vendor due', v: inrShort(c360.kpis.vendorDue), c: c360.kpis.vendorDue > 0 ? '#854F0B' : 'var(--grey-800)' },
            ].map((k) => (
              <div key={k.l} style={{ background: 'white', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--grey-400)' }}>{k.l}</div>
                <div style={{ fontSize: 19, fontWeight: 600, color: k.c, marginTop: 2 }}>{k.v}</div>
                {k.sub && <div style={{ fontSize: 10, color: 'var(--grey-400)', marginTop: 1 }}>{k.sub}</div>}
              </div>
            ))}
          </div>

          {c360.eventCards.length > 0 && <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', color: 'var(--gold)', marginBottom: 10 }}>EVENTS &amp; TRANSACTIONS</div>}
          {c360.eventCards.map((ev) => {
            const esc = EVENT_STATUS_COLORS[(ev.status || '').toLowerCase()] || EVENT_STATUS_COLORS.planning;
            const open = !!expanded[ev.event_id];
            const liveQuotes = ev.quotes.filter((q) => !['superseded', 'rejected', 'expired'].includes((q.status || '').toLowerCase()));
            const aq = liveQuotes[0] || ev.quotes[0];
            const activeInvs = ev.invoices.filter((i) => (i.status || '').toLowerCase() !== 'cancelled');
            const iv = activeInvs[0] || ev.invoices[0];
            const fullyPaid = ev.invoiced > 0 && ev.outstanding <= 0.5;
            return (
              <div key={ev.event_id} style={{ background: 'white', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 10 }}>
                <div style={{ height: 4, background: esc.dot }} />
                <div style={{ padding: '12px 16px' }}>
                  <div onClick={() => setExpanded((x) => ({ ...x, [ev.event_id]: !x[ev.event_id] }))} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }}>
                    <span onClick={(e) => { e.stopPropagation(); onNavigate && onNavigate('events', { eventId: ev.event_id, label: ev.name || ev.ref_number || 'Event' }); }} style={{ fontSize: 14, fontWeight: 600, color: 'var(--grey-800)', textDecoration: 'underline', textDecorationColor: 'var(--grey-200)' }}>{ev.name || eventTypeLabel(ev.type) || 'Event'}</span>
                    <StatusBadge kind="event" status={(ev.status || '').toLowerCase()} />
                    {!open && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--grey-600)' }}>{inr(ev.invoiced)}{fullyPaid ? <span style={{ color: 'var(--green)' }}> · fully paid</span> : ev.outstanding > 0 ? <span style={{ color: 'var(--red)' }}> · {inr(ev.outstanding)} due</span> : null}</span>}
                    <span style={{ marginLeft: open ? 'auto' : 0, color: 'var(--grey-400)', fontSize: 12 }}>{open ? '▾' : '▸'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--grey-400)', marginTop: 2 }}>{ev.ref_number}{ev.type ? ' · ' + eventTypeLabel(ev.type) : ''}{ev.main_date ? ' · ' + fmtDate(ev.main_date) : ''}{ev.location ? ' · ' + ev.location : ''}</div>

                  {open && <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '12px 0', fontSize: 12 }}>
                      <span title="Client RFQ portal" style={{ padding: '4px 10px', border: '1px dashed var(--grey-200)', borderRadius: 20, color: 'var(--grey-400)' }}>RFQ —</span>
                      <span style={{ color: 'var(--grey-300)' }}>→</span>
                      {aq ? <span onClick={() => onNavigate && onNavigate('quotations', { quotId: aq.quotation_id, label: aq.ref_number })} style={{ padding: '4px 10px', border: '1px solid var(--pink-mid)', borderRadius: 20, color: 'var(--pink)', cursor: 'pointer' }}>{ev.quotes.length > 1 ? ev.quotes.length + ' quotes' : aq.ref_number}</span> : <span style={{ padding: '4px 10px', border: '1px solid var(--grey-200)', borderRadius: 20, color: 'var(--grey-400)' }}>No quote</span>}
                      <span style={{ color: 'var(--grey-300)' }}>→</span>
                      {iv ? <span onClick={() => onNavigate && onNavigate('invoices', { invoiceId: iv.invoice_id, label: iv.ref_number })} style={{ padding: '4px 10px', border: '1px solid var(--pink-mid)', borderRadius: 20, color: 'var(--pink)', cursor: 'pointer' }}>{activeInvs.length > 1 ? activeInvs.length + ' invoices' : iv.ref_number}</span> : <span style={{ padding: '4px 10px', border: '1px solid var(--grey-200)', borderRadius: 20, color: 'var(--grey-400)' }}>No invoice</span>}
                      <span style={{ color: 'var(--grey-300)' }}>→</span>
                      <span style={{ padding: '4px 10px', border: '1px solid var(--grey-200)', borderRadius: 20, color: 'var(--grey-600)' }}>{ev.payCount} payment{ev.payCount === 1 ? '' : 's'}</span>
                      {ev.vendorOut > 0 && <><span style={{ color: 'var(--grey-300)' }}>→</span><span style={{ padding: '4px 10px', border: '1px solid var(--grey-200)', borderRadius: 20, color: '#854F0B' }}>Vendors {inr(ev.vendorOut)} due</span></>}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, background: 'var(--grey-50)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
                      {[['Invoiced', inr(ev.invoiced), 'var(--grey-800)'], ['Received', inr(ev.received), 'var(--green)'], ['Outstanding', inr(ev.outstanding), ev.outstanding > 0 ? 'var(--red)' : 'var(--grey-800)'], ['Vendor bal.', inr(ev.vendorOut), ev.vendorOut > 0 ? '#854F0B' : 'var(--grey-800)']].map(([l, v, c]) => (
                        <div key={l}><div style={{ fontSize: 10, color: 'var(--grey-400)' }}>{l}</div><div style={{ fontSize: 13, fontWeight: 500, color: c }}>{v}</div></div>
                      ))}
                    </div>
                  </>}
                </div>
              </div>
            );
          })}

          {c360.opportunities.length > 0 && <>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', color: 'var(--gold)', margin: '14px 0 8px' }}>OPEN — NOT YET AN EVENT</div>
            {c360.opportunities.map((o) => (
              <div key={o.kind + o.id} onClick={() => o.kind === 'quote' ? onNavigate && onNavigate('quotations', { quotId: o.id, label: o.ref }) : onNavigate && onNavigate('leads', { leadId: o.id, label: o.ref })} style={{ background: 'white', border: '1px dashed var(--grey-200)', borderRadius: 'var(--radius-md)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer', marginBottom: 8 }}>
                {o.kind === 'quote' ? <>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--pink)' }}>{o.ref}</span>
                  {(() => { const qc = QUOT_STATUS_COLORS[o.status] || QUOT_STATUS_COLORS.draft; return <StatusBadge kind="quote" status={o.status} />; })()}
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--grey-400)' }}>{inr(o.amount)}</span>
                </> : <>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gold)' }}>LEAD</span>
                  <span style={{ fontSize: 13, color: 'var(--grey-800)' }}>{o.ref}</span>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'var(--grey-100)', color: 'var(--grey-600)' }}>{leadStageDisplay(o.stage)}</span>
                  {o.amount > 0 && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--grey-400)' }}>{inr(o.amount)}</span>}
                </>}
              </div>
            ))}
          </>}
        </div>
      ) : c360 ? (
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '24px', border: '1px solid var(--grey-100)', marginBottom: 16, textAlign: 'center', color: 'var(--grey-400)', fontSize: 13 }}>
          No events, quotes or invoices for this client yet.
        </div>
      ) : null}

      <div className="form-grid">
        {/* Contact details */}
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--grey-100)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 16 }}>Contact details</div>
          {[['Phone 1', client.phone_1], ['Phone 2', client.phone_2], ['Phone 3', client.phone_3], ['Email 1', client.email_1], ['Email 2', client.email_2], ['Email 3', client.email_3]].filter(([, v]) => v).map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--grey-100)', fontSize: 13 }}>
              <span style={{ color: 'var(--grey-400)' }}>{l}</span>
              <span style={{ color: 'var(--grey-800)', fontWeight: 500 }}>{v}</span>
            </div>
          ))}
          {client.street_address && <>
            <div style={{ height: 1, background: 'var(--grey-100)', margin: '12px 0' }} />
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--grey-400)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Address</div>
            <div style={{ fontSize: 13, color: 'var(--grey-800)', lineHeight: 1.6 }}>{client.street_address}<br />{client.city}{client.state ? `, ${client.state}` : ''}{client.pincode ? ` — ${client.pincode}` : ''}</div>
          </>}
          {client.gst_number && <div style={{ marginTop: 12, fontSize: 13 }}><span style={{ color: 'var(--grey-400)' }}>GST: </span><span style={{ color: 'var(--grey-800)' }}>{client.gst_number}</span></div>}
          {client.preferred_contact && <div style={{ marginTop: 8, fontSize: 13 }}><span style={{ color: 'var(--grey-400)' }}>Preferred: </span><span style={{ color: 'var(--grey-800)', fontWeight: 500, textTransform: 'capitalize' }}>{client.preferred_contact}</span></div>}
          {client.notes && <><div style={{ height: 1, background: 'var(--grey-100)', margin: '12px 0' }} /><div style={{ fontSize: 12, fontWeight: 500, color: 'var(--grey-400)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>Notes</div><div style={{ fontSize: 13, color: 'var(--grey-600)', lineHeight: 1.6 }}>{client.notes}</div></>}
        </div>

        {/* Alternative contacts */}
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--grey-100)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)' }}>Alternative contacts</div>
            <button className="btn sm" onClick={() => { setShowAltForm(true); setEditingAlt(null); }}>+ Add</button>
          </div>
          {altContacts.length === 0 && !showAltForm && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--grey-400)', fontSize: 13 }}>
              No alternative contacts yet.<br />
              <span style={{ fontSize: 12 }}>Add family members or other contacts.</span>
            </div>
          )}
          {altContacts.map((ac) => (
            <div key={ac.contact_id} style={{ padding: '10px 0', borderBottom: '1px solid var(--grey-100)' }}>
              {editingAlt?.contact_id === ac.contact_id ? (
                <AltContactForm clientId={clientId} initial={editingAlt} onSave={handleSaveAlt} onCancel={() => setEditingAlt(null)} />
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-800)' }}>{ac.first_name} {ac.last_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--grey-400)', marginTop: 2 }}>{relLabels[ac.relationship] || ac.relationship} · {ac.phone}</div>
                    {ac.email && <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>{ac.email}</div>}
                    {ac.notes && <div style={{ fontSize: 12, color: 'var(--grey-600)', marginTop: 4, fontStyle: 'italic' }}>{ac.notes}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn sm" onClick={() => { setEditingAlt(ac); setShowAltForm(false); }}>✏️</button>
                    <button className="btn sm" style={{ color: 'var(--red)' }} onClick={() => handleDeleteAlt(ac.contact_id)}>🗑</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {showAltForm && <AltContactForm clientId={clientId} onSave={handleSaveAlt} onCancel={() => setShowAltForm(false)} />}
        </div>
      </div>

      {/* History panels */}
      <div style={{ marginTop: 16, background: 'white', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--grey-100)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 16 }}>Client history</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {[{ icon: '🎪', label: 'Events', val: '0', color: 'var(--green-light)', tc: 'var(--green)' }, { icon: '📋', label: 'Quotations', val: '0', color: 'var(--orange-light)', tc: 'var(--orange)' }, { icon: '💰', label: 'Total business', val: '₹0', color: 'var(--pink-light)', tc: 'var(--pink)' }].map((h, i) => (
            <div key={i} style={{ padding: 16, background: h.color, borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>{h.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: h.tc }}>{h.val}</div>
              <div style={{ fontSize: 12, color: h.tc, opacity: .8 }}>{h.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Message history */}
      <div style={{ marginTop: 16, background: 'white', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--grey-100)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)' }}>Message history</div>
          <button className="btn sm" onClick={openMsgModal}>💬 Send Message</button>
        </div>
        {msgLogLoading ? <div style={{ textAlign: 'center', padding: '16px 0' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>
          : msgLog.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)', textAlign: 'center', padding: '12px 0' }}>No messages sent yet.</div>
            : msgLog.map((m) => (
              <div key={m.id || m.created_at} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--grey-100)', fontSize: 13 }}>
                <span style={{ fontSize: 16 }}>{m.channel === 'whatsapp' ? '📲' : '📧'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 500, color: 'var(--grey-700)' }}>{(CLIENT_TEMPLATES.find((t) => t.id === m.template) || {}).label || m.template || 'Custom'}</span>
                  {m.body && <span style={{ color: 'var(--grey-400)', marginLeft: 8 }}>{m.body.slice(0, 40)}{m.body.length > 40 ? '…' : ''}</span>}
                </div>
                <span style={{ fontSize: 11, color: 'var(--grey-400)', whiteSpace: 'nowrap' }}>{m.created_at ? new Date(m.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : ''}</span>
              </div>
            ))}
      </div>

      {/* Compose modal */}
      {showMsgModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '24px 28px', width: 480, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)' }}>💬 Send Message</div>
              <button className="btn sm" onClick={() => setShowMsgModal(false)}>✕ Close</button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--grey-500)', display: 'block', marginBottom: 4 }}>Template</label>
              <select className="field-input" value={msgTemplate} onChange={(e) => handleTemplateChange(e.target.value)} style={{ width: '100%' }}>
                {CLIENT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--grey-500)', display: 'block', marginBottom: 4 }}>Message</label>
              <textarea className="field-input" value={msgBody} onChange={(e) => setMsgBody(e.target.value)} rows={5} style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} placeholder="Type your message…" />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--grey-500)', display: 'block', marginBottom: 4 }}>Phone number (for this send)</label>
              <input className="field-input" value={msgPhone} onChange={(e) => setMsgPhone(e.target.value)} style={{ width: '100%' }} placeholder="+91 98765 43210" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--grey-500)', display: 'block', marginBottom: 4 }}>Email (for this send)</label>
              <input className="field-input" value={msgEmail} onChange={(e) => setMsgEmail(e.target.value)} style={{ width: '100%' }} placeholder="client@email.com" type="email" />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={handleSendWA} disabled={!msgPhone || !msgBody}>📲 Send on WhatsApp</button>
              <button className="btn" onClick={handleSendEmail} disabled={!msgEmail || !msgBody}>📧 Send by Email</button>
              {msgSent && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500 }}>✅ Sent</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MassClientUpload({ onClose, onSuccess }) {
  const [step, setStep] = useState('intro'); // intro | preview | uploading | done
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [progress, setProgress] = useState(0);
  const [imported, setImported] = useState(0);
  const [failed, setFailed] = useState(0);
  const fileRef = React.useRef();

  const COLUMNS = [
    'first_name', 'last_name', 'phone_1', 'phone_2', 'phone_3',
    'email_1', 'email_2', 'email_3', 'source', 'status',
    'preferred_contact', 'street_address', 'city', 'state', 'pincode',
    'gst_number', 'notes',
  ];
  const REQUIRED = ['first_name', 'last_name', 'phone_1', 'source'];
  const VALID_SOURCE = ['referral', 'website', 'manual'];
  const VALID_STATUS = ['active', 'inactive', 'vip'];
  const VALID_CONTACT = ['whatsapp', 'phone', 'email', ''];

  const downloadTemplate = () => {
    downloadAoa('Isheeka_Clients_Upload_Template.xlsx', 'Clients', [
      COLUMNS,
      ['Priya', 'Sharma', '+91 98765 43210', '', '', 'priya@email.com', '', '', 'referral', 'active', 'whatsapp', 'Banjara Hills', 'Hyderabad', 'Telangana', '500034', '', 'VIP client'],
      ['Ravi', 'Menon', '+91 87654 32109', '', '', 'ravi@email.com', '', '', 'website', 'active', 'email', 'Jubilee Hills', 'Hyderabad', 'Telangana', '500033', '', ''],
    ], COLUMNS.map(() => 18));
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = await readAoa(evt.target.result);
        if (data.length < 2) { notify('File appears empty. Please add at least one client row.', 'error'); return; }

        const header = data[0].map((h) => String(h).trim().toLowerCase().replace(/ /g, '_'));
        const dataRows = data.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));

        const parsed = []; const rowErrors = [];
        dataRows.forEach((row, ri) => {
          const obj = {};
          header.forEach((h, ci) => { obj[h] = String(row[ci] || '').trim(); });

          const rowErrs = [];
          REQUIRED.forEach((f) => { if (!obj[f]) rowErrs.push(`${f} is required`); });
          if (obj.source && !VALID_SOURCE.includes(obj.source.toLowerCase())) rowErrs.push('source must be: referral, website, or manual');
          if (obj.status && !VALID_STATUS.includes(obj.status.toLowerCase())) rowErrs.push('status must be: active, inactive, or vip');
          if (obj.preferred_contact && !VALID_CONTACT.includes(obj.preferred_contact.toLowerCase())) rowErrs.push('preferred_contact must be: whatsapp, phone, or email');
          if (obj.email_1 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(obj.email_1).trim())) rowErrs.push('email_1 format is invalid');

          if (rowErrs.length > 0) rowErrors.push({ row: ri + 2, errors: rowErrs, data: obj });
          else parsed.push({
            ...obj,
            source: (obj.source || 'manual').toLowerCase(),
            status: (obj.status || 'active').toLowerCase(),
            preferred_contact: (obj.preferred_contact || '').toLowerCase(),
          });
        });

        setRows(parsed);
        setErrors(rowErrors);
        setStep('preview');
      } catch (err) {
        notify('Could not read file. Please use the provided template.', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleImport = async () => {
    setStep('uploading');
    let ok = 0, fail = 0;
    for (let i = 0; i < rows.length; i++) {
      try {
        const ref_number = await getNextClientRef();
        const { error } = await supabase.from('clients').insert({
          ...rows[i],
          ref_number,
          client_since: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          total_business_value: 0,
        });
        if (error) throw error;
        ok++;
      } catch { fail++; }
      setProgress(Math.round(((i + 1) / rows.length) * 100));
    }
    setImported(ok); setFailed(fail);
    setStep('done');
    if (ok > 0) setTimeout(() => onSuccess(ok), 1500);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 680, maxHeight: '85vh', overflow: 'auto', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--grey-800)' }}>Mass client upload</div>
            <div style={{ fontSize: 12, color: 'var(--grey-400)', marginTop: 2 }}>Upload multiple clients at once via Excel</div>
          </div>
          <button className="btn sm" onClick={onClose}>✕ Close</button>
        </div>

        <div style={{ padding: 24 }}>
          {step === 'intro' && (
            <>
              <div style={{ background: 'var(--blue-light)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 24 }}>📋</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--blue)', marginBottom: 4 }}>Step 1 — Download the template</div>
                  <div style={{ fontSize: 13, color: 'var(--blue)', opacity: .8, marginBottom: 10 }}>Use our Excel template to ensure your data is in the correct format. Fill in client details row by row.</div>
                  <button className="btn sm primary" onClick={downloadTemplate}>⬇️ Download Excel template</button>
                </div>
              </div>

              <div style={{ background: 'var(--grey-50)', borderRadius: 'var(--radius-md)', padding: 14, marginBottom: 16, border: '1px solid var(--grey-100)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--grey-600)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Template columns</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {COLUMNS.map((c) => (
                    <div key={c} style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ color: REQUIRED.includes(c) ? 'var(--pink)' : 'var(--green)', fontSize: 10, fontWeight: 700 }}>{REQUIRED.includes(c) ? 'REQ' : 'OPT'}</span>
                      <span style={{ color: 'var(--grey-600)', fontFamily: 'monospace' }}>{c}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--grey-400)' }}>
                  <span style={{ color: 'var(--pink)', fontWeight: 700 }}>REQ</span> = Required &nbsp;·&nbsp;
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>OPT</span> = Optional &nbsp;·&nbsp;
                  source: referral/website/manual &nbsp;·&nbsp; status: active/inactive/vip
                </div>
              </div>

              <div style={{ border: '2px dashed var(--grey-200)', borderRadius: 'var(--radius-md)', padding: 24, textAlign: 'center', cursor: 'pointer', transition: 'border-color .2s' }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--pink)'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--grey-200)'}
                onClick={() => fileRef.current?.click()}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📂</div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--grey-800)', marginBottom: 4 }}>Step 2 — Upload your filled template</div>
                <div style={{ fontSize: 13, color: 'var(--grey-400)', marginBottom: 12 }}>Click here or drag and drop your Excel file (.xlsx)</div>
                <button className="btn sm primary">Choose file</button>
                <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={handleFile} />
              </div>
            </>
          )}

          {step === 'preview' && (
            <>
              {errors.length > 0 && (
                <div style={{ background: 'var(--red-light)', borderRadius: 'var(--radius-md)', padding: 14, marginBottom: 16, border: '1px solid rgba(163,45,45,0.2)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)', marginBottom: 8 }}>⚠️ {errors.length} row{errors.length > 1 ? 's' : ''} with errors (will be skipped)</div>
                  {errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--red)', marginBottom: 4 }}>
                      Row {e.row}: {e.errors.join(' · ')}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ background: 'var(--green-light)', borderRadius: 'var(--radius-md)', padding: 12, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>✅ {rows.length} client{rows.length !== 1 ? 's' : ''} ready to import</div>
                <button className="btn sm" onClick={() => { setStep('intro'); setRows([]); setErrors([]); }}>← Change file</button>
              </div>

              {rows.length > 0 && (
                <div style={{ border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 16 }}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--pink-light)' }}>
                          {['#', 'First name', 'Last name', 'Phone 1', 'Email 1', 'Source', 'Status', 'City'].map((h) => (
                            <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--pink)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.03em', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 10).map((r, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--grey-100)' }}>
                            <td style={{ padding: '8px 10px', color: 'var(--grey-400)' }}>{i + 1}</td>
                            <td style={{ padding: '8px 10px', fontWeight: 500, color: 'var(--grey-800)' }}>{r.first_name}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--grey-800)' }}>{r.last_name}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--grey-600)' }}>{r.phone_1}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--grey-600)' }}>{r.email_1}</td>
                            <td style={{ padding: '8px 10px' }}><span style={{ background: 'var(--blue-light)', color: 'var(--blue)', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500, textTransform: 'capitalize' }}>{r.source}</span></td>
                            <td style={{ padding: '8px 10px' }}><span style={{ background: 'var(--green-light)', color: 'var(--green)', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500, textTransform: 'capitalize' }}>{r.status}</span></td>
                            <td style={{ padding: '8px 10px', color: 'var(--grey-600)' }}>{r.city}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > 10 && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--grey-400)', background: 'var(--grey-50)', borderTop: '1px solid var(--grey-100)' }}>+ {rows.length - 10} more rows not shown</div>}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn" onClick={() => { setStep('intro'); setRows([]); setErrors([]); }}>Cancel</button>
                <button className="btn primary" onClick={handleImport} disabled={rows.length === 0}>
                  🚀 Import {rows.length} client{rows.length !== 1 ? 's' : ''}
                </button>
              </div>
            </>
          )}

          {step === 'uploading' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div className="spinner" style={{ margin: '0 auto 20px' }}></div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 8 }}>Importing clients...</div>
              <div style={{ fontSize: 13, color: 'var(--grey-400)', marginBottom: 20 }}>Please don't close this window</div>
              <div style={{ background: 'var(--grey-100)', borderRadius: 10, height: 10, overflow: 'hidden', maxWidth: 300, margin: '0 auto' }}>
                <div style={{ height: '100%', background: 'var(--pink)', borderRadius: 10, width: `${progress}%`, transition: 'width .3s' }}></div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--grey-400)', marginTop: 8 }}>{progress}%</div>
            </div>
          )}

          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ width: 60, height: 60, borderRadius: '50%', background: failed === 0 ? 'var(--green-light)' : 'var(--orange-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 16px' }}>
                {failed === 0 ? '✅' : '⚠️'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 8 }}>Import complete!</div>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', margin: '16px 0' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--green)' }}>{imported}</div>
                  <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>Imported</div>
                </div>
                {failed > 0 && <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--red)' }}>{failed}</div>
                  <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>Failed</div>
                </div>}
              </div>
              <button className="btn primary" onClick={onClose}>View clients list</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ClientsModule({ nav, onNavigate, onBack }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const detailId = nav && nav.clientId; const isNew = !!(nav && nav.mode === 'new'); // stack-driven
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => { loadClients(); }, []);
  useEffect(() => { if (!detailId && !isNew) loadClients(); }, [detailId, isNew]);

  const loadClients = async () => {
    setLoading(true);
    const { data } = await supabase.from('clients').select('*').eq('is_deleted', false).order('created_at', { ascending: false });
    if (data) setClients(data);
    setLoading(false);
  };

  const handleSaveNew = async (form) => {
    const ref_number = await getNextClientRef();
    const payload = {
      ...form,
      ref_number,
      preferred_contact: form.preferred_contact || null,
      source: form.source || null,
      phone_2: form.phone_2 || null,
      phone_3: form.phone_3 || null,
      email_2: form.email_2 || null,
      email_3: form.email_3 || null,
      gst_number: form.gst_number || null,
      notes: form.notes || null,
      created_by: form.created_by || null,
      updated_by: form.updated_by || null,
      lead_id: form.lead_id || null,
      client_since: new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('clients').insert(payload).select().single();
    if (error) throw error;
    setSaveSuccess(`Client ${form.first_name} ${form.last_name} added successfully!`);
    setTimeout(() => setSaveSuccess(''), 4000);
    loadClients();
    onBack && onBack();
  };

  const filtered = clients.filter((c) => {
    const q = search.toLowerCase();
    const matchSearch = !q || `${c.first_name} ${c.last_name} ${c.phone_1} ${c.email_1} ${c.city} ${c.ref_number || ''}`.toLowerCase().includes(q);
    const matchStatus = !statusFilter || c.status?.toLowerCase() === statusFilter.toLowerCase();
    const matchSource = !sourceFilter || c.source?.toLowerCase() === sourceFilter.toLowerCase();
    return matchSearch && matchStatus && matchSource;
  });

  const statusColors = { active: { bg: 'var(--green-light)', color: 'var(--green)' }, inactive: { bg: 'var(--grey-100)', color: 'var(--grey-400)' }, vip: { bg: 'var(--pink-light)', color: 'var(--pink)' } };

  if (isNew) return <ClientForm onSave={handleSaveNew} onCancel={onBack} />;
  if (detailId) return <ClientDetail clientId={detailId} onBack={onBack} onNavigate={onNavigate} />;

  return (
    <div>
      {saveSuccess && <div style={{ background: 'var(--green-light)', color: 'var(--green)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 13, marginBottom: 16, border: '1px solid rgba(15,110,86,0.2)' }}>✅ {saveSuccess}</div>}

      <div className="metrics-grid" style={{ marginBottom: 20 }}>
        <div className="metric-card pink"><div className="metric-icon">👥</div><div className="metric-value">{clients.length}</div><div className="metric-label">Total clients</div></div>
        <div className="metric-card green"><div className="metric-icon">⭐</div><div className="metric-value">{clients.filter((c) => c.status?.toLowerCase() === 'vip').length}</div><div className="metric-label">VIP clients</div></div>
        <div className="metric-card blue"><div className="metric-icon">✅</div><div className="metric-value">{clients.filter((c) => c.status?.toLowerCase() === 'active').length}</div><div className="metric-label">Active clients</div></div>
        <div className="metric-card orange"><div className="metric-icon">🔗</div><div className="metric-value">{clients.filter((c) => c.source?.toLowerCase() === 'referral').length}</div><div className="metric-label">From referrals</div></div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--grey-400)', pointerEvents: 'none' }}>🔍</span>
          <input className="field-input" style={{ paddingLeft: 36 }} placeholder="Search by ref, name, phone, email, city..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="field-input" style={{ width: 140 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="vip">VIP</option>
        </select>
        <select className="field-input" style={{ width: 140 }} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="">All sources</option>
          <option value="referral">Referral</option>
          <option value="website">Website</option>
          <option value="manual">Manual</option>
        </select>
        <button className="btn primary" onClick={() => onNavigate('clients', { mode: 'new', label: 'New client' })}>+ New client</button>
        <button className="btn" onClick={() => setShowUpload(true)}>⬆️ Import</button>
      </div>
      {showUpload && <MassClientUpload onClose={() => setShowUpload(false)} onSuccess={(count) => { setShowUpload(false); loadClients(); setSaveSuccess(`${count} clients imported successfully!`); setTimeout(() => setSaveSuccess(''), 4000); }} />}

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>
      ) : filtered.length === 0 ? (
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: 60, textAlign: 'center', border: '1px solid var(--grey-100)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>👥</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 6 }}>{search || statusFilter || sourceFilter ? 'No clients found' : 'No clients yet'}</div>
          <div style={{ fontSize: 13, color: 'var(--grey-400)', marginBottom: 16 }}>{search || statusFilter || sourceFilter ? 'Try adjusting your search or filters' : 'Add your first client to get started'}</div>
          {!search && !statusFilter && !sourceFilter && <button className="btn primary" onClick={() => onNavigate('clients', { mode: 'new', label: 'New client' })}>+ Add first client</button>}
        </div>
      ) : (
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--grey-100)', fontSize: 12, color: 'var(--grey-400)', fontWeight: 500 }}>
            {filtered.length} client{filtered.length !== 1 ? 's' : ''} {search || statusFilter || sourceFilter ? '(filtered)' : ''}
          </div>
          {filtered.map((c, i) => {
            const sc = statusColors[c.status?.toLowerCase()] || statusColors.active;
            return (
              <div key={c.client_id}
                style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 16, alignItems: 'center', padding: '14px 20px', borderBottom: i < filtered.length - 1 ? '1px solid var(--grey-100)' : 'none', cursor: 'pointer', transition: 'background .15s' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-50)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                onClick={() => onNavigate('clients', { clientId: c.client_id, label: ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || c.ref_number || 'Client' })}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--pink-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--pink)', flexShrink: 0 }}>
                  {c.first_name?.charAt(0)}{c.last_name?.charAt(0)}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--grey-800)' }}>{c.first_name} {c.last_name}{c.ref_number && <span style={{ fontSize: 11, color: 'var(--grey-400)', fontWeight: 400, marginLeft: 6 }}>{c.ref_number}</span>}</div>
                  <div style={{ fontSize: 12, color: 'var(--grey-400)', marginTop: 2 }}>{c.phone_1}{c.email_1 ? ` · ${c.email_1}` : ''}{c.city ? ` · ${c.city}` : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: sc.bg, color: sc.color }}>{c.status?.toUpperCase()}</span>
                  <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: 'var(--blue-light)', color: 'var(--blue)', textTransform: 'capitalize' }}>{c.source}</span>
                </div>
                <div style={{ color: 'var(--grey-400)', fontSize: 16 }}>›</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
