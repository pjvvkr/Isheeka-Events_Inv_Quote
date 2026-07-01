// Quote Generation Wizard (ported verbatim from isheeka-erp-v22.html).
// Shared modal used by Leads (LeadDetail), Quotations (QuotationDetail revise/
// continue), and Events (EventDetail). 4-step flow: client → line items →
// quote details → share. Item entry reuses the shared FastEntryTable.
import React from 'react';
import { ClientViewControls } from '../components/ClientViewControls.jsx';
import { supabase } from '../lib/supabase';
import { notify, runDb } from '../lib/toast.jsx';
import { defaultEventName, eventTypeLabel } from '../lib/format.js';
import { getNextClientRef, getNextQuotRef } from '../lib/refs.js';
import { uploadQuotePdf, buildQuoteShareMsg, openWhatsApp, openEmail } from '../lib/share.js';
import { logQuoteSend } from '../lib/session.js';
import { buildQuotationPDF } from '../pdf/quotationPdf.js';
import { fetchAsBase64 } from '../lib/storage.js';
import { createInvoiceFromQuote } from '../lib/money.js';
import { FastEntryTable } from './ItemEntry.jsx';
import { confirmDialog } from './confirm.jsx';
// Stable per-line lineage id (Phase 2c v2). Carried across revisions; minted for new lines.
const newSrcId = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : null;
import { filesToPayloads, extractItems, extractErrMsg } from '../lib/staffExtract.js';

function QWSubEventNameInput({value, onChange}) {
  return <input className="field-input" style={{flex:1,fontSize:13,fontWeight:500}}
    value={value||''} onChange={e=>onChange(e.target.value)} placeholder="Sub-event name"/>;
}

function QWTemplateSelect({options, onSelect, eventType}) {
  const [open, setOpen] = React.useState(false);
  const empty=!options||options.length===0;
  const priority = (options||[]).filter(o=>o.priority);
  const others = (options||[]).filter(o=>!o.priority);
  return (
    <div style={{position:'relative',flexShrink:0}}>
      <button className="btn sm" onClick={()=>setOpen(v=>!v)} style={{fontSize:11,display:'flex',alignItems:'center',gap:4,opacity:empty?0.6:1}}>
        <span>Templates</span><span style={{fontSize:9}}>&#9660;</span>
      </button>
      {open&&(
        <div style={{position:'absolute',top:'100%',right:0,zIndex:200,background:'white',border:'1px solid var(--grey-200)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-md)',minWidth:260,maxHeight:240,overflowY:'auto',marginTop:4}}
          onMouseLeave={()=>setOpen(false)}>
          {empty&&(
            <div style={{padding:'12px 14px',fontSize:12,color:'var(--grey-400)',lineHeight:1.5}}>
              No templates with items yet.
              <div style={{marginTop:4,color:'var(--pink)',fontWeight:500}}>Create one in Settings &#8594; Templates</div>
            </div>
          )}
          {priority.length>0&&<>
            <div style={{padding:'4px 10px',fontSize:10,fontWeight:700,color:'var(--pink)',textTransform:'uppercase',letterSpacing:'.04em',background:'#FCEAF1'}}>Matching</div>
            {priority.map((o,i)=>(
              <div key={i} onMouseDown={()=>{onSelect(o.templateId,o.subEventName);setOpen(false);}}
                style={{padding:'8px 12px',fontSize:12,cursor:'pointer',color:'var(--grey-800)',borderBottom:'1px solid var(--grey-100)'}}
                onMouseEnter={e=>e.currentTarget.style.background='#FCEAF1'}
                onMouseLeave={e=>e.currentTarget.style.background='white'}>{o.label}</div>
            ))}
          </>}
          {others.length>0&&<>
            <div style={{padding:'4px 10px',fontSize:10,fontWeight:700,color:'var(--grey-400)',textTransform:'uppercase',letterSpacing:'.04em',background:'var(--grey-50)'}}>{priority.length>0?'Other templates':'All templates'}</div>
            {others.map((o,i)=>(
              <div key={i} onMouseDown={()=>{onSelect(o.templateId,o.subEventName);setOpen(false);}}
                style={{padding:'8px 12px',fontSize:12,cursor:'pointer',color:'var(--grey-800)',borderBottom:'1px solid var(--grey-100)'}}
                onMouseEnter={e=>e.currentTarget.style.background='var(--grey-50)'}
                onMouseLeave={e=>e.currentTarget.style.background='white'}>{o.label}</div>
            ))}
          </>}
        </div>
      )}
    </div>
  );
}

