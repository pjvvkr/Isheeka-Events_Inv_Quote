// Invoices module — list + the full InvoiceDetail (GST toggle, revise, record payment
// with spill-over allocation, client refund, discount/write-off, share, PDF, activity log).
// Ported verbatim from isheeka-erp-v22.html (incl. the refund-reopen + self-heal + discount work).
import React from 'react';
import { supabase } from '../lib/supabase';
import { createNotifications } from '../lib/notifications.js';
import { sendPush } from '../lib/push.js';
import { resolveAudience } from '../lib/notifyPrefs.js';
import { notify, runDb } from '../lib/toast.jsx';
import { _currentUid, logInvoiceActivity } from '../lib/session.js';
import { recordClientRefund, reconcileInvoiceInstallments } from '../lib/money.js';
import { buildQuotationPDF } from '../pdf/quotationPdf.js';
import { uploadInvoicePdf, buildInvoiceShareMsg, openWhatsApp, openEmail, validClientPhone } from '../lib/share.js';
import { fmtDate, isInvoiceOverdue } from '../lib/format.js';
import { INVOICE_STATUS_COLORS, INVOICE_STATUS_LABELS, QUOT_STATUS_LABELS, LEAD_STAGE_LABELS } from '../lib/constants.js';
import { ClientLink } from '../components/links.jsx';
import { ClientForm } from './ClientsModule.jsx';

