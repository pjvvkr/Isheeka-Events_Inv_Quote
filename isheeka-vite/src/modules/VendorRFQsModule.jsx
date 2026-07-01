// Vendor RFQ module (staff side) — a directory of every vendor RFQ across the system,
// mirroring the Client RFQ module. Each row shows the vendor, the event, and the client
// it's being sourced for. The detail page shows the vendor's frozen item list + their
// submitted costs, with reminder / regenerate-link / jump-to-costing actions.
//
// A vendor RFQ is an `rfqs` row with party_type='vendor', parent_rfq_id (the client RFQ
// it sources) and vendor_id. Logic lives in lib/vendorRfq.js.
import React from 'react';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/toast.jsx';
import { fmtDate, eventTypeLabel } from '../lib/format.js';
import { waLink } from '../lib/share.js';
import { loadVendorRfqItems, regenerateVendorLink, bumpReminder, vendorRfqLink, buildVendorRfqMsg } from '../lib/vendorRfq.js';
import { confirmDialog } from '../components/confirm.jsx';

// Vendor-RFQ status chips (the vendor lifecycle: Sent → Opened → Submitted).
const VCHIP = {
  sent: { l: 'Sent', bg: 'var(--blue-light)', c: 'var(--blue)' },
  in_progress: { l: 'Opened', bg: '#FAEEDA', c: '#854F0B' },
  submitted: { l: 'Submitted', bg: 'var(--green-light)', c: 'var(--green)' },
  withdrawn: { l: 'Withdrawn', bg: 'var(--grey-100)', c: 'var(--grey-400)' },
  expired: { l: 'Expired', bg: 'var(--grey-100)', c: 'var(--grey-400)' },
};
const vchip = (s) => VCHIP[s] || VCHIP.sent;

function rfqItemsGrouped(list) { const g = {}; (list || []).forEach((it) => { const k = it.sub_event_name || 'General'; (g[k] = g[k] || []).push(it); }); return g; }

export function VendorRFQsModule({ nav, onNavigate, onBack }) {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState('');
  const detailId = nav && nav.vendorRfqId;

  const load = async () => {
    setLoading(true);
    const { data: vrfqs } = await supabase.from('rfqs')
      .select('rfq_id,ref_number,status,vendor_id,parent_rfq_id,event_type,event_date,created_at,client_submitted_at,reminder_count,revision_number')
      .eq('party_type', 'vendor').eq('is_deleted', false).order('created_at', { ascending: false });
    const list = vrfqs || [];
    // Resolve vendor names + the parent client RFQ (for the client name + event fallback).
    const vIds = [...new Set(list.map((r) => r.vendor_id).filter(Boolean))];
    const pIds = [...new Set(list.map((r) => r.parent_rfq_id).filter(Boolean))];
    const [vRes, pRes] = await Promise.all([
      vIds.length ? supabase.from('vendors').select('vendor_id,name').in('vendor_id', vIds) : Promise.resolve({ data: [] }),
      pIds.length ? supabase.from('rfqs').select('rfq_id,contact_name,event_type,client_id').in('rfq_id', pIds) : Promise.resolve({ data: [] }),
    ]);
    const vmap = {}; (vRes.data || []).forEach((v) => { vmap[v.vendor_id] = v; });
    const pmap = {}; (pRes.data || []).forEach((p) => { pmap[p.rfq_id] = p; });
    setRows(list.map((r) => {
      const p = pmap[r.parent_rfq_id] || {};
      return {
        ...r,
        vendor_name: (vmap[r.vendor_id] || {}).name || '—',
        client_name: p.contact_name || '—',
        event_name: r.event_type || p.event_type || '',
      };
    }));
    setLoading(false);
  };
  React.useEffect(() => { if (!detailId) load(); }, [detailId]);

  if (detailId) return <VendorRFQDetail rfqId={detailId} onBack={onBack} onNavigate={onNavigate} />;

  const responded = rows.filter((r) => r.status === 'submitted').length;
  const pending = rows.filter((r) => ['sent', 'in_progress'].includes(r.status)).length;
  const list = rows.filter((r) => !statusFilter || r.status === statusFilter);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--grey-800)' }}>Vendor RFQs</div>
          {rows.length > 0 && <div style={{ fontSize: 12, color: 'var(--grey-400)', marginTop: 2 }}>{responded} responded · {pending} awaiting pricing</div>}
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--grey-400)', marginBottom: 14 }}>To request new pricing, open a client RFQ (or any quote) and use <b>Source vendors</b> — that sends vendor RFQs and they land here.</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select className="field-input" style={{ width: 200, fontSize: 13 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.keys(VCHIP).map((s) => <option key={s} value={s}>{VCHIP[s].l}</option>)}
        </select>
      </div>
      {loading ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>
        : list.length === 0 ? <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: 40, textAlign: 'center', color: 'var(--grey-400)' }}>No vendor RFQs yet. Use “Source vendors” on a client RFQ or quote to request pricing.</div>
          : <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', overflow: 'hidden' }}>
            {list.map((r, i) => { const sc = vchip(r.status); return (
              <div key={r.rfq_id} onClick={() => onNavigate('vendor-rfqs', { vendorRfqId: r.rfq_id, label: r.ref_number })} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i > 0 ? '1px solid var(--grey-100)' : 'none', cursor: 'pointer' }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--pink)', width: 110, flexShrink: 0 }}>{r.ref_number}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--grey-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.vendor_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--grey-400)', marginTop: 1 }}>
                    {r.event_name || '—'}{r.event_date ? (' · ' + fmtDate(r.event_date, { day: 'numeric', month: 'short', year: 'numeric' })) : ''} · client: {r.client_name}
                  </div>
                </div>
                {(r.revision_number || 0) > 1 && <span title={'Vendor revised this ' + r.revision_number + '×'} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600, background: 'var(--orange-light)', color: 'var(--orange)' }}>🔄 Rev {r.revision_number}</span>}
                {r.reminder_count > 0 && r.status !== 'submitted' && <span style={{ fontSize: 11, color: 'var(--grey-400)' }}>reminded {r.reminder_count}×</span>}
                <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 500, background: sc.bg, color: sc.c, flexShrink: 0 }}>{sc.l}</span>
              </div>
            ); })}
          </div>}
    </div>
  );
}

