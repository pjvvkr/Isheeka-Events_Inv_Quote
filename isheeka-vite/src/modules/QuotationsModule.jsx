// Quotations module — list + filters + metrics, and QuotationDetail (share/export
// with display toggles + revision history, confirm→event/invoice across lead/event/
// client origins, revise via the wizard, close-as-not-proceeding, source RFQ→Lead→
// Event chain, activity log). Ported verbatim from isheeka-erp-v22.html.
import React from 'react';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/toast.jsx';
import { fmtDate, isQuoteExpired, eventTypeLabel, quoteStatusLabel } from '../lib/format.js';
import { QUOT_STATUS_COLORS, QUOT_STATUS_LABELS, REJECT_REASONS } from '../lib/constants.js';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { DocFlow } from '../components/ui/DocFlow.jsx';
import { resolveDocChain } from '../lib/docChain.js';
import { loadSourcingDrift } from '../lib/costing.js';
import { driftSummary } from '../lib/sourcingDrift.js';
import { DealHistory } from '../components/ui/DealHistory.jsx';
import { loadDealHistory } from '../lib/dealHistory.js';
import { closeQuoteNotProceeding, createEventFromQuote, createInvoiceFromQuote } from '../lib/money.js';
import { uploadQuotePdf, buildQuoteShareMsg, openWhatsApp, openEmail, validClientPhone, waLink } from '../lib/share.js';
import { logQuoteSend } from '../lib/session.js';
import { buildQuotationPDF } from '../pdf/quotationPdf.js';
import { fetchAsBase64 } from '../lib/storage.js';
import { sha256Hex } from '../lib/rfq.js';
import { ClientLink } from '../components/links.jsx';
import { QuoteGenerationWizard } from '../components/QuoteWizard.jsx';
import { WelcomeMessageModal } from './LeadsModule.jsx';
import { ensureSourcingAnchor, applySourcingSync } from '../lib/vendorRfq.js';