export function InvoicesModule({ nav, onNavigate, onBack }) {
  const [invoices, setInvoices] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const detailId = nav && nav.invoiceId; // stack-driven detail target

  const loadInvoices = React.useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('invoices').select('*').eq('is_deleted', false).order('doc_date', { ascending: false });
    if (data) setInvoices(data);
    setLoading(false);
  }, []);
  React.useEffect(() => { loadInvoices(); }, [loadInvoices]);
  React.useEffect(() => { if (!detailId) loadInvoices(); }, [detailId]);

  const filtered = invoices.filter((i) => {
    const q = search.toLowerCase();
    const matchSearch = !q || `${i.ref_number} ${i.client_name || ''} ${i.event_name || ''}`.toLowerCase().includes(q);
    const matchStatus = !statusFilter || i.status === statusFilter;
    return matchSearch && matchStatus;
  }).sort((a, b) => { const d = (s) => s === 'cancelled' ? 1 : 0; return d(a.status) - d(b.status) || (b.doc_date || '').localeCompare(a.doc_date || ''); });
  const sumOutstanding = invoices.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + (parseFloat(i.total_outstanding) || 0), 0);
  const sumReceived = invoices.reduce((s, i) => s + (parseFloat(i.total_received) || 0), 0);
  const overdueCount = invoices.filter((i) => i.status === 'overdue').length;

  if (detailId) return <InvoiceDetail invoiceId={detailId} onBack={onBack} onNavigate={onNavigate} />;

  return (
    <div>
      <div className="metrics-grid" style={{ marginBottom: 20 }}>
        <div className="metric-card pink"><div className="metric-icon">🧾</div><div className="metric-value">{invoices.length}</div><div className="metric-label">Total invoices</div></div>
        <div className="metric-card orange"><div className="metric-icon">⏳</div><div className="metric-value">₹{sumOutstanding.toLocaleString('en-IN')}</div><div className="metric-label">Outstanding</div></div>
        <div className="metric-card green"><div className="metric-icon">✅</div><div className="metric-value">₹{sumReceived.toLocaleString('en-IN')}</div><div className="metric-label">Received</div></div>
        <div className="metric-card pink"><div className="metric-icon">⚠️</div><div className="metric-value">{overdueCount}</div><div className="metric-label">Overdue</div></div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--grey-400)', pointerEvents: 'none' }}>🔍</span>
          <input className="field-input" style={{ paddingLeft: 36 }} placeholder="Search by ref, client, event..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="field-input" style={{ width: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.keys(INVOICE_STATUS_LABELS).map((s) => <option key={s} value={s}>{INVOICE_STATUS_LABELS[s]}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>
      ) : filtered.length === 0 ? (
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: 60, textAlign: 'center', border: '1px solid var(--grey-100)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🧾</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 6 }}>{search || statusFilter ? 'No invoices found' : 'No invoices yet'}</div>
          <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>{search || statusFilter ? 'Try adjusting your search or filter' : 'Invoices are created automatically when a quotation is confirmed.'}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((inv) => {
            const est = isInvoiceOverdue(inv) ? 'overdue' : inv.status;
            const sc = INVOICE_STATUS_COLORS[est] || INVOICE_STATUS_COLORS.draft;
            const recvd = parseFloat(inv.total_received) || 0; const out = parseFloat(inv.total_outstanding) || 0;
            return (
              <div key={inv.invoice_id} style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', overflow: 'hidden', cursor: 'pointer' }}
                onMouseEnter={(ev) => ev.currentTarget.style.borderColor = 'var(--grey-200)'}
                onMouseLeave={(ev) => ev.currentTarget.style.borderColor = 'var(--grey-100)'}
                onClick={() => onNavigate('invoices', { invoiceId: inv.invoice_id, label: inv.ref_number })}>
                <div style={{ display: 'grid', gridTemplateColumns: '6px 1fr auto auto', alignItems: 'stretch' }}>
                  <div style={{ background: sc.dot, borderRadius: 'var(--radius-lg) 0 0 var(--radius-lg)' }}></div>
                  <div style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--pink)' }}>{inv.ref_number}</span>
                      {inv.revision_number > 0 && <span style={{ fontSize: 11, color: 'var(--grey-400)' }}>Rev {inv.revision_number}</span>}
                      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: sc.bg, color: sc.color }}>{INVOICE_STATUS_LABELS[est] || est}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--grey-400)', flexWrap: 'wrap' }}>
                      {inv.client_name && <span>👤 <ClientLink clientId={inv.client_id} name={inv.client_name} onNavigate={onNavigate}>{inv.client_name}</ClientLink></span>}
                      {inv.event_name && <span>🎪 {inv.event_name}</span>}
                      {inv.doc_date && <span>📅 {fmtDate(inv.doc_date, { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                    </div>
                  </div>
                  <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--grey-800)' }}>₹{parseFloat(inv.grand_total || 0).toLocaleString('en-IN')}</div>
                    <div style={{ fontSize: 11, color: out > 0 ? 'var(--red)' : 'var(--green)' }}>{out > 0 ? '₹' + out.toLocaleString('en-IN') + ' due' : 'Settled'}{recvd > 0 && out > 0 ? ' · ₹' + recvd.toLocaleString('en-IN') + ' rec' : ''}</div>
                  </div>
                  <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center' }}><span style={{ color: 'var(--grey-400)', fontSize: 18 }}>›</span></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InvoiceDetail({ invoiceId, onBack, onNavigate }) {
  const [inv, setInv] = React.useState(null);
  const [items, setItems] = React.useState([]);
  const [installments, setInstallments] = React.useState([]);
  const [settings, setSettings] = React.useState({});
  const [clientInfo, setClientInfo] = React.useState({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  const [showClientEdit, setShowClientEdit] = React.useState(false);
  const [activity, setActivity] = React.useState([]);
  const [userMap, setUserMap] = React.useState({});
  const [showLog, setShowLog] = React.useState(false);
  const [revising, setRevising] = React.useState(false);
  const [revItems, setRevItems] = React.useState([]);
  const [revDiscount, setRevDiscount] = React.useState(0);
  const [revTotalOverride, setRevTotalOverride] = React.useState('');
  const [revReason, setRevReason] = React.useState('');
  const [revSaving, setRevSaving] = React.useState(false);
  const [srcQuote, setSrcQuote] = React.useState(null);
  const [srcRfq, setSrcRfq] = React.useState(null);
  const [srcLead, setSrcLead] = React.useState(null);
  const [srcEvent, setSrcEvent] = React.useState(null);
  const [schedule, setSchedule] = React.useState([]);
  const [pdfDisplay, setPdfDisplay] = React.useState({ prices: true, qty: true, schedule: true, discount: true, coverPage: false, bankDetails: true });
  const [includeRevHistory, setIncludeRevHistory] = React.useState(true);
  const [evtName, setEvtName] = React.useState('');
  const [payments, setPayments] = React.useState([]);
  const [showPay, setShowPay] = React.useState(false);
  const [payForm, setPayForm] = React.useState({ amount: '', date: new Date().toISOString().split('T')[0], mode: 'upi', installment_id: '', reference: '', notes: '' });
  const [paySaving, setPaySaving] = React.useState(false);
  const [payFile, setPayFile] = React.useState(null);
  const [showRefund, setShowRefund] = React.useState(false);
  const [refundForm, setRefundForm] = React.useState({ amount: '', reason: '', date: new Date().toISOString().split('T')[0] });
  const [showDiscount, setShowDiscount] = React.useState(false);
  const [discountForm, setDiscountForm] = React.useState({ amount: '', reason: '' });

  React.useEffect(() => { if (inv) setEvtName(inv.event_name || ''); }, [inv && inv.event_name]);
  const saveEventName = async () => {
    const v = (evtName || '').trim();
    const { error: ene } = await runDb(supabase.from('invoices').update({ event_name: v || null, updated_at: new Date().toISOString() }).eq('invoice_id', invoiceId), 'update event name');
    if (ene) return;
    setInv((x) => ({ ...x, event_name: v || null }));
    notify('Event name updated — it will show on the invoice PDF.', 'success');
  };

  const openRefund = () => { setRefundForm({ amount: String(Math.round(parseFloat(inv.total_received) || 0)), reason: '', date: new Date().toISOString().split('T')[0] }); setShowRefund(true); };
  const submitRefund = async () => {
    if (paySaving) return;
    const amt = parseFloat(refundForm.amount) || 0;
    if (amt <= 0) { notify('Enter a valid refund amount.', 'error'); return; }
    if (amt > (parseFloat(inv.total_received) || 0) + 0.5) { notify('Refund cannot exceed the amount collected (₹' + Math.round(parseFloat(inv.total_received) || 0).toLocaleString('en-IN') + ').', 'error'); return; }
    if (!refundForm.reason.trim()) { notify('Enter a reason for the refund.', 'error'); return; }
    setPaySaving(true);
    try { await recordClientRefund(inv, { amount: amt, reason: refundForm.reason.trim(), date: refundForm.date }); setShowRefund(false); notify('Client refund recorded.', 'success'); await loadAll(); }
    catch (err) { notify('Could not record refund: ' + (err && err.message ? err.message : ''), 'error'); }
    setPaySaving(false);
  };

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    const [{ data: i }, { data: li }, { data: inst }, { data: s }, { data: act }, { data: us }, { data: pays }] = await Promise.all([
      supabase.from('invoices').select('*').eq('invoice_id', invoiceId).single(),
      supabase.from('invoice_line_items').select('*').eq('invoice_id', invoiceId).eq('is_deleted', false).order('sort_order'),
      supabase.from('invoice_installments').select('*').eq('invoice_id', invoiceId).eq('is_deleted', false).order('installment_number'),
      supabase.from('settings').select('gst_pct,default_invoice_due_days,bank_name,account_number,ifsc_code,upi_id,phone_1,email,website,company_name,cover_intro').single(),
      supabase.from('invoice_activity_log').select('*').eq('invoice_id', invoiceId).order('changed_at', { ascending: false }),
      supabase.from('users').select('user_id,first_name,last_name'),
      supabase.from('invoice_payments').select('*').eq('invoice_id', invoiceId).order('payment_date', { ascending: false }),
    ]);
    setInv(i || null); setItems(li || []); setInstallments(inst || []); setSettings(s || {}); setActivity(act || []); setPayments(pays || []);
    // Self-heal: rebuild the installment allocation from total_received whenever the two have drifted.
    if (i && inst && inst.length) {
      const sumPaid = inst.reduce((acc, x) => acc + (parseFloat(x.amount_paid) || 0), 0);
      const recv = parseFloat(i.total_received) || 0;
      if (Math.abs(sumPaid - recv) > 0.5) {
        try {
          await reconcileInvoiceInstallments(inst, recv);
          const { data: inst2 } = await supabase.from('invoice_installments').select('*').eq('invoice_id', invoiceId).eq('is_deleted', false).order('installment_number');
          setInstallments(inst2 || inst);
        } catch (e) { /* noop */ }
      }
    }
    if (i && isInvoiceOverdue(i)) { try { await supabase.from('invoices').update({ status: 'overdue', updated_at: new Date().toISOString() }).eq('invoice_id', i.invoice_id); setInv((prev) => prev ? { ...prev, status: 'overdue' } : prev); } catch (e) { /* noop */ } }
    const m = {}; (us || []).forEach((u) => { m[u.user_id] = ((u.first_name || '') + ' ' + (u.last_name || '')).trim(); }); setUserMap(m);
    if (i && i.client_id) { const { data: c } = await supabase.from('clients').select('*').eq('client_id', i.client_id).single(); setClientInfo(c || {}); }
    else setClientInfo({});
    let sq = null;
    if (i && i.quotation_id) { const r = await supabase.from('quotations').select('quotation_id,ref_number,status,grand_total,lead_id,event_id').eq('quotation_id', i.quotation_id).maybeSingle(); sq = r.data || null; }
    setSrcQuote(sq);
    try { const _qid = (sq && sq.quotation_id) || i.quotation_id; if (_qid) { const { data: rq } = await supabase.from('rfqs').select('rfq_id,ref_number').eq('quotation_id', _qid).eq('is_deleted', false).maybeSingle(); setSrcRfq(rq || null); } else setSrcRfq(null); } catch (e) { setSrcRfq(null); }
    const leadId = (i && i.lead_id) || (sq && sq.lead_id) || null;
    if (leadId) { const { data: ld } = await supabase.from('leads').select('lead_id,ref_number,stage').eq('lead_id', leadId).maybeSingle(); setSrcLead(ld || null); }
    else setSrcLead(null);
    const evtId = (i && i.event_id) || (sq && sq.event_id) || null;
    if (evtId) { const { data: ev } = await supabase.from('events').select('event_id,ref_number,name,status,main_date').eq('event_id', evtId).maybeSingle(); setSrcEvent(ev || null); }
    else setSrcEvent(null);
    if (evtId) { try { const { data: subs } = await supabase.from('sub_events').select('name,date,location,sort_order').eq('event_id', evtId).eq('is_deleted', false).order('sort_order'); setSchedule((subs || []).filter((s) => s.name || s.date).map((s) => ({ name: s.name || '', date: s.date || null, venue: s.location || '' }))); } catch (e) { setSchedule([]); } }
    else setSchedule([]);
    setLoading(false);
  }, [invoiceId]);
  React.useEffect(() => { loadAll(); }, [loadAll]);

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  if (!inv) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--grey-400)' }}>Invoice not found. <button className="btn sm" onClick={onBack}>← Back</button></div>;

  const sc = INVOICE_STATUS_COLORS[inv.status] || INVOICE_STATUS_COLORS.draft;
  const subtotal = parseFloat(inv.subtotal) || 0;
  const discount = parseFloat(inv.discount_amount) || 0;
  const taxable = Math.max(0, subtotal - discount);
  const gstPct = parseFloat(inv.gst_applicable ? (inv.gst_pct || settings.gst_pct || 0) : 0) || 0;
  const tax = inv.gst_applicable ? Math.round(taxable * gstPct / 100) : 0;
  const grand = taxable + tax;
  const received = parseFloat(inv.total_received) || 0;
  const outstanding = parseFloat(inv.total_outstanding != null ? inv.total_outstanding : (grand - received)) || 0;
  const sourceQuoteTotal = parseFloat(inv.source_quote_total) || 0; const variance = taxable - sourceQuoteTotal;
  const locked = ['paid', 'cancelled'].includes(inv.status);

  const toggleGst = async (on) => {
    if (saving || locked) return;
    setSaving(true);
    const rate = on ? (parseFloat(settings.gst_pct) || 0) : 0;
    const newTax = on ? Math.round(taxable * rate / 100) : 0;
    const newGrand = taxable + newTax;
    const newOutstanding = Math.max(0, newGrand - received);
    const { error } = await supabase.from('invoices').update({ gst_applicable: on, gst_pct: rate, tax_amount: newTax, grand_total: newGrand, total_outstanding: newOutstanding, updated_at: new Date().toISOString() }).eq('invoice_id', invoiceId);
    if (error) { notify('Could not update GST: ' + (error.message || ''), 'error'); setSaving(false); return; }
    for (const it of installments) {
      if (it.percentage == null) continue;
      const due = Math.round(newGrand * (parseFloat(it.percentage) || 0) / 100);
      const bal = Math.max(0, due - (parseFloat(it.amount_paid) || 0));
      await supabase.from('invoice_installments').update({ amount_due: due, balance: bal, updated_at: new Date().toISOString() }).eq('installment_id', it.installment_id);
    }
    notify(on ? 'GST applied (' + rate + '%).' : 'GST removed.', 'success');
    setSaving(false);
    await loadAll();
  };

  const markSent = async () => {
    if (saving || inv.status !== 'draft') return;
    setSaving(true);
    const patch = { status: 'sent', updated_at: new Date().toISOString() };
    if (!inv.due_date && settings.default_invoice_due_days) { const d = new Date(); d.setDate(d.getDate() + parseInt(settings.default_invoice_due_days)); patch.due_date = d.toISOString().split('T')[0]; }
    const { error } = await supabase.from('invoices').update(patch).eq('invoice_id', invoiceId);
    if (error) { notify('Could not mark as sent: ' + (error.message || ''), 'error'); setSaving(false); return; }
    if (inv.event_id) { try { await supabase.from('events').update({ status: 'confirmed', updated_at: new Date().toISOString() }).eq('event_id', inv.event_id).eq('status', 'planning'); } catch (e) { /* noop */ } }
    notify('Invoice ' + inv.ref_number + ' marked as sent.', 'success'); setSaving(false); await loadAll();
  };

  const cancelInvoice = async () => {
    if (saving || locked) return;
    if (received > 0) { notify('This invoice has payments recorded — it can\'t be cancelled.', 'error'); return; }
    setSaving(true);
    const { error } = await supabase.from('invoices').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('invoice_id', invoiceId);
    if (error) { notify('Could not cancel: ' + (error.message || ''), 'error'); setSaving(false); return; }
    notify('Invoice cancelled.', 'info'); setSaving(false); await loadAll();
  };

  // Shape the invoice as a quote-like object for the shared PDF engine (docType='invoice').
  const invForPdf = () => ({
    ...inv,
    event_schedule: schedule.length ? schedule : null,
    event_date: (srcEvent && srcEvent.main_date) || inv.event_date || null,
    client_phone: clientInfo.phone_1 || '', client_email: clientInfo.email_1 || '', client_city: clientInfo.city || '',
    additional_terms: inv.additional_notes || '',
    payment_schedule: installments.map((it) => ({
      pct: parseFloat(it.percentage) || 0,
      amount: parseFloat(it.amount_due) || 0,
      label: it.label || ('Installment ' + it.installment_number),
      when: (it.when_text || (it.due_date ? ('due ' + fmtDate(it.due_date, { day: 'numeric', month: 'short' })) : 'on schedule'))
        + ((parseFloat(it.balance) || 0) > 0 && (parseFloat(it.balance) || 0) !== (parseFloat(it.amount_due) || 0) ? (' (bal Rs.' + (parseFloat(it.balance) || 0).toLocaleString('en-IN') + ')') : ''),
    })),
  });
  const revRows = (() => { const log = (activity || []).filter((a) => a.action === 'revised').sort((x, y) => (x.revision_number || 0) - (y.revision_number || 0)); if (!log.length) return []; const rows = [{ label: 'Original', date: fmtDate(log[0].changed_at, { day: 'numeric', month: 'short', year: 'numeric' }), change: (log[0].old_value || '') }]; log.forEach((a) => rows.push({ label: 'Rev ' + (a.revision_number || ''), date: fmtDate(a.changed_at, { day: 'numeric', month: 'short', year: 'numeric' }), change: (a.old_value || '') + ' → ' + (a.new_value || ''), reason: a.reason || '' })); return rows; })();
  const revOpts = () => ({ showRevisionHistory: includeRevHistory && (inv.revision_number || 0) > 0, revisionHistory: revRows });
  const pdfOpts = (action) => ({ action, docType: 'invoice', displayOpts: { ...pdfDisplay, grouping: true }, settings, ...revOpts() });
  const downloadPdf = () => { try { buildQuotationPDF(invForPdf(), items, pdfOpts('download')); } catch (e) { notify('Could not generate the PDF.', 'error'); } };
  const printPdf = () => { try { buildQuotationPDF(invForPdf(), items, pdfOpts('print')); } catch (e) { notify('Could not open the print view.', 'error'); } };
  const previewPdf = () => { try { buildQuotationPDF(invForPdf(), items, pdfOpts('preview')); } catch (e) { notify('Could not open the preview.', 'error'); } };
  const handleSaveClient = async (form) => {
    const { error } = await supabase.from('clients').update({ ...form, updated_at: new Date().toISOString() }).eq('client_id', inv.client_id);
    if (error) { notify('Could not update client: ' + (error.message || ''), 'error'); throw error; }
    const newName = ((form.first_name || '') + ' ' + (form.last_name || '')).trim();
    let cascaded = 0;
    if (newName && newName !== inv.client_name) {
      const rq = await supabase.from('quotations').update({ client_name: newName }, { count: 'exact' }).eq('client_id', inv.client_id).eq('status', 'draft');
      const ri = await supabase.from('invoices').update({ client_name: newName }, { count: 'exact' }).eq('client_id', inv.client_id).eq('status', 'draft');
      const re = await supabase.from('events').update({ client_name: newName }, { count: 'exact' }).eq('client_id', inv.client_id).not('status', 'in', '("completed","cancelled")');
      cascaded = (rq.count || 0) + (ri.count || 0) + (re.count || 0);
    }
    setShowClientEdit(false);
    notify('Client updated' + (cascaded ? (' — name synced to ' + cascaded + ' active document' + (cascaded > 1 ? 's' : '')) : '') + '.', 'success');
    await loadAll();
  };

  const openRevise = () => {
    if (inv.status === 'cancelled') return;
    if (inv.status === 'paid' && !window.confirm('This invoice is fully paid. Revising a settled invoice is an admin action and will be logged. Continue?')) return;
    setRevItems(items.map((it) => ({ description: it.description || '', quantity: parseFloat(it.quantity) || 1, unit_price: parseFloat(it.unit_price) || 0, sub_event_name: it.sub_event_name || null })));
    setRevDiscount(parseFloat(inv.discount_amount) || 0);
    const _adj = parseFloat(inv.discount_amount) || 0;
    setRevTotalOverride(_adj !== 0 ? String(Math.round((parseFloat(inv.subtotal) || 0) - _adj)) : '');
    setRevReason('');
    setRevising(true);
  };
  const revSub = revItems.reduce((s, r) => s + (parseFloat(r.quantity) || 0) * (parseFloat(r.unit_price) || 0), 0);
  const revOverrideOn = revTotalOverride !== '' && revTotalOverride != null && !isNaN(parseFloat(revTotalOverride));
  const revEffDiscount = revOverrideOn ? (revSub - parseFloat(revTotalOverride)) : (parseFloat(revDiscount) || 0);
  const revTaxable = revSub - revEffDiscount;
  const revTax = inv.gst_applicable ? Math.round(revTaxable * gstPct / 100) : 0;
  const revGrand = revTaxable + revTax;
  const handleRevise = async () => {
    if (revSaving) return;
    if (!revReason.trim()) { notify('Please enter a reason for the revision.', 'error'); return; }
    if (revItems.filter((r) => r.description.trim()).length === 0) { notify('Add at least one line item.', 'error'); return; }
    if (!revOverrideOn && ((parseFloat(revDiscount) || 0) < 0 || (parseFloat(revDiscount) || 0) > revSub)) { notify('Discount must be between ₹0 and the subtotal (₹' + revSub.toLocaleString('en-IN') + ').', 'error'); return; }
    if (revTaxable < 0) { notify('The final total can’t be negative.', 'error'); return; }
    setRevSaving(true);
    const rows = revItems.filter((r) => r.description.trim()).map((r, idx) => ({ invoice_id: invoiceId, description: r.description.trim(), sub_event_name: r.sub_event_name || null, quantity: parseFloat(r.quantity) || 0, unit_price: parseFloat(r.unit_price) || 0, amount: (parseFloat(r.quantity) || 0) * (parseFloat(r.unit_price) || 0), sort_order: idx }));
    const newDiscount = revEffDiscount, newSub = revSub, newGrand = revGrand, newTax = revTax;
    const newOut = Math.max(0, newGrand - received);
    const newRev = (inv.status === 'draft') ? (inv.revision_number || 0) : ((inv.revision_number || 0) + 1);
    const oldGrand = grand;
    const { error: de } = await supabase.from('invoice_line_items').update({ is_deleted: true }).eq('invoice_id', invoiceId);
    if (de) { notify('Could not update line items: ' + (de.message || ''), 'error'); setRevSaving(false); return; }
    const { error: ie } = await supabase.from('invoice_line_items').insert(rows);
    if (ie) { notify('Could not save revised items: ' + (ie.message || ''), 'error'); setRevSaving(false); return; }
    const { error: ue } = await supabase.from('invoices').update({ subtotal: newSub, discount_amount: newDiscount, tax_amount: newTax, grand_total: newGrand, total_outstanding: newOut, revision_number: newRev, updated_at: new Date().toISOString() }).eq('invoice_id', invoiceId);
    if (ue) { notify('Could not update the invoice: ' + (ue.message || ''), 'error'); setRevSaving(false); return; }
    for (const it of installments) { if (it.percentage == null) continue; const due = Math.round(newGrand * (parseFloat(it.percentage) || 0) / 100); const bal = Math.max(0, due - (parseFloat(it.amount_paid) || 0)); await supabase.from('invoice_installments').update({ amount_due: due, balance: bal, updated_at: new Date().toISOString() }).eq('installment_id', it.installment_id); }
    await logInvoiceActivity(invoiceId, { action: 'revised', field: 'grand_total', old_value: '₹' + oldGrand.toLocaleString('en-IN'), new_value: '₹' + newGrand.toLocaleString('en-IN'), reason: revReason.trim(), revision_number: newRev });
    setRevSaving(false); setRevising(false);
    notify('Invoice revised' + (newRev > (inv.revision_number || 0) ? (' (rev ' + newRev + ')') : '') + '.', 'success');
    await loadAll();
  };
  const openDiscount = () => { setDiscountForm({ amount: outstanding > 0 ? String(Math.round(outstanding)) : '', reason: '' }); setShowDiscount(true); };
  const applyDiscount = async () => {
    if (saving) return;
    const d = parseFloat(discountForm.amount) || 0;
    if (d <= 0) { notify('Enter a discount amount greater than ₹0.', 'error'); return; }
    if (d > taxable + 0.5) { notify('Discount can’t exceed the invoice total (₹' + Math.round(taxable).toLocaleString('en-IN') + ').', 'error'); return; }
    if (!discountForm.reason.trim()) { notify('Enter a reason for the discount.', 'error'); return; }
    setSaving(true);
    const newDiscount = (parseFloat(inv.discount_amount) || 0) + d;
    const newTaxable = Math.max(0, subtotal - newDiscount);
    const newTax = inv.gst_applicable ? Math.round(newTaxable * gstPct / 100) : 0;
    const newGrand = newTaxable + newTax;
    const newOut = Math.max(0, newGrand - received);
    const fullyPaid = received >= newGrand - 0.5;
    const newStatus = fullyPaid ? 'paid' : (received > 0 ? 'partially_paid' : (inv.status === 'draft' ? 'draft' : 'sent'));
    const newRev = (inv.status === 'draft') ? (inv.revision_number || 0) : ((inv.revision_number || 0) + 1);
    const { error: ue } = await supabase.from('invoices').update({ discount_amount: newDiscount, tax_amount: newTax, grand_total: newGrand, total_outstanding: newOut, status: newStatus, revision_number: newRev, updated_at: new Date().toISOString() }).eq('invoice_id', invoiceId);
    if (ue) { notify('Could not apply the discount: ' + (ue.message || ''), 'error'); setSaving(false); return; }
    for (const it of installments) { if (it.percentage == null) continue; const due = Math.round(newGrand * (parseFloat(it.percentage) || 0) / 100); await supabase.from('invoice_installments').update({ amount_due: due, updated_at: new Date().toISOString() }).eq('installment_id', it.installment_id); }
    try { const { data: fresh } = await supabase.from('invoice_installments').select('*').eq('invoice_id', invoiceId).eq('is_deleted', false).order('installment_number'); await reconcileInvoiceInstallments(fresh || [], received); } catch (e) { /* noop */ }
    if (fullyPaid && inv.quotation_id) { try { await supabase.from('quotations').update({ status: 'invoiced', updated_at: new Date().toISOString() }).eq('quotation_id', inv.quotation_id); } catch (e) { /* noop */ } }
    try { await logInvoiceActivity(invoiceId, { action: 'revised', field: 'discount', old_value: '₹' + grand.toLocaleString('en-IN'), new_value: '₹' + newGrand.toLocaleString('en-IN'), reason: 'Discount ₹' + d.toLocaleString('en-IN') + ' — ' + discountForm.reason.trim(), revision_number: newRev }); } catch (e) { /* noop */ }
    setSaving(false); setShowDiscount(false);
    notify('Discount of ₹' + d.toLocaleString('en-IN') + ' applied' + (fullyPaid ? ' — invoice settled.' : '.'), 'success');
    await loadAll();
  };
  const canShare = ['sent', 'partially_paid', 'paid', 'overdue'].includes(inv.status);
  const shareInvoice = async (channel) => {
    if (sharing) return;
    if (channel === 'whatsapp' && !validClientPhone(clientInfo.phone_1)) { notify("This client's phone number looks invalid — update it before sharing on WhatsApp.", 'error'); return; }
    if ((channel === 'gmail' || channel === 'email') && !clientInfo.email_1) { notify('This client has no email address on file.', 'error'); return; }
    setSharing(true);
    notify('Preparing the invoice PDF…', 'info', 2500);
    const url = await uploadInvoicePdf(invForPdf(), items, settings, pdfDisplay, revOpts());
    if (!url) notify("Couldn't attach the PDF link — sharing the message; you can attach the downloaded PDF manually.", 'error');
    const msg = buildInvoiceShareMsg(inv, settings, url);
    if (channel === 'whatsapp') openWhatsApp(clientInfo.phone_1, msg);
    else openEmail(channel === 'gmail' ? 'gmail' : 'default', clientInfo.email_1, 'Invoice ' + inv.ref_number + ' — Isheeka Events', msg);
    await logInvoiceActivity(inv.invoice_id, { action: 'sent', channel: channel === 'whatsapp' ? 'whatsapp' : 'email', revision_number: inv.revision_number || 0 });
    setSharing(false);
    await loadAll();
  };
  const unpaidInstallments = installments.filter((it) => (parseFloat(it.balance != null ? it.balance : it.amount_due) || 0) > 0);
  const canRecordPay = inv.status !== 'cancelled' && outstanding > 0;
  const openPay = () => { setPayForm({ amount: '', date: new Date().toISOString().split('T')[0], mode: 'upi', installment_id: (unpaidInstallments[0] && unpaidInstallments[0].installment_id) || '', reference: '', notes: '' }); setPayFile(null); setShowPay(true); };
  const recordPayment = async () => {
    if (paySaving) return;
    const amt = parseFloat(payForm.amount) || 0;
    if (amt <= 0) { notify('Enter a valid payment amount.', 'error'); return; }
    if (!payForm.date) { notify('Pick a payment date.', 'error'); return; }
    if (!payForm.installment_id && unpaidInstallments.length) { notify('Select which installment this payment is against.', 'error'); return; }
    setPaySaving(true);
    const uid = await _currentUid();
    let receiptUrl = null;
    if (payFile) {
      try {
        const ext = ((payFile.name || '').split('.').pop() || 'png').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'png';
        const path = 'receipts/' + String(inv.ref_number || 'inv').replace(/[^A-Za-z0-9_-]/g, '') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.' + ext;
        const { error: ue } = await supabase.storage.from('quotations').upload(path, payFile, { contentType: payFile.type || 'application/octet-stream', upsert: true });
        if (ue) { notify("Couldn't upload the attachment — recording the payment without it.", 'error'); }
        else { const { data: pu } = await supabase.storage.from('quotations').createSignedUrl(path, 60 * 60 * 24 * 365); receiptUrl = (pu && pu.signedUrl) || null; }
      } catch (e) { notify('Attachment upload failed — recording the payment without it.', 'error'); }
    }
    const rowInstId = payForm.installment_id || (unpaidInstallments[0] && unpaidInstallments[0].installment_id) || (installments[0] && installments[0].installment_id) || null;
    const { error: pe } = await supabase.from('invoice_payments').insert({ invoice_id: invoiceId, installment_id: rowInstId, amount: amt, payment_date: payForm.date, payment_mode: payForm.mode, reference_number: payForm.reference || null, notes: payForm.notes || null, recorded_by: uid, receipt_url: receiptUrl });
    if (pe) { notify('Could not record payment: ' + (pe.message || ''), 'error'); setPaySaving(false); return; }
    {
      let remaining = amt;
      const ordered = [...installments].sort((a, b) => (a.installment_number || 0) - (b.installment_number || 0));
      const chosen = ordered.filter((x) => x.installment_id === payForm.installment_id);
      const rest = ordered.filter((x) => x.installment_id !== payForm.installment_id);
      for (const it of [...chosen, ...rest]) {
        if (remaining <= 0.5) break;
        const due = parseFloat(it.amount_due) || 0; const curPaid = parseFloat(it.amount_paid) || 0;
        const room = Math.max(0, due - curPaid); if (room <= 0) continue;
        const add = Math.min(room, remaining);
        const newPaid = curPaid + add; const bal = Math.max(0, due - newPaid); const ist = bal <= 0 ? 'paid' : 'partially_paid';
        await supabase.from('invoice_installments').update({ amount_paid: newPaid, balance: bal, status: ist, updated_at: new Date().toISOString() }).eq('installment_id', it.installment_id);
        remaining -= add;
      }
    }
    const newRec = (parseFloat(inv.total_received) || 0) + amt; const newOut = Math.max(0, grand - newRec);
    const fullyPaid = newRec >= grand;
    const newStatus = fullyPaid ? 'paid' : 'partially_paid';
    await supabase.from('invoices').update({ total_received: newRec, total_outstanding: newOut, status: newStatus, updated_at: new Date().toISOString() }).eq('invoice_id', invoiceId);
    try { await logInvoiceActivity(invoiceId, { action: 'payment', channel: payForm.mode, new_value: '₹' + amt.toLocaleString('en-IN'), reason: (payForm.reference ? ('Ref: ' + payForm.reference) : '') || 'Payment recorded', revision_number: inv.revision_number || 0 }); } catch (e) { /* noop */ }
    if (fullyPaid) {
      await supabase.from('invoice_installments').update({ balance: 0, status: 'paid', updated_at: new Date().toISOString() }).eq('invoice_id', invoiceId).eq('is_deleted', false);
      if (inv.quotation_id) { await supabase.from('quotations').update({ status: 'invoiced', updated_at: new Date().toISOString() }).eq('quotation_id', inv.quotation_id); }
      try { await logInvoiceActivity(invoiceId, { action: 'paid_in_full', new_value: '₹' + grand.toLocaleString('en-IN'), reason: 'Invoice fully paid — locked for edits', revision_number: inv.revision_number || 0 }); } catch (e) { /* noop */ }
    }
    try {
      const aud = await resolveAudience('payment_received');
      const pbody = '₹' + Math.round(amt).toLocaleString('en-IN') + ' from ' + (inv.client_name || 'client') + (fullyPaid ? ' · paid in full' : '');
      createNotifications(aud.inappIds, { type: 'payment_received', title: 'Payment received', body: pbody, doc_ref: inv.ref_number || '', link_page: 'invoices', link_opts: { invoiceId } });
      sendPush(aud.pushIds, { title: 'Payment received — ' + (inv.ref_number || ''), body: pbody, url: window.location.origin + '/?inv=' + invoiceId, tag: 'pay-' + invoiceId });
    } catch (e) { /* non-fatal */ }
    setPaySaving(false); setShowPay(false);
    notify('Payment of ₹' + amt.toLocaleString('en-IN') + ' recorded.', 'success');
    await loadAll();
  };
  const groups = {}; items.forEach((li) => { const k = li.sub_event_name || 'General Items'; (groups[k] = groups[k] || []).push(li); });
  const fmt = (d) => fmtDate(d);
  const fmtDT = (d) => d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  const sends = activity.filter((a) => a.action === 'sent');
  const describeActivity = (a) => {
    if (a.action === 'sent') return 'Sent via ' + (a.channel === 'whatsapp' ? 'WhatsApp' : (a.channel === 'email' ? 'Email' : (a.channel || '—')));
    if (a.action === 'revised') return (a.field ? (a.field + ': ' + (a.old_value || '—') + ' → ' + (a.new_value || '—')) : 'Revised') + (a.reason ? (' — ' + a.reason) : '');
    if (a.action === 'auto_refresh') return 'Auto-refreshed from the confirmed quote' + (a.reason ? (' — ' + a.reason) : '');
    if (a.action === 'payment') return 'Payment received ' + (a.new_value || '') + (a.channel ? (' via ' + String(a.channel).toUpperCase()) : '') + (a.reason && a.reason !== 'Payment recorded' ? (' — ' + a.reason) : '');
    if (a.action === 'paid_in_full') return 'Invoice fully paid — locked for edits';
    if (a.action === 'created') return 'Invoice created';
    if (a.action === 'cancelled') return 'Invoice cancelled';
    return a.action || 'Activity';
  };

  return (
    <div>
      {/* Header card */}
      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '16px 20px', border: '1px solid var(--grey-100)', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--grey-800)' }}>{inv.ref_number}</span>
              {inv.revision_number > 0 && <span style={{ fontSize: 12, color: 'var(--grey-400)' }}>Rev {inv.revision_number}</span>}
              <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: sc.bg, color: sc.color }}>{INVOICE_STATUS_LABELS[inv.status] || inv.status}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--grey-400)', marginTop: 4 }}>
              <ClientLink clientId={inv.client_id} name={inv.client_name} onNavigate={onNavigate}>{inv.client_name || '—'}</ClientLink>{inv.event_name ? ' · ' + inv.event_name : ''}{inv.doc_date ? ' · ' + fmt(inv.doc_date) : ''}
            </div>
            {(srcLead || srcQuote || srcEvent || srcRfq) && <div style={{ fontSize: 12, marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', color: 'var(--grey-400)' }}>
              <span style={{ fontWeight: 500, color: 'var(--grey-600)' }}>Source:</span>
              {srcRfq ? <><a onClick={() => onNavigate && onNavigate('rfqs', { rfqId: srcRfq.rfq_id, label: srcRfq.ref_number || 'RFQ' })} style={{ color: 'var(--pink)', cursor: 'pointer', fontWeight: 500 }}>📝 {srcRfq.ref_number || 'RFQ'}</a><span>→</span></> : null}
              {srcLead ? <a onClick={() => onNavigate && onNavigate('leads', { leadId: srcLead.lead_id, label: srcLead.ref_number || 'Lead' })} style={{ color: 'var(--pink)', cursor: 'pointer', fontWeight: 500 }} title={LEAD_STAGE_LABELS[srcLead.stage] || srcLead.stage}>🎯 {srcLead.ref_number || 'Lead'}</a> : (srcRfq ? null : <span>🎯 —</span>)}
              {(srcLead || !srcRfq) && <span>→</span>}
              {srcQuote ? <a onClick={() => onNavigate && onNavigate('quotations', { quotId: srcQuote.quotation_id, label: srcQuote.ref_number })} style={{ color: 'var(--pink)', cursor: 'pointer', fontWeight: 500 }} title={(QUOT_STATUS_LABELS[srcQuote.status] || srcQuote.status) + ' · ₹' + parseFloat(srcQuote.grand_total || 0).toLocaleString('en-IN')}>📄 {srcQuote.ref_number}</a> : <span>📄 —</span>}
              <span>→</span>
              {srcEvent ? <a onClick={() => onNavigate && onNavigate('events', { eventId: srcEvent.event_id, label: srcEvent.name || srcEvent.ref_number || 'Event' })} style={{ color: 'var(--pink)', cursor: 'pointer', fontWeight: 500 }} title={srcEvent.name || ''}>🎪 {srcEvent.ref_number || 'Event'}</a> : <span>🎪 —</span>}
            </div>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {inv.client_id && <button className="btn sm" title="Open this client's 360" onClick={() => onNavigate && onNavigate('clients', { clientId: inv.client_id, label: inv.client_name || 'Client' })}>👤 View client →</button>}
            {inv.event_id && <button className="btn sm" onClick={() => onNavigate && onNavigate('events', { eventId: inv.event_id, label: inv.event_name || 'Event' })}>Go to event →</button>}
            {inv.status === 'draft' && <button className="btn primary" disabled={saving} onClick={markSent}>Mark sent</button>}
            {!locked && <button className="btn sm" disabled={saving} onClick={openRevise}>✏️ Revise</button>}
            {canShare && <button className="btn sm" disabled={sharing} onClick={() => shareInvoice('whatsapp')}>💬 WhatsApp</button>}
            {canShare && <button className="btn sm" disabled={sharing} onClick={() => shareInvoice('gmail')}>Email</button>}
            <button className="btn sm" disabled={saving} onClick={previewPdf}>👁 Preview</button>
            <button className="btn sm" disabled={saving} onClick={printPdf}>Print</button>
            <button className="btn" disabled={saving} onClick={downloadPdf}>⬇ PDF</button>
            {!locked && <button className="btn sm" disabled={saving} onClick={cancelInvoice} style={{ color: 'var(--red)' }}>Cancel</button>}
          </div>
        </div>
        {Math.abs(variance) >= 1 && sourceQuoteTotal > 0 && inv.status !== 'cancelled' && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--orange-light)', color: 'var(--orange)', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
            ⚠️ This invoice differs from the source quote by {variance > 0 ? '+' : ''}₹{Math.abs(variance).toLocaleString('en-IN')} before GST (quote ₹{sourceQuoteTotal.toLocaleString('en-IN')} → invoice ₹{taxable.toLocaleString('en-IN')}).
          </div>
        )}
      </div>

      {inv.status === 'cancelled' && <div style={{ padding: '8px 12px', marginBottom: 16, background: 'var(--grey-50)', color: 'var(--grey-600)', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>This invoice is cancelled. To raise a new one, open the event {inv.event_id && <a onClick={() => onNavigate && onNavigate('events', { eventId: inv.event_id })} style={{ color: 'var(--pink)', cursor: 'pointer', fontWeight: 500 }}>(go to event →)</a>} and click <b>+ Generate invoice</b>.</div>}
      {inv.status === 'paid' && <div style={{ padding: '8px 12px', marginBottom: 16, background: 'var(--green-light)', color: 'var(--green)', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>✅ This invoice is fully paid and locked for edits. Sharing and printing remain available.</div>}
      {/* Event schedule (functions · dates · venues) */}
      {schedule.length > 0 && (
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: '14px 18px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: 'var(--gold)', marginBottom: 8 }}>📅 EVENT SCHEDULE</div>
          {schedule.map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.4fr', gap: 8, fontSize: 13, padding: '5px 0', borderTop: i ? '1px solid var(--grey-50)' : 'none' }}>
              <span style={{ fontWeight: 500, color: 'var(--grey-800)' }}>{s.name}</span>
              <span style={{ color: 'var(--grey-500)' }}>{s.date ? fmtDate(s.date, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span>
              <span style={{ color: s.venue ? 'var(--grey-700)' : 'var(--grey-400)' }}>{s.venue ? ('📍 ' + s.venue) : 'TBD'}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 6 }}>Dates &amp; venues are set on the event; this prints on the invoice PDF.</div>
        </div>
      )}
      {/* Event name */}
      {!locked && <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '12px 16px', border: '1px solid var(--grey-100)', marginBottom: 16, display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label className="field-label">Event name <span style={{ fontWeight: 400, color: 'var(--grey-400)' }}>(shown on the invoice &amp; PDF)</span></label>
          <input className="field-input" value={evtName} onChange={(e) => setEvtName(e.target.value)} placeholder="e.g. Half Saree Event" />
        </div>
        <button className="btn sm primary" disabled={(evtName || '').trim() === (inv.event_name || '')} onClick={saveEventName}>Save</button>
      </div>}
      {/* PDF options */}
      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '10px 16px', border: '1px solid var(--grey-100)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--grey-700)' }}>Include in PDF:</span>
        {[['prices', 'Prices'], ['qty', 'Qty'], ['schedule', 'Schedule'], ['discount', 'Discount'], ['coverPage', 'Cover page'], ['bankDetails', 'Bank details']].map(([k, l]) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--grey-700)', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!pdfDisplay[k]} onChange={(e) => setPdfDisplay((o) => ({ ...o, [k]: e.target.checked }))} style={{ accentColor: 'var(--pink)' }} />{l}
          </label>
        ))}
        {(inv.revision_number || 0) > 0 && <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--grey-700)', cursor: 'pointer' }}><input type="checkbox" checked={includeRevHistory} onChange={(e) => setIncludeRevHistory(e.target.checked)} style={{ accentColor: 'var(--pink)' }} />Revision history</label>}
      </div>
      {/* Client details */}
      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '16px 20px', border: '1px solid var(--grey-100)', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)' }}>Client details</div>
          {inv.client_id && !locked && <button className="btn sm" onClick={() => setShowClientEdit(true)}>✏️ Edit client</button>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '10px 24px', fontSize: 13 }}>
          <div><div style={{ fontSize: 11, color: 'var(--grey-400)' }}>Name</div><div><ClientLink clientId={inv.client_id} name={inv.client_name} onNavigate={onNavigate}>{inv.client_name || (((clientInfo.first_name || '') + ' ' + (clientInfo.last_name || '')).trim()) || '—'}</ClientLink></div></div>
          <div><div style={{ fontSize: 11, color: 'var(--grey-400)' }}>Phone</div><div>{[clientInfo.phone_1, clientInfo.phone_2].filter(Boolean).join(', ') || '—'}</div></div>
          <div><div style={{ fontSize: 11, color: 'var(--grey-400)' }}>Email</div><div>{[clientInfo.email_1, clientInfo.email_2].filter(Boolean).join(', ') || '—'}</div></div>
          <div><div style={{ fontSize: 11, color: 'var(--grey-400)' }}>Address</div><div>{[clientInfo.street_address, clientInfo.city, clientInfo.state, clientInfo.pincode].filter(Boolean).join(', ') || '—'}</div></div>
          <div><div style={{ fontSize: 11, color: 'var(--grey-400)' }}>GST no.</div><div>{clientInfo.gst_number || '—'}</div></div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 10 }}>Editing here updates the client master; contact details flow to all their documents automatically. A name change syncs to active (unsent) documents — already-sent ones keep their original name.</div>
      </div>
      {showClientEdit && clientInfo.client_id && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) setShowClientEdit(false); }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 680, boxShadow: 'var(--shadow-lg)', padding: '8px 4px' }}>
            <ClientForm initial={clientInfo} title="Edit client" onSave={handleSaveClient} onCancel={() => setShowClientEdit(false)} />
          </div>
        </div>
      )}
      {showDiscount && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', overflowY: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) setShowDiscount(false); }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 440, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--grey-100)', fontSize: 15, fontWeight: 600, color: 'var(--grey-800)' }}>Discount / write-off <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--grey-400)' }}>· {inv.ref_number} · outstanding ₹{Math.round(outstanding).toLocaleString('en-IN')}</span></div>
            <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <div><label className="field-label">Discount amount (₹) <span style={{ color: 'var(--pink)' }}>*</span></label><input type="number" className="field-input" value={discountForm.amount} onChange={(e) => setDiscountForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0" /><div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 4 }}>Prefilled with the full outstanding (a write-off). Lower it for a partial discount. New total: ₹{Math.max(0, Math.round(grand - (parseFloat(discountForm.amount) || 0))).toLocaleString('en-IN')}.</div></div>
              <div><label className="field-label">Reason <span style={{ color: 'var(--pink)' }}>*</span></label><input className="field-input" value={discountForm.reason} onChange={(e) => setDiscountForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Goodwill discount agreed on event day" /></div>
              <div style={{ fontSize: 11, color: 'var(--grey-400)' }}>Reduces the invoice total and outstanding, rescales the installment schedule, and is logged in the activity trail. If the discount clears the balance, the invoice is marked Paid.</div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button className="btn" onClick={() => setShowDiscount(false)}>Cancel</button><button className="btn primary" disabled={saving} onClick={applyDiscount}>{saving ? 'Saving…' : 'Apply discount'}</button></div>
          </div>
        </div>
      )}
      {showRefund && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', overflowY: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) setShowRefund(false); }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 440, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--grey-100)', fontSize: 15, fontWeight: 600, color: 'var(--grey-800)' }}>Record client refund <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--grey-400)' }}>· {inv.ref_number} · collected ₹{Math.round(parseFloat(inv.total_received) || 0).toLocaleString('en-IN')}</span></div>
            <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label className="field-label">Refund amount (₹) <span style={{ color: 'var(--pink)' }}>*</span></label><input type="number" className="field-input" value={refundForm.amount} onChange={(e) => setRefundForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0" /></div>
              <div><label className="field-label">Date</label><input type="date" className="field-input" value={refundForm.date} onChange={(e) => setRefundForm((f) => ({ ...f, date: e.target.value }))} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label className="field-label">Reason <span style={{ color: 'var(--pink)' }}>*</span></label><input className="field-input" value={refundForm.reason} onChange={(e) => setRefundForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Refunded advance after cancellation" /></div>
              <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--grey-400)' }}>Recorded as a reversal — reduces collected. Move the money to the client offline.</div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button className="btn" onClick={() => setShowRefund(false)}>Cancel</button><button className="btn primary" disabled={paySaving} onClick={submitRefund}>{paySaving ? 'Saving…' : 'Record refund'}</button></div>
          </div>
        </div>
      )}
      {showPay && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) setShowPay(false); }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 480, boxShadow: 'var(--shadow-lg)', padding: '20px 24px' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 4 }}>Record payment · {inv.ref_number}</div>
            <div style={{ fontSize: 12, color: 'var(--grey-400)', marginBottom: 14 }}>Outstanding: ₹{outstanding.toLocaleString('en-IN')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div><div style={{ fontSize: 12, fontWeight: 500, color: 'var(--grey-700)', marginBottom: 4 }}>Amount (₹) <span style={{ color: 'var(--red)' }}>*</span></div><input className="field-input" type="number" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} /></div>
              <div><div style={{ fontSize: 12, fontWeight: 500, color: 'var(--grey-700)', marginBottom: 4 }}>Date <span style={{ color: 'var(--red)' }}>*</span></div><input className="field-input" type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} /></div>
              <div><div style={{ fontSize: 12, fontWeight: 500, color: 'var(--grey-700)', marginBottom: 4 }}>Mode <span style={{ color: 'var(--red)' }}>*</span></div><select className="field-input" value={payForm.mode} onChange={(e) => setPayForm((f) => ({ ...f, mode: e.target.value }))}>{[['upi', 'UPI'], ['neft', 'Bank / NEFT'], ['cash', 'Cash'], ['cheque', 'Cheque']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
              <div><div style={{ fontSize: 12, fontWeight: 500, color: 'var(--grey-700)', marginBottom: 4 }}>Against installment {unpaidInstallments.length > 0 && <span style={{ color: 'var(--red)' }}>*</span>}</div><select className="field-input" value={payForm.installment_id} onChange={(e) => setPayForm((f) => ({ ...f, installment_id: e.target.value }))}>{unpaidInstallments.length === 0 ? <option value="">General — against outstanding</option> : <option value="">Auto — apply in order</option>}{unpaidInstallments.map((it) => <option key={it.installment_id} value={it.installment_id}>{(it.label || ('Installment ' + it.installment_number)) + ' · bal ₹' + (parseFloat(it.balance != null ? it.balance : it.amount_due) || 0).toLocaleString('en-IN')}</option>)}</select></div>
            </div>
            <div style={{ marginBottom: 8 }}><div style={{ fontSize: 12, fontWeight: 500, color: 'var(--grey-700)', marginBottom: 4 }}>Reference no. (optional)</div><input className="field-input" value={payForm.reference} onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))} placeholder="UTR / cheque no. / txn id" /></div>
            <div style={{ marginBottom: 12 }}><div style={{ fontSize: 12, fontWeight: 500, color: 'var(--grey-700)', marginBottom: 4 }}>Notes (optional)</div><input className="field-input" value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} /></div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--grey-700)', marginBottom: 4 }}>Payment confirmation (optional)</div>
              <input type="file" accept="image/*,application/pdf" onChange={(e) => setPayFile((e.target.files && e.target.files[0]) || null)} style={{ fontSize: 12 }} />
              {payFile && <div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 4 }}>Attached: {payFile.name}</div>}
              <div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 2 }}>Screenshot or PDF — from your phone or computer.</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setShowPay(false)}>Cancel</button>
              <button className="btn primary" disabled={paySaving} onClick={recordPayment}>{paySaving ? 'Saving…' : 'Record payment'}</button>
            </div>
          </div>
        </div>
      )}
      {revising && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) setRevising(false); }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 720, boxShadow: 'var(--shadow-lg)', padding: '20px 24px' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 4 }}>Revise invoice {inv.ref_number}</div>
            <div style={{ fontSize: 12, color: 'var(--grey-400)', marginBottom: 14 }}>Edits recompute totals and installments and are logged. {inv.status !== 'draft' ? ('This invoice has been issued — saving creates revision ' + ((inv.revision_number || 0) + 1) + '.') : 'This is a draft — it updates in place.'}</div>
            <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 110px 28px', gap: 8, fontSize: 11, color: 'var(--grey-400)', marginBottom: 4 }}><span>Description</span><span>Qty</span><span>Unit price</span><span></span></div>
              {revItems.map((r, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 110px 28px', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                  <input className="field-input" value={r.description} placeholder="Description" onChange={(e) => { const a = [...revItems]; a[i] = { ...a[i], description: e.target.value }; setRevItems(a); }} />
                  <input className="field-input" type="number" value={r.quantity} onChange={(e) => { const a = [...revItems]; a[i] = { ...a[i], quantity: e.target.value }; setRevItems(a); }} />
                  <input className="field-input" type="number" value={r.unit_price} onChange={(e) => { const a = [...revItems]; a[i] = { ...a[i], unit_price: e.target.value }; setRevItems(a); }} />
                  <button className="btn sm" style={{ color: 'var(--red)' }} onClick={() => setRevItems(revItems.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <button className="btn sm" onClick={() => setRevItems([...revItems, { description: '', quantity: 1, unit_price: 0, sub_event_name: null }])}>+ Add item</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, borderTop: '1px solid var(--grey-100)', paddingTop: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 13, color: 'var(--grey-600)' }}>Discount (₹) <input className="field-input" type="number" disabled={revOverrideOn} style={{ width: 120, display: 'inline-block', marginLeft: 8, ...(revOverrideOn ? { opacity: 0.5 } : {}) }} value={revDiscount} onChange={(e) => setRevDiscount(e.target.value)} /></label>
                <label style={{ fontSize: 13, color: 'var(--grey-600)' }}>Or set total (before GST) <input className="field-input" type="number" style={{ width: 120, display: 'inline-block', marginLeft: 8 }} value={revTotalOverride}
                  onChange={(e) => setRevTotalOverride(e.target.value)}
                  onBlur={(e) => { const v = e.target.value; if (v !== '' && !isNaN(parseFloat(v))) { const tgt = parseFloat(v); if (Math.abs(tgt - revSub) > 0.5) { const adj = revSub - tgt; if (!window.confirm('Set the total (before GST) to ₹' + Math.round(tgt).toLocaleString('en-IN') + '?\n\nLine items add up to ₹' + Math.round(revSub).toLocaleString('en-IN') + '. This applies a ' + (adj > 0 ? '−' : '+') + '₹' + Math.round(Math.abs(adj)).toLocaleString('en-IN') + ' adjustment' + (inv.gst_applicable ? ', then GST is added on top.' : '.'))) { setRevTotalOverride(''); } } } }} /></label>
                {revOverrideOn && <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: 'var(--orange-light)', color: 'var(--orange)', alignSelf: 'flex-start' }}>Manual total · {revEffDiscount >= 0 ? '−' : '+'}₹{Math.round(Math.abs(revEffDiscount)).toLocaleString('en-IN')} adjustment</span>}
              </div>
              <div style={{ textAlign: 'right', fontSize: 13 }}>
                <div style={{ color: 'var(--grey-400)' }}>Subtotal ₹{revSub.toLocaleString('en-IN')}{revOverrideOn ? (' · adj ' + (revEffDiscount >= 0 ? '−' : '+') + '₹' + Math.round(Math.abs(revEffDiscount)).toLocaleString('en-IN')) : ''}{inv.gst_applicable ? (' · GST ₹' + revTax.toLocaleString('en-IN')) : ''}</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>Grand total ₹{revGrand.toLocaleString('en-IN')}</div>
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--grey-700)', marginBottom: 4 }}>Reason for revision <span style={{ color: 'var(--red)' }}>*</span></div>
              <textarea className="field-input" rows={2} value={revReason} onChange={(e) => setRevReason(e.target.value)} placeholder="e.g. Client added lighting on event day" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setRevising(false)}>Cancel</button>
              <button className="btn primary" disabled={revSaving} onClick={handleRevise}>{revSaving ? 'Saving…' : 'Save revision'}</button>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Line items + totals */}
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '16px 20px', border: '1px solid var(--grey-100)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 12 }}>Line items</div>
          {items.length === 0 && <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>No line items.</div>}
          {Object.keys(groups).map((g) => (
            <div key={g} style={{ marginBottom: 10 }}>
              {Object.keys(groups).length > 1 && <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--grey-400)', textTransform: 'uppercase', letterSpacing: '.04em', margin: '6px 0' }}>{g}</div>}
              {groups[g].map((li) => (
                <div key={li.line_item_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--grey-50)' }}>
                  <span style={{ flex: 1 }}>{li.description}</span>
                  <span style={{ color: 'var(--grey-400)', whiteSpace: 'nowrap' }}>{parseFloat(li.quantity || 0)} × ₹{parseFloat(li.unit_price || 0).toLocaleString('en-IN')}</span>
                  <span style={{ fontWeight: 500, whiteSpace: 'nowrap', minWidth: 80, textAlign: 'right' }}>₹{parseFloat(li.amount || 0).toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--grey-200)', marginTop: 10, paddingTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0', color: 'var(--grey-600)' }}><span>Subtotal</span><span>₹{subtotal.toLocaleString('en-IN')}</span></div>
            {Math.abs(discount) > 0.5 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0', color: 'var(--grey-600)' }}><span>Adjustment</span><span>{discount > 0 ? '− ' : '+ '}₹{Math.abs(Math.round(discount)).toLocaleString('en-IN')}</span></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0', color: 'var(--grey-600)' }}><span>GST {inv.gst_applicable ? '@ ' + gstPct + '%' : '(not applied)'}</span><span>₹{tax.toLocaleString('en-IN')}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 600, padding: '4px 0' }}><span>Grand total</span><span>₹{grand.toLocaleString('en-IN')}</span></div>
          </div>
        </div>

        {/* Right column: GST + installments + totals */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '14px 18px', border: '1px solid var(--grey-100)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)' }}>GST applicable</div>
                <div style={{ fontSize: 11, color: 'var(--grey-400)' }}>Rate from Settings: {parseFloat(settings.gst_pct) || 0}%</div>
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', cursor: locked ? 'not-allowed' : 'pointer' }}>
                <input type="checkbox" checked={!!inv.gst_applicable} disabled={saving || locked} onChange={(e) => toggleGst(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--pink)' }} />
              </label>
            </div>
          </div>

          <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '14px 18px', border: '1px solid var(--grey-100)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 10 }}>Installments</div>
            {installments.length === 0 && <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>No installment schedule.</div>}
            {installments.map((it) => {
              const ist = INVOICE_STATUS_COLORS[it.status] || { bg: 'var(--grey-100)', color: 'var(--grey-400)' };
              return (
                <div key={it.installment_id} style={{ padding: '6px 0', borderBottom: '1px solid var(--grey-50)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span>{it.label || ('Installment ' + it.installment_number)}{it.percentage ? ' · ' + parseFloat(it.percentage) + '%' : ''}</span>
                    <span style={{ fontWeight: 500 }}>₹{parseFloat(it.amount_due || 0).toLocaleString('en-IN')}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--grey-400)', marginTop: 2 }}>
                    <span>{it.when_text || (it.due_date ? fmt(it.due_date) : '—')}</span>
                    <span>Bal ₹{parseFloat(it.balance != null ? it.balance : it.amount_due || 0).toLocaleString('en-IN')} · <span style={{ color: ist.color }}>{INVOICE_STATUS_LABELS[it.status] || it.status}</span></span>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '14px 18px', border: '1px solid var(--grey-100)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}><span style={{ color: 'var(--grey-400)' }}>Received</span><span style={{ fontWeight: 500, color: 'var(--green)' }}>₹{received.toLocaleString('en-IN')}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}><span style={{ color: 'var(--grey-400)' }}>Outstanding</span><span style={{ fontWeight: 500, color: outstanding > 0 ? 'var(--red)' : 'var(--green)' }}>₹{outstanding.toLocaleString('en-IN')}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--grey-50)' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--grey-700)' }}>Payments ({payments.length})</span>
              {canRecordPay && <button className="btn sm" style={{ fontSize: 11, padding: '3px 8px' }} onClick={openPay}>+ Record</button>}
              {canRecordPay && <button className="btn sm" style={{ fontSize: 11, padding: '3px 8px' }} title="Apply a last-minute discount / write off the balance" onClick={openDiscount}>% Discount</button>}
              {(parseFloat(inv.total_received) || 0) > 0 && <button className="btn sm" style={{ fontSize: 11, padding: '3px 8px' }} title="Record money refunded to the client" onClick={openRefund}>↩ Refund</button>}
            </div>
            {payments.length === 0 && <div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 4 }}>No payments recorded yet.</div>}
            {payments.map((p) => (
              <div key={p.payment_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--grey-50)' }}>
                <span style={{ color: 'var(--grey-600)' }}>{fmtDate(p.payment_date, { day: 'numeric', month: 'short', year: 'numeric' })} · {String(p.payment_mode || '').toUpperCase()}{p.reference_number ? (' · ' + p.reference_number) : ''}{p.receipt_url ? <a href={p.receipt_url} target="_blank" rel="noreferrer" style={{ color: 'var(--pink)', marginLeft: 6 }}>📎 receipt</a> : ''}</span>
                <span style={{ fontWeight: 500, color: 'var(--green)' }}>₹{parseFloat(p.amount || 0).toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Activity & change log */}
      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '14px 20px', border: '1px solid var(--grey-100)', marginTop: 16 }}>
        <div onClick={() => setShowLog((v) => !v)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)' }}>{showLog ? '▾' : '▸'} Activity & change log <span style={{ fontSize: 11, color: 'var(--grey-400)', fontWeight: 400 }}>({activity.length})</span></div>
          <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>{sends.length > 0 ? ('Sent ' + sends.length + '× · last ' + fmtDT(sends[0].changed_at)) : 'Not sent yet'}</div>
        </div>
        {showLog && (
          <div style={{ marginTop: 10, borderLeft: '2px solid var(--grey-100)', paddingLeft: 12 }}>
            {activity.length === 0 && <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>No activity recorded yet.</div>}
            {activity.map((a) => (
              <div key={a.log_id} style={{ padding: '6px 0', borderBottom: '1px solid var(--grey-50)' }}>
                <div style={{ fontSize: 13, color: 'var(--grey-800)' }}>{describeActivity(a)}</div>
                <div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 2 }}>{fmtDT(a.changed_at)}{a.changed_by && userMap[a.changed_by] ? (' · ' + userMap[a.changed_by]) : ''}{a.revision_number ? (' · rev ' + a.revision_number) : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