// ── Quote Generation Wizard ───────────────────────────────────────────────────
export function QuoteGenerationWizard({lead, leadSubEvents, isRevision, isContinuation, existingQuotationId, originEvent, onComplete, onCancel}) {
  const [step, setStep] = React.useState(1);
  const [clientMode, setClientMode] = React.useState('new');
  const [existingClient, setExistingClient] = React.useState(null);
  const [clients, setClients] = React.useState([]);
  const [clientSearch, setClientSearch] = React.useState('');
  const [dupClient, setDupClient] = React.useState(null);
  const [templates, setTemplates] = React.useState([]);
  const [templateItems, setTemplateItems] = React.useState({});
  const [saving, setSaving] = React.useState(false);
  const [createdQuot, setCreatedQuot] = React.useState(null);
  const [emailMenuOpen, setEmailMenuOpen] = React.useState(false);
  // Quote display options — what the CLIENT sees (not internal data)
  const [displayOpts, setDisplayOpts] = React.useState({prices:false,qty:true,grouping:true,schedule:true,discount:false,coverPage:false,bankDetails:false});
  const setDO=(field,val)=>setDisplayOpts(o=>({...o,[field]:val}));
  const applyPreset=(preset)=>{
    if(preset==='full') setDisplayOpts({prices:true,qty:true,grouping:true,schedule:true,discount:true,coverPage:displayOpts.coverPage,bankDetails:displayOpts.bankDetails});
    else if(preset==='items') setDisplayOpts({prices:false,qty:true,grouping:true,schedule:true,discount:false,coverPage:displayOpts.coverPage,bankDetails:displayOpts.bankDetails});
    else if(preset==='summary') setDisplayOpts({prices:false,qty:false,grouping:true,schedule:false,discount:false,coverPage:displayOpts.coverPage,bankDetails:displayOpts.bankDetails});
  };

  const [subEventBlocks, setSubEventBlocks] = React.useState(()=>{
    const blocks = (leadSubEvents||[]).filter(se=>se.name&&se.name.trim()).map(se=>({
      id:'se-'+Date.now()+Math.random(), name:se.name,
      items:(se.items||[]).map(i=>({id:'li-'+Date.now()+Math.random(),description:i.description,quantity:i.quantity,unit_price:i.unit_price,sub_items:i.sub_items||[]}))
    }));
    if(!blocks.some(b=>(b.name||'').trim().toLowerCase()==='general items')) blocks.push({id:'se-main', name:'General Items', items:[]});
    return blocks;
  });
  // Track which item ids have their sub-items panel expanded
  const [expandedSubItems, setExpandedSubItems] = React.useState({});
  const toggleSubItems = (itemId) => setExpandedSubItems(p=>({...p,[itemId]:!p[itemId]}));
  const addSubItem = (blockId, itemId) => {
    setSubEventBlocks(bs=>bs.map(b=>b.id!==blockId?b:{...b,items:(b.items||[]).map(i=>i.id!==itemId?i:{...i,sub_items:[...(i.sub_items||[]),{id:'si-'+Date.now()+Math.random(),name:'',qty:0,note:''}]})}));
    setExpandedSubItems(p=>({...p,[itemId]:true}));
  };
  const updateSubItem = (blockId, itemId, siId, field, val) => {
    setSubEventBlocks(bs=>bs.map(b=>b.id!==blockId?b:{...b,items:(b.items||[]).map(i=>i.id!==itemId?i:{...i,sub_items:(i.sub_items||[]).map(si=>si.id!==siId?si:{...si,[field]:val})})}));
  };
  const removeSubItem = (blockId, itemId, siId) => {
    setSubEventBlocks(bs=>bs.map(b=>b.id!==blockId?b:{...b,items:(b.items||[]).map(i=>i.id!==itemId?i:{...i,sub_items:(i.sub_items||[]).filter(si=>si.id!==siId)})}));
  };

  const today = new Date().toISOString().split('T')[0];
  const [quotDetails, setQuotDetails] = React.useState({
    doc_date:today, valid_until:'',
    event_name:'', event_date:'',
    discount_pct:0, discount_amount:0, total_override:'',
    additional_notes:'', payment_terms:'', additional_terms:'',
    payment_terms_touched: false,
    valid_until_touched: false,
    payment_schedule_touched: false,
    // pct = default ratio used to auto-fill amounts until the user types an amount; amount is the source of truth.
    payment_schedule:[
      {pct:50,amount:0,label:'Advance',when:'On confirmation'},
      {pct:40,amount:0,label:'Pre-event',when:'7 days before event'},
      {pct:10,amount:0,label:'Balance',when:'On event day'}
    ]
  });
  const [calcRow, setCalcRow] = React.useState(null); // index of the installment whose % calculator is open
  const [calcPct, setCalcPct] = React.useState('');

  // ── staff-side import: photo/PDF/paste → items (review, then add to blocks) ──
  const [impPending, setImpPending] = React.useState(null);
  const [impMsg, setImpMsg] = React.useState('');
  const [impPaste, setImpPaste] = React.useState(false);
  const [impText, setImpText] = React.useState('');
  const [impBusy, setImpBusy] = React.useState(false);
  const applyImported = (list) => {
    let added = 0;
    setSubEventBlocks((bs) => {
      const blocks = bs.map((b) => ({ ...b, items: [...(b.items || [])] }));
      (Array.isArray(list) ? list : []).forEach((ex) => {
        const desc = (ex.description || '').trim(); if (!desc) return;
        const se = (ex.sub_event || '').trim();
        let block;
        if (se) { block = blocks.find((b) => (b.name || '').trim().toLowerCase() === se.toLowerCase()); if (!block) { block = { id: 'se-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), name: se, items: [] }; blocks.push(block); } }
        else { if (!blocks.length) blocks.push({ id: 'se-' + Date.now(), name: '', items: [] }); block = blocks[0]; }
        block.items.push({ id: 'imp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), description: desc, quantity: Math.max(1, Math.round(Number(ex.quantity) || 1)), unit_price: 0, sub_items: [] });
        added++;
      });
      return blocks;
    });
    return added;
  };
  const runImportFiles = (camera) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = camera ? 'image/*' : 'image/*,application/pdf';
    if (camera) inp.setAttribute('capture', 'environment'); else inp.multiple = true;
    inp.onchange = async () => {
      const fl = inp.files; if (!fl || !fl.length) return;
      setImpBusy(true); setImpMsg('Reading your list…');
      try {
        const files = await filesToPayloads(fl);
        if (!files.length) { setImpMsg('Couldn’t read that file — try a clear photo or PDF.'); setImpBusy(false); return; }
        const r = await extractItems({ files });
        if (r && r.ok) { if ((r.items || []).length) { setImpPending(r.items); setImpMsg(''); } else setImpMsg('No items found — add them manually.'); }
        else setImpMsg(extractErrMsg(r));
      } catch (e) { setImpMsg('Couldn’t read that — try again, or add items manually.'); }
      setImpBusy(false);
    };
    inp.click();
  };
  const runImportText = async () => {
    const t = (impText || '').trim(); if (t.length < 3) { setImpMsg('Paste your list first.'); return; }
    setImpBusy(true); setImpMsg('Reading your message…');
    try {
      const r = await extractItems({ text: t });
      if (r && r.ok) { setImpPaste(false); setImpText(''); if ((r.items || []).length) { setImpPending(r.items); setImpMsg(''); } else setImpMsg('No items found — add them manually.'); }
      else setImpMsg(extractErrMsg(r));
    } catch (e) { setImpMsg('Couldn’t read that — try again, or add items manually.'); }
    setImpBusy(false);
  };
  const confirmImport = () => { const n = applyImported(impPending || []); setImpPending(null); setImpMsg(n + ' item' + (n === 1 ? '' : 's') + ' added — set prices below.'); };

  // Helper: auto-generate payment terms text from schedule (amount-based).
  const buildPaymentTermsText = (schedule) => {
    if(!schedule||schedule.length===0) return '';
    const inr=n=>'₹'+(Math.round(parseFloat(n)||0)).toLocaleString('en-IN');
    return 'Payment schedule: '+schedule.map((p,i)=>{ const w=(p.when||'').trim(); const wl=w?(w.charAt(0).toLowerCase()+w.slice(1)):'—'; return `${inr(p.amount)} (${p.label||'Installment '+(i+1)}) due ${wl}`; }).join('; ')+'.';
  };

  // Valid-until rule: quotation date + 2 days; if that's after the planned event date, use event date − 1 day; never earlier than the quotation date.
  const computeValidUntil=(docDate,eventDate)=>{
    if(!docDate) return '';
    const _p=n=>String(n).padStart(2,'0'), fmtD=d=>d.getFullYear()+'-'+_p(d.getMonth()+1)+'-'+_p(d.getDate());
    const doc=new Date(docDate+'T00:00:00'); let vu=new Date(doc); vu.setDate(vu.getDate()+2);
    if(eventDate){ const evm1=new Date(eventDate+'T00:00:00'); evm1.setDate(evm1.getDate()-1); if(vu>evm1) vu=evm1; }
    if(vu<doc) vu=doc;
    return fmtD(vu);
  };
  React.useEffect(()=>{
    // Default the editable event name to "{Event Type} Event" for new quotes (revisions load the prior name below).
    if(!(isRevision||isContinuation)){ setQuotDetails(f=>({...f,event_name:defaultEventName(lead.event_type)})); }
    // Seed the planned event date: lead tentative date, or the origin event's main date.
    if(lead&&lead.tentative_date){ setQuotDetails(f=>({...f,event_date:f.event_date||lead.tentative_date})); }
    if(originEvent&&originEvent.eventId){ supabase.from('events').select('main_date').eq('event_id',originEvent.eventId).maybeSingle().then(({data})=>{ if(data&&data.main_date) setQuotDetails(f=>({...f,event_date:data.main_date})); }); }
    supabase.from('clients').select('client_id,first_name,last_name,phone_1,status').eq('is_deleted',false).neq('status','inactive').order('first_name').then(({data})=>{ if(data) setClients(data); });
    if(lead.phone) supabase.from('clients').select('*').eq('phone_1',lead.phone).eq('is_deleted',false).neq('status','inactive').single().then(({data})=>{ if(data) setDupClient(data); });
    supabase.from('settings').select('default_terms,default_validity_days').single().then(({data})=>{
      if(data){
        setQuotDetails(f=>({...f,additional_terms:data.default_terms||'',payment_terms:buildPaymentTermsText(f.payment_schedule)}));
      }
    });
    supabase.from('event_templates').select('*').eq('is_active',true).eq('is_deleted',false).order('name').then(({data:tmps})=>{
      if(tmps){
        setTemplates(tmps);
        supabase.from('event_template_items').select('*').order('sort_order').then(({data:items})=>{
          if(items){
            const grouped={};
            items.forEach(i=>{
              if(!grouped[i.template_id]) grouped[i.template_id]={};
              const key=i.sub_event_name||'General';
              if(!grouped[i.template_id][key]) grouped[i.template_id][key]=[];
              grouped[i.template_id][key].push(i);
            });
            setTemplateItems(grouped);
          }
        });
      }
    });
    if((isRevision||isContinuation)&&existingQuotationId){
      supabase.from('quotation_line_items').select('*').eq('quotation_id',existingQuotationId).eq('is_deleted',false).order('sort_order').then(({data:li})=>{
        if(li&&li.length>0){
          const seNames=[...new Set(li.map(i=>i.sub_event_name||'General Items'))];
          setSubEventBlocks(seNames.map(name=>({
            id:'se-'+Date.now()+Math.random(), name,
            items:li.filter(i=>(i.sub_event_name||'General Items')===name).map(i=>({id:'li-'+i.line_item_id,description:i.description,quantity:i.quantity,unit_price:i.unit_price,sub_items:Array.isArray(i.sub_items)?i.sub_items:[],source_item_id:i.source_item_id||newSrcId()}))
          })));
        }
      });
      supabase.from('quotations').select('*').eq('quotation_id',existingQuotationId).single().then(({data:q})=>{
        if(q){
          const ps=typeof q.payment_schedule==='string'?JSON.parse(q.payment_schedule||'[]'):q.payment_schedule||[];
          // If the loaded schedule already carries explicit amounts (new format), preserve them and mark touched
          // so auto-fill won't overwrite. Old (pct-only) schedules stay un-touched so amounts fill from pct × grand.
          const hasAmounts=ps.some(p=>parseFloat(p.amount)>0);
          // payment_terms_touched stays false on load so the terms text keeps auto-regenerating as the user
          // edits installment amounts in the revision (it only "sticks" once they hand-edit the terms box).
          // event_name defaults to the "{Type} Event" formula (per the chosen rule), editable in step 3 —
          // not the legacy stored name (older quotes carried the "{Client}'s {Type}" auto-name).
          const _mAdj=(parseFloat(q.discount_amount)||0)!==0 && (!q.discount_pct||parseFloat(q.discount_pct)===0);
          const _ovPrefill=_mAdj?String(Math.round((parseFloat(q.grand_total)!=null?parseFloat(q.grand_total):((parseFloat(q.subtotal)||0)-(parseFloat(q.discount_amount)||0))))):'';
          setQuotDetails(f=>({...f,doc_date:q.doc_date||f.doc_date,valid_until:q.valid_until||f.valid_until,event_name:defaultEventName(lead.event_type),discount_pct:q.discount_pct||0,discount_amount:q.discount_amount||0,total_override:_ovPrefill,additional_notes:q.additional_notes||'',payment_terms:q.payment_terms||'',additional_terms:q.additional_terms||'',payment_terms_touched:false,payment_schedule_touched:false,payment_schedule:ps.length>0?ps:f.payment_schedule}));
          if(q.display_options){ try{ setDisplayOpts(JSON.parse(q.display_options)); }catch(e){} }
        }
      });
    }
  },[]);

  // Event-originated quote: client is already known from the event — preselect it and skip the client step.
  React.useEffect(()=>{
    if(originEvent && lead && lead.client_id){
      setClientMode('existing');
      setExistingClient({client_id:lead.client_id, first_name:lead.first_name, last_name:lead.last_name});
      setStep(2);
    }
  },[]);

  // Auto-populate Valid until from quotation date + event date (per rule), until the user edits it manually.
  React.useEffect(()=>{ setQuotDetails(f=> f.valid_until_touched ? f : {...f, valid_until: computeValidUntil(f.doc_date, f.event_date)}); },[quotDetails.doc_date, quotDetails.event_date]);

  // Auto-fill installment AMOUNTS from their default ratios whenever the grand total changes —
  // until the user manually edits an amount (payment_schedule_touched). Last row absorbs rounding so the sum is exact.
  React.useEffect(()=>{
    const its=subEventBlocks.flatMap(b=>b.items);
    const sub=its.reduce((s,i)=>s+(parseFloat(i.quantity)||0)*(parseFloat(i.unit_price)||0),0);
    const _ov=quotDetails.total_override;
    const _ovOn=_ov!==''&&_ov!=null&&!isNaN(parseFloat(_ov));
    const disc=_ovOn?(sub-parseFloat(_ov)):(quotDetails.discount_pct>0?sub*(parseFloat(quotDetails.discount_pct)||0)/100:(parseFloat(quotDetails.discount_amount)||0));
    const grand=Math.max(0,sub-disc);
    setQuotDetails(f=>{
      if(f.payment_schedule_touched) return f;
      const sch=f.payment_schedule||[]; if(!sch.length||grand<=0) return f;
      // Preserve exact loaded amounts on mount (no rounding drift): only re-proportion when the schedule
      // no longer sums to the grand total — i.e. the total actually changed (override/discount/items).
      const allocated=sch.reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
      if(Math.abs(allocated-grand)<1) return f;
      let acc=0;
      const filled=sch.map((p,i)=>{ if(i===sch.length-1){ return {...p,amount:Math.max(0,grand-acc)}; } const a=Math.round(grand*(parseFloat(p.pct)||0)/100); acc+=a; return {...p,amount:a}; });
      return {...f, payment_schedule:filled, payment_terms: f.payment_terms_touched?f.payment_terms:buildPaymentTermsText(filled)};
    });
  },[subEventBlocks, quotDetails.discount_pct, quotDetails.discount_amount, quotDetails.total_override]);

  const loadTemplateForBlock = (blockId, templateId, subEventName) => {
    const items=templateItems[templateId]; if(!items) return;
    const matchKey=Object.keys(items).find(k=>k.toLowerCase()===(subEventName||'').toLowerCase());
    const srcItems=matchKey?items[matchKey]:Object.values(items).flat();
    const newItems=srcItems.map(i=>({id:'li-'+Date.now()+Math.random(),description:i.description,quantity:i.default_quantity||1,unit_price:0,sub_items:[]}));
    setSubEventBlocks(bs=>bs.map(b=>b.id===blockId?{...b,items:newItems}:b));
  };

  const getTemplateOptions = (blockName) => {
    const lt=(lead.event_type||'').toLowerCase();
    const bn=(blockName||'').trim().toLowerCase();
    // Show ALL active templates so any preconfigured template can be pulled in; the lead's
    // event-type matches (and sub-event-name matches) are surfaced first as "Matching".
    const opts=[];
    // Priority: type-matching templates whose sub-event name matches the block (exact, then partial).
    templates.forEach(t=>{
      if(lt && (t.event_type||'').toLowerCase()!==lt) return; // priority section = matching type only
      const items=templateItems[t.template_id]||{};
      const keys=Object.keys(items);
      let matchKey=null, matchType=null;
      if(bn){
        matchKey=keys.find(k=>k.toLowerCase()===bn);
        if(matchKey) matchType='exact';
        if(!matchKey){ matchKey=keys.find(k=>{const kl=k.toLowerCase();return kl.includes(bn)||bn.includes(kl);}); if(matchKey) matchType='partial'; }
      }
      if(matchKey && items[matchKey] && items[matchKey].length>0){
        opts.push({label:t.name+' → '+matchKey+' ('+items[matchKey].length+' items)'+(matchType==='partial'?' · similar':''),templateId:t.template_id,subEventName:matchKey,priority:true});
      }
    });
    // "All items" option for every non-empty template; type-matching ones are flagged priority.
    templates.forEach(t=>{
      const items=templateItems[t.template_id]||{};
      const total=Object.values(items).reduce((s,arr)=>s+arr.length,0);
      if(total<=0) return;
      const typeMatch = lt && (t.event_type||'').toLowerCase()===lt;
      const tag = t.event_type? (' ['+eventTypeLabel(t.event_type)+']') : ' [General]';
      opts.push({label:t.name+tag+' → All items ('+total+')',templateId:t.template_id,subEventName:null,priority:!!typeMatch});
    });
    return opts;
  };

  const setQD=(field,val)=>setQuotDetails(f=>{
    const next={...f,[field]:val};
    // Editing the schedule directly marks it "touched" so auto-fill stops overwriting the user's amounts.
    if(field==='payment_schedule'){
      next.payment_schedule_touched=true;
      if(!f.payment_terms_touched) next.payment_terms=buildPaymentTermsText(val);
    }
    if(field==='valid_until') next.valid_until_touched=true; // stop auto-recompute once edited by hand
    return next;
  });
  const allItems=subEventBlocks.flatMap(b=>b.items);
  const subtotal=allItems.reduce((s,i)=>s+(parseFloat(i.quantity)||0)*(parseFloat(i.unit_price)||0),0);
  // Manual total override: when set, it's the final (pre-GST) total the user wants; the gap becomes a
  // signed adjustment stored in discount_amount (positive = reduced, negative = added). Quotes carry no GST.
  const _ovRaw=quotDetails.total_override;
  const overrideOn=_ovRaw!==''&&_ovRaw!=null&&!isNaN(parseFloat(_ovRaw));
  const discountAmt=overrideOn?(subtotal-parseFloat(_ovRaw)):(quotDetails.discount_pct>0?subtotal*(parseFloat(quotDetails.discount_pct)||0)/100:(parseFloat(quotDetails.discount_amount)||0));
  const grandTotal=subtotal-discountAmt;
  const schedAllocated=(quotDetails.payment_schedule||[]).reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
  const schedBalance=Math.round(grandTotal-schedAllocated);
  const schedBalanced=Math.abs(schedBalance)<1;

  const filteredClients=clients.filter(c=>{
    const q=clientSearch.toLowerCase();
    return !q||(c.first_name+' '+c.last_name+' '+(c.phone_1||'')).toLowerCase().includes(q);
  });

  const handleCreate=async()=>{
    if(!quotDetails.valid_until){notify('Please set a valid until date.','error');return;}
    if(grandTotal>0 && !schedBalanced){ notify('Payment installments (₹'+Math.round(schedAllocated).toLocaleString('en-IN')+') must add up to the grand total (₹'+Math.round(grandTotal).toLocaleString('en-IN')+'). Adjust the schedule before continuing.','error'); return; }
    // Persist each installment's amount (source of truth) plus a derived pct for downstream rescaling (GST/revise).
    const _g=grandTotal||0;
    const normSchedule=(quotDetails.payment_schedule||[]).map((p,idx)=>({ amount:Math.round(parseFloat(p.amount)||0), pct:_g>0?Math.round((parseFloat(p.amount)||0)/_g*1000)/10:(parseFloat(p.pct)||0), label:p.label||('Installment '+(idx+1)), when:p.when||'' }));
    setSaving(true);
    try {
      // Item 5: continuing an in-progress draft — update it in place, no new client/ref
      if(isContinuation&&existingQuotationId){
        const contItems=subEventBlocks.flatMap(b=>{
          const seName=(b.name&&b.name.trim()&&b.name.trim().toLowerCase()!=='general items')?b.name.trim():null;
          return (b.items||[]).filter(i=>i.description&&i.description.trim()).map((i,idx)=>({
            quotation_id:existingQuotationId,sub_event_name:seName,source_item_id:i.source_item_id||newSrcId(),description:i.description,
            quantity:parseFloat(i.quantity)||1,unit_price:parseFloat(i.unit_price)||0,
            amount:(parseFloat(i.quantity)||1)*(parseFloat(i.unit_price)||0),
            sub_items:(i.sub_items||[]).filter(si=>si.name&&si.name.trim()).map(si=>({name:si.name.trim(),qty:Math.max(0,parseInt(si.qty)||0),note:si.note||null})),
            sort_order:idx,created_at:new Date().toISOString(),is_deleted:false
          }));
        });
        const {error:ue}=await supabase.from('quotations').update({
          subtotal,discount_pct:overrideOn?0:(parseFloat(quotDetails.discount_pct)||0),
          discount_amount:discountAmt,grand_total:grandTotal,
          doc_date:quotDetails.doc_date,valid_until:quotDetails.valid_until,
          event_name:quotDetails.event_name||null,
          additional_notes:quotDetails.additional_notes||null,
          payment_terms:quotDetails.payment_terms||null,
          additional_terms:quotDetails.additional_terms||null,
          payment_schedule:JSON.stringify(normSchedule),
          display_options:JSON.stringify(displayOpts),
          updated_at:new Date().toISOString()
        }).eq('quotation_id',existingQuotationId);
        if(ue) throw ue;
        // Hard-delete old items first, then insert fresh set — prevents pile-up on repeated edits
        const {error:de}=await supabase.from('quotation_line_items').delete().eq('quotation_id',existingQuotationId);
        if(de) throw de;
        if(contItems.length>0){ const {error:cie}=await supabase.from('quotation_line_items').insert(contItems); if(cie) throw cie; }
        const {data:updated}=await supabase.from('quotations').select('*').eq('quotation_id',existingQuotationId).single();
        setCreatedQuot(updated); setStep(4); setSaving(false); return;
      }

      let clientId=null, clientName=lead.first_name+' '+lead.last_name;
      if(clientMode==='existing'&&existingClient){
        clientId=existingClient.client_id;
        clientName=existingClient.first_name+' '+existingClient.last_name;
      } else if(!isRevision){
        const ref_number = await getNextClientRef();
        const {data:nc,error:ce}=await supabase.from('clients').insert({
          ref_number,
          first_name:lead.first_name,last_name:lead.last_name,phone_1:lead.phone,phone_2:lead.phone_2||null,
          email_1:lead.email||null,source:lead.source||'referral',status:'active',
          client_since:new Date().toISOString().split('T')[0],
          created_at:new Date().toISOString(),updated_at:new Date().toISOString(),is_deleted:false
        }).select().single();
        if(ce) throw ce;
        clientId=nc.client_id; clientName=nc.first_name+' '+nc.last_name;
      } else if(lead.client_id){
        clientId=lead.client_id;
      }

      if(isRevision&&existingQuotationId){
        const {error:spe}=await supabase.from('quotations').update({status:'superseded',updated_at:new Date().toISOString()}).eq('quotation_id',existingQuotationId); if(spe) throw spe;
      }

      const {data:oldQ}=isRevision&&existingQuotationId?await supabase.from('quotations').select('revision_number').eq('quotation_id',existingQuotationId).single():{data:null};
      const revNum=isRevision?(oldQ?.revision_number||0)+1:0;
      const refNum=await getNextQuotRef();

      const lineItems=subEventBlocks.flatMap(b=>{
        // Canonical sub_event_name = the block's display name (trimmed), or null for default/empty blocks
        const seName=(b.name&&b.name.trim()&&b.name.trim().toLowerCase()!=='general items')?b.name.trim():null;
        return (b.items||[]).filter(i=>i.description&&i.description.trim()).map((i,idx)=>({
          sub_event_name:seName,source_item_id:i.source_item_id||newSrcId(),description:i.description,
          quantity:parseFloat(i.quantity)||1,unit_price:parseFloat(i.unit_price)||0,
          amount:(parseFloat(i.quantity)||1)*(parseFloat(i.unit_price)||0),
          sub_items:(i.sub_items||[]).filter(si=>si.name&&si.name.trim()).map(si=>({name:si.name.trim(),qty:Math.max(0,parseInt(si.qty)||0),note:si.note||null})),
          sort_order:idx,created_at:new Date().toISOString(),is_deleted:false
        }));
      });

      const {data:newQ,error:qe}=await supabase.from('quotations').insert({
        ref_number:refNum,status:'draft',
        client_id:clientId,client_name:clientName,
        lead_id:lead.lead_id||null,
        event_id:originEvent?originEvent.eventId:null,
        event_name:quotDetails.event_name||defaultEventName(lead.event_type),
        doc_date:quotDetails.doc_date,valid_until:quotDetails.valid_until,
        subtotal,discount_pct:parseFloat(quotDetails.discount_pct)||0,
        discount_amount:discountAmt,grand_total:grandTotal,
        additional_notes:quotDetails.additional_notes||null,
        payment_terms:quotDetails.payment_terms||null,
        additional_terms:quotDetails.additional_terms||null,
        payment_schedule:JSON.stringify(normSchedule),
        display_options:JSON.stringify(displayOpts),
        parent_quotation_id:isRevision?existingQuotationId:null,
        revision_number:revNum,
        created_at:new Date().toISOString(),updated_at:new Date().toISOString(),is_deleted:false
      }).select().single();
      if(qe) throw qe;

      if(lineItems.length>0){ const {error:lie}=await supabase.from('quotation_line_items').insert(lineItems.map(i=>({...i,quotation_id:newQ.quotation_id}))); if(lie) throw lie; }

      // RFQ-origin: keep the source RFQ pointing at the LIVE quote (so "Go to quote" never lands on a superseded one).
      if(isRevision&&existingQuotationId){ try{ await supabase.from('rfqs').update({quotation_id:newQ.quotation_id,updated_at:new Date().toISOString()}).eq('quotation_id',existingQuotationId); }catch(e){} }

      // Sync the planned event date back: lead's tentative date (lead-origin) and/or the event's main date (event-origin).
      if(quotDetails.event_date){
        if(lead&&lead.lead_id&&lead.tentative_date!==quotDetails.event_date){ try{ await supabase.from('leads').update({tentative_date:quotDetails.event_date,updated_at:new Date().toISOString()}).eq('lead_id',lead.lead_id); }catch(e){} }
        if(originEvent&&originEvent.eventId){ try{ await supabase.from('events').update({main_date:quotDetails.event_date,updated_at:new Date().toISOString()}).eq('event_id',originEvent.eventId); }catch(e){} }
      }

      // Event mirrors the quote: rebuild the event's sub-events + items to match (best-effort; the quote is already saved)
      if(originEvent){
        try {
          // preserve any date/venue already captured on the event's sub-events across the re-sync
          const {data:prevSubs}=await supabase.from('sub_events').select('name,date,location').eq('event_id',originEvent.eventId).eq('is_deleted',false);
          const prevByName={}; (prevSubs||[]).forEach(s=>{ prevByName[String(s.name||'').toLowerCase().trim()]={date:s.date||null,location:s.location||null}; });
          await supabase.from('sub_event_items').update({is_deleted:true}).eq('event_id',originEvent.eventId);
          await supabase.from('sub_events').update({is_deleted:true}).eq('event_id',originEvent.eventId);
          const seNames=[...new Set(lineItems.map(i=>i.sub_event_name).filter(n=>n&&String(n).trim()))];
          const nameToId={}; let so=0;
          for(const nm of seNames){
            const prev=prevByName[String(nm).toLowerCase().trim()]||{};
            const {data:se,error:see}=await supabase.from('sub_events').insert({event_id:originEvent.eventId,name:nm,date:prev.date||null,location:prev.location||null,sort_order:so++,created_at:new Date().toISOString(),is_deleted:false}).select().single();
            if(see) throw see;
            nameToId[nm]=se.sub_event_id;
          }
          const evItems=lineItems.map((i,idx)=>({sub_event_id:i.sub_event_name?(nameToId[i.sub_event_name]||null):null,event_id:originEvent.eventId,description:i.description,quantity:i.quantity,unit_price:i.unit_price,sort_order:idx,created_at:new Date().toISOString(),is_deleted:false}));
          if(evItems.length>0){ const {error:eie}=await supabase.from('sub_event_items').insert(evItems); if(eie) throw eie; }
        } catch(syncErr){ console.error('[Isheeka ERP] event item sync failed:', syncErr); notify('Quote saved, but syncing the event items failed — please refresh the event.','error'); }
      }

      if(!originEvent && lead && lead.lead_id){
        const {error:lqe}=await supabase.from('leads').update({
          active_quotation_id:newQ.quotation_id,
          client_id:clientId||lead.client_id||null,
          stage:'quote_generation_in_progress',
          updated_at:new Date().toISOString()
        }).eq('lead_id',lead.lead_id);
        if(lqe) throw lqe;
      } else if(lead && lead.lead_id){
        // Revising a quote that already has an event (lead-origin, post-conversion): keep the lead pointing
        // at the newest revision so it doesn't surface the superseded original. Stage is left as-is (converted).
        try{ await supabase.from('leads').update({active_quotation_id:newQ.quotation_id,updated_at:new Date().toISOString()}).eq('lead_id',lead.lead_id); }catch(e){ console.error('[Isheeka ERP] lead active-quote repoint failed:', e); }
      }

      // Auto-sync the draft invoice to this revision (with a confirm popup). Safe while the invoice is a
      // draft — nothing has been sent to the client. Declining leaves the manual "Confirm" path + banner.
      if(isRevision && originEvent && originEvent.eventId){
        try{
          const {data:exInv}=await supabase.from('invoices').select('invoice_id,ref_number,status,total_received').eq('event_id',originEvent.eventId).eq('is_deleted',false).neq('status','cancelled').limit(1);
          const di=exInv&&exInv[0];
          if(di && (di.status||'').toLowerCase()==='draft' && (parseFloat(di.total_received)||0)<=0){
            if(await confirmDialog('Update draft invoice '+di.ref_number+' to match this revision (₹'+Math.round(grandTotal).toLocaleString('en-IN')+')?\n\nThis refreshes its items, totals and schedule. The invoice is still a draft — nothing has been sent to the client.')){
              await supabase.from('quotations').update({status:'approved',updated_at:new Date().toISOString()}).eq('quotation_id',newQ.quotation_id);
              newQ.status='approved';
              await createInvoiceFromQuote(newQ.quotation_id,{eventId:originEvent.eventId});
            }
          }
        }catch(e){ console.error('[Isheeka ERP] revision invoice auto-sync failed:', e); }
      }

      setCreatedQuot(newQ);
      setStep(4);
    } catch(err){
      console.error('[Isheeka ERP] quote creation failed:', err);
      notify('Could not create quotation: '+(err&&err.message?err.message:'Please try again.'),'error');
    } finally { setSaving(false); }
  };

  const handleMarkSent=async()=>{
    if(!createdQuot) return;
    // Always set to sent (never confirmed) — Swathi manually confirms on client's verbal yes
    const newStage = isRevision ? 'revised_quote_sent' : 'quote_sent';
    const {error:qse}=await runDb(supabase.from('quotations').update({status:'sent',updated_at:new Date().toISOString()}).eq('quotation_id',createdQuot.quotation_id),'mark quotation sent');
    if(qse) return;
    if(!originEvent && lead && lead.lead_id){
      const {error:lse}=await runDb(supabase.from('leads').update({stage:newStage,updated_at:new Date().toISOString()}).eq('lead_id',lead.lead_id),'update lead stage');
      if(lse) return;
    }
    onComplete(createdQuot);
  };

  // Build the PDF items + settings, upload a hosted PDF, and return the share context (with the link).
  const buildShareCtx=async()=>{
    const pdfItems=subEventBlocks.flatMap(b=>(b.items||[]).filter(i=>i.description&&i.description.trim()).map(i=>({
      sub_event_name:(b.name&&b.name.trim()&&b.name.trim().toLowerCase()!=='general items')?b.name.trim():null,
      description:i.description, quantity:i.quantity, unit_price:i.unit_price,
      amount:(parseFloat(i.quantity)||0)*(parseFloat(i.unit_price)||0),
      sub_items:(i.sub_items||[]).filter(si=>si.name&&si.name.trim())
    })));
    const {data:s}=await supabase.from('settings').select('bank_name,account_number,ifsc_code,upi_id,cover_intro,phone_1,email,website,company_name').single();
    const enrichedQuot={...createdQuot,client_phone:lead.phone||'',client_email:lead.email||'',client_city:lead.location||'',event_date:quotDetails.event_date||lead.tentative_date||null};
    const url=await uploadQuotePdf(enrichedQuot, pdfItems, displayOpts, s||{});
    return {s:s||{}, enrichedQuot, url};
  };

  const handleWhatsApp=async()=>{
    if(!createdQuot) return;
    notify('Preparing the quotation link…','info');
    const {s, enrichedQuot, url}=await buildShareCtx();
    if(!url) notify('Couldn\'t attach the PDF link — sharing the message without it.','error');
    const msg=buildQuoteShareMsg(enrichedQuot, s, url);
    openWhatsApp(lead.phone, msg);
    logQuoteSend(createdQuot.quotation_id, 'whatsapp');
  };

  const handleEmailSend=async(provider)=>{
    if(!createdQuot) return;
    setEmailMenuOpen(false);
    notify('Preparing the quotation link…','info');
    const {s, enrichedQuot, url}=await buildShareCtx();
    if(!url) notify('Couldn\'t attach the PDF link — sharing the message without it.','error');
    const subject='Quotation '+createdQuot.ref_number+' — Isheeka Events';
    const bodyTxt=buildQuoteShareMsg(enrichedQuot, s, url);
    openEmail(provider, lead.email||'', subject, bodyTxt);
    logQuoteSend(createdQuot.quotation_id, 'email');
  };

  const handleQuotePDF=async(action)=>{
    if(!createdQuot) return;
    const pdfItems=subEventBlocks.flatMap(b=>(b.items||[]).filter(i=>i.description&&i.description.trim()).map(i=>({
      sub_event_name:(b.name&&b.name.trim()&&b.name.trim().toLowerCase()!=='general items')?b.name.trim():null,
      description:i.description,
      quantity:i.quantity, unit_price:i.unit_price,
      amount:(parseFloat(i.quantity)||0)*(parseFloat(i.unit_price)||0),
      sub_items:(i.sub_items||[]).filter(si=>si.name&&si.name.trim())
    })));
    const {data:s}=await supabase.from('settings').select('bank_name,account_number,ifsc_code,upi_id,cover_intro,phone_1,email,website,company_name,payment_qr_path').single();
    const enrichedQuot={...createdQuot,client_phone:lead.phone||'',client_email:lead.email||'',client_city:lead.location||'',event_date:quotDetails.event_date||lead.tentative_date||null};
    const qrBase64 = (displayOpts.bankDetails && s?.payment_qr_path) ? await fetchAsBase64(s.payment_qr_path) : null;
    buildQuotationPDF(enrichedQuot,pdfItems,{action,displayOpts,settings:s||{},qrBase64});
  };

  const steps=['Client','Line items','Quote details','Share'];

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:720,maxHeight:'90vh',display:'flex',flexDirection:'column',boxShadow:'var(--shadow-lg)'}}>
        <div style={{padding:'18px 24px',borderBottom:'1px solid var(--grey-100)',flexShrink:0}}>
          <div style={{fontSize:15,fontWeight:600,color:'var(--grey-800)',marginBottom:8}}>
            {isRevision?'Generate revised quotation':'Generate quotation'} — {lead.first_name} {lead.last_name}
          </div>
          {step<4&&(
            <div style={{display:'flex',alignItems:'center'}}>
              {steps.map((s,i)=>(
                <React.Fragment key={i}>
                  <div style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:i+1===step?'var(--pink)':i+1<step?'var(--green)':'var(--grey-400)',fontWeight:i+1===step?500:400}}>
                    <div style={{width:20,height:20,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:600,
                      background:i+1===step?'var(--pink)':i+1<step?'var(--green-light)':'var(--grey-100)',
                      color:i+1===step?'white':i+1<step?'var(--green)':'var(--grey-400)'}}>
                      {i+1<step?'✓':i+1}
                    </div>{s}
                  </div>
                  {i<steps.length-1&&<div style={{flex:1,height:1,background:'var(--grey-200)',margin:'0 8px',alignSelf:'center'}}/>}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        <div style={{flex:1,overflowY:'auto',padding:20}}>

          {step===1&&(
            <div>
              {!isRevision&&!isContinuation&&<>
                {dupClient&&clientMode==='new'&&(
                  <div style={{background:'#FFF3E0',borderRadius:'var(--radius-md)',padding:'10px 14px',fontSize:13,color:'#E65100',marginBottom:14,border:'1px solid #FFE0B2'}}>
                    Existing client found with this phone: <strong>{dupClient.first_name} {dupClient.last_name}</strong>. Consider linking below.
                  </div>
                )}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
                  {[{value:'new',label:'Create new client',sub:'Pre-filled from lead details'},{value:'existing',label:'Link existing client',sub:'Search your client list'}].map(opt=>(
                    <div key={opt.value} onClick={()=>setClientMode(opt.value)}
                      style={{padding:'14px 16px',border:'1.5px solid '+(clientMode===opt.value?'var(--pink)':'var(--grey-100)'),borderRadius:'var(--radius-md)',cursor:'pointer',background:clientMode===opt.value?'#FCEAF1':'white'}}>
                      <div style={{fontSize:13,fontWeight:500,color:'var(--grey-800)',marginBottom:3}}>{opt.label}</div>
                      <div style={{fontSize:12,color:'var(--grey-400)'}}>{opt.sub}</div>
                    </div>
                  ))}
                </div>
                {clientMode==='new'&&(
                  <div style={{background:'var(--grey-50)',borderRadius:'var(--radius-md)',padding:14,border:'1px solid var(--grey-100)'}}>
                    <div style={{fontSize:12,fontWeight:600,color:'var(--grey-400)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:10}}>New client details</div>
                    {[['Name',lead.first_name+' '+lead.last_name],['Phone',lead.phone||'—'],['Email',lead.email||'—'],['Source',(lead.source||'').split('_').join(' ')]].map(([l,v])=>(
                      <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid var(--grey-100)',fontSize:13}}>
                        <span style={{color:'var(--grey-400)'}}>{l}</span>
                        <span style={{fontWeight:500,color:'var(--grey-800)',textTransform:'capitalize'}}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
                {clientMode==='existing'&&(
                  <div>
                    <input className="field-input" placeholder="Search by name or phone..." value={clientSearch} onChange={e=>setClientSearch(e.target.value)} style={{marginBottom:10}}/>
                    <div style={{maxHeight:220,overflowY:'auto',display:'flex',flexDirection:'column',gap:6}}>
                      {filteredClients.map(c=>{
                        const sel=existingClient&&existingClient.client_id===c.client_id;
                        return (
                          <div key={c.client_id} onClick={()=>setExistingClient(c)}
                            style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',border:'1px solid '+(sel?'var(--pink)':'var(--grey-100)'),borderRadius:'var(--radius-md)',cursor:'pointer',background:sel?'#FCEAF1':'white'}}>
                            <div style={{width:32,height:32,borderRadius:'50%',background:'var(--pink-light)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:600,color:'var(--pink)'}}>
                              {c.first_name&&c.first_name.charAt(0)}{c.last_name&&c.last_name.charAt(0)}
                            </div>
                            <div style={{flex:1}}>
                              <div style={{fontSize:13,fontWeight:500}}>{c.first_name} {c.last_name}</div>
                              <div style={{fontSize:12,color:'var(--grey-400)'}}>{c.phone_1}</div>
                            </div>
                            {sel&&<span style={{color:'var(--green)',fontSize:16}}>{'✓'}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>}
              {isContinuation&&(
                <div style={{background:'var(--blue-light)',borderRadius:'var(--radius-md)',padding:'12px 16px',fontSize:13,color:'var(--blue)'}}>
                  Continuing your in-progress draft. Line items and details are pre-filled — make your changes and save to update the existing draft (no duplicate is created).
                </div>
              )}
              {isRevision&&(
                <div style={{background:'var(--blue-light)',borderRadius:'var(--radius-md)',padding:'12px 16px',fontSize:13,color:'var(--blue)'}}>
                  This is a revision. Line items will be pre-filled from the previous quotation. The previous quotation will be marked as Superseded.
                </div>
              )}
            </div>
          )}

          {step===2&&(
            <div>
              <div style={{background:'var(--blue-light)',borderRadius:'var(--radius-md)',padding:'8px 14px',fontSize:12,color:'var(--blue)',marginBottom:14}}>
                Use templates to pre-fill items per sub-event, then fill in prices. Tab between cells.
              </div>
              {impPending ? (
                <div style={{background:'#fff',border:'1px solid #e6d9bf',borderRadius:'var(--radius-lg)',padding:'12px 14px',marginBottom:12}}>
                  <div style={{fontWeight:600,fontSize:13.5,color:'var(--grey-800)'}}>We read {impPending.length} item{impPending.length===1?'':'s'} — review, then add</div>
                  <div style={{fontSize:11,color:'var(--grey-400)',margin:'2px 0 6px'}}>Prices start at ₹0 — you'll set them after adding.</div>
                  <div>{impPending.map((p,i)=>(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,borderTop:'1px solid var(--grey-100)',padding:'5px 0',fontSize:12.5}}>
                      <span>{p.description} <span style={{color:'var(--grey-400)'}}>×{Number(p.quantity)||1}{p.sub_event?(' · '+p.sub_event):''}</span></span>
                      <span onClick={()=>setImpPending(ps=>{ const n=(ps||[]).filter((_,j)=>j!==i); return n.length?n:null; })} style={{cursor:'pointer',color:'var(--grey-300)'}}>✕</span>
                    </div>
                  ))}</div>
                  <div style={{display:'flex',gap:8,marginTop:8}}>
                    <button className="btn sm primary" onClick={confirmImport}>✓ Add {impPending.length} item{impPending.length===1?'':'s'}</button>
                    <button className="btn sm" onClick={()=>{setImpPending(null);setImpMsg('');}}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{background:'#FDF2F6',border:'1px solid #f4cfdd',borderRadius:'var(--radius-lg)',padding:'12px 14px',marginBottom:12}}>
                  <div style={{fontWeight:600,fontSize:13.5,color:'#a11149'}}>⚡ Have the list already?</div>
                  <div style={{fontSize:11.5,color:'var(--grey-400)',margin:'2px 0 8px'}}>Attach a photo/PDF or paste a message — we'll fill the items for you to review, then you set the prices.</div>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                    <button className="btn sm" disabled={impBusy} onClick={()=>runImportFiles(false)}>📎 Attach a list</button>
                    <button className="btn sm" disabled={impBusy} onClick={()=>runImportFiles(true)}>📷 Take a photo</button>
                    <button className="btn sm" disabled={impBusy} onClick={()=>setImpPaste(v=>!v)}>📋 Paste a message</button>
                  </div>
                  {impPaste&&(
                    <div style={{marginTop:10}}>
                      <textarea className="field-input" rows={4} value={impText} onChange={e=>setImpText(e.target.value)} placeholder="Paste your WhatsApp message or typed list here…" style={{width:'100%',boxSizing:'border-box'}}/>
                      <div style={{display:'flex',gap:8,marginTop:6}}><button className="btn sm primary" disabled={impBusy} onClick={runImportText}>✨ Build from this</button><button className="btn sm" onClick={()=>{setImpPaste(false);setImpText('');}}>Cancel</button></div>
                    </div>
                  )}
                  {impMsg&&<div style={{marginTop:8,fontSize:11.5,color:'#a11149'}}>{impMsg}</div>}
                </div>
              )}
              {subEventBlocks.map((block,bi)=>(
                <div key={block.id} style={{background:'var(--grey-50)',borderRadius:'var(--radius-lg)',padding:'14px 16px',marginBottom:12,border:'1px solid var(--grey-100)'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,paddingBottom:8,borderBottom:'1px solid var(--grey-200)'}}>
                    <div style={{width:8,height:8,borderRadius:'50%',background:'#e8185a',flexShrink:0}}/>
                    <QWSubEventNameInput value={block.name} onChange={v=>setSubEventBlocks(bs=>bs.map(b=>b.id===block.id?{...b,name:v}:b))}/>
                    <QWTemplateSelect options={getTemplateOptions(block.name)} eventType={lead.event_type} onSelect={async (tId,seName)=>{
                      if(block.items&&block.items.length>0&&!await confirmDialog('Replace existing items with template?')) return;
                      loadTemplateForBlock(block.id,tId,seName||block.name);
                    }}/>
                    {subEventBlocks.length>1&&<button style={{background:'none',border:'none',cursor:'pointer',color:'var(--red)',fontSize:14,flexShrink:0}} onClick={()=>setSubEventBlocks(bs=>bs.filter(b=>b.id!==block.id))}>X</button>}
                  </div>
                  <FastEntryTable key={block.id} items={block.items||[]} onChange={items=>setSubEventBlocks(bs=>bs.map(b=>{
                    if(b.id!==block.id) return b;
                    // Preserve sub_items from previous state by item id
                    const prevById={}; (b.items||[]).forEach(pi=>{prevById[pi.id]=pi.sub_items||[];});
                    return {...b,items:items.map(i=>({...i,sub_items:prevById[i.id]||i.sub_items||[]}))};
                  }))}/>
                  {/* Sub-items editor — one expandable panel per filled line item */}
                  {(block.items||[]).filter(i=>i.description&&i.description.trim()).map(item=>{
                    const sis=item.sub_items||[];
                    const isOpen=!!expandedSubItems[item.id];
                    return (
                      <div key={item.id} style={{marginTop:4,marginLeft:8,borderLeft:'2px solid var(--grey-100)',paddingLeft:10}}>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <button type="button" onClick={()=>sis.length>0?toggleSubItems(item.id):addSubItem(block.id,item.id)}
                            style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:'var(--grey-400)',padding:'2px 4px',display:'flex',alignItems:'center',gap:4}}
                            onMouseEnter={e=>e.currentTarget.style.color='var(--pink)'}
                            onMouseLeave={e=>e.currentTarget.style.color='var(--grey-400)'}>
                            {sis.length>0?(isOpen?'▾ Sub-items ('+sis.length+')':'▸ Sub-items ('+sis.length+')'):'＋ Add sub-item'}
                          </button>
                          <span style={{fontSize:11,color:'var(--grey-300)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.description}</span>
                        </div>
                        {isOpen&&(
                          <div style={{marginTop:6,marginBottom:6}}>
                            {sis.map(si=>(
                              <div key={si.id} style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                                <input className="field-input" style={{flex:3,fontSize:11,padding:'3px 6px'}}
                                  value={si.name} onChange={e=>updateSubItem(block.id,item.id,si.id,'name',e.target.value)}
                                  placeholder="Name (required)"/>
                                <input type="number" className="field-input" style={{width:52,fontSize:11,padding:'3px 6px',textAlign:'right'}}
                                  value={si.qty??0} min={0}
                                  onChange={e=>updateSubItem(block.id,item.id,si.id,'qty',Math.max(0,parseInt(e.target.value)||0))}/>
                                <input className="field-input" style={{flex:2,fontSize:11,padding:'3px 6px'}}
                                  value={si.note||''} onChange={e=>updateSubItem(block.id,item.id,si.id,'note',e.target.value||null)}
                                  placeholder="Note (optional)"/>
                                <button type="button" onClick={()=>removeSubItem(block.id,item.id,si.id)}
                                  style={{background:'none',border:'none',cursor:'pointer',color:'var(--grey-400)',fontSize:13,padding:'2px 4px',flexShrink:0}}
                                  onMouseEnter={e=>e.currentTarget.style.color='var(--red)'}
                                  onMouseLeave={e=>e.currentTarget.style.color='var(--grey-400)'}>✕</button>
                              </div>
                            ))}
                            <button type="button" onClick={()=>addSubItem(block.id,item.id)}
                              style={{background:'none',border:'1px dashed var(--grey-200)',borderRadius:'var(--radius-sm)',cursor:'pointer',fontSize:11,color:'var(--grey-400)',padding:'2px 8px',marginTop:2}}
                              onMouseEnter={e=>e.currentTarget.style.color='var(--pink)'}
                              onMouseLeave={e=>e.currentTarget.style.color='var(--grey-400)'}>＋ Add sub-item</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8}}>
                <button className="btn sm" style={{border:'1px dashed var(--grey-200)',color:'var(--grey-400)'}}
                  onClick={()=>setSubEventBlocks(bs=>[...bs,{id:'se-'+Date.now(),name:'',items:[]}])}>+ Add sub-event</button>
                <div style={{background:'white',borderRadius:'var(--radius-md)',padding:'8px 16px',border:'1px solid var(--grey-100)',fontSize:13}}>
                  Grand total: <strong style={{color:'var(--green)'}}>Rs.{grandTotal.toLocaleString('en-IN')}</strong>
                </div>
              </div>
            </div>
          )}

          {step===3&&(
            <div>
              <div style={{marginBottom:14}}>
                <label className="field-label">Event name <span style={{fontWeight:400,color:'var(--grey-400)'}}>(shown on the quotation &amp; PDF)</span></label>
                <input className="field-input" value={quotDetails.event_name} onChange={e=>setQD('event_name',e.target.value)} placeholder="e.g. Half Saree Event"/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:14}}>
                <div><label className="field-label">Event date <span style={{fontWeight:400,color:'var(--grey-400)'}}>(planned)</span></label>
                  <input type="date" className="field-input" value={quotDetails.event_date||''} onChange={e=>setQD('event_date',e.target.value)}/></div>
                <div><label className="field-label">Quotation date</label>
                  <input type="date" className="field-input" value={quotDetails.doc_date} onChange={e=>setQD('doc_date',e.target.value)}/></div>
                <div><label className="field-label">Valid until <span style={{color:'var(--pink)'}}>*</span></label>
                  <input type="date" className="field-input" value={quotDetails.valid_until} onChange={e=>setQD('valid_until',e.target.value)}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                <div><label className="field-label">Discount %</label>
                  <input type="number" className="field-input" disabled={overrideOn} style={overrideOn?{opacity:0.5}:{}} value={quotDetails.discount_pct||''} onChange={e=>{setQD('discount_pct',parseFloat(e.target.value)||0);setQD('discount_amount',0);}} placeholder="0"/></div>
                <div><label className="field-label">Discount (fixed Rs.)</label>
                  <input type="number" className="field-input" disabled={overrideOn} style={overrideOn?{opacity:0.5}:{}} value={quotDetails.discount_amount||''} onChange={e=>{setQD('discount_amount',parseFloat(e.target.value)||0);setQD('discount_pct',0);}} placeholder="0"/></div>
              </div>
              <div style={{marginBottom:14}}>
                <label className="field-label">Or set final total <span style={{fontWeight:400,color:'var(--grey-400)'}}>(override — replaces discount; GST added on top for invoices)</span></label>
                <input type="number" className="field-input" value={quotDetails.total_override}
                  onChange={e=>setQD('total_override',e.target.value)}
                  onBlur={async e=>{ const v=e.target.value; if(v!==''&&!isNaN(parseFloat(v))){ const tgt=parseFloat(v); if(Math.abs(tgt-subtotal)>0.5){ const adj=subtotal-tgt; if(!await confirmDialog('Set the total to ₹'+Math.round(tgt).toLocaleString('en-IN')+'?\n\nLine items add up to ₹'+Math.round(subtotal).toLocaleString('en-IN')+'. This applies a '+(adj>0?'−':'+')+'₹'+Math.round(Math.abs(adj)).toLocaleString('en-IN')+' adjustment.')){ setQD('total_override',''); } } } }}
                  placeholder={'Default ₹'+Math.round(subtotal).toLocaleString('en-IN')+' (line-items sum)'}/>
                {overrideOn&&<div style={{marginTop:6,display:'flex',gap:8,alignItems:'center'}}>
                  <span style={{padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:500,background:'var(--orange-light)',color:'var(--orange)'}}>Manual total · {discountAmt>=0?'−':'+'}₹{Math.round(Math.abs(discountAmt)).toLocaleString('en-IN')} adjustment</span>
                  <button type="button" className="btn sm" style={{fontSize:11,padding:'2px 8px'}} onClick={()=>setQD('total_override','')}>Clear</button>
                </div>}
              </div>
              <div style={{background:'var(--grey-50)',borderRadius:'var(--radius-md)',padding:'12px 16px',marginBottom:14}}>
                {[['Subtotal','Rs.'+subtotal.toLocaleString('en-IN'),false],[overrideOn?'Adjustment':'Discount',(overrideOn?((discountAmt>=0?'- ':'+ ')+'Rs.'+Math.abs(Math.round(discountAmt)).toLocaleString('en-IN')):('-Rs.'+discountAmt.toLocaleString('en-IN'))),false],['Grand total','Rs.'+grandTotal.toLocaleString('en-IN'),true]].map(([l,v,bold],i)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:i<2?'1px solid var(--grey-200)':'none'}}>
                    <span style={{fontSize:13,color:'var(--grey-400)'}}>{l}</span>
                    <span style={{fontSize:bold?15:13,fontWeight:bold?700:400,color:bold?'var(--green)':'var(--grey-800)'}}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)'}}>Payment schedule</div>
                  <span style={{fontSize:12,fontWeight:500,color:schedBalanced?'var(--green)':'var(--orange)'}}>
                    {schedBalanced?('✓ Allocated ₹'+Math.round(schedAllocated).toLocaleString('en-IN')+' of ₹'+Math.round(grandTotal).toLocaleString('en-IN')):(schedBalance>0?('Unallocated ₹'+schedBalance.toLocaleString('en-IN')):('Over by ₹'+Math.abs(schedBalance).toLocaleString('en-IN')))}
                  </span>
                </div>
                {(quotDetails.payment_schedule||[]).map((inst,i)=>(
                  <div key={i}>
                    <div style={{display:'grid',gridTemplateColumns:'140px 1fr 1fr auto',gap:8,marginBottom:6,alignItems:'flex-end'}}>
                      <div><label className="field-label" style={{display:i===0?'block':'none'}}>Amount (₹)</label>
                        <div style={{display:'flex',gap:4}}>
                          <input type="number" className="field-input" value={inst.amount||''} onChange={e=>{const ps=[...(quotDetails.payment_schedule||[])];ps[i]={...ps[i],amount:parseFloat(e.target.value)||0};setQD('payment_schedule',ps);}} placeholder="0"/>
                          <button type="button" title="Calculate from a percentage of the grand total" className="btn sm" style={{flex:'0 0 34px',padding:0}} onClick={()=>{ setCalcRow(calcRow===i?null:i); setCalcPct(''); }}>%</button>
                        </div>
                      </div>
                      <div><label className="field-label" style={{display:i===0?'block':'none'}}>Label</label>
                        <input className="field-input" value={inst.label||''} onChange={e=>{const ps=[...(quotDetails.payment_schedule||[])];ps[i]={...ps[i],label:e.target.value};setQD('payment_schedule',ps);}} placeholder="e.g. Advance"/></div>
                      <div><label className="field-label" style={{display:i===0?'block':'none'}}>When due</label>
                        <input className="field-input" value={inst.when||''} onChange={e=>{const ps=[...(quotDetails.payment_schedule||[])];ps[i]={...ps[i],when:e.target.value};setQD('payment_schedule',ps);}} placeholder="e.g. On confirmation"/></div>
                      <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--grey-400)',paddingBottom:6}} onClick={()=>setQD('payment_schedule',(quotDetails.payment_schedule||[]).filter((_,j)=>j!==i))}>X</button>
                    </div>
                    {calcRow===i&&(
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',background:'var(--blue-light)',borderRadius:'var(--radius-sm)',padding:'8px 10px',marginBottom:8,fontSize:13}}>
                        <span style={{color:'var(--grey-600)'}}>Apply</span>
                        <input type="number" className="field-input" style={{width:72}} value={calcPct} onChange={e=>setCalcPct(e.target.value)} placeholder="50"/>
                        <span style={{color:'var(--grey-600)'}}>% of ₹{Math.round(grandTotal).toLocaleString('en-IN')} = <b>₹{Math.round(grandTotal*(parseFloat(calcPct)||0)/100).toLocaleString('en-IN')}</b></span>
                        <button className="btn sm primary" style={{marginLeft:'auto'}} onClick={()=>{const ps=[...(quotDetails.payment_schedule||[])];ps[i]={...ps[i],amount:Math.round(grandTotal*(parseFloat(calcPct)||0)/100)};setQD('payment_schedule',ps);setCalcRow(null);}}>Apply</button>
                      </div>
                    )}
                  </div>
                ))}
                <button className="btn sm" style={{border:'1px dashed var(--grey-200)',color:'var(--grey-400)'}}
                  onClick={()=>setQD('payment_schedule',[...(quotDetails.payment_schedule||[]),{pct:0,amount:0,label:'',when:''}])}>+ Add installment</button>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div><label className="field-label">Notes (optional)</label>
                  <textarea className="field-textarea" rows={3} value={quotDetails.additional_notes||''} onChange={e=>setQD('additional_notes',e.target.value)} placeholder="Notes for client..."/></div>
                <div><label className="field-label">Payment terms <span style={{fontSize:11,color:'var(--grey-400)',fontWeight:400}}>(auto-generated from schedule above — edit if needed)</span></label>
                  <textarea className="field-textarea" rows={3} value={quotDetails.payment_terms||''} onChange={e=>setQuotDetails(f=>({...f,payment_terms:e.target.value,payment_terms_touched:true}))} placeholder="Payment terms will be auto-generated from the schedule above..."/></div>
                <div><label className="field-label">Additional terms &amp; conditions <span style={{fontSize:11,color:'var(--grey-400)',fontWeight:400}}>(cancellation, inclusions, taxes, etc.)</span></label>
                  <textarea className="field-textarea" rows={3} value={quotDetails.additional_terms||''} onChange={e=>setQD('additional_terms',e.target.value)} placeholder="e.g. Cancellation policy, what's included/excluded, GST, etc."/></div>
              </div>
            </div>
          )}

          {step===4&&createdQuot&&(
            <div style={{textAlign:'center',padding:'10px 0'}}>
              <div style={{width:64,height:64,borderRadius:'50%',background:'var(--green-light)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,margin:'0 auto 14px'}}>{'✅'}</div>
              <div style={{fontSize:16,fontWeight:600,color:'var(--grey-800)',marginBottom:4}}>{isRevision?'Revised quotation created!':'Quotation created!'}</div>
              <div style={{fontSize:14,color:'var(--grey-400)',marginBottom:6}}>{createdQuot.ref_number} — Rs.{parseFloat(createdQuot.grand_total||0).toLocaleString('en-IN')}</div>
              <div style={{fontSize:13,color:'var(--grey-400)',marginBottom:24}}>Share with {lead.first_name}, then mark it as sent.{(!originEvent && lead && lead.lead_id)?' This updates the lead stage.':''}</div>
              <ClientViewControls
                title="What the client sees"
                modes={[{ key: 'full', label: 'Full detail' }, { key: 'items', label: 'Items only (recommended)' }, { key: 'summary', label: 'Summary only' }]}
                activeMode={(displayOpts.prices && displayOpts.qty && displayOpts.schedule) ? 'full' : ((!displayOpts.prices && displayOpts.qty) ? 'items' : ((!displayOpts.prices && !displayOpts.qty && !displayOpts.schedule) ? 'summary' : null))}
                onMode={(k) => applyPreset(k)}
                toggles={[
                  { key: 'prices', label: 'Show item prices', checked: !!displayOpts.prices, onChange: (v) => setDO('prices', v) },
                  { key: 'qty', label: 'Show quantities', checked: !!displayOpts.qty, onChange: (v) => setDO('qty', v) },
                  { key: 'grouping', label: 'Show sub-event grouping', checked: !!displayOpts.grouping, onChange: (v) => setDO('grouping', v) },
                  { key: 'schedule', label: 'Show payment schedule', checked: !!displayOpts.schedule, onChange: (v) => setDO('schedule', v) },
                  { key: 'discount', label: 'Show discount', checked: !!displayOpts.discount, onChange: (v) => setDO('discount', v) },
                  { key: 'coverPage', label: 'Include cover page', checked: !!displayOpts.coverPage, onChange: (v) => setDO('coverPage', v) },
                  { key: 'bankDetails', label: 'Show bank details', checked: !!displayOpts.bankDetails, onChange: (v) => setDO('bankDetails', v) },
                ]}
              />
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,maxWidth:420,margin:'0 auto 10px'}}>
                <button className="btn" style={{padding:'12px 16px'}} onClick={handleWhatsApp}>
                  <div style={{fontSize:13,fontWeight:500}}>Share via WhatsApp</div>
                  <div style={{fontSize:11,color:'var(--grey-400)'}}>Opens app, falls back to web</div>
                </button>
                <div style={{position:'relative'}}>
                  <button className="btn" style={{padding:'12px 16px',width:'100%'}} onClick={()=>setEmailMenuOpen(v=>!v)}>
                    <div style={{fontSize:13,fontWeight:500}}>Send via Email {'▾'}</div>
                    <div style={{fontSize:11,color:'var(--grey-400)'}}>Gmail or default app</div>
                  </button>
                  {emailMenuOpen&&(
                    <div style={{position:'absolute',top:'100%',left:0,right:0,zIndex:200,background:'white',border:'1px solid var(--grey-200)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-md)',marginTop:4,overflow:'hidden'}}
                      onMouseLeave={()=>setEmailMenuOpen(false)}>
                      <div onClick={()=>handleEmailSend('gmail')} style={{padding:'10px 14px',fontSize:13,cursor:'pointer',borderBottom:'1px solid var(--grey-100)',textAlign:'left'}}
                        onMouseEnter={e=>e.currentTarget.style.background='var(--grey-50)'} onMouseLeave={e=>e.currentTarget.style.background='white'}>Gmail (web)</div>
                      <div onClick={()=>handleEmailSend('default')} style={{padding:'10px 14px',fontSize:13,cursor:'pointer',textAlign:'left'}}
                        onMouseEnter={e=>e.currentTarget.style.background='var(--grey-50)'} onMouseLeave={e=>e.currentTarget.style.background='white'}>Default email app</div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,maxWidth:420,margin:'0 auto 16px'}}>
                <button className="btn" style={{padding:'10px 16px'}} onClick={()=>handleQuotePDF('download')}>
                  <div style={{fontSize:13,fontWeight:500}}>{'⬇'} Download PDF</div>
                  <div style={{fontSize:11,color:'var(--grey-400)'}}>Branded quotation</div>
                </button>
                <button className="btn" style={{padding:'10px 16px'}} onClick={()=>handleQuotePDF('print')}>
                  <div style={{fontSize:13,fontWeight:500}}>Print</div>
                  <div style={{fontSize:11,color:'var(--grey-400)'}}>Open print dialog</div>
                </button>
              </div>
              <button className="btn primary" style={{width:'100%',maxWidth:420,padding:'12px'}} onClick={handleMarkSent}>
                {(!originEvent && lead && lead.lead_id) ? 'Mark as sent — update lead stage' : 'Mark quotation as sent'}
              </button>
              <button className="btn" style={{width:'100%',maxWidth:420,padding:'10px',marginTop:8}} onClick={()=>onComplete(createdQuot)}>
                Close — I'll mark it sent later
              </button>
            </div>
          )}
        </div>

        {step<4&&(
          <div style={{padding:'14px 24px',borderTop:'1px solid var(--grey-100)',display:'flex',justifyContent:'space-between',flexShrink:0}}>
            <button className="btn" onClick={step===1?onCancel:()=>setStep(s=>s-1)}>{step===1?'Cancel':'Back'}</button>
            {step<3&&<button className="btn primary" onClick={()=>{
              if(step===1&&clientMode==='existing'&&!existingClient&&!isRevision) return;
              setStep(s=>s+1);
            }}>Next</button>}
            {step===3&&<div style={{display:'flex',alignItems:'center',gap:10}}>
              {grandTotal>0&&!schedBalanced&&<span style={{fontSize:12,fontWeight:500,color:'var(--orange)',maxWidth:300,textAlign:'right'}}>⚠ Installments {schedBalance<0?('exceed by ₹'+Math.abs(schedBalance).toLocaleString('en-IN')):('₹'+schedBalance.toLocaleString('en-IN')+' short')} — must total ₹{Math.round(grandTotal).toLocaleString('en-IN')}</span>}
              <button className="btn primary" onClick={handleCreate} disabled={saving||(grandTotal>0&&!schedBalanced)}>{saving?'Creating...':isRevision?'Create revised quote':'Create quotation'}</button>
            </div>}
          </div>
        )}
      </div>
    </div>
  );
}