function VendorRFQDetail({ rfqId, onBack, onNavigate }) {
  const [r, setR] = React.useState(null);
  const [items, setItems] = React.useState([]);
  const [vendor, setVendor] = React.useState(null);
  const [parent, setParent] = React.useState(null);
  const [settings, setSettings] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  const load = async () => {
    setLoading(true);
    const { data: rfq } = await supabase.from('rfqs').select('*').eq('rfq_id', rfqId).maybeSingle();
    const its = await loadVendorRfqItems(rfqId);
    const [vRes, pRes, sRes] = await Promise.all([
      rfq && rfq.vendor_id ? supabase.from('vendors').select('*').eq('vendor_id', rfq.vendor_id).maybeSingle() : Promise.resolve({ data: null }),
      rfq && rfq.parent_rfq_id ? supabase.from('rfqs').select('rfq_id,contact_name,client_id,event_type').eq('rfq_id', rfq.parent_rfq_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('settings').select('company_name').limit(1).maybeSingle(),
    ]);
    setR(rfq || null); setItems(its); setVendor(vRes.data || null); setParent(pRes.data || null); setSettings(sRes.data || null);
    setLoading(false);
  };
  React.useEffect(() => { load(); }, [rfqId]);

  const remind = async () => {
    try {
      const { token, pin } = await regenerateVendorLink(rfqId);
      const n = await bumpReminder(rfqId);
      const link = vendorRfqLink(token);
      const msg = buildVendorRfqMsg({ vendor_name: (vendor && vendor.name) || '', pin }, settings, link, { reminder: true });
      window.open(waLink(vendor && vendor.phone_1, msg), '_blank');
      notify('Reminder #' + n + ' — fresh link opened.', 'success'); load();
    } catch (e) { notify('Could not send reminder.', 'error'); }
  };
  const regenerate = async () => {
    if (!await confirmDialog('Generate a NEW link & PIN for this vendor? The previous link stops working.')) return;
    try {
      const { token, pin } = await regenerateVendorLink(rfqId);
      const link = vendorRfqLink(token);
      try { await navigator.clipboard.writeText(link + '\nPIN: ' + pin); } catch (e) { /* noop */ }
      notify('New link + PIN copied. PIN: ' + pin, 'success'); load();
    } catch (e) { notify('Could not regenerate.', 'error'); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>;
  if (!r) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--grey-400)' }}>Vendor RFQ not found.</div>;
  const sc = vchip(r.status);
  const groups = rfqItemsGrouped(items);
  const priced = items.filter((it) => it.can_supply !== false && it.unit_cost != null).length;
  const cant = items.filter((it) => it.can_supply === false).length;
  const clientName = (parent && parent.contact_name) || '—';

  return (
    <div>
      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: '18px 22px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--grey-800)' }}>{r.ref_number} <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 500, background: sc.bg, color: sc.c, marginLeft: 6 }}>{sc.l}</span>{(r.revision_number || 0) > 1 && <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 600, background: 'var(--orange-light)', color: 'var(--orange)', marginLeft: 6 }}>🔄 Rev {r.revision_number}</span>}</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--grey-800)', marginTop: 6 }}>{(vendor && vendor.name) || '—'}</div>
            <div style={{ fontSize: 13, color: 'var(--grey-400)', marginTop: 2 }}>{(eventTypeLabel(r.event_type || (parent && parent.event_type)) || '—')}{r.event_date ? (' · ' + fmtDate(r.event_date, { day: 'numeric', month: 'short', year: 'numeric' })) : ''}{r.city ? (' · ' + r.city) : ''}</div>
            <div style={{ fontSize: 12.5, color: 'var(--grey-400)', marginTop: 2 }}>Sourcing for client: <b style={{ color: 'var(--grey-600)' }}>{clientName}</b>{(vendor && vendor.phone_1) ? (' · vendor ' + vendor.phone_1) : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {r.status !== 'submitted' && !['withdrawn', 'expired'].includes(r.status) && <button className="btn sm" onClick={remind} title="Send a fresh link + reminder on WhatsApp">🔔 Remind</button>}
            {!['withdrawn', 'expired'].includes(r.status) && <button className="btn sm" onClick={regenerate}>🔗 Regenerate link & PIN</button>}
            {r.parent_rfq_id && <button className="btn sm" onClick={() => onNavigate && onNavigate('rfqs', { rfqId: r.parent_rfq_id, label: 'Client RFQ' })}>📝 Client RFQ →</button>}
            {r.parent_rfq_id && <button className="btn sm" onClick={() => onNavigate && onNavigate('rfqs', { costingRfqId: r.parent_rfq_id, label: 'Costing & markup' })}>🧮 Costing →</button>}
          </div>
        </div>
        {r.status === 'submitted' && <div style={{ fontSize: 12.5, color: 'var(--grey-600)', marginTop: 10, background: 'var(--grey-50)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' }}>✅ Submitted{r.client_submitted_at ? (' ' + fmtDate(r.client_submitted_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) : ''} · {priced} priced{cant ? (' · ' + cant + ' can’t supply') : ''}</div>}
        {r.notes && <div style={{ fontSize: 13, color: 'var(--grey-700)', marginTop: 10, background: 'var(--grey-50)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', overflowWrap: 'anywhere' }}><b style={{ color: 'var(--grey-800)' }}>Vendor note:</b> {r.notes}</div>}
      </div>

      {/* Items + the vendor's costs */}
      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 10 }}>Items {items.length > 0 ? ('(' + items.length + ')') : ''} {r.status === 'submitted' ? '· vendor pricing' : '· awaiting pricing'}</div>
        {items.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>No items on this vendor RFQ.</div>
          : Object.keys(groups).map((k) => (
            <div key={k} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: 'var(--gold)', marginBottom: 4 }}>{k.toUpperCase()}</div>
              {groups[k].map((it) => (
                <div key={it.rfq_item_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, fontSize: 13, padding: '3px 0' }}>
                  <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{it.description} <span style={{ color: 'var(--grey-400)' }}>×{it.quantity}</span>{it.item_note ? <span style={{ color: 'var(--grey-400)' }}> · {it.item_note}</span> : ''}</span>
                  <span style={{ whiteSpace: 'nowrap', color: it.can_supply === false ? 'var(--red)' : 'var(--grey-800)' }}>{it.can_supply === false ? 'can’t supply' : (it.unit_cost != null ? ('₹' + Number(it.unit_cost).toLocaleString('en-IN')) : '—')}</span>
                </div>
              ))}
            </div>
          ))}
      </div>

      <div style={{ marginTop: 4 }}><button className="btn sm" onClick={onBack}>← All vendor RFQs</button></div>
    </div>
  );
}
