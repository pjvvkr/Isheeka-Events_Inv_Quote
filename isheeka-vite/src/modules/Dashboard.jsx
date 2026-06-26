// Dashboard — greeting, KPI cards, upcoming events + outstanding invoices (ported verbatim).
import React from 'react';
import { supabase } from '../lib/supabase';
import { fmtDate } from '../lib/format.js';

const CAL_COLORS = [
  { bg: '#FBEAF0', fg: '#72243E' }, { bg: '#E1F5EE', fg: '#085041' }, { bg: '#FAEEDA', fg: '#633806' },
  { bg: '#E6F1FB', fg: '#0C447C' }, { bg: '#EEEDFE', fg: '#3C3489' }, { bg: '#FAECE7', fg: '#712B13' },
  { bg: '#EAF3DE', fg: '#27500A' }, { bg: '#F1EFE8', fg: '#444441' },
];

// Month calendar of confirmed events. One colour per event (its functions share it),
// busy days stack; clicking a chip opens that event's detail.
function EventCalendar({ events, onNavigate }) {
  const [cursor, setCursor] = React.useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const pad = (n) => String(n).padStart(2, '0');
  const colorByEvent = React.useMemo(() => { const m = {}; (events || []).forEach((e, i) => { m[e.event_id] = CAL_COLORS[i % CAL_COLORS.length]; }); return m; }, [events]);
  const byDate = React.useMemo(() => {
    const m = {};
    (events || []).forEach((e) => {
      const push = (date, label) => { if (!date) return; (m[date] = m[date] || []).push({ event_id: e.event_id, label, color: colorByEvent[e.event_id] || CAL_COLORS[0], ref: e.ref_number, client: e.client_name }); };
      push(e.main_date, e.name || 'Event');
      (e.subs || []).forEach((s) => push(s.date, s.name));
    });
    return m;
  }, [events, colorByEvent]);
  const y = cursor.getFullYear(), mo = cursor.getMonth();
  const startDow = new Date(y, mo, 1).getDay(), daysInMonth = new Date(y, mo + 1, 0).getDate();
  const cells = []; for (let i = 0; i < startDow; i++) cells.push(null); for (let d = 1; d <= daysInMonth; d++) cells.push(d); while (cells.length % 7 !== 0) cells.push(null);
  const todayStr = (() => { const t = new Date(); return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); })();
  return (
    <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '16px 20px', border: '1px solid var(--grey-100)', marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--grey-800)' }}>📅 {cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn sm" onClick={() => setCursor(new Date(y, mo - 1, 1))}>‹</button>
          <button className="btn sm" onClick={() => { const t = new Date(); setCursor(new Date(t.getFullYear(), t.getMonth(), 1)); }}>Today</button>
          <button className="btn sm" onClick={() => setCursor(new Date(y, mo + 1, 1))}>›</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--grey-400)', textAlign: 'center', padding: 2 }}>{d}</div>)}
        {cells.map((d, i) => {
          if (d == null) return <div key={i} />;
          const ds = y + '-' + pad(mo + 1) + '-' + pad(d);
          const items = byDate[ds] || []; const isToday = ds === todayStr;
          return (
            <div key={i} style={{ minHeight: 70, border: '1px solid ' + (isToday ? 'var(--pink)' : 'var(--grey-100)'), borderRadius: 6, padding: '3px 4px', background: isToday ? 'var(--pink-light)' : 'white' }}>
              <div style={{ fontSize: 11, color: 'var(--grey-500)', textAlign: 'right' }}>{d}</div>
              {items.slice(0, 3).map((it, j) => (
                <div key={j} onClick={() => onNavigate && onNavigate('events', { eventId: it.event_id, label: it.ref || 'Event' })} title={it.label + (it.client ? ' · ' + it.client : '')} style={{ background: it.color.bg, color: it.color.fg, fontSize: 10, borderRadius: 4, padding: '1px 5px', marginTop: 2, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>
              ))}
              {items.length > 3 && <div style={{ fontSize: 9, color: 'var(--grey-400)', marginTop: 2 }}>+{items.length - 3} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Dashboard({ user, onNavigate }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.user_metadata?.first_name || user?.email?.split('@')[0] || 'there';
  const [stats, setStats] = React.useState({ activeLeads: 0, upcomingCount: 0, quotedMonth: 0, collectedMonth: 0, rfqReview: 0 });
  const [upcoming, setUpcoming] = React.useState([]);
  const [outstanding, setOutstanding] = React.useState([]);
  const [clientResp, setClientResp] = React.useState([]);   // client RFQs submitted, awaiting review
  const [vendorResp, setVendorResp] = React.useState([]);   // vendor bids submitted, awaiting costing
  const [loading, setLoading] = React.useState(true);
  const [calEvents, setCalEvents] = React.useState([]);
  React.useEffect(() => { (async () => {
    setLoading(true);
    const now = new Date(), _p = (n) => String(n).padStart(2, '0'), todayStr = now.getFullYear() + '-' + _p(now.getMonth() + 1) + '-' + _p(now.getDate()), monthStr = now.getFullYear() + '-' + _p(now.getMonth() + 1);
    const [{ data: leads }, { data: events }, { data: quotes }, { data: pays }, { data: invs }, { count: rfqReview }, { data: cResp }, { data: vResp }, { data: subEv }] = await Promise.all([
      supabase.from('leads').select('stage').eq('is_deleted', false),
      supabase.from('events').select('event_id,name,ref_number,main_date,status,client_name').eq('is_deleted', false),
      supabase.from('quotations').select('grand_total,doc_date,status,event_id').eq('is_deleted', false),
      supabase.from('invoice_payments').select('amount,payment_date,invoice_id').eq('is_deleted', false),
      supabase.from('invoices').select('invoice_id,ref_number,client_name,event_name,total_outstanding,status').eq('is_deleted', false),
      supabase.from('rfqs').select('rfq_id', { count: 'exact', head: true }).eq('is_deleted', false).eq('party_type', 'client').eq('is_sourcing_anchor', false).eq('status', 'submitted'),
      supabase.from('rfqs').select('rfq_id,ref_number,contact_name,event_type,revision_number,client_submitted_at').eq('is_deleted', false).eq('party_type', 'client').eq('is_sourcing_anchor', false).eq('status', 'submitted').order('client_submitted_at', { ascending: false }).limit(6),
      supabase.from('rfqs').select('rfq_id,ref_number,vendor_id,parent_rfq_id,client_submitted_at').eq('is_deleted', false).eq('party_type', 'vendor').eq('status', 'submitted').order('client_submitted_at', { ascending: false }).limit(6),
      supabase.from('sub_events').select('event_id,name,date').eq('is_deleted', false),
    ]);
    // resolve vendor names for the bid card
    const vIds = [...new Set((vResp || []).map((v) => v.vendor_id).filter(Boolean))];
    let vnameMap = {};
    if (vIds.length) { const { data: vs } = await supabase.from('vendors').select('vendor_id,name').in('vendor_id', vIds); (vs || []).forEach((v) => { vnameMap[v.vendor_id] = v.name; }); }
    setClientResp(cResp || []);
    setVendorResp((vResp || []).map((v) => ({ ...v, vendor_name: vnameMap[v.vendor_id] || 'Vendor' })));
    const cancelledInv = {}; (invs || []).forEach((i) => { if (i.status === 'cancelled') cancelledInv[i.invoice_id] = true; });
    const cancelledEvt = {}; (events || []).forEach((e) => { if ((e.status || '').toLowerCase() === 'cancelled') cancelledEvt[e.event_id] = true; });
    const activeLeads = (leads || []).filter((l) => !['lost', 'event_triggered'].includes(l.stage)).length;
    const up = (events || []).filter((e) => e.main_date && e.main_date >= todayStr && !['completed', 'cancelled'].includes(e.status)).sort((a, b) => a.main_date.localeCompare(b.main_date));
    const quotedMonth = (quotes || []).filter((q) => !['superseded', 'rejected'].includes(q.status) && !(q.event_id && cancelledEvt[q.event_id]) && q.doc_date && q.doc_date.slice(0, 7) === monthStr).reduce((s, q) => s + (parseFloat(q.grand_total) || 0), 0);
    const collectedMonth = (pays || []).filter((p) => p.payment_date && p.payment_date.slice(0, 7) === monthStr && !cancelledInv[p.invoice_id]).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    const out = (invs || []).filter((i) => !['paid', 'cancelled'].includes(i.status) && (parseFloat(i.total_outstanding) || 0) > 0).sort((a, b) => (parseFloat(b.total_outstanding) || 0) - (parseFloat(a.total_outstanding) || 0));
    setStats({ activeLeads, upcomingCount: up.length, quotedMonth, collectedMonth, rfqReview: rfqReview || 0 });
    const subsByEvent = {}; (subEv || []).forEach((s) => { if (s.date) (subsByEvent[s.event_id] = subsByEvent[s.event_id] || []).push({ name: s.name, date: s.date }); });
    setCalEvents((events || []).filter((e) => (e.status || '').toLowerCase() !== 'cancelled').map((e) => ({ event_id: e.event_id, name: e.name, client_name: e.client_name, ref_number: e.ref_number, main_date: e.main_date, subs: subsByEvent[e.event_id] || [] })));
    setUpcoming(up.slice(0, 5)); setOutstanding(out.slice(0, 5)); setLoading(false);
  })(); }, []);
  const inr = (n) => '₹' + (parseFloat(n) || 0).toLocaleString('en-IN');
  const ago = (ts) => { try { const d = (Date.now() - new Date(ts).getTime()) / 1000; if (d < 3600) return Math.max(1, Math.round(d / 60)) + 'm ago'; if (d < 86400) return Math.round(d / 3600) + 'h ago'; return Math.round(d / 86400) + 'd ago'; } catch (e) { return ''; } };
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--grey-800)' }}>{greeting}, {firstName}! 👋</h1>
        <p style={{ fontSize: 14, color: 'var(--grey-400)', marginTop: 4 }}>Here's what's happening with Isheeka Events today.</p>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        {stats.rfqReview > 0 && <div onClick={() => onNavigate && onNavigate('rfqs')} style={{ cursor: 'pointer', background: 'var(--pink-light)', color: 'var(--pink)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 13, fontWeight: 500 }}>⏳ {stats.rfqReview} client RFQ{stats.rfqReview > 1 ? 's' : ''} awaiting review — Review →</div>}
        <button className="btn sm primary" onClick={() => onNavigate && onNavigate('rfqs', { mode: 'new', label: 'New RFQ' })}>📝 New Client RFQ</button>
      </div>
      <div className="metrics-grid">
        <div className="metric-card pink" style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('leads')}><div className="metric-icon">🎯</div><div className="metric-value">{stats.activeLeads}</div><div className="metric-label">Active leads</div></div>
        <div className="metric-card green" style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('events')}><div className="metric-icon">🎪</div><div className="metric-value">{stats.upcomingCount}</div><div className="metric-label">Upcoming events</div></div>
        <div className="metric-card orange" style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('quotations')}><div className="metric-icon">📋</div><div className="metric-value">{inr(stats.quotedMonth)}</div><div className="metric-label">Quoted this month</div></div>
        <div className="metric-card blue" style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('invoices')}><div className="metric-icon">💰</div><div className="metric-value">{inr(stats.collectedMonth)}</div><div className="metric-label">Collected this month</div></div>
      </div>
      {/* RFQ / vendor-bid response cards — actionable submissions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '16px 20px', border: '1px solid var(--pink-mid)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)' }}>📝 Client RFQ responses</div>
            {clientResp.length > 0 && <span style={{ background: 'var(--pink)', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '1px 9px' }}>{clientResp.length} to review</span>}
          </div>
          {loading ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>Loading…</div>
            : clientResp.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>No responses awaiting review. 🎉</div>
            : clientResp.map((r) => (
              <div key={r.rfq_id} onClick={() => onNavigate && onNavigate('rfqs', { rfqId: r.rfq_id, label: r.ref_number })} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--grey-50)', cursor: 'pointer' }}>
                <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, color: 'var(--grey-800)' }}><span style={{ color: 'var(--pink)', fontWeight: 600 }}>{r.ref_number}</span> · {r.contact_name || '—'}{(r.revision_number || 0) > 1 && <span style={{ fontSize: 10, background: 'var(--pink-light)', color: 'var(--pink)', borderRadius: 10, padding: '0 6px', marginLeft: 6 }}>🔄 Rev {r.revision_number}</span>}</div><div style={{ fontSize: 11, color: 'var(--grey-400)' }}>{r.event_type || ''}{r.client_submitted_at ? ' · ' + ago(r.client_submitted_at) : ''}</div></div>
                <span style={{ color: 'var(--grey-300)' }}>→</span>
              </div>
            ))}
        </div>
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '16px 20px', border: '1px solid var(--gold-light)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)' }}>🔧 Vendor bid responses</div>
            {vendorResp.length > 0 && <span style={{ background: 'var(--gold)', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '1px 9px' }}>{vendorResp.length} new</span>}
          </div>
          {loading ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>Loading…</div>
            : vendorResp.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>No new vendor bids.</div>
            : vendorResp.map((v) => (
              <div key={v.rfq_id} onClick={() => onNavigate && onNavigate('rfqs', { rfqId: v.parent_rfq_id, label: 'Sourcing' })} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--grey-50)', cursor: 'pointer' }}>
                <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--grey-800)' }}>{v.vendor_name}</div><div style={{ fontSize: 11, color: 'var(--grey-400)' }}>bid submitted{v.client_submitted_at ? ' · ' + ago(v.client_submitted_at) : ''}</div></div>
                <span style={{ color: 'var(--grey-300)' }}>→</span>
              </div>
            ))}
        </div>
      </div>
      <EventCalendar events={calEvents} onNavigate={onNavigate} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '16px 20px', border: '1px solid var(--grey-100)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 10 }}>Upcoming events</div>
          {loading ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>Loading…</div> : upcoming.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>No upcoming events.</div> : upcoming.map((e) => (
            <div key={e.event_id} onClick={() => onNavigate && onNavigate('events', { eventId: e.event_id, label: e.name || e.ref_number || 'Event' })} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--grey-50)', cursor: 'pointer' }}>
              <div><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-800)' }}>{e.name}</div><div style={{ fontSize: 12, color: 'var(--grey-400)' }}>{e.client_name || ''}{e.ref_number ? ' · ' + e.ref_number : ''}</div></div>
              <div style={{ fontSize: 12, color: 'var(--pink)', fontWeight: 500, whiteSpace: 'nowrap' }}>{fmtDate(e.main_date, { day: 'numeric', month: 'short' })}</div>
            </div>
          ))}
        </div>
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '16px 20px', border: '1px solid var(--grey-100)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 10 }}>Outstanding invoices</div>
          {loading ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>Loading…</div> : outstanding.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>Nothing outstanding. 🎉</div> : outstanding.map((i) => (
            <div key={i.invoice_id} onClick={() => onNavigate && onNavigate('invoices', { invoiceId: i.invoice_id, label: i.ref_number })} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--grey-50)', cursor: 'pointer' }}>
              <div><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-800)' }}>{i.ref_number}</div><div style={{ fontSize: 12, color: 'var(--grey-400)' }}>{i.client_name || ''}{i.event_name ? ' · ' + i.event_name : ''}</div></div>
              <div style={{ fontSize: 12, color: 'var(--red)', fontWeight: 500, whiteSpace: 'nowrap' }}>{inr(i.total_outstanding)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