// ── Convert Lead Modal ────────────────────────────────────────────────────────
function ConvertLeadModal({lead, onConfirm, onCancel}) {
  const [converting, setConverting] = React.useState(false);
  const handleConvert = async () => {
    setConverting(true);
    await onConfirm();
    setConverting(false);
  };
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:460,boxShadow:'var(--shadow-lg)'}}>
        <div style={{padding:'18px 24px',borderBottom:'1px solid var(--grey-100)'}}>
          <div style={{fontSize:15,fontWeight:600,color:'var(--grey-800)'}}>Convert lead to client + event</div>
        </div>
        <div style={{padding:20}}>
          <div style={{background:'var(--green-light)',borderRadius:'var(--radius-md)',padding:14,marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:600,color:'var(--green)',marginBottom:8}}>This will create:</div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              <div style={{fontSize:13,color:'var(--green)',display:'flex',gap:8}}>
                <span>👤</span>
                <span>Client: <strong>{lead.first_name} {lead.last_name}</strong></span>
              </div>
              <div style={{fontSize:13,color:'var(--green)',display:'flex',gap:8}}>
                <span>🎪</span>
                <span>Event: <strong>{lead.first_name} {lead.last_name} {lead.event_type?eventTypeLabel(lead.event_type):''}</strong></span>
              </div>
            </div>
          </div>
          <div style={{background:'var(--blue-light)',borderRadius:'var(--radius-md)',padding:12,fontSize:13,color:'var(--blue)'}}>
            ℹ️ A welcome message will be prepared for you to copy and send to the client via WhatsApp.
          </div>
        </div>
        <div style={{padding:'14px 24px',borderTop:'1px solid var(--grey-100)',display:'flex',justifyContent:'flex-end',gap:8}}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={handleConvert} disabled={converting}>
            {converting?'⏳ Converting...':'🎉 Convert & create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuotationDetail({quotationId, onBack, onNavigate}) {
  const [quot, setQuot] = React.useState(null);
  const [sourceRfq, setSourceRfq] = React.useState(null);
  const [items, setItems] = React.useState([]);
  const [qSettings, setQSettings] = React.useState({});
  const [qActivity, setQActivity] = React.useState([]);
  const [qUserMap, setQUserMap] = React.useState({});
  const [srcLead, setSrcLead] = React.useState(null);
  const [srcEvent, setSrcEvent] = React.useState(null);
  const [schedule, setSchedule] = React.useState([]);
  const [srcRfq, setSrcRfq] = React.useState(null);
  const [invoiceIssued, setInvoiceIssued] = React.useState(false);
  const [qActExpanded, setQActExpanded] = React.useState(false);
  const [history, setHistory] = React.useState(null);
  const [histOpen, setHistOpen] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  const [sourcing, setSourcing] = React.useState(false);
  const [showResource, setShowResource] = React.useState(false);
  const [resourceInfo, setResourceInfo] = React.useState(null);
  const [resourcing, setResourcing] = React.useState(false);
  // Open vendor sourcing for this quote. If it has a client RFQ behind it, jump there;
  // otherwise create a hidden sourcing anchor from the quote's items, then open it.
  const openSourcing = async () => {
    if (sourceRfq) { onNavigate && onNavigate('rfqs', { rfqId: sourceRfq.rfq_id, label: sourceRfq.ref_number }); return; }
    setSourcing(true);
    try { const rfqId = await ensureSourcingAnchor(quot); onNavigate && onNavigate('rfqs', { rfqId, label: 'Sourcing' }); }
    catch (e) { notify((e && e.message) || 'Could not start sourcing.', 'error'); }
    setSourcing(false);
  };
  // v3 guided re-source: preview the delta (with AP warning) then sync sourcing to the quote.
  const openResource = async () => {
    let apCount = 0;
    if (srcEvent && srcEvent.event_id) { try { const { data } = await supabase.from('event_vendors').select('event_id').eq('event_id', srcEvent.event_id).eq('is_deleted', false); apCount = (data || []).length; } catch (e) { /* noop */ } }
    setResourceInfo({ apCount });
    setShowResource(true);
  };
  const doResource = async () => {
    setResourcing(true);
    try {
      const rfqId = await ensureSourcingAnchor(quot);
      const counts = await applySourcingSync(rfqId, quot.quotation_id);
      setShowResource(false);
      const parts = []; if (counts.added) parts.push(counts.added + ' added'); if (counts.changed) parts.push(counts.changed + ' changed'); if (counts.removed) parts.push(counts.removed + ' removed');
      notify(parts.length ? ('Sourcing updated — ' + parts.join(', ')) : 'Sourcing already up to date', 'success');
      onNavigate && onNavigate('rfqs', { rfqId, label: 'Sourcing' });
    } catch (e) { notify((e && e.message) || 'Could not re-source.', 'error'); }
    setResourcing(false);
  };
  const [confirming, setConfirming] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [displayOpts, setDisplayOpts] = React.useState({prices:false,qty:true,grouping:true,schedule:true,discount:false,coverPage:false,bankDetails:true});
  const [revHistory, setRevHistory] = React.useState([]);
  const [includeRevHistory, setIncludeRevHistory] = React.useState(true);
  const [lineItemsOpen, setLineItemsOpen] = React.useState(false);
  const [paySchedOpen, setPaySchedOpen] = React.useState(false);
  const [showClose, setShowClose] = React.useState(false);
  const [closeForm, setCloseForm] = React.useState({outcome:'client',reason:'',notes:''});
  const [closing, setClosing] = React.useState(false);
  const [showWelcome, setShowWelcome] = React.useState(false);
  const [welcomeData, setWelcomeData] = React.useState(null);
  const doCloseQuote = async () => {
    if(!closeForm.reason){ notify('Pick a reason.','error'); return; }
    setClosing(true);
    try{ await closeQuoteNotProceeding(quot,closeForm); setShowClose(false); setClosing(false); notify('Quote closed as not proceeding.','success'); loadAll(); }
    catch(err){ setClosing(false); notify('Could not close the quote: '+(err&&err.message?err.message:'try again'),'error'); }
  };
  const [showWizard, setShowWizard] = React.useState(false);
  const [wizardCtx, setWizardCtx] = React.useState(null);
  const [showConvert, setShowConvert] = React.useState(false);
  const [convertLead, setConvertLead] = React.useState(null);
  // Approval flow
  const [showApprovalModal, setShowApprovalModal] = React.useState(false);
  const [approvalPin, setApprovalPin] = React.useState('');
  const [approvalLink, setApprovalLink] = React.useState('');
  const [requestingApproval, setRequestingApproval] = React.useState(false);
  const [approvalAudit, setApprovalAudit] = React.useState([]);
  const setDO=(k,v)=>setDisplayOpts(o=>({...o,[k]:v}));
  const applyPreset=(p)=>{
    if(p==='full') setDisplayOpts(o=>({...o,prices:true,qty:true,grouping:true,schedule:true,discount:true}));
    else if(p==='items') setDisplayOpts(o=>({...o,prices:false,qty:true,grouping:true,schedule:true,discount:false}));
    else if(p==='summary') setDisplayOpts(o=>({...o,prices:false,qty:false,grouping:true,schedule:false,discount:false}));
  };

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    const [{data:q},{data:li},{data:st},{data:qact},{data:qus},{data:srfq}] = await Promise.all([
      supabase.from('quotations').select('*').eq('quotation_id',quotationId).single(),
      supabase.from('quotation_line_items').select('*').eq('quotation_id',quotationId).eq('is_deleted',false).order('sort_order'),
      supabase.from('settings').select('bank_name,account_number,ifsc_code,upi_id,cover_intro,phone_1,email,website,company_name,payment_qr_path').single(),
      supabase.from('quotation_activity_log').select('*').eq('quotation_id',quotationId).order('logged_at',{ascending:false}),
      supabase.from('users').select('user_id,first_name,last_name'),
      supabase.from('rfqs').select('rfq_id,ref_number,status').eq('quotation_id',quotationId).eq('party_type','client').eq('is_deleted',false).maybeSingle(),
    ]);
    let qEnriched=q;
    if(q){
      if(q.client_id){ const {data:c}=await supabase.from('clients').select('phone_1,email_1,city').eq('client_id',q.client_id).single(); if(c) qEnriched={...q,client_phone:q.client_phone||c.phone_1||'',client_email:q.client_email||c.email_1||'',client_city:q.client_city||c.city||''}; }
      else if(q.lead_id){ const {data:l}=await supabase.from('leads').select('phone,email,location').eq('lead_id',q.lead_id).single(); if(l) qEnriched={...q,client_phone:q.client_phone||l.phone||'',client_email:q.client_email||l.email||'',client_city:q.client_city||l.location||''}; }
    }
    setQuot(qEnriched||null); setItems(li||[]); setQSettings(st||{}); setQActivity(qact||[]); setSourceRfq(srfq||null);
    const {data:approvalRows}=await supabase.from('quote_approvals').select('*').eq('quotation_id',quotationId).order('created_at',{ascending:false});
    setApprovalAudit(approvalRows||[]);
    { const m={}; (qus||[]).forEach(u=>{m[u.user_id]=((u.first_name||'')+' '+(u.last_name||'')).trim();}); setQUserMap(m); }
    if(q&&q.display_options){ try{ setDisplayOpts(JSON.parse(q.display_options)); }catch(e){} }
    let _evd=null;
    if(q&&q.lead_id){ const {data:ld}=await supabase.from('leads').select('lead_id,ref_number,stage,tentative_date').eq('lead_id',q.lead_id).maybeSingle(); setSrcLead(ld||null); if(ld&&ld.tentative_date) _evd=ld.tentative_date; } else setSrcLead(null);
    try{ const {data:rq}=await supabase.from('rfqs').select('rfq_id,ref_number').eq('quotation_id',q.quotation_id).eq('is_deleted',false).maybeSingle(); setSrcRfq(rq||null); }catch(e){ setSrcRfq(null); }
    if(q&&q.event_id){
      const {data:ev}=await supabase.from('events').select('event_id,ref_number,name,status,main_date').eq('event_id',q.event_id).maybeSingle(); setSrcEvent(ev||null);
      try{ const {data:subs}=await supabase.from('sub_events').select('name,date,location,sort_order').eq('event_id',q.event_id).eq('is_deleted',false).order('sort_order'); let _sc=(subs||[]).filter(s=>s.name||s.date).map(s=>({name:s.name||'',date:s.date||null,venue:s.location||''})); const {data:rq}=await supabase.from('rfqs').select('sub_events').eq('quotation_id',q.quotation_id).eq('is_deleted',false).maybeSingle(); const rfqMap={}; ((rq&&Array.isArray(rq.sub_events))?rq.sub_events:[]).forEach(s=>{if(s.name)rfqMap[s.name]={date:s.planned_date||null,venue:s.venue||null};}); if(!_sc.length){ _sc=Object.entries(rfqMap).map(([name,v])=>({name,date:v.date,venue:v.venue||''})); } else { _sc=_sc.map(s=>({...s,date:s.date||(rfqMap[s.name]&&rfqMap[s.name].date)||null,venue:s.venue||(rfqMap[s.name]&&rfqMap[s.name].venue)||''})); } setSchedule(_sc); }catch(e){ setSchedule([]); }
      if(ev&&ev.main_date) _evd=ev.main_date;
      const {data:invs}=await supabase.from('invoices').select('status').eq('event_id',q.event_id).eq('is_deleted',false);
      setInvoiceIssued((invs||[]).some(i=>['sent','partially_paid','paid','overdue'].includes((i.status||'').toLowerCase())));
    } else { setSrcEvent(null); setInvoiceIssued(false); try{ const {data:rq}=await supabase.from('rfqs').select('sub_events').eq('quotation_id',q.quotation_id).eq('is_deleted',false).maybeSingle(); setSchedule(((rq&&Array.isArray(rq.sub_events))?rq.sub_events:[]).filter(s=>s.name||s.planned_date).map(s=>({name:s.name||'',date:s.planned_date||null,venue:s.venue||''}))); }catch(e){ setSchedule([]); } }
    if(_evd) setQuot(prev=>prev?{...prev,event_date:_evd}:prev);
    if(q&&(q.revision_number||0)>0){
      let qy=supabase.from('quotations').select('revision_number,doc_date,grand_total,created_at').eq('is_deleted',false);
      qy = q.lead_id ? qy.eq('lead_id',q.lead_id) : (q.event_id ? qy.eq('event_id',q.event_id) : qy.eq('quotation_id',q.quotation_id));
      const {data:chain}=await qy;
      const rows=(chain||[]).sort((a,b)=>(a.revision_number||0)-(b.revision_number||0)||String(a.created_at||'').localeCompare(b.created_at||'')).map(r=>({label:(r.revision_number||0)===0?'Original':'Rev '+r.revision_number, date:fmtDate(r.doc_date||r.created_at,{day:'numeric',month:'short',year:'numeric'}), change:'Grand total ₹'+Math.round(parseFloat(r.grand_total)||0).toLocaleString('en-IN')}));
      setRevHistory(rows);
    } else setRevHistory([]);
    setLoading(false);
  },[quotationId]);
  React.useEffect(()=>{ loadAll(); },[loadAll]);
  const [docChain, setDocChain] = React.useState(null);
  React.useEffect(()=>{ let live=true; if(quotationId) resolveDocChain('quote', quotationId).then(d=>{ if(live) setDocChain(d); }).catch(()=>{}); return ()=>{ live=false; }; },[quotationId]);
  const [drift, setDrift] = React.useState(null);
  React.useEffect(()=>{ let live=true; if(quotationId) loadSourcingDrift(quotationId).then(d=>{ if(live) setDrift(d); }).catch(()=>{}); return ()=>{ live=false; }; },[quotationId, quot && quot.updated_at]);
  React.useEffect(()=>{ let live=true; if(quotationId) loadDealHistory(quotationId).then(h=>{ if(live) setHistory(h); }).catch(()=>{}); return ()=>{ live=false; }; },[quotationId, quot && quot.updated_at]);

  const doShare = async (channel) => {
    if(sharing||!quot) return;
    if(channel==='whatsapp' && !validClientPhone(quot.client_phone)){ notify("This client's phone number looks invalid — please update it before sharing on WhatsApp.",'error'); return; }
    if((channel==='gmail'||channel==='email') && !quot.client_email){ notify('This client has no email address on file.','error'); return; }
    if((parseFloat(quot.grand_total)||0)<=0 && !window.confirm('This quote total is ₹0 — no prices are set yet. Send it to the client anyway?')) return;
    setSharing(true);
    notify('Preparing the quotation PDF…','info',2500);
    const url = await uploadQuotePdf(await withSchedule(quot), items, displayOpts, qSettings, {showRevisionHistory: includeRevHistory && (quot.revision_number||0)>0, revisionHistory: revHistory});
    if(!url) notify("Couldn't attach the PDF link — sharing the message; you can attach the downloaded PDF manually.",'error');
    const msg = buildQuoteShareMsg(quot, qSettings, url);
    if(channel==='whatsapp') openWhatsApp(quot.client_phone, msg);
    else openEmail(channel==='gmail'?'gmail':'default', quot.client_email, 'Quotation '+quot.ref_number+' — Isheeka Events', msg);
    await logQuoteSend(quot.quotation_id, channel==='whatsapp'?'whatsapp':'email');
    const {data:qact}=await supabase.from('quotation_activity_log').select('*').eq('quotation_id',quot.quotation_id).order('logged_at',{ascending:false});
    setQActivity(qact||[]); setSharing(false);
  };
  // Attach the linked event's schedule (functions · dates · venues) so the PDF prints it.
  const withSchedule = (q) => (schedule.length ? { ...q, event_schedule: schedule } : q);
  const doExport = async (action) => {
    if(!quot) return;
    if((parseFloat(quot.grand_total)||0)<=0 && !window.confirm('This quote total is ₹0 — no prices are set yet. '+(action==='download'?'Download':action==='print'?'Print':'Open')+' it anyway?')) return;
    const q2 = await withSchedule(quot);
    const qrBase64 = (displayOpts.bankDetails && qSettings.payment_qr_path) ? await fetchAsBase64(qSettings.payment_qr_path) : null;
    buildQuotationPDF(q2, items, {action, displayOpts, settings:qSettings, qrBase64, showRevisionHistory: includeRevHistory && (quot.revision_number||0)>0, revisionHistory: revHistory});
  };
  const doConfirmQuote = async () => {
    if(confirming||!quot) return;
    if((parseFloat(quot.grand_total)||0)<=0){ notify('Add prices before confirming — this quote total is ₹0.','error'); return; }
    // Event-origin: just approve + create the draft invoice (event already exists).
    if(quot.event_id){
      setConfirming(true);
      const {error}=await supabase.from('quotations').update({status:'approved',updated_at:new Date().toISOString()}).eq('quotation_id',quot.quotation_id);
      if(error){ notify('Could not confirm the quote: '+(error.message||'Please try again.'),'error'); setConfirming(false); return; }
      const inv = await createInvoiceFromQuote(quot.quotation_id,{eventId:quot.event_id});
      setConfirming(false);
      if(inv){ onNavigate&&onNavigate('events',{eventId:quot.event_id}); }
      else { setQuot(q=>({...q,status:'approved'})); }
      return;
    }
    // Lead-origin: open the convert dialog → creates the event from this quote.
    if(quot.lead_id){
      const {data:l}=await supabase.from('leads').select('*').eq('lead_id',quot.lead_id).single();
      if(!l){ notify('Could not load the lead to convert.','error'); return; }
      setConvertLead(l); setShowConvert(true);
      return;
    }
    // Client/RFQ-origin (no lead, no event): create the event directly from the quote + client.
    if(quot.client_id){
      if(!window.confirm('Confirm this quote and create the event?\n\nThis creates the event from the quote items and a draft invoice.')) return;
      setConfirming(true);
      try{
        const {data:c}=await supabase.from('clients').select('first_name,last_name,phone_1,phone_2,email_1,source').eq('client_id',quot.client_id).maybeSingle();
        const {data:rq}=await supabase.from('rfqs').select('event_type,event_date,location,city,guest_count,budget').eq('quotation_id',quot.quotation_id).eq('is_deleted',false).maybeSingle();
        const nm=(quot.client_name||'').trim();
        const synthLead={
          lead_id:null, client_id:quot.client_id,
          first_name:(c&&c.first_name)||nm.split(' ')[0]||nm, last_name:(c&&c.last_name)||nm.split(' ').slice(1).join(' '),
          phone:(c&&c.phone_1)||'', phone_2:(c&&c.phone_2)||'', email:(c&&c.email_1)||'', source:(c&&c.source)||'referral',
          event_type:(rq&&rq.event_type)||'', tentative_date:(rq&&rq.event_date)||null,
          location:(rq&&(rq.location||rq.city))||null, guest_count:(rq&&rq.guest_count)||null, budget:(rq&&rq.budget)||null,
          active_quotation_id:quot.quotation_id
        };
        if(quot.status!=='approved'){ const {error:ae}=await supabase.from('quotations').update({status:'approved',updated_at:new Date().toISOString()}).eq('quotation_id',quot.quotation_id); if(ae) throw ae; }
        const res=await createEventFromQuote(synthLead, {quot, forcedClientId:quot.client_id});
        setConfirming(false);
        notify('Event created from the quote.','success');
        onNavigate&&onNavigate('events',{eventId:res.eventId});
      }catch(err){ console.error('[Isheeka ERP] confirm (client-origin) failed:', err); notify('Could not create the event: '+(err&&err.message?err.message:'Please try again.'),'error'); setConfirming(false); }
      return;
    }
    notify('This quote is not linked to a lead or event.','error');
  };
  // Lead-origin confirm → create the event from this quote (reuses the shared conversion helper).
  const doConvertFromQuote = async () => {
    if(!convertLead||confirming) return;
    setConfirming(true);
    try {
      if(quot.status!=='approved'){ const {error}=await supabase.from('quotations').update({status:'approved',updated_at:new Date().toISOString()}).eq('quotation_id',quot.quotation_id); if(error) throw error; }
      const res = await createEventFromQuote(convertLead, {quot, forcedClientId: quot.client_id||convertLead.client_id||undefined});
      setShowConvert(false); setConfirming(false);
      // #2: createEventFromQuote returns clientOutcome as a string ('reused'|'created') + a
      // separate clientName; the welcome modal wants {type,name}. Map it so it stops showing "undefined".
      setWelcomeData({eventId:res.eventId, clientOutcome:{type:res.clientOutcome, name:res.clientName}, leadObj:convertLead}); setShowWelcome(true);
    } catch(err){
      console.error('[Isheeka ERP] convert-from-quote failed:', err);
      notify('Could not create the event: '+(err&&err.message?err.message:'Please try again.'),'error');
      setConfirming(false);
    }
  };
  // Build approval link using the same base as rfq.html but pointing to approval.html
  const approvalLink_ = (token) => {
    try {
      const raw = (import.meta.env && import.meta.env.VITE_RFQ_BASE_URL) || '';
      const base = raw ? (raw.endsWith('/') ? raw : raw + '/') : location.href;
      return new URL('approval.html?t=' + token, base).href;
    } catch (e) { return 'approval.html?t=' + token; }
  };
  const doRequestApproval = async () => {
    if (!approvalPin || approvalPin.length < 4 || approvalPin.length > 6 || !/^\d+$/.test(approvalPin)) {
      notify('Enter a 4–6 digit numeric PIN.', 'error'); return;
    }
    setRequestingApproval(true);
    try {
      const arr = new Uint8Array(16); crypto.getRandomValues(arr);
      const token = [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
      const [tokenHash, pinHash] = await Promise.all([sha256Hex(token), sha256Hex(approvalPin)]);
      const { error } = await supabase.from('quotations').update({
        approval_status: 'pending',
        approval_token_hash: tokenHash,
        approval_pin_hash: pinHash,
        updated_at: new Date().toISOString(),
      }).eq('quotation_id', quot.quotation_id);
      if (error) throw error;
      const link = approvalLink_(token);
      setApprovalLink(link);
      setQuot(q => ({ ...q, approval_status: 'pending' }));
      notify('Approval link generated.', 'success');
    } catch (err) {
      notify('Could not set up approval: ' + (err && err.message ? err.message : 'Please try again.'), 'error');
    }
    setRequestingApproval(false);
  };

  // Reconstruct the wizard context (lead vs event origin) and open it to edit/revise this quote.
  const launchEdit = async () => {
    let leadObj=null, origin=null;
    if(quot.event_id){
      const {data:ev}=await supabase.from('events').select('event_id,name,type,client_id,client_name').eq('event_id',quot.event_id).single();
      if(ev){
        origin={eventId:ev.event_id, eventName:ev.name};
        const {data:c}=await supabase.from('clients').select('first_name,last_name,phone_1,phone_2,email_1,source').eq('client_id',ev.client_id).single();
        const nm=(ev.client_name||'').trim();
        // Carry the quote's lead_id through the revision so the lead stays linked (and its active-quote pointer can be repointed).
        const _lid=quot.lead_id||null;
        leadObj = c ? {lead_id:_lid,client_id:ev.client_id,first_name:c.first_name,last_name:c.last_name,phone:c.phone_1||'',phone_2:c.phone_2||'',email:c.email_1||'',source:c.source||'referral',event_type:ev.type}
                    : {lead_id:_lid,client_id:ev.client_id,first_name:nm.split(' ')[0]||nm,last_name:nm.split(' ').slice(1).join(' '),phone:'',phone_2:'',email:'',source:'referral',event_type:ev.type};
      }
    } else if(quot.lead_id){
      const {data:l}=await supabase.from('leads').select('*').eq('lead_id',quot.lead_id).single();
      leadObj=l||null;
    }
    if(!leadObj && quot.client_id){
      // quotes created from an RFQ link by client_id (no lead/event yet) — seed the wizard from the client,
      // falling back to the quote's own client fields so this can never hard-fail when a client is linked.
      let c=null; try{ const res=await supabase.from('clients').select('client_id,first_name,last_name,phone_1,phone_2,email_1,source').eq('client_id',quot.client_id).maybeSingle(); c=res.data; }catch(e){}
      const nm=(quot.client_name||'').trim();
      leadObj = c ? {lead_id:null,client_id:c.client_id,first_name:c.first_name,last_name:c.last_name,phone:c.phone_1||'',phone_2:c.phone_2||'',email:c.email_1||'',source:c.source||'referral',event_type:''}
                  : {lead_id:null,client_id:quot.client_id,first_name:nm.split(' ')[0]||nm,last_name:nm.split(' ').slice(1).join(' '),phone:'',phone_2:'',email:'',source:'referral',event_type:''};
    }
    if(!leadObj){ notify('Could not load the quote context to edit.','error'); return; }
    setWizardCtx({lead:leadObj, origin, isRevision: quot.status!=='draft'});
    setShowWizard(true);
  };

  if(loading) return <div style={{padding:60,textAlign:'center'}}><div className="spinner" style={{margin:'0 auto'}}/></div>;
  if(!quot) return <div style={{padding:40,textAlign:'center',color:'var(--grey-400)'}}>Quotation not found. <button className="btn sm" onClick={onBack}>← Back</button></div>;

  const fmt=(d)=>fmtDate(d);
  const groups={}; items.forEach(li=>{ const k=li.sub_event_name||'General Items'; (groups[k]=groups[k]||[]).push(li); });
  const quoteUnpriced=(parseFloat(quot.grand_total)||0)<=0;
  let ps = quot.payment_schedule; if(typeof ps==='string'){ try{ps=JSON.parse(ps||'[]');}catch(e){ps=[];} } ps=Array.isArray(ps)?ps:[];
  const sc = QUOT_STATUS_COLORS[quot.status]||{bg:'var(--grey-100)',color:'var(--grey-400)'};
  const statusLabel = quoteStatusLabel(quot);
  const eventCancelled = !!(srcEvent && (srcEvent.status||'').toLowerCase()==='cancelled');
  // Historical/closed quote: no client sends (WhatsApp/Email), but Print/Download stay for records.
  const histClosed = eventCancelled || ['rejected','expired','superseded'].includes(quot.status);
  // Revision is gated on INVOICE ISSUANCE, not conversion — a converted quote stays revisable while its
  // invoice is still a draft (consistent across lead-origin and event-origin paths). Locks once the invoice
  // is issued (sent+), the event is cancelled, or the quote is terminal.
  const editable = !['rejected','expired','superseded'].includes(quot.status) && !invoiceIssued && !eventCancelled;
  // A draft revision sitting under an event with an unissued invoice — revising alone doesn't touch the
  // invoice; the user must re-confirm to push the change into the draft invoice.
  const pendingRevisionConfirm = quot.status==='draft' && (quot.revision_number||0)>0 && !!quot.event_id && !invoiceIssued && !eventCancelled;
  // Event-origin: confirm available until approved (then the invoice exists). Lead-origin: confirm
  // (= create the event) available until converted, including 'approved' (idempotent re-convert).
  const canConfirm = (quot.event_id
    ? !['approved','converted','rejected','expired','superseded'].includes(quot.status)
    : ((!!quot.lead_id || !!quot.client_id) && !['converted','rejected','expired','superseded'].includes(quot.status))) && !invoiceIssued && !eventCancelled;
  // Booking a NEW event requires the client's signed approval first. Scoped to !event_id so
  // revision re-confirms (invoice sync, which have an event) are never blocked.
  const needsApproval = !quot.event_id && quot.approval_status !== 'approved';
  const sourced = !!(docChain && docChain.sourcing && (((docChain.sourcing.vendorTotal||0) > 0) || docChain.sourcing.costingExists));

  return (
    <div>
      {docChain && <DocFlow chain={docChain} current="quote" onNavigate={onNavigate} />}
      {drift && (drift.stale || drift.vendorStale || drift.costingStale) && (
        <div style={{background:'var(--orange-light)',border:'1px solid var(--orange)',borderRadius:'var(--radius-lg)',padding:'10px 14px',marginBottom:16,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <span style={{fontSize:16}}>⚠️</span>
          <div style={{flex:1,minWidth:220}}>
            {drift.stale ? (<>
              <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)'}}>Sourcing may be out of date</div>
              <div style={{fontSize:12,color:'var(--grey-600)',marginTop:2}}>The quote changed after vendors were priced ({driftSummary(drift.counts)}). Accepted bids may no longer cover the current items.</div>
            </>) : (<>
              <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)'}}>Sourcing not finalized</div>
              <div style={{fontSize:12,color:'var(--grey-600)',marginTop:2}}>Vendors may need to re-bid, or the costing regenerated, to reflect the latest items. This clears once you re-cost.</div>
            </>)}
          </div>
          {drift.stale
            ? (editable
                ? <button className="btn sm primary" onClick={openResource}>Re-source →</button>
                : (srcRfq&&<button className="btn sm" onClick={()=>onNavigate&&onNavigate('rfqs',{costingRfqId:srcRfq.rfq_id,label:'Costing'})}>Review sourcing →</button>))
            : (srcRfq&&<button className="btn sm primary" onClick={()=>onNavigate&&onNavigate('rfqs',{rfqId:srcRfq.rfq_id,label:'Sourcing'})}>Review sourcing →</button>)}
        </div>
      )}
      {showWizard&&wizardCtx&&
<QuoteGenerationWizard lead={wizardCtx.lead} leadSubEvents={[]} isRevision={wizardCtx.isRevision} isContinuation={!wizardCtx.isRevision} existingQuotationId={quot.quotation_id} originEvent={wizardCtx.origin||undefined} onComplete={async(newQ)=>{ setShowWizard(false); setWizardCtx(null); if(newQ&&newQ.quotation_id&&newQ.quotation_id!==quot.quotation_id){ onNavigate&&onNavigate('quotations',{quotId:newQ.quotation_id}); } else { await loadAll(); } }} onCancel={()=>{ setShowWizard(false); setWizardCtx(null); }}/>}
      {showConvert&&convertLead&&<ConvertLeadModal lead={convertLead} onConfirm={doConvertFromQuote} onCancel={()=>{setShowConvert(false);setConvertLead(null);}}/>}
      {showResource && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}} onClick={()=>!resourcing&&setShowResource(false)}>
          <div style={{background:'white',borderRadius:'var(--radius-lg)',maxWidth:460,padding:'20px 22px'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:600,color:'var(--grey-800)',marginBottom:8}}>Re-source this quote</div>
            <div style={{fontSize:13,color:'var(--grey-600)',lineHeight:1.6,marginBottom:10}}>{drift&&drift.stale?('The quote changed since vendors were priced ('+driftSummary(drift.counts)+'). '):''}This updates the sourcing item list to match the current quote. Bids on unchanged items are kept; changed and new items will need fresh bids. <b>Nothing is sent to a vendor</b> until you send it on the next screen.</div>
            {resourceInfo&&resourceInfo.apCount>0&&<div style={{fontSize:12.5,color:'var(--grey-700)',background:'var(--orange-light)',border:'1px solid var(--orange)',borderRadius:'var(--radius-sm)',padding:'8px 12px',marginBottom:12}}>⚠️ {resourceInfo.apCount} vendor{resourceInfo.apCount>1?'s are':' is'} already assigned to the event. Re-sourcing changes the sourcing basis but won't automatically reconcile booked vendor payments — review before sending.</div>}
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn" disabled={resourcing} onClick={()=>setShowResource(false)}>Cancel</button>
              <button className="btn primary" disabled={resourcing} onClick={doResource}>{resourcing?'Syncing…':'Sync & open sourcing →'}</button>
            </div>
          </div>
        </div>
      )}


      {/* Header */}
      <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'16px 20px',border:'1px solid var(--grey-100)',marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:18,fontWeight:600,color:'var(--grey-800)'}}>{quot.ref_number} <StatusBadge kind="quote" status={quot.status} label={statusLabel} style={{marginLeft:6}} />{isQuoteExpired(quot)&&<span style={{padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:500,background:'var(--orange-light)',color:'var(--orange)',marginLeft:6}}>Expired</span>}{quot.approval_status==='pending'&&<span style={{padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:500,background:'var(--orange-light)',color:'var(--orange)',marginLeft:6}}>🔏 Pending approval</span>}{quot.approval_status==='approved'&&<span style={{padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:500,background:'var(--green-light)',color:'var(--green)',marginLeft:6}}>✅ Approved by {quot.approver_name||'client'}</span>}{quot.approval_status==='declined'&&<span style={{padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:500,background:'var(--red-light)',color:'var(--red)',marginLeft:6}}>❌ Declined</span>}</div>
            <div style={{fontSize:13,color:'var(--grey-400)',marginTop:4}}><ClientLink clientId={quot.client_id} name={quot.client_name} onNavigate={onNavigate}>{quot.client_name||'—'}</ClientLink>{quot.event_name?' · '+quot.event_name:''}{quot.doc_date?' · '+fmt(quot.doc_date):''}{quot.valid_until?' · valid until '+fmt(quot.valid_until):''}</div>
          </div>
        </div>
        {quoteUnpriced && quot.status==='draft' && <div style={{fontSize:12,color:'var(--grey-600)',marginTop:12,background:'var(--grey-50)',border:'1px solid var(--grey-100)',borderRadius:'var(--radius-sm)',padding:'8px 12px'}}>💡 <b>No prices yet.</b> Use <b>Edit quotation</b> to price in-house{(import.meta.env && import.meta.env.VITE_ENABLE_VENDOR_RFQ==='true') ? <>, or <b>Source vendors →</b> to price from vendor bids</> : ''}.</div>}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:14}}>
          {quot.client_id&&<button className="btn sm" title="Open this client's 360" onClick={()=>onNavigate&&onNavigate('clients',{clientId:quot.client_id,label:quot.client_name||'Client'})}>👤 View client →</button>}
          {(import.meta.env && import.meta.env.VITE_ENABLE_VENDOR_RFQ==='true') && !['rejected','superseded','expired'].includes(quot.status) && !eventCancelled && !(srcEvent && (srcEvent.status||'').toLowerCase()==='completed') && <button className={"btn sm"+(quoteUnpriced?' primary':'')} disabled={sourcing} title={sourced?'Review the vendor RFQs and costing for this quote':'Send vendor RFQs and price this quote via the costing screen'} onClick={openSourcing}>{sourcing?'Starting…':(sourced?'🔍 Review sourcing →':'🔧 Source vendors →')}</button>}
          {editable&&<button className="btn sm primary" onClick={launchEdit}>✏️ {quot.status==='draft'?'Edit quotation':'Revise'}</button>}
          {!editable&&invoiceIssued&&<span style={{fontSize:12,color:'var(--grey-400)',display:'inline-flex',alignItems:'center'}} title="An invoice has been issued for this event — revise the invoice instead.">🔒 Invoice issued — revise the invoice</span>}
          {canConfirm&&<button className="btn sm" style={(quoteUnpriced||needsApproval)?{color:'var(--grey-400)',borderColor:'var(--grey-200)',cursor:'not-allowed'}:{color:'var(--green)',borderColor:'#86EFAC'}} disabled={confirming||quoteUnpriced||needsApproval} title={quoteUnpriced?'Add prices before confirming — this quote total is ₹0':(needsApproval?"Get the client's approval first":'')} onClick={doConfirmQuote}>{confirming?'Confirming…':(quot.event_id?'✅ Confirm & create invoice':'✅ Confirm & create event')}</button>}
          {quot.event_id&&<button className="btn sm" onClick={()=>onNavigate&&onNavigate('events',{eventId:quot.event_id,label:quot.event_name||'Event'})}>Go to event →</button>}
          {!quot.event_id&&!['rejected','converted','expired','superseded'].includes(quot.status)&&<button className="btn sm" style={{color:'var(--red)',borderColor:'rgba(163,45,45,0.3)'}} onClick={()=>{setCloseForm({outcome:'client',reason:'',notes:''});setShowClose(true);}} title="Client declined or we can't fulfil — close this quote">✕ Close — not proceeding</button>}
          {['sent','approved','draft'].includes(quot.status)&&quot.approval_status==='pending'&&<button className="btn sm" disabled style={{color:'var(--grey-400)',borderColor:'var(--grey-200)',cursor:'not-allowed'}}>🔏 Awaiting client approval</button>}
          {['sent','approved','draft'].includes(quot.status)&&(!quot.approval_status||quot.approval_status==='declined')&&<button className="btn sm" disabled={quoteUnpriced} title={quoteUnpriced?'Add prices before requesting approval — this quote total is ₹0':''} style={quoteUnpriced?{color:'var(--grey-400)',borderColor:'var(--grey-200)',cursor:'not-allowed'}:{color:'var(--pink)',borderColor:'var(--pink)'}} onClick={()=>{setApprovalPin('');setApprovalLink('');setShowApprovalModal(true);}}>🔏 Request Approval</button>}
        </div>
      </div>

      {/* Status banners */}
      {quot.status==='rejected'&&<div style={{padding:'8px 12px',marginBottom:16,background:'var(--red-light)',color:'var(--red)',borderRadius:'var(--radius-sm)',fontSize:12}}>✕ <b>This quote was closed — not proceeding.</b>{(()=>{const r=(qActivity||[]).find(a=>a.action==='rejected'&&a.notes);return r?(' '+r.notes):'';})()} To pursue again, revise or generate a new quote.</div>}
      {srcEvent&&(srcEvent.status||'').toLowerCase()==='cancelled'&&<div style={{padding:'8px 12px',marginBottom:16,background:'var(--red-light)',color:'var(--red)',borderRadius:'var(--radius-sm)',fontSize:12}}>⛔ The event created from this quote (<b>{srcEvent.ref_number}</b>) has been cancelled. This quote is kept for record only.</div>}
      {quot.approval_status==='approved' && !quot.event_id && <div style={{padding:'10px 14px',marginBottom:16,background:'var(--green-light)',border:'1px solid #86EFAC',borderRadius:'var(--radius-sm)',fontSize:12.5,color:'var(--green)'}}>✅ <b>Client-approved</b> — signed by {quot.approver_name||'the client'}{quot.client_approved_at?(' on '+fmt(quot.client_approved_at)):''}. You can now confirm to book the event.</div>}
      {(quot.status==='converted'||quot.event_id)&&!invoiceIssued&&!pendingRevisionConfirm&&(!srcEvent||(srcEvent.status||'').toLowerCase()!=='cancelled')&&<div style={{padding:'8px 12px',marginBottom:16,background:'var(--green-light)',color:'var(--green)',borderRadius:'var(--radius-sm)',fontSize:12}}>📅 An event has been created from this quote. You can still revise it until the invoice is issued — confirming a revision updates the draft invoice.</div>}
      {pendingRevisionConfirm&&<div style={{padding:'8px 12px',marginBottom:16,background:'var(--orange-light)',color:'var(--orange)',borderRadius:'var(--radius-sm)',fontSize:12}}>📝 <b>Draft revision.</b> Use <b>Confirm &amp; create invoice</b> above to push these changes into the draft invoice — until you do, the invoice keeps the previous figures.</div>}
      {invoiceIssued&&<div style={{padding:'8px 12px',marginBottom:16,background:'var(--orange-light)',color:'var(--orange)',borderRadius:'var(--radius-sm)',fontSize:12}}>🔒 An invoice has been issued — this quote is locked. To change scope or pricing, revise the invoice.</div>}

      {/* What the client sees + share/export */}
      <div style={{background:'var(--grey-50)',borderRadius:'var(--radius-lg)',padding:'14px 18px',marginBottom:16}}>
        <div style={{fontSize:12,fontWeight:600,color:'var(--grey-800)',marginBottom:8}}>What the client sees</div>
        <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
          {[['full','Full detail'],['items','Items only'],['summary','Summary only']].map(([k,l])=>{
            const active=(k==='full'&&displayOpts.prices)||(k==='items'&&!displayOpts.prices&&displayOpts.qty)||(k==='summary'&&!displayOpts.prices&&!displayOpts.qty);
            return <button key={k} onClick={()=>applyPreset(k)} className="btn sm" style={{fontSize:11,flex:1,minWidth:90,background:active?'var(--pink)':'white',color:active?'white':'var(--grey-600)',border:'1px solid var(--grey-200)'}}>{l}</button>;
          })}
        </div>
        <div style={{display:'flex',gap:14,flexWrap:'wrap',marginBottom:12}}>
          {[['prices','Prices'],['qty','Quantities'],['grouping','Sub-event grouping'],['schedule','Payment schedule'],['discount','Discount'],['coverPage','Cover page'],['bankDetails','Bank details']].map(([k,l])=>(
            <label key={k} style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--grey-700)',cursor:'pointer'}}>
              <input type="checkbox" checked={!!displayOpts[k]} onChange={e=>setDO(k,e.target.checked)} style={{accentColor:'var(--pink)'}}/>{l}
            </label>
          ))}
          {(quot.revision_number||0)>0&&<label style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--grey-700)',cursor:'pointer'}}><input type="checkbox" checked={includeRevHistory} onChange={e=>setIncludeRevHistory(e.target.checked)} style={{accentColor:'var(--pink)'}}/>Revision history</label>}
        </div>
        <div style={{borderTop:'1px solid var(--grey-200)',paddingTop:12,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <span style={{fontSize:11,color:quoteUnpriced?'var(--red)':'var(--grey-400)',marginRight:'auto'}}>{histClosed?'Closed — print/download only (sending disabled):':(quoteUnpriced?'⚠ This quote has no prices yet (₹0). Add prices before sharing — client sending is disabled.':'Share / export (uses the toggles above):')}</span>
          <button className="btn sm" disabled={sharing||histClosed||quoteUnpriced} title={quoteUnpriced?'Add prices first — this quote total is ₹0':(histClosed?'This quote is closed — sending is disabled':'')} onClick={()=>doShare('whatsapp')}>💬 WhatsApp</button>
          <button className="btn sm" disabled={sharing||histClosed||quoteUnpriced} title={quoteUnpriced?'Add prices first — this quote total is ₹0':(histClosed?'This quote is closed — sending is disabled':'')} onClick={()=>doShare('gmail')}>Gmail</button>
          <button className="btn sm" disabled={sharing||histClosed||quoteUnpriced} title={quoteUnpriced?'Add prices first — this quote total is ₹0':(histClosed?'This quote is closed — sending is disabled':'')} onClick={()=>doShare('email')}>Email</button>
          <button className="btn sm" onClick={()=>doExport('print')}>Print</button>
          <button className="btn sm primary" onClick={()=>doExport('download')}>⬇ Download PDF</button>
        </div>
      </div>

      {/* Event schedule (functions · dates · venues) */}
      {schedule.length>0&&(
        <div style={{background:'white',borderRadius:'var(--radius-lg)',border:'1px solid var(--grey-100)',padding:'14px 18px',marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:'.04em',color:'var(--gold)',marginBottom:8}}>📅 EVENT SCHEDULE</div>
          {schedule.map((s,i)=>(
            <div key={i} style={{display:'grid',gridTemplateColumns:'1.2fr 1fr 1.4fr',gap:8,fontSize:13,padding:'5px 0',borderTop:i?'1px solid var(--grey-50)':'none'}}>
              <span style={{fontWeight:500,color:'var(--grey-800)'}}>{s.name}</span>
              <span style={{color:'var(--grey-500)'}}>{s.date?fmtDate(s.date,{day:'numeric',month:'short',year:'numeric'}):'—'}</span>
              <span style={{color:s.venue?'var(--grey-700)':'var(--grey-400)'}}>{s.venue?('📍 '+s.venue):'TBD'}</span>
            </div>
          ))}
          <div style={{fontSize:11,color:'var(--grey-400)',marginTop:6}}>Dates &amp; venues are set on the event; this prints on the quotation PDF.</div>
        </div>
      )}
      {/* Line items */}
      <div style={{background:'white',borderRadius:'var(--radius-lg)',border:'1px solid var(--grey-100)',padding:'16px 20px',marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:lineItemsOpen?10:0,cursor:'pointer'}} onClick={()=>setLineItemsOpen(o=>!o)}>
          <span style={{fontSize:10,color:'var(--grey-400)',userSelect:'none'}}>{lineItemsOpen?'▼':'▶'}</span>
          <span style={{fontSize:13,fontWeight:600,color:'var(--grey-800)'}}>Line items{items.length>0?' ('+items.length+')':''}</span>
        </div>
        {lineItemsOpen && Object.keys(groups).map(k=>(
          <div key={k} style={{marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:700,color:'var(--pink)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:6}}>{k}</div>
            {groups[k].map((li,idx)=>{
              const qty=parseFloat(li.quantity)||0, up=parseFloat(li.unit_price)||0;
              const amt=(li.amount!=null&&li.amount!=='')?parseFloat(li.amount):qty*up;
              const sis = Array.isArray(li.sub_items) ? li.sub_items.filter(s=>s&&String(s.name||'').trim()) : [];
              return (
                <div key={idx} style={{borderBottom:'1px solid var(--grey-100)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:10,padding:'6px 0',fontSize:13}}>
                    <span style={{flex:1,color:'var(--grey-800)'}}>{li.description}</span>
                    <span style={{color:'var(--grey-400)',width:120,textAlign:'right'}}>{qty} × ₹{up.toLocaleString('en-IN')}</span>
                    <span style={{fontWeight:500,width:90,textAlign:'right'}}>₹{amt.toLocaleString('en-IN')}</span>
                  </div>
                  {sis.map((si,si_i)=>(
                    <div key={si_i} style={{display:'flex',gap:6,padding:'2px 0 2px 16px',fontSize:12,color:'var(--grey-400)'}}>
                      <span>↳</span>
                      <span>{String(si.name).trim()}{si.qty>0?' × '+si.qty:''}{si.note?' ('+si.note+')':''}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
        {lineItemsOpen && <div style={{background:'var(--grey-50)',borderRadius:'var(--radius-md)',padding:'12px 16px'}}>
          {(()=>{const _d=parseFloat(quot.discount_amount)||0;const rows=[['Subtotal','₹'+(parseFloat(quot.subtotal)||0).toLocaleString('en-IN'),false]];if(Math.abs(_d)>0.5)rows.push(['Adjustment',(_d>0?'- ':'+ ')+'₹'+Math.abs(Math.round(_d)).toLocaleString('en-IN'),false]);rows.push(['Grand total','₹'+(parseFloat(quot.grand_total)||0).toLocaleString('en-IN'),true]);return rows;})().map(([l,v,bold],i,arr)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:i<arr.length-1?'1px solid var(--grey-200)':'none'}}>
              <span style={{fontSize:13,color:'var(--grey-400)'}}>{l}</span>
              <span style={{fontSize:bold?15:13,fontWeight:bold?700:400,color:bold?'var(--green)':'var(--grey-800)'}}>{v}</span>
            </div>
          ))}
        </div>}
      </div>
      {/* Sourcing & pricing history */}
      <div style={{background:'white',borderRadius:'var(--radius-lg)',border:'1px solid var(--grey-100)',padding:'14px 18px',marginBottom:16}}>
        <div onClick={()=>setHistOpen(o=>!o)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)'}}>🧾 Sourcing &amp; pricing history{history&&history.length?(' ('+history.length+')'):''}</div>
          <span style={{fontSize:12,color:'var(--grey-400)'}}>{histOpen?'▾ Hide':'▸ Show'}</span>
        </div>
        {histOpen && <div style={{marginTop:10}}><DealHistory items={history||[]} /></div>}
      </div>

      {/* Schedule + terms */}
      {(ps.length>0||quot.payment_terms||quot.additional_terms||quot.additional_notes)&&(
        <div style={{background:'white',borderRadius:'var(--radius-lg)',border:'1px solid var(--grey-100)',padding:'16px 20px',marginBottom:16}}>
          {ps.length>0&&<div style={{marginBottom:12}}>
            <div onClick={()=>setPaySchedOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:6,marginBottom:paySchedOpen?6:0,cursor:'pointer'}}>
              <span style={{fontSize:10,color:'var(--grey-400)',userSelect:'none'}}>{paySchedOpen?'▼':'▶'}</span>
              <span style={{fontSize:13,fontWeight:600,color:'var(--grey-800)'}}>Payment schedule <span style={{fontSize:12,fontWeight:400,color:'var(--grey-400)'}}>(edit via Revise)</span></span>
            </div>
            {paySchedOpen&&ps.map((p,i)=>(
              <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:13,borderBottom:'1px solid var(--grey-100)'}}>
                <span style={{color:'var(--grey-800)'}}>{p.label||('Installment '+(i+1))} <span style={{color:'var(--grey-400)'}}>· {p.when}</span></span>
                <span style={{fontWeight:500}}>{parseFloat(p.amount)>0?('₹'+Math.round(p.amount).toLocaleString('en-IN')):((p.pct||0)+'%')}</span>
              </div>
            ))}
          </div>}
          {quot.additional_notes&&<div style={{marginBottom:10}}><div style={{fontSize:12,fontWeight:600,color:'var(--grey-800)',marginBottom:4}}>Notes</div><div style={{fontSize:13,color:'var(--grey-600)',whiteSpace:'pre-wrap',overflowWrap:'anywhere',wordBreak:'break-word'}}>{quot.additional_notes}</div></div>}
          {quot.payment_terms&&<div style={{marginBottom:10}}><div style={{fontSize:12,fontWeight:600,color:'var(--grey-800)',marginBottom:4}}>Payment terms</div><div style={{fontSize:13,color:'var(--grey-600)',whiteSpace:'pre-wrap'}}>{quot.payment_terms}</div></div>}
          {quot.additional_terms&&<div><div style={{fontSize:12,fontWeight:600,color:'var(--grey-800)',marginBottom:4}}>Additional terms &amp; conditions</div><div style={{fontSize:13,color:'var(--grey-600)',whiteSpace:'pre-wrap'}}>{quot.additional_terms}</div></div>}
        </div>
      )}

      {/* Activity & change log */}
      {quot.status!=='draft'&&(
        <div style={{background:'white',borderRadius:'var(--radius-lg)',border:'1px solid var(--grey-100)',padding:'14px 20px'}}>
          <div onClick={()=>setQActExpanded(v=>!v)} style={{fontSize:13,fontWeight:600,color:'var(--grey-800)',cursor:qActivity.length>1?'pointer':'default'}}>{qActivity.length>1?(qActExpanded?'▾ ':'▸ '):''}Activity &amp; change log{(()=>{const s=qActivity.filter(a=>a.action==='sent');return s.length>0?(' · sent '+s.length+'× · last '+new Date(s[0].logged_at).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})):'';})()}</div>
          {qActivity.length===0&&<div style={{fontSize:12,color:'var(--grey-400)',marginTop:6}}>No sends logged yet.</div>}
          {(qActExpanded||qActivity.length<=1)&&qActivity.slice(0,10).map(a=>(
            <div key={a.log_id} style={{fontSize:12,color:'var(--grey-500)',padding:'3px 0'}}>
              {a.action==='sent'?('Sent via '+(a.channel==='whatsapp'?'WhatsApp':(a.channel==='email'?'Email':(a.channel||'—')))):a.action} · {new Date(a.logged_at).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'})}{a.logged_by&&qUserMap[a.logged_by]?(' · '+qUserMap[a.logged_by]):''}
            </div>
          ))}
        </div>
      )}

      {/* Approval history */}
      {approvalAudit.length>0&&(
        <div style={{background:'white',borderRadius:'var(--radius-lg)',border:'1px solid var(--grey-100)',padding:'14px 20px',marginTop:16}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)',marginBottom:8}}>🔏 Approval history</div>
          {approvalAudit.map((a,i)=>(
            <div key={a.approval_id||i} style={{fontSize:12,color:'var(--grey-500)',padding:'3px 0',borderTop:i?'1px solid var(--grey-100)':'none'}}>
              <span style={{fontWeight:500,color:a.action==='signed'?'var(--green)':a.action==='declined'?'var(--red)':'var(--grey-700)'}}>{a.action==='requested'?'Approval requested':a.action==='opened'?'Link opened':a.action==='signed'?'✅ Signed':a.action==='declined'?'❌ Declined':a.action}</span>
              {a.signer_name&&<span style={{color:'var(--grey-700)'}}> by {a.signer_name}</span>}
              {' · '}{new Date(a.created_at).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'})}
              {a.ip&&<span style={{color:'var(--grey-400)'}}> · {a.ip}</span>}
            </div>
          ))}
        </div>
      )}
      {showApprovalModal&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'50px 20px',overflowY:'auto'}} onClick={e=>{if(e.target===e.currentTarget){setShowApprovalModal(false);}}}>
          <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:460}}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid var(--grey-100)',fontSize:15,fontWeight:600,color:'var(--grey-800)'}}>🔏 Request client approval <span style={{fontSize:12,fontWeight:400,color:'var(--grey-400)'}}>· {quot.ref_number}</span></div>
            <div style={{padding:20}}>
              {!approvalLink&&(<>
                <div style={{fontSize:13,color:'var(--grey-500)',marginBottom:14}}>Set a PIN the client will use to access and sign the approval page. Share the link via WhatsApp after generating.</div>
                <label style={{fontSize:12,fontWeight:600,color:'var(--grey-700)',display:'block',marginBottom:6}}>PIN (4–6 digits) <span style={{color:'var(--pink)'}}>*</span></label>
                <input type="text" inputMode="numeric" maxLength={6} placeholder="e.g. 1234" value={approvalPin} onChange={e=>setApprovalPin(e.target.value.replace(/\D/g,''))} style={{width:'100%',padding:'10px 12px',border:'1.5px solid var(--grey-200)',borderRadius:'var(--radius-md)',fontSize:15,fontFamily:'inherit',letterSpacing:4,textAlign:'center',marginBottom:16}}/>
                <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
                  <button className="btn sm" onClick={()=>setShowApprovalModal(false)}>Cancel</button>
                  <button className="btn sm primary" disabled={requestingApproval||approvalPin.length<4} onClick={doRequestApproval}>{requestingApproval?'Generating…':'Generate approval link'}</button>
                </div>
              </>)}
              {approvalLink&&(<>
                <div style={{fontSize:13,color:'var(--green)',fontWeight:600,marginBottom:8}}>✅ Approval link ready</div>
                <div style={{fontSize:12,color:'var(--grey-500)',marginBottom:8}}>Share this link and PIN <b>{approvalPin}</b> with the client:</div>
                <div style={{background:'var(--grey-50)',borderRadius:'var(--radius-md)',padding:'10px 12px',fontSize:12,wordBreak:'break-all',color:'var(--grey-700)',marginBottom:14,border:'1px solid var(--grey-200)'}}>{approvalLink}</div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  <a className="btn sm" style={{background:'#25D366',color:'white',border:'none',textDecoration:'none',display:'inline-flex',alignItems:'center',gap:4}} href={waLink(quot.client_phone,'Hi '+((quot.client_name||'').split(' ')[0]||'there')+'! Please review and approve your event quotation '+quot.ref_number+' using this link: '+approvalLink+'\n\nYour PIN is: '+approvalPin+'\n\nThank you! — Isheeka Events')} target="_blank" rel="noreferrer">💬 Share on WhatsApp</a>
                  <button className="btn sm" onClick={()=>{try{navigator.clipboard.writeText(approvalLink);}catch(e){}notify('Link copied.','success');}}>📋 Copy link</button>
                  <button className="btn sm" onClick={()=>setShowApprovalModal(false)}>Close</button>
                </div>
              </>)}
            </div>
          </div>
        </div>
      )}
      {showClose&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'50px 20px',overflowY:'auto'}} onClick={e=>{if(e.target===e.currentTarget)setShowClose(false);}}>
          <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:460}}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid var(--grey-100)',fontSize:15,fontWeight:600,color:'var(--grey-800)'}}>Close quote — not proceeding <span style={{fontSize:12,fontWeight:400,color:'var(--grey-400)'}}>· {quot.ref_number}</span></div>
            <div style={{padding:20}}>
              <div style={{fontSize:12,color:'var(--grey-500)',marginBottom:10}}>Marks this quote <b>Rejected</b>{quot.lead_id?' and the source lead Lost':''}. Terminal — to pursue again, revise or create a new quote.</div>
              <label className="field-label">What happened?</label>
              <div style={{display:'flex',gap:6,marginBottom:12}}>
                <button className={'btn sm'+(closeForm.outcome==='client'?' primary':'')} style={{flex:1}} onClick={()=>setCloseForm(f=>({...f,outcome:'client',reason:''}))}>Client declined</button>
                <button className={'btn sm'+(closeForm.outcome==='us'?' primary':'')} style={{flex:1}} onClick={()=>setCloseForm(f=>({...f,outcome:'us',reason:''}))}>We withdrew / can't fulfil</button>
              </div>
              <label className="field-label">Reason <span style={{color:'var(--pink)'}}>*</span></label>
              <select className="field-input" value={closeForm.reason} onChange={e=>setCloseForm(f=>({...f,reason:e.target.value}))}><option value="">Select a reason…</option>{(REJECT_REASONS[closeForm.outcome]||[]).map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select>
              <label className="field-label" style={{marginTop:10}}>Notes</label>
              <textarea className="field-textarea" rows={2} value={closeForm.notes} onChange={e=>setCloseForm(f=>({...f,notes:e.target.value}))} placeholder="Optional context"/>
            </div>
            <div style={{padding:'14px 20px',borderTop:'1px solid var(--grey-100)',display:'flex',justifyContent:'flex-end',gap:8}}><button className="btn" onClick={()=>setShowClose(false)}>Cancel</button><button className="btn primary" disabled={closing||!closeForm.reason} style={{background:'var(--red)',borderColor:'var(--red)'}} onClick={doCloseQuote}>{closing?'Closing…':'Close quote'}</button></div>
          </div>
        </div>
      )}
      {showWelcome&&welcomeData&&<WelcomeMessageModal
        lead={welcomeData.leadObj||convertLead||{first_name:quot.client_name||'',last_name:'',event_type:''}}
        quotRef={quot.ref_number}
        clientOutcome={welcomeData.clientOutcome}
        onGoToEvent={()=>{ setShowWelcome(false); onNavigate&&onNavigate('events',{eventId:welcomeData.eventId}); }}
        onClose={()=>{ setShowWelcome(false); onNavigate&&onNavigate('events',{eventId:welcomeData.eventId}); }}
      />}
    </div>
  );
}

