// Vendor Payments module — payments ledger, dues-by-vendor rollup (Excel export),
// voided-payment audit trail, and a record-payment modal. Ported verbatim.
import React from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/toast.jsx';
import { todayLocalStr, fmtDate } from '../lib/format.js';
import { VENDOR_CATS, VENDOR_MODES } from '../lib/constants.js';
import { addEventVendor, recordVendorPayment } from '../lib/money.js';
import { VendorLink } from '../components/links.jsx';
import { EventQuickView } from '../components/EventQuickView.jsx';

export function VendorPaymentsModule({ onNavigate }) {
  const [pays, setPays] = React.useState([]);
  const [evs, setEvs] = React.useState([]); // event_vendors
  const [vendors, setVendors] = React.useState([]);
  const [events, setEvents] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [evtFilter, setEvtFilter] = React.useState('');
  const [range, setRange] = React.useState('month');
  const [showVoided, setShowVoided] = React.useState(false);
  const [duesView, setDuesView] = React.useState(false);
  const [expVendor, setExpVendor] = React.useState(null);
  const [popupEvent, setPopupEvent] = React.useState(null);
  const [showRec, setShowRec] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const recEmpty = { eventId: '', eventVendorId: '', newVendor: false, vendorName: '', vendorId: '', category: 'other', service: '', agreed: '', amount: '', date: todayLocalStr(), mode: 'upi', reference: '' };
  const [rec, setRec] = React.useState(recEmpty);
  const setR = (k, v) => setRec((f) => ({ ...f, [k]: v }));

  const load = React.useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: ev }, { data: vn }, { data: e }] = await Promise.all([
      supabase.from('vendor_payments').select('*').order('payment_date', { ascending: false }),
      supabase.from('event_vendors').select('*').eq('is_deleted', false),
      supabase.from('vendors').select('vendor_id,name,category,status').eq('is_deleted', false),
      supabase.from('events').select('event_id,ref_number,name,main_date,client_name').eq('is_deleted', false).order('main_date', { ascending: false }),
    ]);
    setPays(p || []); setEvs(ev || []); setVendors(vn || []); setEvents(e || []); setLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const vMap = {}; vendors.forEach((v) => { vMap[v.vendor_id] = v.name; });
  const eMap = {}; events.forEach((e) => { eMap[e.event_id] = e; });
  const evMap = {}; evs.forEach((x) => { evMap[x.event_vendor_id] = x; });
  const yr = String(new Date().getFullYear()), mo = todayLocalStr().slice(0, 7);
  const inRange = (d) => range === 'all' ? true : range === 'year' ? (String(d || '').slice(0, 4) === yr) : (String(d || '').slice(0, 7) === mo);
  const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
  const live = pays.filter((p) => !p.is_voided);
  const mMonth = live.filter((p) => String(p.payment_date || '').slice(0, 7) === mo).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const mYear = live.filter((p) => String(p.payment_date || '').slice(0, 4) === yr).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const outstanding = evs.reduce((s, x) => s + (parseFloat(x.outstanding) || 0), 0);
  const voidedCount = pays.filter((p) => p.is_voided).length;
  // Cross-event dues rollup: what's still owed to each vendor, summed across all their engagements.
  const duesByVendor = (() => { const m = {}; evs.forEach((x) => { const out = parseFloat(x.outstanding) || 0; const vid = x.vendor_id ? ('id:' + x.vendor_id) : ('nm:' + (x.vendor_name || '?')); const name = vMap[x.vendor_id] || x.vendor_name || 'Unknown vendor'; if (!m[vid]) m[vid] = { key: vid, vid: x.vendor_id || null, name, agreed: 0, paid: 0, outstanding: 0, events: [] }; m[vid].agreed += parseFloat(x.agreed_amount) || 0; m[vid].paid += parseFloat(x.total_paid) || 0; m[vid].outstanding += out; if (out > 0.5) { m[vid].events.push({ eid: x.event_id, ev: eMap[x.event_id], outstanding: out, service: x.service_description }); } }); return Object.values(m).filter((r) => r.outstanding > 0.5).sort((a, b) => b.outstanding - a.outstanding); })();
  const exportDues = () => {
    if (!duesByVendor.length) { notify('No outstanding vendor dues to export.', 'info'); return; }
    const rows = [];
    duesByVendor.forEach((r) => {
      rows.push({ Vendor: r.name, Event: '— Total —', Agreed: Math.round(r.agreed), Paid: Math.round(r.paid), Outstanding: Math.round(r.outstanding) });
      r.events.forEach((e) => { rows.push({ Vendor: '', Event: (e.ev ? (e.ev.ref_number + ' · ' + e.ev.name) : '(event)') + (e.service ? (' · ' + e.service) : ''), Agreed: '', Paid: '', Outstanding: Math.round(e.outstanding) }); });
    });
    try { const ws = XLSX.utils.json_to_sheet(rows, { header: ['Vendor', 'Event', 'Agreed', 'Paid', 'Outstanding'] }); ws['!cols'] = [{ wch: 26 }, { wch: 42 }, { wch: 12 }, { wch: 12 }, { wch: 13 }]; const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Vendor dues'); XLSX.writeFile(wb, 'isheeka-vendor-dues-' + todayLocalStr() + '.xlsx'); notify('Vendor dues exported.', 'success'); }
    catch (err) { console.error('[Isheeka ERP] dues export failed:', err); notify('Could not export the dues.', 'error'); }
  };
  const filtered = pays.filter((p) => {
    if (showVoided ? !p.is_voided : p.is_voided) return false;
    const q = search.toLowerCase();
    const ev = evMap[p.event_vendor_id]; const evt = eMap[p.event_id];
    const ms = !q || `${vMap[p.vendor_id] || p.vendor_id || ''} ${(ev && ev.service_description) || ''} ${(evt && evt.ref_number) || ''} ${(evt && evt.name) || ''} ${p.reference_number || ''} ${p.void_reason || ''}`.toLowerCase().includes(q);
    const me = !evtFilter || p.event_id === evtFilter;
    return ms && me && inRange(p.payment_date);
  });

  const evForSelectedEvent = evs.filter((x) => x.event_id === rec.eventId);
  const openRec = () => { setRec(recEmpty); setShowRec(true); };
  const saveRec = async () => {
    if (!rec.eventId) { notify('Select the event this payment is for.', 'error'); return; }
    const amt = parseFloat(rec.amount) || 0; if (amt <= 0) { notify('Enter a valid amount.', 'error'); return; }
    setSaving(true);
    try {
      let ev;
      if (rec.newVendor) {
        if (!rec.vendorName.trim()) { notify('Enter the vendor name.', 'error'); setSaving(false); return; }
        ev = await addEventVendor({ eventId: rec.eventId, vendorId: rec.vendorId || null, vendorName: rec.vendorName.trim(), category: rec.category, service: rec.service, agreed: rec.agreed });
      } else {
        if (!rec.eventVendorId) { notify('Pick the vendor on this event (or add a new one).', 'error'); setSaving(false); return; }
        ev = evMap[rec.eventVendorId];
      }
      await recordVendorPayment(ev, { amount: amt, date: rec.date, mode: rec.mode, reference: rec.reference });
      setSaving(false); setShowRec(false); notify('Vendor payment recorded.', 'success'); load();
    } catch (err) { console.error('[Isheeka ERP] vendor payment failed:', err); notify('Could not record the payment: ' + (err && err.message ? err.message : 'try again'), 'error'); setSaving(false); }
  };

  return (
    <div>
      {popupEvent && <EventQuickView eventId={popupEvent} onClose={() => setPopupEvent(null)} onNavigate={onNavigate} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--grey-800)' }}>Vendor payments</div>
        <button className="btn primary" onClick={openRec}>+ Record payment</button>
      </div>
      <div className="metrics-grid" style={{ marginBottom: 18 }}>
        <div className="metric-card pink"><div className="metric-icon">🧾</div><div className="metric-value">{inr(mMonth)}</div><div className="metric-label">Paid this month</div></div>
        <div className="metric-card red"><div className="metric-icon">⏳</div><div className="metric-value">{inr(outstanding)}</div><div className="metric-label">Outstanding to vendors</div></div>
        <div className="metric-card blue"><div className="metric-icon">📅</div><div className="metric-value">{inr(mYear)}</div><div className="metric-label">Paid this year</div></div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 180, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--grey-400)', pointerEvents: 'none' }}>🔍</span>
          <input className="field-input" style={{ paddingLeft: 36 }} placeholder="Search vendor, event ref/name, reference…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="field-input" style={{ width: 200 }} value={evtFilter} onChange={(e) => setEvtFilter(e.target.value)}><option value="">All events</option>{events.map((e) => <option key={e.event_id} value={e.event_id}>{e.ref_number} · {e.name}{e.client_name ? (' · ' + e.client_name) : ''}{e.main_date ? (' · ' + fmtDate(e.main_date, { day: 'numeric', month: 'short', year: 'numeric' })) : ''}</option>)}</select>
        <select className="field-input" style={{ width: 130 }} value={range} onChange={(e) => setRange(e.target.value)}><option value="month">This month</option><option value="year">This year</option><option value="all">All time</option></select>
        <button className="btn sm" onClick={() => setDuesView((v) => !v)} title="Outstanding owed to each vendor across all their events" style={{ background: duesView ? 'var(--grey-100)' : undefined, color: duesView ? 'var(--grey-800)' : 'var(--grey-400)' }}>{duesView ? '← Payments' : ('Dues by vendor' + (duesByVendor.length ? (' (' + duesByVendor.length + ')') : ''))}</button>
        {duesView && <button className="btn sm" onClick={exportDues} title="Download the vendor dues as an Excel file">⬇ Export</button>}
        <button className="btn sm" onClick={() => setShowVoided((v) => !v)} title="Audit trail of voided payments" style={{ background: showVoided ? 'var(--grey-100)' : undefined, color: showVoided ? 'var(--grey-800)' : 'var(--grey-400)' }}>{showVoided ? '← Active' : ('Voided' + (voidedCount ? (' (' + voidedCount + ')') : ''))}</button>
      </div>
      {!duesView && (loading ? <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        : filtered.length === 0 ? <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: 50, textAlign: 'center', border: '1px solid var(--grey-100)', color: 'var(--grey-400)' }}>No vendor payments for this view. <button className="btn sm" onClick={openRec}>+ Record one</button></div>
          : <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 200px 90px 96px', gap: 10, padding: '9px 16px', background: 'var(--grey-50)', fontSize: 11, fontWeight: 600, color: 'var(--grey-400)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              <div>Date</div><div>Vendor / service</div><div>Event</div><div>Mode</div><div style={{ textAlign: 'right' }}>Amount</div>
            </div>
            {filtered.map((p) => { const ev = evMap[p.event_vendor_id]; const evt = eMap[p.event_id]; return (
              <div key={p.payment_id || p.vendor_payment_id} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 200px 90px 96px', gap: 10, padding: '11px 16px', borderTop: '1px solid var(--grey-100)', alignItems: 'center', fontSize: 13, opacity: p.is_voided ? 0.75 : 1 }}>
                <div style={{ color: 'var(--grey-500)' }}>{fmtDate(p.payment_date, { day: 'numeric', month: 'short' })}</div>
                <div><b><VendorLink vendorId={p.vendor_id} name={vMap[p.vendor_id]} onNavigate={onNavigate}>{vMap[p.vendor_id] || 'Vendor'}</VendorLink></b>{ev && ev.service_description ? (' · ' + ev.service_description) : ''}{p.is_voided && <div style={{ fontSize: 11, color: 'var(--red)' }}>voided{p.voided_at ? (' ' + fmtDate(p.voided_at, { day: 'numeric', month: 'short', year: 'numeric' })) : ''}{p.void_reason ? (' — ' + p.void_reason) : ''}</div>}</div>
                <div>{evt ? <><a onClick={() => setPopupEvent(p.event_id)} style={{ color: 'var(--pink)', cursor: 'pointer', fontWeight: 500 }}>{evt.ref_number}</a> <span style={{ color: 'var(--grey-400)' }}>· {evt.name}</span></> : '—'}</div>
                <div style={{ textTransform: 'uppercase', fontSize: 11, color: 'var(--grey-500)' }}>{p.payment_mode}</div>
                <div style={{ textAlign: 'right', fontWeight: 500, textDecoration: p.is_voided ? 'line-through' : 'none', color: p.is_voided ? 'var(--grey-400)' : 'var(--grey-800)' }}>{inr(p.amount)}</div>
              </div>
            ); })}
          </div>)}

      {duesView && (
        duesByVendor.length === 0
          ? <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: 50, textAlign: 'center', border: '1px solid var(--grey-100)', color: 'var(--grey-400)' }}>No outstanding vendor dues — everyone's settled. 🎉</div>
          : <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 110px 110px 120px', gap: 10, padding: '9px 16px', background: 'var(--grey-50)', fontSize: 11, fontWeight: 600, color: 'var(--grey-400)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              <div>Vendor</div><div style={{ textAlign: 'center' }}>Events</div><div style={{ textAlign: 'right' }}>Agreed</div><div style={{ textAlign: 'right' }}>Paid</div><div style={{ textAlign: 'right' }}>Outstanding</div>
            </div>
            {duesByVendor.map((r) => { const open = expVendor === r.key; return (
              <div key={r.key} style={{ borderTop: '1px solid var(--grey-100)' }}>
                <div onClick={() => setExpVendor(open ? null : r.key)} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 110px 110px 120px', gap: 10, padding: '11px 16px', alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                  <div style={{ fontWeight: 600, color: 'var(--grey-800)' }}>{open ? '▾' : '▸'} {r.name}</div>
                  <div style={{ textAlign: 'center', color: 'var(--grey-500)' }}>{r.events.length}</div>
                  <div style={{ textAlign: 'right', color: 'var(--grey-500)' }}>{inr(r.agreed)}</div>
                  <div style={{ textAlign: 'right', color: 'var(--grey-500)' }}>{inr(r.paid)}</div>
                  <div style={{ textAlign: 'right', fontWeight: 600, color: 'var(--red)' }}>{inr(r.outstanding)}</div>
                </div>
                {open && r.events.map((e, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10, padding: '8px 16px 8px 32px', alignItems: 'center', fontSize: 12, background: 'var(--grey-50)', borderTop: '1px solid var(--grey-100)' }}>
                    <div>{e.ev ? <a onClick={() => onNavigate && onNavigate('events', { eventId: e.eid, label: e.ev.name || e.ev.ref_number || 'Event' })} style={{ color: 'var(--pink)', cursor: 'pointer', fontWeight: 500 }}>{e.ev.ref_number}</a> : '—'}{e.ev ? (' · ' + e.ev.name) : ''}{e.service ? (' · ' + e.service) : ''}</div>
                    <div style={{ textAlign: 'right', color: 'var(--red)' }}>{inr(e.outstanding)}</div>
                  </div>
                ))}
              </div>
            ); })}
          </div>
      )}

      {showRec && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) setShowRec(false); }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 520 }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)' }}>Record vendor payment</div>
              <button className="btn sm" onClick={() => setShowRec(false)}>✕</button>
            </div>
            <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}><label className="field-label">Event <span style={{ color: 'var(--pink)' }}>*</span></label><select className="field-input" value={rec.eventId} onChange={(e) => { setR('eventId', e.target.value); setR('eventVendorId', ''); setR('newVendor', false); }}><option value="">Select event…</option>{events.map((e) => <option key={e.event_id} value={e.event_id}>{e.ref_number} · {e.name}{e.client_name ? (' · ' + e.client_name) : ''}{e.main_date ? (' · ' + fmtDate(e.main_date, { day: 'numeric', month: 'short', year: 'numeric' })) : ''}</option>)}</select></div>
              {rec.eventId && <div style={{ gridColumn: '1 / -1' }}>
                <label className="field-label">Vendor</label>
                <select className="field-input" value={rec.newVendor ? '__new' : rec.eventVendorId} onChange={(e) => { if (e.target.value === '__new') { setR('newVendor', true); setR('eventVendorId', ''); } else { setR('newVendor', false); setR('eventVendorId', e.target.value); } }}>
                  <option value="">Select a vendor on this event…</option>
                  {evForSelectedEvent.map((x) => <option key={x.event_vendor_id} value={x.event_vendor_id}>{x.vendor_name || vMap[x.vendor_id] || 'Vendor'}{x.service_description ? (' — ' + x.service_description) : ''} (bal ₹{Math.round(parseFloat(x.outstanding) || 0).toLocaleString('en-IN')})</option>)}
                  <option value="__new">+ Add a new vendor to this event</option>
                </select>
              </div>}
              {rec.eventId && rec.newVendor && <>
                <div style={{ gridColumn: '1 / -1' }}><label className="field-label">From vendor master</label>
                  <select className="field-input" value={rec.vendorId} onChange={(e) => { const v = vendors.find((x) => String(x.vendor_id) === e.target.value); setRec((f) => ({ ...f, vendorId: e.target.value, vendorName: v ? v.name : '', category: (v && v.category) ? v.category : f.category })); }}>
                    <option value="">— Create brand-new vendor —</option>
                    {vendors.filter((v) => v.status === 'active' && !evForSelectedEvent.some((x) => String(x.vendor_id) === String(v.vendor_id))).map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.name}{v.category ? (' · ' + ((VENDOR_CATS.find((c) => c[0] === v.category) || [])[1] || v.category)) : ''}</option>)}
                  </select>
                </div>
                {!rec.vendorId && <div><label className="field-label">Vendor name <span style={{ color: 'var(--pink)' }}>*</span></label><input className="field-input" value={rec.vendorName} onChange={(e) => setR('vendorName', e.target.value)} placeholder="e.g. Blooms Decor" /></div>}
                <div><label className="field-label">Category</label><select className="field-input" value={rec.category} onChange={(e) => setR('category', e.target.value)} disabled={!!rec.vendorId}>{VENDOR_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                <div><label className="field-label">Service</label><input className="field-input" value={rec.service} onChange={(e) => setR('service', e.target.value)} placeholder="e.g. Mandap & florals" /></div>
                <div><label className="field-label">Agreed amount (₹)</label><input type="number" className="field-input" value={rec.agreed} onChange={(e) => setR('agreed', e.target.value)} placeholder="0" /></div>
              </>}
              <div><label className="field-label">Amount paid (₹) <span style={{ color: 'var(--pink)' }}>*</span></label><input type="number" className="field-input" value={rec.amount} onChange={(e) => setR('amount', e.target.value)} placeholder="0" /></div>
              <div><label className="field-label">Date <span style={{ color: 'var(--pink)' }}>*</span></label><input type="date" className="field-input" value={rec.date} onChange={(e) => setR('date', e.target.value)} /></div>
              <div><label className="field-label">Mode</label><select className="field-input" value={rec.mode} onChange={(e) => setR('mode', e.target.value)}>{VENDOR_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
              <div><label className="field-label">Reference</label><input className="field-input" value={rec.reference} onChange={(e) => setR('reference', e.target.value)} placeholder="optional" /></div>
            </div>
            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setShowRec(false)}>Cancel</button>
              <button className="btn primary" disabled={saving} onClick={saveRec}>{saving ? 'Saving…' : 'Record payment'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