export function QuotationsModule({nav, onNavigate, onBack}) {
  const [quotes, setQuotes] = React.useState([]);
  const [cancelledEvents, setCancelledEvents] = React.useState({});
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const detailId = nav && nav.quotId; // stack-driven detail target

  const loadQuotes = React.useCallback(async () => {
    setLoading(true);
    const {data} = await supabase.from('quotations').select('*').eq('is_deleted',false).order('doc_date',{ascending:false});
    if(data) setQuotes(data);
    const {data:ce} = await supabase.from('events').select('event_id').eq('status','cancelled').eq('is_deleted',false);
    const m={}; (ce||[]).forEach(e=>{m[e.event_id]=true;}); setCancelledEvents(m);
    setLoading(false);
  },[]);
  React.useEffect(()=>{ loadQuotes(); },[loadQuotes]);
  React.useEffect(()=>{ if(!detailId) loadQuotes(); },[detailId]);

  if(detailId) return <QuotationDetail quotationId={detailId} onBack={onBack} onNavigate={onNavigate}/>;

  const filtered = quotes.filter(q=>{
    const s=search.toLowerCase();
    const matchSearch=!s||`${q.ref_number} ${q.client_name||''} ${q.event_name||''}`.toLowerCase().includes(s);
    const matchStatus=!statusFilter||q.status===statusFilter;
    return matchSearch&&matchStatus;
  }).sort((a,b)=>{ const d=s=>['superseded','rejected','expired'].includes(s)?1:0; return d(a.status)-d(b.status) || (b.doc_date||'').localeCompare(a.doc_date||'') || (b.revision_number||0)-(a.revision_number||0); });
  const cnt=(f)=>quotes.filter(f).length;

  return (
    <div>
      <div className="metrics-grid" style={{marginBottom:20}}>
        <div className="metric-card pink"><div className="metric-icon">📋</div><div className="metric-value">{cnt(q=>q.status!=='superseded')}</div><div className="metric-label">Total quotations</div></div>
        <div className="metric-card orange"><div className="metric-icon">📤</div><div className="metric-value">{cnt(q=>q.status==='sent')}</div><div className="metric-label">Awaiting response</div></div>
        <div className="metric-card green"><div className="metric-icon">✅</div><div className="metric-value">{cnt(q=>['approved','converted','invoiced'].includes(q.status))}</div><div className="metric-label">Confirmed</div></div>
        <div className="metric-card pink"><div className="metric-icon">📝</div><div className="metric-value">{cnt(q=>q.status==='draft')}</div><div className="metric-label">Draft</div></div>
      </div>

      <div style={{display:'flex',gap:10,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:200,position:'relative'}}>
          <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:15,color:'var(--grey-400)',pointerEvents:'none'}}>🔍</span>
          <input className="field-input" style={{paddingLeft:36}} placeholder="Search by ref, client, event..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <select className="field-input" style={{width:170}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.keys(QUOT_STATUS_LABELS).map(s=><option key={s} value={s}>{QUOT_STATUS_LABELS[s]}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{padding:60,textAlign:'center'}}><div className="spinner" style={{margin:'0 auto'}}></div></div>
      ) : filtered.length===0 ? (
        <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:60,textAlign:'center',border:'1px solid var(--grey-100)'}}>
          <div style={{fontSize:48,marginBottom:12}}>📋</div>
          <div style={{fontSize:15,fontWeight:600,color:'var(--grey-800)',marginBottom:6}}>{search||statusFilter?'No quotations found':'No quotations yet'}</div>
          <div style={{fontSize:13,color:'var(--grey-400)'}}>{search||statusFilter?'Try adjusting your search or filter':'Quotations are created from a lead or an event.'}</div>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {filtered.map(q=>{
            const sc=QUOT_STATUS_COLORS[q.status]||{bg:'var(--grey-100)',color:'var(--grey-400)'};
            return (
              <div key={q.quotation_id} onClick={()=>onNavigate('quotations',{quotId:q.quotation_id,label:q.ref_number})} style={{background:'white',borderRadius:'var(--radius-lg)',border:'1px solid var(--grey-100)',overflow:'hidden',cursor:'pointer',opacity:q.status==='superseded'?0.65:1}}
                onMouseEnter={ev=>ev.currentTarget.style.borderColor='var(--grey-200)'}
                onMouseLeave={ev=>ev.currentTarget.style.borderColor='var(--grey-100)'}>
                <div style={{display:'grid',gridTemplateColumns:'1fr auto auto',alignItems:'center',padding:'14px 16px',gap:12}}>
                  <div>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                      <span style={{fontSize:14,fontWeight:500,color:'var(--pink)'}}>{q.ref_number}</span>
                      <StatusBadge kind="quote" status={q.status} label={quoteStatusLabel(q)} />{isQuoteExpired(q)&&<span style={{padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:500,background:'var(--orange-light)',color:'var(--orange)'}}>Expired</span>}{q.event_id&&cancelledEvents[q.event_id]&&<span style={{padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:500,background:'var(--red-light)',color:'var(--red)'}}>Event cancelled</span>}
                    </div>
                    <div style={{display:'flex',gap:16,fontSize:12,color:'var(--grey-400)',flexWrap:'wrap'}}>
                      {q.client_name&&<span>👤 <ClientLink clientId={q.client_id} name={q.client_name} onNavigate={onNavigate}>{q.client_name}</ClientLink></span>}
                      {q.event_name&&<span>🎪 {q.event_name}</span>}
                      {q.doc_date&&<span>📅 {fmtDate(q.doc_date,{day:'numeric',month:'short',year:'numeric'})}</span>}
                    </div>
                  </div>
                  <div style={{textAlign:'right',fontSize:14,fontWeight:600,color:'var(--grey-800)'}}>₹{parseFloat(q.grand_total||0).toLocaleString('en-IN')}</div>
                  <span style={{color:'var(--grey-400)',fontSize:18}}>›</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
