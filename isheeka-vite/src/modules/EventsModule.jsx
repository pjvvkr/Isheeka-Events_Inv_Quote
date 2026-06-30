// Events module — list + filters + funnel badges, EventDetail (view/edit, sub-events
// & items, checklist, workflow chain, payment summary, vendors & installments, cancel/
// reopen, change-client, event-originated quote wizard), and NewEventWizard (4-step
// create with reference-copy, templates, Excel import). Ported verbatim from
// isheeka-erp-v22.html.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { notify, runDb } from '../lib/toast.jsx';
import { _currentUid } from '../lib/session.js';
import { fmtDate, eventTypeLabel, effectiveEventStatus, eventFunnel, matchesBudget, vendorInstBalance, isVendorInstOverdue, isVendorInstDueSoon, todayLocalStr, quoteStatusLabel } from '../lib/format.js';
import { EVENT_STATUS_ORDER, EVENT_STATUS_LABELS, EVENT_STATUS_COLORS, EVENT_STAGE_COLORS, BUDGET_RANGES, VENDOR_CATS, VENDOR_MODES } from '../lib/constants.js';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { useEventTypes } from '../lib/data.js';
import { getNextEventRef, getNextClientRef } from '../lib/refs.js';
import { addEventVendor, recordVendorPayment, recordVendorRefund, recordClientRefund, createInvoiceFromQuote, _ensureVendorInstallment } from '../lib/money.js';
import { loadCostingVendorSuggestion } from '../lib/costing.js';
import { InputField, SelectField, AutocompleteInput, fetchSuggestions } from '../components/fields.jsx';
import { ClientLink, VendorLink } from '../components/links.jsx';
import { FastEntryTable, SubEventTplBtn } from '../components/ItemEntry.jsx';
import { QuoteGenerationWizard } from '../components/QuoteWizard.jsx';
import { readWorkbook } from '../lib/xlsxIO.js';
import { ClientForm } from './ClientsModule.jsx';

function SubEventNameInput({value, onChange}) {
  const [suggestions, setSuggestions] = React.useState([]);
  const [filtered, setFiltered] = React.useState([]);
  const [open, setOpen] = React.useState(false);

  const handleFocus = async () => {
    const suggs = await fetchSuggestions('sub_events','name');
    setSuggestions(suggs);
    const q=(value||'').toLowerCase();
    const f=q?suggs.filter(s=>s.toLowerCase().includes(q)):suggs;
    setFiltered(f);
    if(f.length>0) setOpen(true);
  };
  const handleChange = (val) => {
    onChange(val);
    const q=val.toLowerCase();
    setFiltered(q?suggestions.filter(s=>s.toLowerCase().includes(q)&&s.toLowerCase()!==q):suggestions);
    setOpen(true);
  };
  const handleSelect = (val) => { onChange(val); setOpen(false); };

  return (
    <div style={{flex:1,position:'relative'}}>
      <input style={{flex:1,border:'none',background:'transparent',fontSize:13,fontWeight:500,outline:'none',color:'var(--grey-800)',width:'100%'}}
        value={value} onChange={e=>handleChange(e.target.value)}
        onFocus={handleFocus} onBlur={()=>setTimeout(()=>setOpen(false),150)}
        placeholder="Sub-event name (e.g. Mehendi)"/>
      {open && filtered.length>0 && (
        <div style={{position:'absolute',top:'100%',left:0,zIndex:500,background:'white',border:'1.5px solid var(--pink)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-md)',minWidth:180,maxHeight:160,overflowY:'auto'}}>
          {filtered.map((s,i)=>(
            <div key={i} onMouseDown={()=>handleSelect(s)}
              style={{padding:'7px 12px',fontSize:13,cursor:'pointer',color:'var(--grey-800)',borderBottom:'1px solid var(--grey-100)'}}
              onMouseEnter={e=>e.currentTarget.style.background='var(--pink-light)'}
              onMouseLeave={e=>e.currentTarget.style.background='white'}>
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function SubEventDateInput({value, onChange}) {
  return <input type="date" style={{width:140,fontSize:12,padding:'4px 8px',border:'1px solid var(--grey-200)',borderRadius:'var(--radius-sm)',background:'white'}} value={value} onChange={e=>onChange(e.target.value)}/>;
}
function SubEventLocInput({value, onChange}) {
  return <input style={{width:140,fontSize:12,padding:'4px 8px',border:'1px solid var(--grey-200)',borderRadius:'var(--radius-sm)',background:'white'}} value={value} onChange={e=>onChange(e.target.value)} placeholder="Location"/>;
}

// ── Stable inputs for EventDetail edit mode ──────────────────────────────────
function EvtInput({label, required, value, onChange, placeholder='', error='', type='text', hint=''}) {
  return (
    <div>
      {label && <label className="field-label">{label}{required&&<span style={{color:'var(--pink)'}}> *</span>}</label>}
      <input className="field-input" type={type} value={value||''} onChange={e=>onChange(e.target.value)}
        placeholder={placeholder} style={error?{borderColor:'var(--red)'}:{}}/>
      {error&&<div style={{fontSize:11,color:'var(--red)',marginTop:4}}>⚠ {error}</div>}
      {hint&&!error&&<div style={{fontSize:11,color:'var(--grey-400)',marginTop:4}}>{hint}</div>}
    </div>
  );
}
function EvtSelect({label, required, value, onChange, options, placeholder='Select...'}) {
  return (
    <div>
      {label && <label className="field-label">{label}{required&&<span style={{color:'var(--pink)'}}> *</span>}</label>}
      <select className="field-input" value={value||''} onChange={e=>onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
function EvtTextarea({label, value, onChange, placeholder=''}) {
  return (
    <div>
      {label && <label className="field-label">{label}</label>}
      <textarea className="field-textarea" rows={3} value={value||''} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/>
    </div>
  );
}
function EvtAutoInput({label, required, value, onChange, placeholder='', table, column}) {
  return <AutocompleteInput label={label} required={required} value={value} onChange={onChange}
    placeholder={placeholder} table={table} column={column}/>;
}

// ── Change Client Modal ───────────────────────────────────────────────────────
function ChangeClientModal({currentClient, onSave, onCancel}) {
  const [clients, setClients] = React.useState([]);
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(()=>{
    supabase.from('clients').select('client_id,first_name,last_name,phone_1,status')
      .eq('is_deleted',false).neq('status','inactive').order('first_name')
      .then(({data})=>{ if(data) setClients(data); setLoading(false); });
  },[]);

  const filtered = clients.filter(c=>{
    const q = search.toLowerCase();
    return !q || `${c.first_name} ${c.last_name} ${c.phone_1}`.toLowerCase().includes(q);
  }).filter(c=>c.client_id !== currentClient?.client_id);

  const statusColors = {active:{bg:'var(--green-light)',color:'var(--green)'},inactive:{bg:'var(--grey-100)',color:'var(--grey-400)'},vip:{bg:'var(--pink-light)',color:'var(--pink)'}};

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:500,maxHeight:'80vh',overflow:'auto',boxShadow:'var(--shadow-lg)'}}>
        <div style={{padding:'18px 24px',borderBottom:'1px solid var(--grey-100)',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,background:'white'}}>
          <div style={{fontSize:15,fontWeight:600,color:'var(--grey-800)'}}>Change client</div>
          <button className="btn sm" onClick={onCancel}>✕</button>
        </div>
        <div style={{padding:20}}>
          <div style={{background:'var(--orange-light)',borderRadius:'var(--radius-md)',padding:'10px 14px',fontSize:13,color:'var(--orange)',marginBottom:16}}>
            ⚠️ Changing the client will reset the primary and secondary contacts for this event. Make sure to reassign them after.
          </div>
          <input className="field-input" placeholder="Search clients..." value={search}
            onChange={e=>setSearch(e.target.value)} style={{marginBottom:12}}/>
          {loading ? <div style={{textAlign:'center',padding:20}}><div className="spinner" style={{margin:'0 auto'}}/></div> : (
            <div style={{display:'flex',flexDirection:'column',gap:6,maxHeight:300,overflowY:'auto'}}>
              {filtered.map(c=>{
                const sc=statusColors[c.status?.toLowerCase()]||statusColors.active;
                const sel=selected?.client_id===c.client_id;
                return (
                  <div key={c.client_id} onClick={()=>setSelected(c)}
                    style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',border:`1px solid ${sel?'#A01044':'var(--grey-100)'}`,borderRadius:'var(--radius-md)',cursor:'pointer',background:sel?'#FCEAF1':'white'}}>
                    <div style={{width:32,height:32,borderRadius:'50%',background:'var(--pink-light)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:600,color:'var(--pink)',flexShrink:0}}>
                      {c.first_name?.charAt(0)}{c.last_name?.charAt(0)}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:500,color:'var(--grey-800)'}}>{c.first_name} {c.last_name}</div>
                      <div style={{fontSize:12,color:'var(--grey-400)'}}>{c.phone_1}</div>
                    </div>
                    <span style={{padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:500,background:sc.bg,color:sc.color}}>{c.status?.toUpperCase()}</span>
                    {sel&&<span style={{color:'var(--green)',fontSize:16}}>✓</span>}
                  </div>
                );
              })}
              {filtered.length===0&&<div style={{textAlign:'center',padding:20,color:'var(--grey-400)',fontSize:13}}>No other clients found</div>}
            </div>
          )}
        </div>
        <div style={{padding:'14px 24px',borderTop:'1px solid var(--grey-100)',display:'flex',justifyContent:'flex-end',gap:8,position:'sticky',bottom:0,background:'white'}}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!selected} onClick={()=>onSave(selected)}>
            Change to {selected?`${selected.first_name} ${selected.last_name}`:'selected client'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewTaskInput({value, onChange, onEnter}) {
  return <input className="field-input" style={{flex:1}} value={value} onChange={e=>onChange(e.target.value)}
    placeholder="Add a task..." onKeyDown={e=>{if(e.key==='Enter') onEnter();}}/>;
}

function EventFunnelBadge({funnel, compact}){
  if(!funnel) return null;
  const pad=compact?'2px 8px':'3px 10px'; const fs=compact?11:12;
  const sc=EVENT_STAGE_COLORS[funnel.stage];
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
      {funnel.label&&sc&&<span style={{padding:pad,borderRadius:20,fontSize:fs,fontWeight:500,background:sc.bg,color:sc.color}}>{funnel.label}</span>}
      {funnel.vendorBalance>0&&<span title="Outstanding vendor dues for this event" style={{padding:pad,borderRadius:20,fontSize:fs,fontWeight:500,background:'#FCEBEB',color:'#A32D2D'}}>Vendor balance ₹{Math.round(funnel.vendorBalance).toLocaleString('en-IN')}</span>}
    </span>
  );
}

function EventDetail({eventId, onBack, onUseAsReference, onNavigate}) {
  const eventTypes = useEventTypes();
  const [event, setEvent] = React.useState(null);
  const [subEvents, setSubEvents] = React.useState([]);
  const [checklist, setChecklist] = React.useState([]);
  const [quotations, setQuotations] = React.useState([]);
  const [linkedLead, setLinkedLead] = React.useState(null);
  const [showOldQuotes, setShowOldQuotes] = React.useState(false);
  const [genInv, setGenInv] = React.useState(false);
  const [showQuoteWizard, setShowQuoteWizard] = React.useState(false);
  const [quoteWizardLead, setQuoteWizardLead] = React.useState(null);
  const [quoteWizardSubs, setQuoteWizardSubs] = React.useState([]);
  const [reviseQuoteId, setReviseQuoteId] = React.useState(null);
  const [invoices, setInvoices] = React.useState([]);
  const [invInstallments, setInvInstallments] = React.useState([]);
  const [eventVendors, setEventVendors] = React.useState([]);
  const [costingSuggestion, setCostingSuggestion] = React.useState([]);  // vendors from the saved costing, to offer pulling in
  const [applyingSuggestion, setApplyingSuggestion] = React.useState(false);
  const [showAddVendor, setShowAddVendor] = React.useState(false);
  const [vForm, setVForm] = React.useState({mode:'existing',vendorId:'',vendorName:'',category:'other',service:'',agreed:''});
  const [vendorMaster, setVendorMaster] = React.useState([]);
  const [payVendorFor, setPayVendorFor] = React.useState(null);
  const [payInst, setPayInst] = React.useState(null);
  const [vPay, setVPay] = React.useState({amount:'',date:todayLocalStr(),mode:'upi',reference:''});
  const [vSaving, setVSaving] = React.useState(false);
  const [eventInstallments, setEventInstallments] = React.useState({});
  const [expandedVendor, setExpandedVendor] = React.useState(null);
  const [instFor, setInstFor] = React.useState(null);
  const [instForm, setInstForm] = React.useState({id:null,label:'',amount:'',due_date:''});
  const [voidedPays, setVoidedPays] = React.useState([]);
  const loadEventVendors = React.useCallback(async()=>{
    const {data}=await supabase.from('event_vendors').select('*').eq('event_id',eventId).eq('is_deleted',false).order('created_at');
    const evs=data||[]; setEventVendors(evs);
    const ids=evs.map(v=>v.event_vendor_id);
    let map={};
    if(ids.length){ const {data:ii}=await supabase.from('vendor_installments').select('*').in('event_vendor_id',ids).order('installment_number'); (ii||[]).forEach(it=>{ (map[it.event_vendor_id]=map[it.event_vendor_id]||[]).push(it); }); }
    setEventInstallments(map);
    const {data:vp}=await supabase.from('vendor_payments').select('*').eq('event_id',eventId).eq('is_voided',true).order('voided_at',{ascending:false});
    setVoidedPays(vp||[]);
  },[eventId]);
  React.useEffect(()=>{ loadEventVendors(); },[loadEventVendors]);
  // NOTE: declared here (ahead of the effect below that references `editEngage` in its
  // dependency array). The original single-file app left these lower; Babel hoisted const→var
  // so the early reference read `undefined`, but Vite/esbuild keeps `const` and (correctly)
  // throws a temporal-dead-zone ReferenceError. Moving the declaration up is behaviour-neutral.
  const [editEngage,setEditEngage]=React.useState(null);
  const [engForm,setEngForm]=React.useState({vendorId:'',service:'',agreed:''});
  React.useEffect(()=>{ (async()=>{ const {data}=await supabase.from('vendors').select('vendor_id,name,category').eq('is_deleted',false).eq('status','active').order('name'); setVendorMaster(data||[]); })(); },[showAddVendor,editEngage]);
  const submitAddVendor=async()=>{
    if(vForm.mode==='existing'){
      if(!vForm.vendorId){ notify('Pick a vendor.','error'); return; }
      const picked=vendorMaster.find(v=>String(v.vendor_id)===String(vForm.vendorId));
      setVSaving(true);
      try{ await addEventVendor({eventId, vendorId:vForm.vendorId, vendorName:picked&&picked.name, category:vForm.category, service:vForm.service, agreed:vForm.agreed}); setShowAddVendor(false); setVForm({mode:'existing',vendorId:'',vendorName:'',category:'other',service:'',agreed:''}); notify('Vendor added.','success'); await loadEventVendors(); }
      catch(err){ notify('Could not add vendor: '+(err&&err.message?err.message:''),'error'); }
      setVSaving(false); return;
    }
    if(!vForm.vendorName.trim()){ notify('Enter the vendor name.','error'); return; }
    setVSaving(true);
    try{ await addEventVendor({eventId, vendorName:vForm.vendorName.trim(), category:vForm.category, service:vForm.service, agreed:vForm.agreed}); setShowAddVendor(false); setVForm({mode:'existing',vendorId:'',vendorName:'',category:'other',service:'',agreed:''}); notify('Vendor added.','success'); await loadEventVendors(); }
    catch(err){ notify('Could not add vendor: '+(err&&err.message?err.message:''),'error'); }
    setVSaving(false);
  };
  // Pull the costing's chosen vendors into this event as editable engagements (only those not already added).
  const applyCostingVendors=async(list)=>{
    if(!list||!list.length) return;
    setApplyingSuggestion(true);
    try{
      for(const s of list){ await addEventVendor({eventId, vendorId:s.vendor_id, vendorName:s.name, category:'other', service:'Sourced via vendor RFQ', agreed:Math.round(s.amount||0)}); }
      notify(list.length+' vendor'+(list.length>1?'s':'')+' added from costing — adjust agreed amounts as needed.','success');
      await loadEventVendors();
    }catch(err){ notify('Could not add vendors: '+(err&&err.message?err.message:''),'error'); }
    setApplyingSuggestion(false);
  };
  const submitVendorPayment=async()=>{
    const amt=parseFloat(vPay.amount)||0; if(amt<=0){ notify('Enter a valid amount.','error'); return; }
    setVSaving(true);
    try{ await recordVendorPayment(payVendorFor, {amount:amt,date:vPay.date,mode:vPay.mode,reference:vPay.reference,installmentId:payInst&&payInst.installment_id}); setPayVendorFor(null); setPayInst(null); setVPay({amount:'',date:todayLocalStr(),mode:'upi',reference:''}); notify('Payment recorded.','success'); await loadEventVendors(); }
    catch(err){ notify('Could not record payment: '+(err&&err.message?err.message:''),'error'); }
    setVSaving(false);
  };
  const openPayInstallment=(v,inst)=>{ setPayVendorFor(v); setPayInst(inst); const bal=inst?Math.max(0,(parseFloat(inst.amount_due)||0)-(parseFloat(inst.amount_paid)||0)):(parseFloat(v.outstanding)||0); setVPay({amount:bal>0?String(Math.round(bal)):'',date:todayLocalStr(),mode:'upi',reference:''}); };
  const [refundFor,setRefundFor]=React.useState(null);
  const [refundForm,setRefundForm]=React.useState({amount:'',reason:'',date:todayLocalStr()});
  const openVendorRefund=(v)=>{ setRefundFor(v); setRefundForm({amount:String(Math.round(parseFloat(v.total_paid)||0)),reason:'',date:todayLocalStr()}); };
  const submitVendorRefund=async()=>{
    const amt=parseFloat(refundForm.amount)||0; if(amt<=0){ notify('Enter a valid refund amount.','error'); return; }
    if(amt>(parseFloat(refundFor.total_paid)||0)+0.5){ notify('Refund cannot exceed the amount paid ('+'₹'+Math.round(parseFloat(refundFor.total_paid)||0).toLocaleString('en-IN')+').','error'); return; }
    if(!refundForm.reason.trim()){ notify('Enter a reason for the refund.','error'); return; }
    setVSaving(true);
    try{ await recordVendorRefund(refundFor,{amount:amt,reason:refundForm.reason.trim(),date:refundForm.date}); setRefundFor(null); notify('Vendor refund recorded.','success'); await loadEventVendors(); }
    catch(err){ notify('Could not record refund: '+(err&&err.message?err.message:''),'error'); }
    setVSaving(false);
  };
  const openInstEditor=(v,inst)=>{ setInstFor(v); setInstForm(inst?{id:inst.installment_id,label:inst.label||'',amount:String(Math.round(parseFloat(inst.amount_due)||0)),due_date:inst.due_date||''}:{id:null,label:'',amount:'',due_date:''}); };
  const submitInstallment=async()=>{
    const v=instFor; if(!v) return;
    const amt=parseFloat(instForm.amount)||0; if(amt<=0){ notify('Enter the installment amount.','error'); return; }
    setVSaving(true);
    try{
      if(instForm.id){
        const existing=(eventInstallments[v.event_vendor_id]||[]).find(x=>x.installment_id===instForm.id);
        const paid=parseFloat(existing&&existing.amount_paid)||0; const bal=Math.max(0,amt-paid);
        const {error}=await runDb(supabase.from('vendor_installments').update({label:instForm.label||null,amount_due:amt,balance:bal,due_date:instForm.due_date||null,status:bal<=0?'paid':(paid>0?'partially_paid':'pending'),updated_at:new Date().toISOString()}).eq('installment_id',instForm.id),'update installment'); if(error) throw error;
      } else {
        const existing=eventInstallments[v.event_vendor_id]||[];
        const num=existing.reduce((m,x)=>Math.max(m,x.installment_number||0),0)+1;
        const {error}=await runDb(supabase.from('vendor_installments').insert({event_vendor_id:v.event_vendor_id,installment_number:num,label:instForm.label||null,amount_due:amt,amount_paid:0,balance:amt,due_date:instForm.due_date||null,status:'pending',created_at:new Date().toISOString()}),'add installment'); if(error) throw error;
      }
      setInstFor(null); notify('Schedule updated.','success'); await loadEventVendors();
    }catch(err){ notify('Could not save installment: '+(err&&err.message?err.message:''),'error'); }
    setVSaving(false);
  };
  const deleteInstallment=async(inst)=>{
    if((parseFloat(inst.amount_paid)||0)>0){ notify('This installment has payments against it — clear them before deleting.','error'); return; }
    if(!window.confirm('Remove this installment from the schedule?')) return;
    const {error}=await runDb(supabase.from('vendor_installments').delete().eq('installment_id',inst.installment_id),'delete installment');
    if(!error){ notify('Installment removed.','success'); await loadEventVendors(); }
  };
  const openEditEngage=v=>{ setEditEngage(v); setEngForm({vendorId:String(v.vendor_id||''),service:v.service_description||'',agreed:String(Math.round(parseFloat(v.agreed_amount)||0))}); };
  const submitEditEngage=async()=>{
    const v=editEngage; if(!v) return;
    const paid=parseFloat(v.total_paid)||0; const vendorChanged=String(engForm.vendorId)!==String(v.vendor_id);
    if(!engForm.vendorId){ notify('Pick a vendor.','error'); return; }
    if(vendorChanged && paid>0){ notify('Payments are recorded against this vendor — you can’t swap it. Remove the payments first, or remove this vendor and add the new one.','error'); return; }
    const ag=parseFloat(engForm.agreed)||0;
    const picked=vendorMaster.find(x=>String(x.vendor_id)===String(engForm.vendorId));
    const vname=vendorChanged?(picked&&picked.name):v.vendor_name;
    setVSaving(true);
    try{
      const out=Math.max(0,ag-paid);
      const patch={vendor_id:engForm.vendorId,vendor_name:vname||null,service_description:engForm.service||null,agreed_amount:ag,outstanding:out,status:paid<=0?'pending':(out<=0?'paid':'partially_paid'),updated_at:new Date().toISOString()};
      const {error}=await runDb(supabase.from('event_vendors').update(patch).eq('event_vendor_id',v.event_vendor_id),'update engagement'); if(error) throw error;
      const insts=eventInstallments[v.event_vendor_id]||[];
      if(insts.length===1 && (parseFloat(insts[0].amount_paid)||0)<=0){ await supabase.from('vendor_installments').update({amount_due:ag,balance:ag,updated_at:new Date().toISOString()}).eq('installment_id',insts[0].installment_id); }
      setEditEngage(null); notify('Vendor engagement updated.','success'); await loadEventVendors();
    }catch(err){ notify('Could not update: '+(err&&err.message?err.message:''),'error'); }
    setVSaving(false);
  };
  const [removeReasonFor, setRemoveReasonFor] = React.useState(null);
  const [removeReason, setRemoveReason] = React.useState('');
  const removeEngage=async v=>{
    if((parseFloat(v.total_paid)||0)>0){ setRemoveReason(''); setRemoveReasonFor(v); return; }
    if(!window.confirm('Remove '+(v.vendor_name||'this vendor')+' from this event?')) return;
    setVSaving(true);
    try{
      const insts=eventInstallments[v.event_vendor_id]||[];
      if(insts.length){ await supabase.from('vendor_installments').delete().in('installment_id',insts.map(i=>i.installment_id)); }
      const {error}=await runDb(supabase.from('event_vendors').update({is_deleted:true,updated_at:new Date().toISOString()}).eq('event_vendor_id',v.event_vendor_id),'remove vendor'); if(error) throw error;
      setEditEngage(null); notify('Vendor removed from this event.','success'); await loadEventVendors();
    }catch(err){ notify('Could not remove: '+(err&&err.message?err.message:''),'error'); }
    setVSaving(false);
  };
  const confirmVoidRemove=async()=>{
    const v=removeReasonFor; if(!v) return;
    if(!removeReason.trim()){ notify('Enter a reason for voiding the payments.','error'); return; }
    setVSaving(true);
    try{
      const uid=await _currentUid();
      const {error:ve}=await runDb(supabase.from('vendor_payments').update({is_voided:true,void_reason:removeReason.trim(),voided_at:new Date().toISOString(),voided_by:uid}).eq('event_vendor_id',v.event_vendor_id).eq('is_voided',false),'void payments'); if(ve) throw ve;
      // keep installments (voided payment rows still FK-reference them); zero the engagement's live totals + soft-delete it
      const {error}=await runDb(supabase.from('event_vendors').update({is_deleted:true,total_paid:0,outstanding:parseFloat(v.agreed_amount)||0,status:'pending',updated_at:new Date().toISOString()}).eq('event_vendor_id',v.event_vendor_id),'remove vendor'); if(error) throw error;
      setRemoveReasonFor(null); setEditEngage(null); notify('Vendor removed; its payments were voided.','success'); await loadEventVendors();
    }catch(err){ notify('Could not remove: '+(err&&err.message?err.message:''),'error'); }
    setVSaving(false);
  };
  const [altContacts, setAltContacts] = React.useState([]);
  const [staffList, setStaffList] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [mode, setMode] = React.useState('view');
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');
  const [showChangeClient, setShowChangeClient] = React.useState(false);
  const [newTask, setNewTask] = React.useState('');
  const [addingTask, setAddingTask] = React.useState(false);
  const [successMsg, setSuccessMsg] = React.useState('');
  const [form, setForm] = React.useState({});
  const [editSubEvents, setEditSubEvents] = React.useState([]);
  const [editMainItems, setEditMainItems] = React.useState([]);
  const [errors, setErrors] = React.useState({});
  const [mainItemsView, setMainItemsView] = React.useState([]);
  const [evTemplates, setEvTemplates] = React.useState([]);
  React.useEffect(()=>{ supabase.from('event_templates').select('*').eq('is_deleted',false).eq('is_active',true).order('name').then(({data})=>{ if(data) setEvTemplates(data); }); },[]);
  // Load a template's items into one editable sub-event (matched by name, else all), or the main block.
  const loadTplItems = async (tpl, want) => {
    const {data} = await supabase.from('event_template_items').select('*').eq('template_id',tpl.template_id).order('sort_order');
    if(!data) return [];
    let src = want==='main' ? data.filter(i=>(i.sub_event_name||'')==='Main Event') : data.filter(i=>i.sub_event_name!=='Main Event');
    if(want && want!=='main'){ const m=src.filter(i=>(i.sub_event_name||'').trim().toLowerCase()===String(want).trim().toLowerCase()); if(m.length) src=m; }
    if(src.length===0) src = data;
    return src.map(i=>({id:'i-'+i.item_id+'-'+Math.random(),description:i.description,quantity:i.default_quantity,unit_price:0}));
  };
  const loadTemplateIntoEditSub = async (si, tpl) => {
    const se=editSubEvents[si];
    if(se && (se.items||[]).some(i=>i.description&&i.description.trim()) && !window.confirm('Replace this sub-event’s items with the template?')) return;
    const items=await loadTplItems(tpl, (se&&se.name)||'');
    setEditSubEvents(s=>s.map((x,i)=>i===si?{...x,items}:x));
  };
  const loadTemplateIntoEditMain = async (tpl) => {
    if((editMainItems||[]).some(i=>i.description&&i.description.trim()) && !window.confirm('Replace the main event items with the template?')) return;
    const items=await loadTplItems(tpl, 'main');
    setEditMainItems(items);
  };

  React.useEffect(()=>{ loadAll(); },[eventId]);

  const loadAll = async () => {
    setLoading(true);
    setMode('view');
    const [
      {data:evt},
      {data:subs},
      {data:items},
      {data:chk},
      {data:quotes},
      {data:invs},
      {data:staff}
    ] = await Promise.all([
      supabase.from('events').select('*').eq('event_id',eventId).single(),
      supabase.from('sub_events').select('*').eq('event_id',eventId).eq('is_deleted',false).order('sort_order'),
      supabase.from('sub_event_items').select('*').eq('event_id',eventId).eq('is_deleted',false).order('sort_order'),
      supabase.from('event_checklists').select('*').eq('event_id',eventId).order('sort_order'),
      supabase.from('quotations').select('quotation_id,ref_number,status,grand_total,subtotal,discount_amount').eq('event_id',eventId).eq('is_deleted',false),
      supabase.from('invoices').select('invoice_id,ref_number,status,grand_total,total_received,total_outstanding,revision_number').eq('event_id',eventId).eq('is_deleted',false),
      supabase.from('users').select('user_id,first_name,last_name').eq('status','active'),
    ]);
    if(evt){
      setEvent(evt);
      setForm({...evt});
      // Auto-advance the event status (forward only; never touch completed/cancelled).
      // Past the main date → in_progress; else an issued invoice → confirmed.
      try{
        const s=(evt.status||'').toLowerCase();
        if(!['completed','cancelled'].includes(s)){
          const issued=(invs||[]).some(i=>['sent','partially_paid','paid','overdue'].includes((i.status||'').toLowerCase()));
          const past = evt.main_date && evt.main_date<=todayLocalStr();
          const rank={planning:0,confirmed:1,in_progress:2};
          let target=s;
          if(past) target='in_progress'; else if(issued && s==='planning') target='confirmed';
          if((rank[target]||0)>(rank[s]||0)){
            await supabase.from('events').update({status:target,updated_at:new Date().toISOString()}).eq('event_id',eventId);
            setEvent(e=>e?{...e,status:target}:e);
          }
        }
      }catch(e){}
      if(evt.client_id){
        const {data:ac} = await supabase.from('alternative_contacts').select('*').eq('client_id',evt.client_id).eq('is_deleted',false).order('first_name');
        if(ac) setAltContacts(ac);
      }
      if(evt.lead_id){
        const {data:ld} = await supabase.from('leads').select('lead_id,ref_number,stage').eq('lead_id',evt.lead_id).single();
        setLinkedLead(ld||null);
      } else { setLinkedLead(null); }
    }
    if(subs && items){
      const grouped = subs.map(se=>({
        ...se, id:se.sub_event_id,
        items:items.filter(i=>i.sub_event_id===se.sub_event_id).map(i=>({id:i.item_id,description:i.description,quantity:i.quantity,unit_price:i.unit_price,sub_items:Array.isArray(i.sub_items)?i.sub_items:[]}))
      }));
      setSubEvents(grouped);
      setEditSubEvents(grouped.map(se=>({...se})));
      const mi = items.filter(i=>!i.sub_event_id).map(i=>({id:i.item_id,description:i.description,quantity:i.quantity,unit_price:i.unit_price,sub_items:Array.isArray(i.sub_items)?i.sub_items:[]}));
      setMainItemsView(mi);
      setEditMainItems(mi);
    }
    if(chk) setChecklist(chk);
    if(quotes) setQuotations(quotes);
    if(invs) setInvoices(invs);
    // Vendors used in the saved costing for this event's quote(s) — offered as a one-click pull.
    try { const sugg = await loadCostingVendorSuggestion((quotes||[]).map(q=>q.quotation_id)); setCostingSuggestion(sugg||[]); } catch(e){ setCostingSuggestion([]); }
    if(invs&&invs.length){ const {data:iin}=await supabase.from('invoice_installments').select('invoice_id,balance,is_deleted').in('invoice_id',invs.map(i=>i.invoice_id)).eq('is_deleted',false); setInvInstallments(iin||[]); } else { setInvInstallments([]); }
    if(staff) setStaffList(staff);
    setLoading(false);
  };
  const setF = (field,val) => { setForm(f=>({...f,[field]:val})); if(errors[field]) setErrors(e=>({...e,[field]:''})); };

  const handleSave = async () => {
    const e={};
    if(!form.name?.trim()) e.name='Event name is required';
    if(!form.main_date) e.main_date='Date is required';
    if(!form.location?.trim()) e.location='Location is required';
    if(Object.keys(e).length>0){setErrors(e);setSaveError('Please fill in all required fields.');return;}
    setSaving(true); setSaveError('');
    try {
      const {error:eue}=await supabase.from('events').update({
        name:form.name,type:form.type,status:form.status,
        main_date:form.main_date,location:form.location,
        guest_count:form.guest_count?parseInt(form.guest_count):null,
        budget:form.budget?parseFloat(form.budget):null,
        primary_contact_id:form.primary_contact_id||null,
        primary_contact_name:form.primary_contact_name||null,
        secondary_contact_id:form.secondary_contact_id||null,
        secondary_contact_name:form.secondary_contact_name||null,
        assigned_staff_id:form.assigned_staff_id||null,
        assigned_staff_name:form.assigned_staff_name||null,
        internal_notes:form.internal_notes||null,
        updated_at:new Date().toISOString()
      }).eq('event_id',eventId);
      if(eue) throw eue;
      const {error:sidel}=await supabase.from('sub_event_items').update({is_deleted:true}).eq('event_id',eventId); if(sidel) throw sidel;
      const {error:sedel}=await supabase.from('sub_events').update({is_deleted:true}).eq('event_id',eventId); if(sedel) throw sedel;
      for(const se of editSubEvents){
        if(!se.name?.trim()) continue;
        const {data:seData,error:seierr} = await supabase.from('sub_events').insert({
          event_id:eventId,name:se.name,date:se.date||null,location:se.location||null,
          sort_order:editSubEvents.indexOf(se),created_at:new Date().toISOString(),is_deleted:false
        }).select().single();
        if(seierr) throw seierr;
        if(seData && se.items?.length>0){
          const rows=se.items.filter(r=>r.description?.trim()).map((r,i)=>({
            sub_event_id:seData.sub_event_id,event_id:eventId,
            description:r.description,quantity:parseFloat(r.quantity)||1,
            unit_price:parseFloat(r.unit_price)||0,
            sub_items:Array.isArray(r.sub_items)?r.sub_items:[],
            sort_order:i,created_at:new Date().toISOString(),is_deleted:false
          }));
          if(rows.length>0){ const {error:rie}=await supabase.from('sub_event_items').insert(rows); if(rie) throw rie; }
        }
      }
      const mainRows=editMainItems.filter(r=>r.description?.trim()).map((r,i)=>({
        sub_event_id:null,event_id:eventId,
        description:r.description,quantity:parseFloat(r.quantity)||1,
        unit_price:parseFloat(r.unit_price)||0,
        sub_items:Array.isArray(r.sub_items)?r.sub_items:[],
        sort_order:i,created_at:new Date().toISOString(),is_deleted:false
      }));
      if(mainRows.length>0){ const {error:mrie}=await supabase.from('sub_event_items').insert(mainRows); if(mrie) throw mrie; }
      await loadAll();
      setSuccessMsg('Event updated successfully!');
      setTimeout(()=>setSuccessMsg(''),4000);
    } catch(err){ console.error('[Isheeka ERP] event save failed:', err); setSaveError('Could not save changes. Please try again.'); }
    finally { setSaving(false); }
  };

  const handleStatusChange = async (newStatus) => {
    const {error:ese}=await runDb(supabase.from('events').update({status:newStatus,updated_at:new Date().toISOString()}).eq('event_id',eventId),'update event status');
    if(ese) return;
    setEvent(ev=>({...ev,status:newStatus}));
  };

  // Close the source RFQ chain when an event ends. mode 'cancel' withdraws the client RFQ
  // (and its vendor RFQs); mode 'complete' leaves the client RFQ Converted but closes any
  // still-open vendor RFQs. Non-fatal — never blocks the complete/cancel itself.
  const closeEventRfqs = async (mode, reason, uid) => {
    try {
      const qIds = (quotations || []).map(q => q.quotation_id).filter(Boolean);
      if (!qIds.length) return;
      const { data: crfqs } = await supabase.from('rfqs').select('rfq_id,status').eq('party_type', 'client').in('quotation_id', qIds).eq('is_deleted', false);
      const clientIds = (crfqs || []).map(r => r.rfq_id);
      if (mode === 'cancel') {
        const toClose = (crfqs || []).filter(r => !['withdrawn', 'expired'].includes(r.status)).map(r => r.rfq_id);
        if (toClose.length) {
          await supabase.from('rfqs').update({ status: 'withdrawn', updated_at: new Date().toISOString() }).in('rfq_id', toClose);
          for (const id of toClose) { try { await supabase.from('rfq_activity').insert({ rfq_id: id, actor: uid || 'staff', action: 'withdrawn', notes: reason }); } catch (e) {} }
        }
      }
      if (clientIds.length) {
        const { data: vrfqs } = await supabase.from('rfqs').select('rfq_id,status').eq('party_type', 'vendor').in('parent_rfq_id', clientIds).eq('is_deleted', false);
        const vClose = (vrfqs || []).filter(r => !['withdrawn', 'expired'].includes(r.status)).map(r => r.rfq_id);
        if (vClose.length) {
          await supabase.from('rfqs').update({ status: 'withdrawn', updated_at: new Date().toISOString() }).in('rfq_id', vClose);
          for (const id of vClose) { try { await supabase.from('rfq_activity').insert({ rfq_id: id, actor: uid || 'staff', action: 'withdrawn', notes: reason }); } catch (e) {} }
        }
      }
    } catch (e) { /* non-fatal */ }
  };

  const markEventCompleted = async () => {
    if(!funnel.canComplete){ notify('Can’t complete yet — '+(funnel.blocker||'the client invoice isn’t fully paid.'),'error'); return; }
    const leadNote = linkedLead ? ('\n\nThis will also close the source lead '+(linkedLead.ref_number||'')+'.') : '';
    const vNote = funnel.vendorBalance>0 ? ('\n\nNote: ₹'+Math.round(funnel.vendorBalance).toLocaleString('en-IN')+' is still owed to vendors for this event. That won’t be blocked — settle it from the vendor section when ready.') : '';
    if(!window.confirm('Mark this event as completed?'+leadNote+vNote+'\n\nUse this once the event has been delivered.')) return;
    const {error:ese}=await runDb(supabase.from('events').update({status:'completed',updated_at:new Date().toISOString()}).eq('event_id',eventId),'mark event completed');
    if(ese) return;
    setEvent(ev=>({...ev,status:'completed'}));
    if(linkedLead&&linkedLead.lead_id&&linkedLead.stage!=='completed'){
      const {error:lse}=await runDb(supabase.from('leads').update({stage:'completed',updated_at:new Date().toISOString()}).eq('lead_id',linkedLead.lead_id),'close source lead');
      if(!lse) setLinkedLead(l=>l?{...l,stage:'completed'}:l);
    }
    // Close any still-open vendor RFQs (the client RFQ stays Converted = fulfilled).
    try { const uid=await _currentUid(); await closeEventRfqs('complete','Event '+(event.ref_number||'')+' completed',uid); } catch(e){}
    setSuccessMsg('Event marked completed.'+(linkedLead?' Source lead '+(linkedLead.ref_number||'')+' closed.':''));
    setTimeout(()=>setSuccessMsg(''),6000);
  };

  // ── Cancel / reopen event ──
  const [showCancel, setShowCancel] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');
  const [cancelling, setCancelling] = React.useState(false);
  const [expTotal, setExpTotal] = React.useState(0);
  const [rebuildDismissed, setRebuildDismissed] = React.useState(false);
  const [invHandling, setInvHandling] = React.useState({}); // invoice_id -> {mode:'refund'|'retain', amount}
  const [venHandling, setVenHandling] = React.useState({}); // event_vendor_id -> {mode:'recover'|'lost', amount}
  const [leadAction, setLeadAction] = React.useState('leave'); // leave | reopen | lost
  const cancelInvList = (invoices||[]).filter(i=>i.status!=='cancelled' && (parseFloat(i.total_received)||0)>0);
  const cancelVenList = (eventVendors||[]).filter(v=>(parseFloat(v.total_paid)||0)>0);
  const cancelChoicesComplete = cancelInvList.every(i=>invHandling[i.invoice_id]&&invHandling[i.invoice_id].mode) && cancelVenList.every(v=>venHandling[v.event_vendor_id]&&venHandling[v.event_vendor_id].mode);
  const openCancel = async () => {
    setCancelReason('');
    const ih={}; cancelInvList.forEach(i=>{ ih[i.invoice_id]={mode:'',amount:String(Math.round(parseFloat(i.total_received)||0))}; });
    const vh={}; cancelVenList.forEach(v=>{ vh[v.event_vendor_id]={mode:'',amount:String(Math.round(parseFloat(v.total_paid)||0))}; });
    setInvHandling(ih); setVenHandling(vh); setLeadAction('leave'); setShowCancel(true);
    const {data}=await supabase.from('expenses').select('amount').eq('event_id',eventId).eq('is_deleted',false);
    setExpTotal((data||[]).reduce((s,x)=>s+(parseFloat(x.amount)||0),0));
  };
  const doCancelEvent = async () => {
    if(!cancelReason.trim()){ notify('Enter a reason for cancellation.','error'); return; }
    if(!cancelChoicesComplete){ notify('Mark how each client refund and vendor payment is handled.','error'); return; }
    setCancelling(true);
    try{
      const uid=await _currentUid();
      const reason='Event '+(event.ref_number||'')+' cancelled: '+cancelReason.trim();
      const {error:ee}=await runDb(supabase.from('events').update({status:'cancelled',cancellation_reason:cancelReason.trim(),cancelled_at:new Date().toISOString(),cancelled_by:uid,updated_at:new Date().toISOString()}).eq('event_id',eventId),'cancel event'); if(ee) throw ee;
      // 1) cancel all the event's open invoices, then post client refunds (preserving cancelled status)
      await supabase.from('invoices').update({status:'cancelled',updated_at:new Date().toISOString()}).eq('event_id',eventId).eq('is_deleted',false).neq('status','cancelled');
      // Close the event's quote(s) as terminal (Rejected) so they're no longer revisable; historical PDFs stay printable.
      { const {data:eqs}=await supabase.from('quotations').select('quotation_id,status').eq('event_id',eventId).eq('is_deleted',false);
        const qIds=(eqs||[]).filter(q=>!['rejected','superseded','expired'].includes(q.status)).map(q=>q.quotation_id);
        if(qIds.length){ await supabase.from('quotations').update({status:'rejected',updated_at:new Date().toISOString()}).in('quotation_id',qIds);
          for(const qid of qIds){ try{ await supabase.from('quotation_activity_log').insert({quotation_id:qid, action:'rejected', notes:'Event '+(event.ref_number||'')+' cancelled — '+cancelReason.trim(), logged_by:uid}); }catch(e){} } } }
      // Withdraw the source client RFQ + its vendor RFQs (mirrors quote→rejected) so nothing looks live.
      await closeEventRfqs('cancel', reason, uid);
      for(const i of cancelInvList){ const h=invHandling[i.invoice_id]; if(h&&h.mode==='refund'){ const amt=Math.min(parseFloat(h.amount)||0,parseFloat(i.total_received)||0); if(amt>0) await recordClientRefund({...i,status:'cancelled'},{amount:amt,reason,date:todayLocalStr()}); } }
      // 2) vendor refunds (recovered amounts) before installment cleanup
      for(const v of cancelVenList){ const h=venHandling[v.event_vendor_id]; if(h&&h.mode==='recover'){ const amt=Math.min(parseFloat(h.amount)||0,parseFloat(v.total_paid)||0); if(amt>0) await recordVendorRefund(v,{amount:amt,reason,date:todayLocalStr()}); } }
      // 3) clean up vendor installments (unpaid removed, partly-paid due dates cleared)
      const evIds=eventVendors.map(v=>v.event_vendor_id);
      if(evIds.length){
        const {data:insts}=await supabase.from('vendor_installments').select('installment_id,amount_paid').in('event_vendor_id',evIds);
        const unpaid=(insts||[]).filter(i=>(parseFloat(i.amount_paid)||0)<=0).map(i=>i.installment_id);
        const partly=(insts||[]).filter(i=>(parseFloat(i.amount_paid)||0)>0).map(i=>i.installment_id);
        if(unpaid.length) await supabase.from('vendor_installments').delete().in('installment_id',unpaid);
        if(partly.length) await supabase.from('vendor_installments').update({due_date:null,updated_at:new Date().toISOString()}).in('installment_id',partly);
      }
      if(linkedLead&&linkedLead.lead_id){
        const note='[Event '+(event.ref_number||'')+' cancelled '+todayLocalStr()+': '+cancelReason.trim()+']';
        const patch={notes:(linkedLead.notes?(linkedLead.notes+'\n'+note):note),updated_at:new Date().toISOString()};
        if(leadAction==='reopen'){ patch.stage='contacted'; }
        else if(leadAction==='lost'){ patch.stage='lost'; patch.lost_reason='event_cancelled'; patch.lost_notes=cancelReason.trim(); }
        await supabase.from('leads').update(patch).eq('lead_id',linkedLead.lead_id);
      }
      setEvent(ev=>({...ev,status:'cancelled',cancellation_reason:cancelReason.trim(),cancelled_at:new Date().toISOString()}));
      setInvoices(prev=>prev.map(i=>({...i,status:'cancelled'})));
      setShowCancel(false); setCancelling(false);
      notify('Event cancelled.','success');
      await loadEventVendors();
    }catch(err){ setCancelling(false); notify('Could not cancel the event: '+(err&&err.message?err.message:'try again'),'error'); }
  };
  const doReopenEvent = async () => {
    if(!window.confirm('Reopen this event to Planning?\n\nVoided invoices and cleared vendor schedules are NOT auto-restored — you can regenerate them from the banner after reopening.')) return;
    const {error}=await runDb(supabase.from('events').update({status:'planning',updated_at:new Date().toISOString()}).eq('event_id',eventId),'reopen event'); if(error) return;
    setEvent(ev=>({...ev,status:'planning'})); setRebuildDismissed(false);
    notify('Event reopened to Planning. Use the banner to regenerate what you need.','success');
  };
  // Undo an accidental/early completion → return the event to an active state (and reopen the source lead).
  const doReopenCompleted = async () => {
    if(!window.confirm('Reopen this completed event?\n\nIt returns to an active state so you can edit it again.'+(linkedLead&&linkedLead.stage==='completed'?(' The source lead '+(linkedLead.ref_number||'')+' is reopened too.'):''))) return;
    const target = (event.main_date && event.main_date<=todayLocalStr()) ? 'in_progress' : 'confirmed';
    const {error:ese}=await runDb(supabase.from('events').update({status:target,updated_at:new Date().toISOString()}).eq('event_id',eventId),'reopen completed event'); if(ese) return;
    setEvent(ev=>({...ev,status:target}));
    if(linkedLead&&linkedLead.lead_id&&linkedLead.stage==='completed'){
      const {error:lse}=await runDb(supabase.from('leads').update({stage:'event_triggered',updated_at:new Date().toISOString()}).eq('lead_id',linkedLead.lead_id),'reopen source lead');
      if(!lse) setLinkedLead(l=>l?{...l,stage:'event_triggered'}:l);
    }
    notify('Event reopened — you can edit it again.','success');
  };
  const rebuildRegenInvoice = async () => {
    const q=(quotations||[]).find(x=>['approved','converted','invoiced','sent'].includes(x.status))||(quotations||[])[0];
    if(!q){ notify('No source quotation to regenerate from.','error'); return; }
    const inv=await createInvoiceFromQuote(q.quotation_id,{eventId});
    if(inv){ notify('Draft invoice regenerated.','success'); setInvoices(prev=>[...prev.filter(i=>i.invoice_id!==inv.invoice_id),inv]); }
  };
  const rebuildVendorSchedule = async (v) => {
    try{ await _ensureVendorInstallment(v.event_vendor_id, v.agreed_amount); notify('Schedule re-added for '+(v.vendor_name||'vendor')+'. Set due dates in the vendor row.','success'); await loadEventVendors(); }
    catch(err){ notify('Could not re-add schedule: '+(err&&err.message?err.message:''),'error'); }
  };

  const handleChangeClient = async (newClient) => {
    const {error:ecc}=await runDb(supabase.from('events').update({
      client_id:newClient.client_id,
      client_name:newClient.first_name+' '+newClient.last_name,
      primary_contact_id:null,primary_contact_name:null,
      secondary_contact_id:null,secondary_contact_name:null,
      updated_at:new Date().toISOString()
    }).eq('event_id',eventId),'change event client');
    if(ecc) return;
    setShowChangeClient(false);
    await loadAll();
    setSuccessMsg('Client changed to '+newClient.first_name+' '+newClient.last_name+'. Primary and secondary contacts have been reset — please reassign them.');
    setTimeout(()=>setSuccessMsg(''),6000);
  };

  const toggleChecklist = async (item) => {
    const done = !item.is_done;
    setChecklist(c=>c.map(i=>i.checklist_id===item.checklist_id?{...i,is_done:done}:i));
    const {error:tce}=await runDb(supabase.from('event_checklists').update({is_done:done,done_at:done?new Date().toISOString():null}).eq('checklist_id',item.checklist_id),'update task');
    if(tce) setChecklist(c=>c.map(i=>i.checklist_id===item.checklist_id?{...i,is_done:!done}:i));
  };

  const addChecklistItem = async () => {
    if(!newTask.trim()) return;
    const {data,error:ace} = await runDb(supabase.from('event_checklists').insert({
      event_id:eventId,task:newTask.trim(),is_done:false,
      sort_order:checklist.length,created_at:new Date().toISOString()
    }).select().single(),'add task');
    if(ace) return;
    if(data) setChecklist(c=>[...c,data]);
    setNewTask(''); setAddingTask(false);
  };

  const deleteChecklistItem = async (id) => {
    const prevChecklist = checklist;
    setChecklist(c=>c.filter(i=>i.checklist_id!==id));
    const {error:dce}=await runDb(supabase.from('event_checklists').delete().eq('checklist_id',id),'delete task');
    if(dce) setChecklist(prevChecklist);
  };

  // Create a quotation directly from this event (event-originated; no lead, no convert step)
  const launchQuoteWizard = async (reviseId) => {
    if(!event.client_id){ notify('Add a client to this event before creating a quotation.','error'); return; }
    const {data:c} = await supabase.from('clients').select('first_name,last_name,phone_1,phone_2,email_1,source').eq('client_id',event.client_id).single();
    const nm=(event.client_name||'').trim();
    const built = c
      ? {lead_id:null, client_id:event.client_id, first_name:c.first_name, last_name:c.last_name, phone:c.phone_1||'', phone_2:c.phone_2||'', email:c.email_1||'', source:c.source||'referral', event_type:event.type}
      : {lead_id:null, client_id:event.client_id, first_name:nm.split(' ')[0]||nm, last_name:nm.split(' ').slice(1).join(' '), phone:'', phone_2:'', email:'', source:'referral', event_type:event.type};
    setQuoteWizardLead(built);
    const subsWithItems = (subEvents||[]).map(se=>({name:se.name, items:(se.items||[]).map(i=>({description:i.description,quantity:i.quantity,unit_price:i.unit_price}))}));
    const mainEvItems = (mainItemsView||[]).map(i=>({description:i.description,quantity:i.quantity,unit_price:i.unit_price}));
    setQuoteWizardSubs(mainEvItems.length>0 ? [...subsWithItems, {name:'General Items', items:mainEvItems}] : subsWithItems);
    setReviseQuoteId(reviseId||null);
    setShowQuoteWizard(true);
  };

  // Generate-invoice safety net: re-create the draft from a confirmed quote if the
  // auto-create at confirmation didn't run (or the invoice was deleted). Not a manual builder.
  const handleGenerateInvoice = async () => {
    const q = quotations.find(x=>['approved','converted'].includes(x.status));
    if(!q){ notify('Confirm a quotation first — invoices are generated from a confirmed quote.','info'); return; }
    setGenInv(true);
    const inv = await createInvoiceFromQuote(q.quotation_id,{eventId});
    setGenInv(false);
    if(inv) await loadAll();
  };

  const enterEditMode = () => { setForm({...event}); setErrors({}); setSaveError(''); setMode('edit'); };
  const cancelEdit = () => { setErrors({}); setSaveError(''); setMode('view'); };

  if(loading) return <div style={{padding:60,textAlign:'center'}}><div className="spinner" style={{margin:'0 auto'}}/></div>;
  if(!event) return <div style={{padding:40,textAlign:'center',color:'var(--grey-400)'}}>Event not found.</div>;

  const sc = EVENT_STATUS_COLORS[event.status?.toLowerCase()]||EVENT_STATUS_COLORS.planning;
  const hasFinancialDocs = quotations.length>0||invoices.length>0;
  const activeQuote = quotations.find(q=>!['superseded','rejected','expired'].includes(q.status));
  // Once an invoice has been ISSUED (sent or beyond), the invoice is the master — quote revisions
  // would silently diverge from the document the client received/paid against. Draft invoices still
  // auto-refresh from the quote, so revising is fine while the only invoice is a draft.
  const invoiceIssued = invoices.some(i=>['sent','partially_paid','paid','overdue'].includes((i.status||'').toLowerCase()));
  // Derived funnel — drives the progress badge + the Mark-completed gate.
  const vendorOutstandingTotal = eventVendors.reduce((s,v)=>s+(parseFloat(v.outstanding)||0),0);
  const hasApprovedQuote = quotations.some(q=>['approved','converted','invoiced'].includes((q.status||'').toLowerCase()));
  const funnel = eventFunnel({invoices, installments:invInstallments, vendorOutstanding:vendorOutstandingTotal, hasApprovedQuote});
  const staffOpts = staffList.map(s=>({value:s.user_id,label:s.first_name+' '+s.last_name})).sort((a,b)=>a.label.localeCompare(b.label));
  const typeOpts = eventTypes.map(t=>({value:t.value,label:t.label}));
  const statusOpts = EVENT_STATUS_ORDER.map(s=>({value:s,label:EVENT_STATUS_LABELS[s]}));
  const contactOpts = [{value:'',label:'Client themselves'},...altContacts.map(ac=>({value:ac.contact_id,label:ac.first_name+' '+ac.last_name+' ('+ac.relationship+')'}))];
  const grandTotal = subEvents.reduce((s,se)=>s+se.items.reduce((ss,i)=>ss+(parseFloat(i.quantity)||0)*(parseFloat(i.unit_price)||0),0),0)
    + mainItemsView.reduce((s,i)=>s+(parseFloat(i.quantity)||0)*(parseFloat(i.unit_price)||0),0);

  // ── SHARED HEADER (always visible) ──────────────────────────────────────────
  const header = (
    <div>
      {showChangeClient && <ChangeClientModal currentClient={{client_id:event.client_id}} onSave={handleChangeClient} onCancel={()=>setShowChangeClient(false)}/>}
      {mode==='edit'&&<div style={{fontSize:12,color:'var(--grey-400)',marginBottom:10}}>Editing · {event.name}</div>}
      <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'18px 24px',border:'1px solid var(--grey-100)',marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12}}>
        <div>
          <div style={{fontSize:18,fontWeight:600,color:'var(--grey-800)',marginBottom:4}}>{event.name}</div>
          <div style={{fontSize:12,color:'var(--grey-400)'}}>{event.ref_number&&<span style={{color:'var(--pink)',fontWeight:500}}>{event.ref_number} · </span>}{event.type?eventTypeLabel(event.type):''} · <ClientLink clientId={event.client_id} name={event.client_name} onNavigate={onNavigate}>{event.client_name}</ClientLink></div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          {mode==='view' && <>
            <StatusBadge kind="event" status={event.status?.toLowerCase()} size="md" />
            {!['cancelled'].includes(event.status?.toLowerCase())&&<EventFunnelBadge funnel={event.status?.toLowerCase()==='completed'?{...funnel,label:null}:funnel}/>}
            {event.client_id&&<button className="btn sm" title="Open this client's 360" onClick={()=>onNavigate&&onNavigate('clients',{clientId:event.client_id,label:event.client_name||'Client'})}>👤 View client →</button>}
            {!['completed','cancelled'].includes(event.status?.toLowerCase())&&(
              funnel.canComplete
                ? <button className="btn sm" onClick={markEventCompleted} title="Client invoice fully paid — marks the event delivered and closes the source lead">✅ Mark completed</button>
                : <button className="btn sm" disabled style={{opacity:0.5,cursor:'not-allowed'}} title={'Can’t complete yet — '+(funnel.blocker||'client invoice not fully paid.')+(funnel.vendorBalance>0?' (Vendor balance ₹'+Math.round(funnel.vendorBalance).toLocaleString('en-IN')+' can be settled later — it doesn’t block.)':'')}>✅ Mark completed</button>
            )}
            {!['completed','cancelled'].includes(event.status?.toLowerCase())&&<button className="btn sm" style={{color:'var(--red)',borderColor:'rgba(163,45,45,0.3)'}} onClick={openCancel} title="Cancel this event and reconcile its invoices, vendors and schedules">⛔ Cancel event</button>}
            {event.status?.toLowerCase()==='cancelled'&&<button className="btn sm" onClick={doReopenEvent} title="Reopen to Planning (status only)">↩ Reopen event</button>}
            {event.status?.toLowerCase()==='completed'&&<button className="btn sm" onClick={doReopenCompleted} title="Undo completion — returns the event to an active state so you can edit it">↩ Reopen</button>}
            <button className="btn sm" onClick={()=>onUseAsReference(event)}>📋 Use as reference</button>
            {!['completed','cancelled'].includes(event.status?.toLowerCase())
              ? <button className="btn sm primary" onClick={enterEditMode}>✏️ Edit</button>
              : event.status?.toLowerCase()==='completed'
                ? <span style={{fontSize:12,color:'var(--grey-400)',display:'inline-flex',alignItems:'center'}} title="Completed events are locked. Reopen to edit.">🔒 Completed — reopen to edit</span>
                : null}
          </>}
          {mode==='edit' && <>
            <button className="btn sm" onClick={cancelEdit}>✕ Cancel</button>
            <button className="btn sm primary" onClick={handleSave} disabled={saving}>{saving?'Saving...':'💾 Save changes'}</button>
          </>}
        </div>
      </div>
      {saveError&&<div style={{background:'var(--red-light)',color:'var(--red)',borderRadius:'var(--radius-sm)',padding:'10px 14px',fontSize:13,marginBottom:12,border:'1px solid rgba(163,45,45,0.2)'}}>⚠️ {saveError}</div>}
    </div>
  );
  // ── VIEW MODE ────────────────────────────────────────────────────────────────
  if(mode==='view') return (
    <div>
      {header}
      {showQuoteWizard&&<QuoteGenerationWizard lead={quoteWizardLead} leadSubEvents={quoteWizardSubs} isRevision={!!reviseQuoteId} isContinuation={false} existingQuotationId={reviseQuoteId} originEvent={{eventId:event.event_id, eventName:event.name}} onComplete={async()=>{ setShowQuoteWizard(false); setReviseQuoteId(null); await loadAll(); }} onCancel={()=>{ setShowQuoteWizard(false); setReviseQuoteId(null); }}/>}
      {successMsg&&<div style={{background:'var(--green-light)',color:'var(--green)',borderRadius:'var(--radius-sm)',padding:'10px 14px',fontSize:13,marginBottom:12,border:'1px solid rgba(15,110,86,0.2)',display:'flex',alignItems:'center',gap:8}}>✅ {successMsg}</div>}
      {event.status?.toLowerCase()==='cancelled'&&<div style={{background:'var(--red-light)',border:'1px solid rgba(163,45,45,0.25)',borderRadius:'var(--radius-md)',padding:'10px 14px',fontSize:13,marginBottom:12,color:'var(--red)'}}>⛔ <b>This event is cancelled.</b>{event.cancellation_reason?(' Reason: '+event.cancellation_reason):''}{event.cancelled_at?(' · '+fmtDate(event.cancelled_at,{day:'numeric',month:'short',year:'numeric'})):''} <span style={{color:'var(--grey-500)'}}>— invoices were voided; unpaid vendor schedules cleared. Use Reopen to restore.</span></div>}
      {(()=>{ if(!event.cancelled_at || event.status?.toLowerCase()==='cancelled' || rebuildDismissed) return null;
        const hasActiveInv=(invoices||[]).some(i=>i.status!=='cancelled');
        const srcQuote=(quotations||[]).find(x=>['approved','converted','invoiced','sent'].includes(x.status))||(quotations||[])[0];
        const vendorsMissing=(eventVendors||[]).filter(v=>(parseFloat(v.agreed_amount)||0)>0 && ((eventInstallments[v.event_vendor_id]||[]).length===0));
        const needInvoice=!hasActiveInv && srcQuote;
        if(!needInvoice && vendorsMissing.length===0) return null;
        return <div style={{background:'var(--orange-light)',border:'1px solid rgba(230,81,0,0.3)',borderRadius:'var(--radius-md)',padding:'12px 14px',marginBottom:12}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}><div style={{fontSize:13,fontWeight:600,color:'var(--orange)'}}>↩ Reopened — finish rebuilding</div><button className="btn sm" style={{fontSize:11,padding:'2px 8px'}} onClick={()=>setRebuildDismissed(true)}>Dismiss</button></div>
          <div style={{fontSize:12,color:'var(--grey-500)',marginBottom:8}}>The cancellation voided invoices and cleared vendor schedules. Recreate what you need:</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {needInvoice&&<button className="btn sm primary" onClick={rebuildRegenInvoice}>↻ Regenerate invoice from quote</button>}
            {vendorsMissing.map(v=><button key={v.event_vendor_id} className="btn sm" onClick={()=>rebuildVendorSchedule(v)}>↻ Re-add schedule · {v.vendor_name||'vendor'}</button>)}
          </div>
        </div>;
      })()}
      {/* Info cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>
        {[
          {label:'Main event date',val:event.main_date?fmtDate(event.main_date,{day:'numeric',month:'long',year:'numeric'}):'—'},
          {label:'Location',val:event.location||'—'},
          {label:'Guest count',val:event.guest_count||'—'},
          {label:'Budget',val:event.budget?'₹'+parseFloat(event.budget).toLocaleString('en-IN'):'—'},
          {label:'Primary contact',val:event.primary_contact_name||event.client_name||'—'},
          {label:'Assigned staff',val:event.assigned_staff_name||'—'},
        ].map((card,i)=>(
          <div key={i} style={{background:'white',borderRadius:'var(--radius-md)',padding:'12px 16px',border:'1px solid var(--grey-100)'}}>
            <div style={{fontSize:11,color:'var(--grey-400)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:4}}>{card.label}</div>
            <div style={{fontSize:14,fontWeight:500,color:'var(--grey-800)'}}>{card.val}</div>
          </div>
        ))}
      </div>

      {/* Client */}
      <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'14px 20px',border:'1px solid var(--grey-100)',marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <div style={{fontSize:11,color:'var(--grey-400)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:2}}>Client</div>
          <div style={{fontSize:14,fontWeight:500,color:'var(--grey-800)'}}><ClientLink clientId={event.client_id} name={event.client_name} onNavigate={onNavigate} style={{fontSize:14,fontWeight:500}}>{event.client_name||'—'}</ClientLink></div>
        </div>
        {hasFinancialDocs
          ? <div style={{fontSize:12,color:'var(--grey-400)',display:'flex',alignItems:'center',gap:4}}>🔒 Client cannot be changed — quotations/invoices exist</div>
          : <button className="btn sm" onClick={()=>setShowChangeClient(true)}>↔ Change client</button>
        }
      </div>

      {subEvents.length>0&&(
        <div style={{background:'white',borderRadius:'var(--radius-lg)',border:'1px solid var(--grey-100)',padding:'16px 20px',marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:700,color:'var(--gold)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:10}}>📅 Event schedule</div>
          {subEvents.map(se=>(
            <div key={se.sub_event_id} style={{display:'grid',gridTemplateColumns:'1fr auto auto',gap:16,alignItems:'center',padding:'7px 0',borderTop:'1px solid var(--grey-50)',fontSize:13}}>
              <span style={{fontWeight:500,color:'var(--grey-800)'}}>{se.name}</span>
              <span style={{color:'var(--grey-500)',whiteSpace:'nowrap'}}>{se.date?fmtDate(se.date,{day:'numeric',month:'short',year:'numeric'}):'TBD'}</span>
              <span style={{color:'var(--grey-500)',whiteSpace:'nowrap'}}>{se.location?('📍 '+se.location):'—'}</span>
            </div>
          ))}
        </div>
      )}
      {/* Sub-events + Checklist */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'16px 20px',border:'1px solid var(--grey-100)'}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)',marginBottom:14}}>Sub-events & items</div>
          {subEvents.length===0&&<div style={{fontSize:13,color:'var(--grey-400)',textAlign:'center',padding:'20px 0'}}>No sub-events</div>}
          {subEvents.map(se=>(
            <div key={se.sub_event_id} style={{marginBottom:14,paddingBottom:14,borderBottom:'1px solid var(--grey-100)'}}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:'#e8185a',flexShrink:0}}/>
                <div style={{fontSize:13,fontWeight:500,color:'var(--grey-800)'}}>{se.name}</div>
                {se.date&&<div style={{fontSize:12,color:'var(--grey-400)'}}>· {fmtDate(se.date,{day:'numeric',month:'short'})}</div>}{se.location&&<div style={{fontSize:12,color:'var(--grey-400)'}}>· 📍 {se.location}</div>}
              </div>
              {se.items.length>0
                ? <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                    <thead><tr style={{background:'var(--grey-50)'}}>
                      <th style={{padding:'4px 8px',textAlign:'left',color:'var(--grey-400)',fontWeight:500}}>Description</th>
                      <th style={{padding:'4px 8px',textAlign:'right',color:'var(--grey-400)',fontWeight:500,width:'10%'}}>Qty</th>
                      <th style={{padding:'4px 8px',textAlign:'right',color:'var(--grey-400)',fontWeight:500,width:'20%'}}>Price</th>
                      <th style={{padding:'4px 8px',textAlign:'right',color:'var(--grey-400)',fontWeight:500,width:'20%'}}>Amount</th>
                    </tr></thead>
                    <tbody>{se.items.map((item,i)=>(
                      <React.Fragment key={i}>
                        <tr style={{borderBottom:(item.sub_items&&item.sub_items.length)?'none':'1px solid var(--grey-100)'}}>
                          <td style={{padding:'4px 8px',color:'var(--grey-800)'}}>{item.description}</td>
                          <td style={{padding:'4px 8px',textAlign:'right',color:'var(--grey-600)'}}>{item.quantity}</td>
                          <td style={{padding:'4px 8px',textAlign:'right',color:'var(--grey-600)'}}>₹{parseFloat(item.unit_price||0).toLocaleString('en-IN')}</td>
                          <td style={{padding:'4px 8px',textAlign:'right',color:'var(--green)',fontWeight:500}}>₹{((parseFloat(item.quantity)||0)*(parseFloat(item.unit_price)||0)).toLocaleString('en-IN')}</td>
                        </tr>
                        {(item.sub_items||[]).filter(s=>s&&s.name).map((s,si)=>(
                          <tr key={'s'+si} style={{borderBottom:si===(item.sub_items.length-1)?'1px solid var(--grey-100)':'none'}}>
                            <td colSpan={4} style={{padding:'1px 8px 1px 20px',fontSize:11,color:'var(--grey-400)'}}>• {String(s.name).trim()}{s.qty>0?' ×'+s.qty:''}{s.note?' ('+s.note+')':''}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}</tbody>
                  </table>
                : <div style={{fontSize:12,color:'var(--grey-400)',paddingLeft:14}}>No items</div>
              }
            </div>
          ))}
          {mainItemsView.length>0&&(
            <div style={{marginTop:8,paddingTop:8,borderTop:'1px dashed var(--grey-200)'}}>
              <div style={{fontSize:12,color:'var(--grey-400)',marginBottom:6}}>Main event items</div>
              <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                <tbody>{mainItemsView.map((item,i)=>(
                  <React.Fragment key={i}>
                    <tr style={{borderBottom:(item.sub_items&&item.sub_items.length)?'none':'1px solid var(--grey-100)'}}>
                      <td style={{padding:'4px 8px',color:'var(--grey-800)'}}>{item.description}</td>
                      <td style={{padding:'4px 8px',textAlign:'right',color:'var(--grey-600)',width:'10%'}}>{item.quantity}</td>
                      <td style={{padding:'4px 8px',textAlign:'right',color:'var(--grey-600)',width:'20%'}}>₹{parseFloat(item.unit_price||0).toLocaleString('en-IN')}</td>
                      <td style={{padding:'4px 8px',textAlign:'right',color:'var(--green)',fontWeight:500,width:'20%'}}>₹{((parseFloat(item.quantity)||0)*(parseFloat(item.unit_price)||0)).toLocaleString('en-IN')}</td>
                    </tr>
                    {(item.sub_items||[]).filter(s=>s&&s.name).map((s,si)=>(
                      <tr key={'s'+si} style={{borderBottom:si===(item.sub_items.length-1)?'1px solid var(--grey-100)':'none'}}>
                        <td colSpan={4} style={{padding:'1px 8px 1px 20px',fontSize:11,color:'var(--grey-400)'}}>• {String(s.name).trim()}{s.qty>0?' ×'+s.qty:''}{s.note?' ('+s.note+')':''}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}</tbody>
              </table>
            </div>
          )}
          {(subEvents.length>0||mainItemsView.length>0)&&(()=>{
            const _d=activeQuote?(parseFloat(activeQuote.discount_amount)||0):0;
            const hasAdj=activeQuote&&Math.abs(_d)>0.5;
            return (
              <div style={{marginTop:12,paddingTop:12,borderTop:'2px solid var(--grey-200)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{fontSize:13,fontWeight:hasAdj?500:600,color:hasAdj?'var(--grey-600)':'var(--grey-800)'}}>Total items value</div>
                  <div style={{fontSize:hasAdj?13:15,fontWeight:hasAdj?500:700,color:hasAdj?'var(--grey-700)':'var(--pink)'}}>₹{grandTotal.toLocaleString('en-IN')}</div>
                </div>
                {hasAdj&&<>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:5,fontSize:13,color:'var(--grey-600)'}}>
                    <div>Adjustment{activeQuote.ref_number?(' · '+activeQuote.ref_number):''}</div>
                    <div>{_d>0?'− ':'+ '}₹{Math.abs(Math.round(_d)).toLocaleString('en-IN')}</div>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8,paddingTop:8,borderTop:'1px solid var(--grey-100)'}}>
                    <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)'}}>Quote total</div>
                    <div style={{fontSize:15,fontWeight:700,color:'var(--pink)'}}>₹{(parseFloat(activeQuote.grand_total)||0).toLocaleString('en-IN')}</div>
                  </div>
                </>}
              </div>
            );
          })()}
        </div>

        <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'16px 20px',border:'1px solid var(--grey-100)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)'}}>Checklist</div>
            <div style={{fontSize:12,color:'var(--grey-400)'}}>{checklist.filter(i=>i.is_done).length}/{checklist.length} done</div>
          </div>
          {checklist.length===0&&<div style={{fontSize:13,color:'var(--grey-400)',textAlign:'center',padding:'20px 0'}}>No tasks yet</div>}
          {checklist.map(item=>(
            <div key={item.checklist_id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--grey-100)',cursor:'pointer'}} onClick={()=>toggleChecklist(item)}>
              <div style={{width:18,height:18,borderRadius:4,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',transition:'all .15s',
                border:item.is_done?'none':'1.5px solid var(--grey-200)',background:item.is_done?'var(--green)':'white'}}>
                {item.is_done&&<span style={{color:'white',fontSize:11,fontWeight:600}}>✓</span>}
              </div>
              <div style={{flex:1,fontSize:13,color:item.is_done?'var(--grey-400)':'var(--grey-800)',textDecoration:item.is_done?'line-through':'none'}}>{item.task}</div>
              <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--grey-300)',fontSize:13}} onClick={e=>{e.stopPropagation();deleteChecklistItem(item.checklist_id);}}>🗑</button>
            </div>
          ))}
          {addingTask
            ? <div style={{display:'flex',gap:8,marginTop:10}}>
                <NewTaskInput value={newTask} onChange={setNewTask} onEnter={addChecklistItem}/>
                <button className="btn sm primary" onClick={addChecklistItem}>Add</button>
                <button className="btn sm" onClick={()=>{setAddingTask(false);setNewTask('');}}>✕</button>
              </div>
            : <button className="btn sm" style={{marginTop:10,border:'1px dashed var(--grey-200)',color:'var(--grey-400)',width:'100%'}} onClick={()=>setAddingTask(true)}>+ Add task</button>
          }
        </div>
      </div>

      {/* Workflow */}
      <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'16px 20px',border:'1px solid var(--grey-100)',marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)',marginBottom:10}}>Workflow</div>
        {/* Lead → Quote → Event → Invoice chain */}
        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',fontSize:12,color:'var(--grey-400)',marginBottom:14,paddingBottom:12,borderBottom:'1px solid var(--grey-100)'}}>
          {linkedLead?<a onClick={()=>onNavigate&&onNavigate('leads',{leadId:linkedLead.lead_id,label:linkedLead.ref_number||'Lead'})} style={{color:'var(--pink)',cursor:'pointer',fontWeight:500}}>🎯 {linkedLead.ref_number||'Lead'}</a>:<span>🎯 —</span>}
          <span>→</span>
          {quotations.length>0?<a onClick={()=>{const aq=quotations.find(q=>!['superseded','rejected','expired'].includes(q.status))||quotations[0];onNavigate&&onNavigate('quotations',{quotId:aq.quotation_id,label:aq.ref_number});}} style={{color:'var(--pink)',cursor:'pointer',fontWeight:500}}>📄 {quotations.length>1?(quotations.length+' quotes'):(quotations[0].ref_number)}</a>:<span>📄 —</span>}
          <span>→</span>
          <span style={{color:'var(--grey-700)',fontWeight:500}}>🎪 {event.ref_number} (this event)</span>
          <span>→</span>
          {invoices.length>0?<a onClick={()=>{const iv=(invoices.find(i=>i.status!=='cancelled')||invoices[0]);onNavigate&&onNavigate('invoices',{invoiceId:iv.invoice_id,label:iv.ref_number});}} style={{color:'var(--pink)',cursor:'pointer',fontWeight:500}}>🧾 {invoices.length>1?(invoices.length+' invoices'):(invoices[0].ref_number)}</a>:<span>🧾 —</span>}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div style={{fontSize:11,color:'var(--grey-400)',fontWeight:500,textTransform:'uppercase',letterSpacing:'.04em'}}>Quotations ({quotations.length})</div>
              {quotations.length===0
                ? <button className="btn sm" style={{fontSize:11,padding:'3px 8px'}} onClick={()=>launchQuoteWizard(null)}>+ Create</button>
                : invoiceIssued
                  ? <span style={{fontSize:11,color:'var(--grey-400)',display:'inline-flex',alignItems:'center',gap:4}} title="An invoice has already been issued for this event. To change scope or pricing, revise the invoice instead — revising the quote now would diverge from the issued invoice.">🔒 Invoice issued — revise the invoice</span>
                  : <button className="btn sm" style={{fontSize:11,padding:'3px 8px'}} onClick={()=>{const aq=(activeQuote||quotations[0]);onNavigate&&onNavigate('quotations',{quotId:aq.quotation_id,label:aq.ref_number});}} title="Open the quote — revise it here until the invoice is issued">✏️ Revise quote →</button>}
            </div>
            {quotations.length===0&&<div style={{fontSize:13,color:'var(--grey-400)'}}>No quotations yet</div>}
            {(()=>{
              const qs={draft:{bg:'var(--grey-100)',color:'var(--grey-400)'},sent:{bg:'var(--blue-light)',color:'var(--blue)'},approved:{bg:'var(--green-light)',color:'var(--green)'},converted:{bg:'var(--green-light)',color:'var(--green)'},rejected:{bg:'var(--red-light)',color:'var(--red)'},expired:{bg:'var(--orange-light)',color:'var(--orange)'},revised:{bg:'var(--orange-light)',color:'var(--orange)'},superseded:{bg:'var(--grey-100)',color:'var(--grey-400)'}};
              const renderRow=q=>{
                const s=qs[q.status?.toLowerCase()]||qs.draft;
                return <div key={q.quotation_id} onClick={()=>onNavigate&&onNavigate('quotations',{quotId:q.quotation_id,label:q.ref_number})} title="Open quotation" style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',background:'var(--grey-50)',borderRadius:'var(--radius-sm)',marginBottom:6,cursor:'pointer',opacity:q.status==='superseded'?0.6:1}}>
                  <div><div style={{fontSize:13,fontWeight:500}}>{q.ref_number}</div><div style={{fontSize:12,color:'var(--grey-400)'}}>₹{parseFloat(q.grand_total||0).toLocaleString('en-IN')}</div></div>
                  <span style={{padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:500,background:s.bg,color:s.color,textTransform:'capitalize'}}>{quoteStatusLabel(q)}</span>
                </div>;
              };
              const current=quotations.filter(q=>q.status!=='superseded');
              const older=quotations.filter(q=>q.status==='superseded');
              return <>
                {current.map(renderRow)}
                {older.length>0&&<div onClick={()=>setShowOldQuotes(v=>!v)} style={{fontSize:12,fontWeight:500,color:'var(--blue)',cursor:'pointer',padding:'6px 4px',userSelect:'none'}}>{showOldQuotes?'▾ Hide':'▸ Show'} {older.length} earlier revision{older.length>1?'s':''}</div>}
                {showOldQuotes&&older.map(renderRow)}
              </>;
            })()}
          </div>
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div style={{fontSize:11,color:'var(--grey-400)',fontWeight:500,textTransform:'uppercase',letterSpacing:'.04em'}}>Invoices ({invoices.length})</div>
              {!invoices.some(i=>i.status!=='cancelled')&&quotations.some(q=>['approved','converted'].includes(q.status))&&
                <button className="btn sm" style={{fontSize:11,padding:'3px 8px'}} disabled={genInv} onClick={handleGenerateInvoice} title="Create the draft invoice from the confirmed quotation">{genInv?'Generating…':'+ Generate invoice'}</button>}
            </div>
            {invoices.length===0&&<div style={{fontSize:13,color:'var(--grey-400)'}}>{quotations.some(q=>['approved','converted'].includes(q.status))?'No invoice yet — generate it from the confirmed quote.':'No invoices yet — confirm a quotation to raise one.'}</div>}
            {invoices.map(inv=>{
              const is={draft:{bg:'var(--grey-100)',color:'var(--grey-400)'},sent:{bg:'var(--blue-light)',color:'var(--blue)'},partially_paid:{bg:'var(--orange-light)',color:'var(--orange)'},paid:{bg:'var(--green-light)',color:'var(--green)'},overdue:{bg:'var(--red-light)',color:'var(--red)'},cancelled:{bg:'var(--grey-100)',color:'var(--grey-400)'}};
              const s=is[inv.status?.toLowerCase()]||is.draft;
              const recvd=parseFloat(inv.total_received||0); const tot=parseFloat(inv.grand_total||0);
              return <div key={inv.invoice_id} onClick={()=>onNavigate&&onNavigate('invoices',{invoiceId:inv.invoice_id,label:inv.ref_number})} title="View invoice" style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',background:'var(--grey-50)',borderRadius:'var(--radius-sm)',marginBottom:6,cursor:'pointer'}}>
                <div><div style={{fontSize:13,fontWeight:500}}>{inv.ref_number}{inv.revision_number>0?' · Rev '+inv.revision_number:''}</div><div style={{fontSize:12,color:'var(--grey-400)'}}>₹{tot.toLocaleString('en-IN')}{recvd>0?' · ₹'+recvd.toLocaleString('en-IN')+' received':''}</div></div>
                <span style={{padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:500,background:s.bg,color:s.color,textTransform:'capitalize'}}>{(inv.status||'').replace('_',' ')}</span>
              </div>;
            })}
          </div>
        </div>
      </div>

      {/* Payment summary */}
      <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'16px 20px',border:'1px solid var(--grey-100)',marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)'}}>Payment summary</div>
          {(()=>{ const activeInv=invoices.find(i=>i.status!=='cancelled'); return (
            <button className="btn sm" style={activeInv?{}:{opacity:0.5,cursor:'not-allowed'}} disabled={!activeInv}
              title={activeInv?('Record a client payment on '+activeInv.ref_number):'Generate an invoice first to record payments'}
              onClick={()=>activeInv&&onNavigate&&onNavigate('invoices',{invoiceId:activeInv.invoice_id,label:activeInv.ref_number})}>＋ Record payment →</button>
          ); })()}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
          {[
            {label:activeQuote?'Quoted':'Quoted (items)',val:'₹'+(activeQuote?(parseFloat(activeQuote.grand_total)||0):grandTotal).toLocaleString('en-IN'),color:'var(--grey-800)'},
            {label:'Invoiced',val:'₹'+invoices.filter(i=>i.status!=='cancelled').reduce((s,i)=>s+(parseFloat(i.grand_total)||0),0).toLocaleString('en-IN'),color:'var(--blue)'},
            {label:'Received',val:'₹'+invoices.filter(i=>i.status!=='cancelled').reduce((s,i)=>s+(parseFloat(i.total_received)||0),0).toLocaleString('en-IN'),color:'var(--green)'},
            {label:'Outstanding',val:'₹'+invoices.filter(i=>i.status!=='cancelled').reduce((s,i)=>s+(parseFloat(i.total_outstanding!=null?i.total_outstanding:((parseFloat(i.grand_total)||0)-(parseFloat(i.total_received)||0)))||0),0).toLocaleString('en-IN'),color:'var(--red)'},
          ].map((p,i)=>(
            <div key={i} style={{textAlign:'center',padding:'10px',background:'var(--grey-50)',borderRadius:'var(--radius-md)'}}>
              <div style={{fontSize:11,color:'var(--grey-400)',marginBottom:4}}>{p.label}</div>
              <div style={{fontSize:16,fontWeight:600,color:p.color}}>{p.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Vendors & payments */}
      <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'16px 20px',border:'1px solid var(--grey-100)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)'}}>Vendors &amp; payments</div>
          <button className="btn sm" style={{fontSize:11,padding:'3px 8px'}} onClick={()=>setShowAddVendor(true)}>+ Add vendor</button>
        </div>
        {(()=>{ const paid=eventVendors.reduce((s,v)=>s+(parseFloat(v.total_paid)||0),0); const out=eventVendors.reduce((s,v)=>s+(parseFloat(v.outstanding)||0),0); const agr=eventVendors.reduce((s,v)=>s+(parseFloat(v.agreed_amount)||0),0); return <div style={{fontSize:12,color:'var(--grey-400)',marginBottom:12}}>Vendor cost: <b style={{color:'var(--grey-800)'}}>₹{Math.round(paid).toLocaleString('en-IN')} paid</b> · ₹{Math.round(out).toLocaleString('en-IN')} outstanding · ₹{Math.round(agr).toLocaleString('en-IN')} agreed</div>; })()}
        {/* Suggest-and-confirm: vendors chosen during costing that aren't on this event yet. */}
        {(()=>{ if(['completed','cancelled'].includes(event.status?.toLowerCase())) return null; const pending=costingSuggestion.filter(s=>!eventVendors.some(v=>String(v.vendor_id)===String(s.vendor_id))); if(!pending.length) return null; const tot=pending.reduce((x,s)=>x+(s.amount||0),0); return (
          <div style={{background:'var(--blue-light)',border:'1px solid #BFDBFE',borderRadius:'var(--radius-md)',padding:'10px 12px',marginBottom:12}}>
            <div style={{fontSize:12.5,color:'var(--grey-700)',marginBottom:8}}>🔧 From this event's costing: <b>{pending.length}</b> vendor{pending.length>1?'s':''} chosen (₹{Math.round(tot).toLocaleString('en-IN')} cost). Add {pending.length>1?'them':'it'} to this event?</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>{pending.map(s=>(<span key={s.vendor_id} style={{fontSize:11.5,background:'white',border:'1px solid #BFDBFE',borderRadius:20,padding:'2px 9px',color:'var(--grey-700)'}}>{s.name} · ₹{Math.round(s.amount||0).toLocaleString('en-IN')} · {s.item_count} item{s.item_count>1?'s':''}</span>))}</div>
            <button className="btn sm primary" disabled={applyingSuggestion} onClick={()=>applyCostingVendors(pending)}>{applyingSuggestion?'Adding…':('＋ Add '+(pending.length>1?'these vendors':'this vendor'))}</button>
          </div>
        ); })()}
        {eventVendors.length===0&&!costingSuggestion.length&&<div style={{fontSize:13,color:'var(--grey-400)'}}>No vendors added yet.</div>}
        {eventVendors.map(v=>{ const st={pending:{bg:'var(--grey-100)',color:'var(--grey-400)'},partially_paid:{bg:'var(--orange-light)',color:'var(--orange)'},paid:{bg:'var(--green-light)',color:'var(--green)'}}[v.status]||{bg:'var(--grey-100)',color:'var(--grey-400)'}; const insts=(eventInstallments[v.event_vendor_id]||[]); const anyOverdue=insts.some(isVendorInstOverdue); const open=expandedVendor===v.event_vendor_id; return (
          <div key={v.event_vendor_id} style={{borderTop:'1px solid var(--grey-100)'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 90px 90px 96px 110px',gap:8,alignItems:'center',padding:'9px 0',fontSize:13}}>
              <div><div style={{fontWeight:500,display:'flex',alignItems:'center',gap:6}}>{insts.length>0&&<span style={{cursor:'pointer',color:'var(--grey-400)',display:'inline-flex',alignItems:'center'}} onClick={()=>setExpandedVendor(open?null:v.event_vendor_id)}>{open?'▾':'▸'}</span>}<VendorLink vendorId={v.vendor_id} name={v.vendor_name} onNavigate={onNavigate} style={{fontWeight:500}}>{v.vendor_name||'Vendor'}</VendorLink>{anyOverdue&&<span style={{fontSize:10,padding:'1px 7px',borderRadius:10,background:'var(--red)',color:'white'}}>OVERDUE</span>}<span title="Edit / swap / remove vendor" onClick={()=>openEditEngage(v)} style={{cursor:'pointer',color:'var(--grey-400)',fontSize:12}}>✏️</span></div>{v.service_description&&<div style={{fontSize:12,color:'var(--grey-400)',marginLeft:insts.length>0?16:0}}>{v.service_description}</div>}</div>
              <div style={{textAlign:'right'}}>₹{Math.round(parseFloat(v.agreed_amount)||0).toLocaleString('en-IN')}</div>
              <div style={{textAlign:'right'}}>₹{Math.round(parseFloat(v.total_paid)||0).toLocaleString('en-IN')}</div>
              <div style={{textAlign:'right',color:(parseFloat(v.outstanding)||0)>0?'var(--red)':'var(--grey-800)'}}>₹{Math.round(parseFloat(v.outstanding)||0).toLocaleString('en-IN')}</div>
              <div style={{textAlign:'right',display:'flex',gap:6,justifyContent:'flex-end',alignItems:'center'}}><span style={{fontSize:11,padding:'2px 8px',borderRadius:12,background:st.bg,color:st.color,textTransform:'capitalize'}}>{(v.status||'').replace('_',' ')}</span>{(parseFloat(v.outstanding)||0)>0&&<button className="btn sm" style={{fontSize:11,padding:'2px 8px'}} onClick={()=>openPayInstallment(v,null)}>+ Pay</button>}{(parseFloat(v.total_paid)||0)>0&&<button className="btn sm" style={{fontSize:11,padding:'2px 8px'}} title="Record a refund the vendor returned" onClick={()=>openVendorRefund(v)}>↩ Refund</button>}</div>
            </div>
            {open&&<div style={{background:'var(--grey-50)',borderRadius:'var(--radius-md)',padding:'8px 12px',margin:'0 0 8px',marginLeft:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}><div style={{fontSize:11,fontWeight:600,color:'var(--grey-400)',textTransform:'uppercase',letterSpacing:'.04em'}}>Payment schedule</div><button className="btn sm" style={{fontSize:11,padding:'2px 8px'}} onClick={()=>openInstEditor(v,null)}>+ Add installment</button></div>
              {insts.length===0&&<div style={{fontSize:12,color:'var(--grey-400)',padding:'4px 0'}}>No schedule yet — add installments with due dates to track what's due.</div>}
              {insts.map(it=>{ const bal=vendorInstBalance(it); const od=isVendorInstOverdue(it); const ds=isVendorInstDueSoon(it,5); const paidFull=bal<=0.5; return (
                <div key={it.installment_id} style={{display:'grid',gridTemplateColumns:'1fr 84px 84px 150px',gap:8,alignItems:'center',padding:'6px 0',borderTop:'1px solid var(--grey-100)',fontSize:12.5}}>
                  <div>{it.label||('Installment '+it.installment_number)}<div style={{fontSize:11,color:od?'var(--red)':'var(--grey-400)'}}>{it.due_date?('due '+fmtDate(it.due_date,{day:'numeric',month:'short'})):'no due date'}{od&&' · OVERDUE'}{!od&&ds&&' · due soon'}{paidFull&&' · paid'}</div></div>
                  <div style={{textAlign:'right'}}>₹{Math.round(parseFloat(it.amount_due)||0).toLocaleString('en-IN')}</div>
                  <div style={{textAlign:'right',color:bal>0?'var(--red)':'var(--green)'}}>{paidFull?'paid':('₹'+Math.round(bal).toLocaleString('en-IN'))}</div>
                  <div style={{textAlign:'right',display:'flex',gap:6,justifyContent:'flex-end',alignItems:'center'}}>
                    {!paidFull&&<button className="btn sm" style={{fontSize:11,padding:'2px 8px',background:od?'var(--pink)':undefined,color:od?'white':undefined,borderColor:od?'var(--pink)':undefined}} onClick={()=>openPayInstallment(v,it)}>Pay</button>}
                    <span onClick={()=>openInstEditor(v,it)} title="Edit" style={{cursor:'pointer',color:'var(--grey-400)'}}>✏️</span>
                    {(parseFloat(it.amount_paid)||0)<=0&&<span onClick={()=>deleteInstallment(it)} title="Remove" style={{cursor:'pointer',color:'var(--grey-400)'}}>🗑</span>}
                  </div>
                </div>
              ); })}
            </div>}
          </div>
        ); })}
        {voidedPays.length>0&&<div style={{marginTop:12,borderTop:'1px dashed var(--grey-200)',paddingTop:10}}>
          <div style={{fontSize:11,fontWeight:600,color:'var(--grey-400)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:4}}>Voided vendor payments <span style={{fontWeight:400}}>(audit)</span></div>
          {voidedPays.map(p=><div key={p.payment_id||p.vendor_payment_id||p.voided_at} style={{fontSize:12,color:'var(--grey-400)',padding:'3px 0',textDecoration:'none'}}><span style={{textDecoration:'line-through'}}>₹{Math.round(parseFloat(p.amount)||0).toLocaleString('en-IN')}</span> · {p.payment_date?fmtDate(p.payment_date,{day:'numeric',month:'short',year:'numeric'}):''} · voided{p.voided_at?(' '+fmtDate(p.voided_at,{day:'numeric',month:'short'})):''}{p.void_reason?(' — '+p.void_reason):''}</div>)}
        </div>}
      </div>
      {showAddVendor&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1100,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'60px 20px'}} onClick={e=>{if(e.target===e.currentTarget)setShowAddVendor(false);}}>
          <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:460}}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid var(--grey-100)',fontSize:15,fontWeight:600,color:'var(--grey-800)'}}>Add vendor to this event</div>
            <div style={{padding:20,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div style={{gridColumn:'1 / -1',display:'flex',gap:6}}>
                <button className={'btn sm'+(vForm.mode==='existing'?' primary':'')} style={{flex:1}} onClick={()=>setVForm(f=>({...f,mode:'existing'}))}>Pick existing</button>
                <button className={'btn sm'+(vForm.mode==='new'?' primary':'')} style={{flex:1}} onClick={()=>setVForm(f=>({...f,mode:'new'}))}>+ New vendor</button>
              </div>
              {vForm.mode==='existing'
                ? <div style={{gridColumn:'1 / -1'}}><label className="field-label">Vendor <span style={{color:'var(--pink)'}}>*</span></label><select className="field-input" value={vForm.vendorId} onChange={e=>{const v=vendorMaster.find(x=>String(x.vendor_id)===e.target.value); setVForm(f=>({...f,vendorId:e.target.value,category:v&&v.category?v.category:f.category}));}}><option value="">Select an active vendor…</option>{vendorMaster.filter(v=>!eventVendors.some(ev=>String(ev.vendor_id)===String(v.vendor_id))).map(v=><option key={v.vendor_id} value={v.vendor_id}>{v.name}{v.category?(' · '+(VENDOR_CATS.find(c=>c[0]===v.category)||[])[1]||v.category):''}</option>)}</select></div>
                : <div style={{gridColumn:'1 / -1'}}><label className="field-label">Vendor name <span style={{color:'var(--pink)'}}>*</span></label><input className="field-input" value={vForm.vendorName} onChange={e=>setVForm(f=>({...f,vendorName:e.target.value}))} placeholder="e.g. Blooms Decor"/></div>}
              <div><label className="field-label">Category</label><select className="field-input" value={vForm.category} onChange={e=>setVForm(f=>({...f,category:e.target.value}))}>{VENDOR_CATS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
              <div><label className="field-label">Agreed amount (₹)</label><input type="number" className="field-input" value={vForm.agreed} onChange={e=>setVForm(f=>({...f,agreed:e.target.value}))} placeholder="0"/></div>
              <div style={{gridColumn:'1 / -1'}}><label className="field-label">Service</label><input className="field-input" value={vForm.service} onChange={e=>setVForm(f=>({...f,service:e.target.value}))} placeholder="e.g. Mandap & florals"/></div>
            </div>
            <div style={{padding:'14px 20px',borderTop:'1px solid var(--grey-100)',display:'flex',justifyContent:'flex-end',gap:8}}><button className="btn" onClick={()=>setShowAddVendor(false)}>Cancel</button><button className="btn primary" disabled={vSaving} onClick={submitAddVendor}>{vSaving?'Saving…':'Add vendor'}</button></div>
          </div>
        </div>
      )}
      {payVendorFor&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1100,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'60px 20px'}} onClick={e=>{if(e.target===e.currentTarget){setPayVendorFor(null);setPayInst(null);}}}>
          <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:440}}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid var(--grey-100)',fontSize:15,fontWeight:600,color:'var(--grey-800)'}}>Pay {payVendorFor.vendor_name||'vendor'} <span style={{fontSize:12,fontWeight:400,color:'var(--grey-400)'}}>· {payInst?((payInst.label||('Installment '+payInst.installment_number))+' · balance ₹'+Math.round(vendorInstBalance(payInst)).toLocaleString('en-IN')):('balance ₹'+Math.round(parseFloat(payVendorFor.outstanding)||0).toLocaleString('en-IN'))}</span></div>
            <div style={{padding:20,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div><label className="field-label">Amount (₹) <span style={{color:'var(--pink)'}}>*</span></label><input type="number" className="field-input" value={vPay.amount} onChange={e=>setVPay(f=>({...f,amount:e.target.value}))} placeholder="0"/></div>
              <div><label className="field-label">Date</label><input type="date" className="field-input" value={vPay.date} onChange={e=>setVPay(f=>({...f,date:e.target.value}))}/></div>
              <div><label className="field-label">Mode</label><select className="field-input" value={vPay.mode} onChange={e=>setVPay(f=>({...f,mode:e.target.value}))}>{VENDOR_MODES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
              <div><label className="field-label">Reference</label><input className="field-input" value={vPay.reference} onChange={e=>setVPay(f=>({...f,reference:e.target.value}))} placeholder="optional"/></div>
            </div>
            <div style={{padding:'14px 20px',borderTop:'1px solid var(--grey-100)',display:'flex',justifyContent:'flex-end',gap:8}}><button className="btn" onClick={()=>{setPayVendorFor(null);setPayInst(null);}}>Cancel</button><button className="btn primary" disabled={vSaving} onClick={submitVendorPayment}>{vSaving?'Saving…':'Record payment'}</button></div>
          </div>
        </div>
      )}
      {refundFor&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1100,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'60px 20px'}} onClick={e=>{if(e.target===e.currentTarget)setRefundFor(null);}}>
          <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:420}}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid var(--grey-100)',fontSize:15,fontWeight:600,color:'var(--grey-800)'}}>Record vendor refund <span style={{fontSize:12,fontWeight:400,color:'var(--grey-400)'}}>· {refundFor.vendor_name||'vendor'} · paid ₹{Math.round(parseFloat(refundFor.total_paid)||0).toLocaleString('en-IN')}</span></div>
            <div style={{padding:20,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div><label className="field-label">Refund amount (₹) <span style={{color:'var(--pink)'}}>*</span></label><input type="number" className="field-input" value={refundForm.amount} onChange={e=>setRefundForm(f=>({...f,amount:e.target.value}))} placeholder="0"/></div>
              <div><label className="field-label">Date</label><input type="date" className="field-input" value={refundForm.date} onChange={e=>setRefundForm(f=>({...f,date:e.target.value}))}/></div>
              <div style={{gridColumn:'1 / -1'}}><label className="field-label">Reason <span style={{color:'var(--pink)'}}>*</span></label><input className="field-input" value={refundForm.reason} onChange={e=>setRefundForm(f=>({...f,reason:e.target.value}))} placeholder="e.g. Vendor returned advance after cancellation"/></div>
            </div>
            <div style={{padding:'14px 20px',borderTop:'1px solid var(--grey-100)',display:'flex',justifyContent:'flex-end',gap:8}}><button className="btn" onClick={()=>setRefundFor(null)}>Cancel</button><button className="btn primary" disabled={vSaving} onClick={submitVendorRefund}>{vSaving?'Saving…':'Record refund'}</button></div>
          </div>
        </div>
      )}
      {instFor&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1100,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'60px 20px'}} onClick={e=>{if(e.target===e.currentTarget)setInstFor(null);}}>
          <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:420}}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid var(--grey-100)',fontSize:15,fontWeight:600,color:'var(--grey-800)'}}>{instForm.id?'Edit installment':'Add installment'} <span style={{fontSize:12,fontWeight:400,color:'var(--grey-400)'}}>· {instFor.vendor_name||'vendor'}</span></div>
            <div style={{padding:20,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div style={{gridColumn:'1 / -1'}}><label className="field-label">Label</label><input className="field-input" value={instForm.label} onChange={e=>setInstForm(f=>({...f,label:e.target.value}))} placeholder="e.g. Advance, Pre-event, Final"/></div>
              <div><label className="field-label">Amount (₹) <span style={{color:'var(--pink)'}}>*</span></label><input type="number" className="field-input" value={instForm.amount} onChange={e=>setInstForm(f=>({...f,amount:e.target.value}))} placeholder="0"/></div>
              <div><label className="field-label">Due date</label><input type="date" className="field-input" value={instForm.due_date} onChange={e=>setInstForm(f=>({...f,due_date:e.target.value}))}/></div>
              {(()=>{ const sched=(eventInstallments[instFor.event_vendor_id]||[]); const others=sched.filter(x=>x.installment_id!==instForm.id).reduce((s,x)=>s+(parseFloat(x.amount_due)||0),0); const tot=others+(parseFloat(instForm.amount)||0); const agreed=parseFloat(instFor.agreed_amount)||0; const diff=tot-agreed; return <div style={{gridColumn:'1 / -1',fontSize:12,color:Math.abs(diff)<1?'var(--grey-400)':'var(--orange)'}}>Scheduled total ₹{Math.round(tot).toLocaleString('en-IN')} vs agreed ₹{Math.round(agreed).toLocaleString('en-IN')}{Math.abs(diff)<1?' · matches':(diff>0?(' · ₹'+Math.round(diff).toLocaleString('en-IN')+' over'):(' · ₹'+Math.round(-diff).toLocaleString('en-IN')+' unallocated'))}</div>; })()}
            </div>
            <div style={{padding:'14px 20px',borderTop:'1px solid var(--grey-100)',display:'flex',justifyContent:'flex-end',gap:8}}><button className="btn" onClick={()=>setInstFor(null)}>Cancel</button><button className="btn primary" disabled={vSaving} onClick={submitInstallment}>{vSaving?'Saving…':(instForm.id?'Save':'Add')}</button></div>
          </div>
        </div>
      )}
      {editEngage&&(()=>{ const paid=parseFloat(editEngage.total_paid)||0; const opts=[{id:String(editEngage.vendor_id||''),name:editEngage.vendor_name||'(current)'}].concat(vendorMaster.filter(m=>String(m.vendor_id)!==String(editEngage.vendor_id)&&!eventVendors.some(ev=>String(ev.vendor_id)===String(m.vendor_id)&&!ev.is_deleted)).map(m=>({id:String(m.vendor_id),name:m.name}))); return (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1100,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'60px 20px'}} onClick={e=>{if(e.target===e.currentTarget)setEditEngage(null);}}>
          <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:440}}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid var(--grey-100)',fontSize:15,fontWeight:600,color:'var(--grey-800)'}}>Edit vendor on this event</div>
            <div style={{padding:20,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div style={{gridColumn:'1 / -1'}}><label className="field-label">Vendor</label><select className="field-input" value={engForm.vendorId} disabled={paid>0} onChange={e=>setEngForm(f=>({...f,vendorId:e.target.value}))}>{opts.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>{paid>0&&<div style={{fontSize:11,color:'var(--grey-400)',marginTop:3}}>Locked — ₹{Math.round(paid).toLocaleString('en-IN')} already paid to this vendor. Remove payments to swap, or remove + re-add.</div>}</div>
              <div style={{gridColumn:'1 / -1'}}><label className="field-label">Service</label><input className="field-input" value={engForm.service} onChange={e=>setEngForm(f=>({...f,service:e.target.value}))} placeholder="e.g. Mandap & florals"/></div>
              <div><label className="field-label">Agreed amount (₹)</label><input type="number" className="field-input" value={engForm.agreed} onChange={e=>setEngForm(f=>({...f,agreed:e.target.value}))} placeholder="0"/></div>
              <div style={{display:'flex',alignItems:'flex-end',fontSize:11,color:'var(--grey-400)'}}>{paid>0?('Paid ₹'+Math.round(paid).toLocaleString('en-IN')+' · balance updates to agreed − paid.'):'No payments yet.'}</div>
            </div>
            <div style={{padding:'14px 20px',borderTop:'1px solid var(--grey-100)',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
              <button className="btn sm" style={{color:'var(--red)',borderColor:'rgba(163,45,45,0.3)'}} disabled={vSaving} title={paid>0?'Remove + void recorded payments (reason required)':'Remove from event'} onClick={()=>removeEngage(editEngage)}>🗑 {paid>0?'Remove & void payments':'Remove'}</button>
              <div style={{display:'flex',gap:8}}><button className="btn" onClick={()=>setEditEngage(null)}>Cancel</button><button className="btn primary" disabled={vSaving} onClick={submitEditEngage}>{vSaving?'Saving…':'Save'}</button></div>
            </div>
          </div>
        </div>
      ); })()}
      {removeReasonFor&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1200,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'80px 20px'}} onClick={e=>{if(e.target===e.currentTarget)setRemoveReasonFor(null);}}>
          <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:420}}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid var(--grey-100)',fontSize:15,fontWeight:600,color:'var(--grey-800)'}}>Remove {removeReasonFor.vendor_name||'vendor'} &amp; void payments</div>
            <div style={{padding:20}}>
              <div style={{fontSize:13,color:'var(--grey-600)',marginBottom:10}}>₹{Math.round(parseFloat(removeReasonFor.total_paid)||0).toLocaleString('en-IN')} has been recorded against this vendor. Removing will <b>void those payments</b> (kept as an audit record, excluded from totals &amp; reports). This can't be undone in the app.</div>
              <label className="field-label">Reason for voiding <span style={{color:'var(--pink)'}}>*</span></label>
              <textarea className="field-textarea" rows={3} value={removeReason} onChange={e=>setRemoveReason(e.target.value)} placeholder="e.g. Wrong vendor selected, paid in error; refund received."/>
            </div>
            <div style={{padding:'14px 20px',borderTop:'1px solid var(--grey-100)',display:'flex',justifyContent:'flex-end',gap:8}}><button className="btn" onClick={()=>setRemoveReasonFor(null)}>Cancel</button><button className="btn primary" disabled={vSaving} style={{background:'var(--red)',borderColor:'var(--red)'}} onClick={confirmVoidRemove}>{vSaving?'Removing…':'Void & remove'}</button></div>
          </div>
        </div>
      )}
      {showCancel&&(()=>{
        const activeInv=(invoices||[]).filter(i=>i.status!=='cancelled');
        const billed=activeInv.reduce((s,i)=>s+(parseFloat(i.grand_total)||0),0);
        const collected=activeInv.reduce((s,i)=>s+(parseFloat(i.total_received)||0),0);
        const unpaidCount=activeInv.filter(i=>(parseFloat(i.total_received)||0)<=0).length;
        const paidCount=activeInv.length-unpaidCount;
        const vAgreed=(eventVendors||[]).reduce((s,v)=>s+(parseFloat(v.agreed_amount)||0),0);
        const vPaid=(eventVendors||[]).reduce((s,v)=>s+(parseFloat(v.total_paid)||0),0);
        const dueInst=Object.values(eventInstallments||{}).reduce((s,arr)=>s+arr.filter(it=>vendorInstBalance(it)>0.5).length,0);
        const inr=n=>'₹'+Math.round(n||0).toLocaleString('en-IN');
        return (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 20px',overflowY:'auto'}} onClick={e=>{if(e.target===e.currentTarget)setShowCancel(false);}}>
          <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:580}}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid var(--grey-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}><div style={{fontSize:15,fontWeight:600,color:'var(--grey-800)'}}>⛔ Cancel event — {event.ref_number} · {event.name}</div><button className="btn sm" onClick={()=>setShowCancel(false)}>✕</button></div>
            <div style={{padding:'16px 20px'}}>
              {collected>0&&<div style={{background:'var(--red-light)',border:'1px solid rgba(163,45,45,0.25)',borderRadius:'var(--radius-md)',padding:'10px 12px',fontSize:12,color:'var(--red)',marginBottom:14}}>⚠ {inr(collected)} has been collected on this event. Cancelling keeps the paid invoice as a record and flags a refund to arrange offline — the app does not move money.</div>}
              <div style={{fontSize:11,fontWeight:600,color:'var(--grey-400)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:8}}>What will be affected</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14}}>
                <div style={{background:'var(--grey-50)',borderRadius:'var(--radius-md)',padding:'10px 12px',fontSize:12.5}}><div style={{color:'var(--grey-400)',fontSize:12}}>🧾 Invoices</div>{activeInv.length} · {inr(billed)} billed · <span style={{color:'var(--green)'}}>{inr(collected)} collected</span></div>
                <div style={{background:'var(--grey-50)',borderRadius:'var(--radius-md)',padding:'10px 12px',fontSize:12.5}}><div style={{color:'var(--grey-400)',fontSize:12}}>🔧 Vendors</div>{(eventVendors||[]).length} · {inr(vPaid)} paid · {dueInst} due installment{dueInst===1?'':'s'}</div>
                <div style={{background:'var(--grey-50)',borderRadius:'var(--radius-md)',padding:'10px 12px',fontSize:12.5}}><div style={{color:'var(--grey-400)',fontSize:12}}>💰 Expenses</div>{inr(expTotal)} (kept as sunk cost)</div>
                <div style={{background:'var(--grey-50)',borderRadius:'var(--radius-md)',padding:'10px 12px',fontSize:12.5}}><div style={{color:'var(--grey-400)',fontSize:12}}>🎪 Sub-events · Lead</div>{(subEvents||[]).length} sub-event{(subEvents||[]).length===1?'':'s'}{linkedLead?(' · '+(linkedLead.ref_number||'lead')):''}</div>
              </div>
              {cancelInvList.length>0&&<div style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--grey-400)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:6}}>Client money collected — refund or retain? <span style={{color:'var(--red)'}}>*</span></div>
                {cancelInvList.map(i=>{ const h=invHandling[i.invoice_id]||{}; const recv=Math.round(parseFloat(i.total_received)||0); return (
                  <div key={i.invoice_id} style={{padding:'7px 0',borderTop:'1px solid var(--grey-100)',fontSize:12.5}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span>{i.ref_number} <span style={{color:'var(--grey-400)'}}>· {inr(recv)} collected</span></span></div>
                    <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                      <button className={'btn sm'+(h.mode==='refund'?' primary':'')} style={{fontSize:11,padding:'2px 10px'}} onClick={()=>setInvHandling(p=>({...p,[i.invoice_id]:{...p[i.invoice_id],mode:'refund'}}))}>Refund to client</button>
                      <button className={'btn sm'+(h.mode==='retain'?' primary':'')} style={{fontSize:11,padding:'2px 10px'}} onClick={()=>setInvHandling(p=>({...p,[i.invoice_id]:{...p[i.invoice_id],mode:'retain'}}))}>Retain (keep)</button>
                      {h.mode==='refund'&&<span style={{fontSize:11,color:'var(--grey-400)'}}>₹<input type="number" value={h.amount} onChange={e=>setInvHandling(p=>({...p,[i.invoice_id]:{...p[i.invoice_id],amount:e.target.value}}))} style={{width:90,padding:'2px 6px',border:'1px solid var(--grey-200)',borderRadius:4,fontSize:12}}/> refunded {parseFloat(h.amount)<recv?('· '+inr(recv-(parseFloat(h.amount)||0))+' retained'):''}</span>}
                    </div>
                  </div>
                ); })}
              </div>}
              {cancelVenList.length>0&&<div style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--grey-400)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:6}}>Vendor money paid — recovered or lost? <span style={{color:'var(--red)'}}>*</span></div>
                {cancelVenList.map(v=>{ const h=venHandling[v.event_vendor_id]||{}; const paid=Math.round(parseFloat(v.total_paid)||0); return (
                  <div key={v.event_vendor_id} style={{padding:'7px 0',borderTop:'1px solid var(--grey-100)',fontSize:12.5}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span>{v.vendor_name||'Vendor'} <span style={{color:'var(--grey-400)'}}>· {inr(paid)} paid</span></span></div>
                    <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                      <button className={'btn sm'+(h.mode==='recover'?' primary':'')} style={{fontSize:11,padding:'2px 10px'}} onClick={()=>setVenHandling(p=>({...p,[v.event_vendor_id]:{...p[v.event_vendor_id],mode:'recover'}}))}>Recovered (reverse)</button>
                      <button className={'btn sm'+(h.mode==='lost'?' primary':'')} style={{fontSize:11,padding:'2px 10px'}} onClick={()=>setVenHandling(p=>({...p,[v.event_vendor_id]:{...p[v.event_vendor_id],mode:'lost'}}))}>Lost — write off</button>
                      {h.mode==='recover'&&<span style={{fontSize:11,color:'var(--grey-400)'}}>₹<input type="number" value={h.amount} onChange={e=>setVenHandling(p=>({...p,[v.event_vendor_id]:{...p[v.event_vendor_id],amount:e.target.value}}))} style={{width:90,padding:'2px 6px',border:'1px solid var(--grey-200)',borderRadius:4,fontSize:12}}/> recovered {parseFloat(h.amount)<paid?('· '+inr(paid-(parseFloat(h.amount)||0))+' lost'):''}</span>}
                    </div>
                  </div>
                ); })}
              </div>}
              <div style={{fontSize:12,lineHeight:1.7,marginBottom:14,color:'var(--grey-400)'}}>
                {unpaidCount>0&&<div>• Void {unpaidCount} unpaid invoice{unpaidCount===1?'':'s'} → cancelled</div>}
                {dueInst>0&&<div>• Cancel {dueInst} unpaid vendor installment{dueInst===1?'':'s'} (stops overdue alerts)</div>}
                <div>• Keep {inr(expTotal)} expenses as records (sunk cost in Reports)</div>
                {linkedLead&&<div>• Add a dated note to lead {linkedLead.ref_number||''}</div>}
              </div>
              {linkedLead&&<div style={{marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--grey-400)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:6}}>Source lead {linkedLead.ref_number||''}</div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {[['leave','Leave as-is'],['reopen','Reopen → Contacted'],['lost','Mark Lost']].map(([v,l])=>(
                    <button key={v} className={'btn sm'+(leadAction===v?' primary':'')} style={{fontSize:11,padding:'3px 10px'}} onClick={()=>setLeadAction(v)}>{l}</button>
                  ))}
                </div>
              </div>}
              <label className="field-label">Reason for cancellation <span style={{color:'var(--pink)'}}>*</span></label>
              <textarea className="field-textarea" rows={2} value={cancelReason} onChange={e=>setCancelReason(e.target.value)} placeholder="e.g. Client postponed indefinitely; date clash; budget withdrawn."/>
            </div>
            <div style={{padding:'14px 20px',borderTop:'1px solid var(--grey-100)',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
              <span style={{fontSize:11,color:'var(--grey-400)'}}>Reversible — you can reopen later (status only)</span>
              <div style={{display:'flex',gap:8}}><button className="btn" onClick={()=>setShowCancel(false)}>Keep event</button><button className="btn primary" disabled={cancelling||!cancelReason.trim()||!cancelChoicesComplete} title={!cancelChoicesComplete?'Mark every client and vendor payment first':''} style={{background:'var(--red)',borderColor:'var(--red)'}} onClick={doCancelEvent}>{cancelling?'Cancelling…':'Cancel this event'}</button></div>
            </div>
          </div>
        </div>
        ); })()}
    </div>
  );

  // ── EDIT MODE ────────────────────────────────────────────────────────────────
  return (
    <div>
      {header}
      <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'20px 24px',border:'1px solid var(--grey-100)',marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)',marginBottom:16}}>Event details</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14,marginBottom:14}}>
          <EvtInput label="Event name" required value={form.name} onChange={v=>setF('name',v)} error={errors.name}/>
          <EvtSelect label="Event type" value={form.type} onChange={v=>setF('type',v)} options={typeOpts}/>
          <EvtSelect label="Status" value={form.status} onChange={v=>setF('status',v)} options={statusOpts}/>
          <EvtInput label="Main event date" required type="date" value={form.main_date} onChange={v=>setF('main_date',v)} error={errors.main_date}/>
          <EvtAutoInput label="Location" required value={form.location} onChange={v=>setF('location',v)} placeholder="e.g. Hyderabad" table="events" column="location"/>
          <EvtInput label="Guest count" type="number" value={form.guest_count} onChange={v=>setF('guest_count',v)}/>
          <EvtInput label="Budget (₹)" type="number" value={form.budget} onChange={v=>setF('budget',v)}/>
          <EvtSelect label="Assigned staff" value={form.assigned_staff_id||''} onChange={v=>{
            const s=staffList.find(x=>x.user_id===v);
            setF('assigned_staff_id',v);
            setForm(f=>({...f,assigned_staff_name:s?s.first_name+' '+s.last_name:''}));
          }} options={staffOpts} placeholder="Select staff..."/>
          <EvtSelect label="Primary contact" value={form.primary_contact_id||''} onChange={v=>{
            const ac=altContacts.find(x=>x.contact_id===v);
            setF('primary_contact_id',v);
            setForm(f=>({...f,primary_contact_name:ac?ac.first_name+' '+ac.last_name:event.client_name}));
          }} options={contactOpts} placeholder="Client themselves"/>
          <EvtSelect label="Secondary contact" value={form.secondary_contact_id||''} onChange={v=>{
            const ac=altContacts.find(x=>x.contact_id===v);
            setF('secondary_contact_id',v);
            setForm(f=>({...f,secondary_contact_name:ac?ac.first_name+' '+ac.last_name:''}));
          }} options={[{value:'',label:'None'},...altContacts.map(ac=>({value:ac.contact_id,label:ac.first_name+' '+ac.last_name+' ('+ac.relationship+')'}))]} placeholder="None"/>
        </div>
        <EvtTextarea label="Internal notes" value={form.internal_notes} onChange={v=>setF('internal_notes',v)} placeholder="Any internal notes..."/>
      </div>

      {/* Sub-events edit */}
      <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'16px 20px',border:'1px solid var(--grey-100)',marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)'}}>Sub-events & items</div>
          <button className="btn sm" style={{border:'1px dashed var(--grey-200)',color:'var(--grey-400)'}}
            onClick={()=>setEditSubEvents(s=>[...s,{id:'new-'+Date.now(),name:'',date:'',location:'',items:[]}])}>+ Add sub-event</button>
        </div>
        {editSubEvents.map((se,si)=>(
          <div key={se.id||se.sub_event_id} style={{background:'var(--grey-50)',borderRadius:'var(--radius-md)',padding:'12px',marginBottom:10,border:'1px solid var(--grey-100)'}}>
            <div style={{display:'flex',gap:8,marginBottom:8,alignItems:'center'}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:'#e8185a',flexShrink:0}}/>
              <SubEventNameInput value={se.name} onChange={v=>setEditSubEvents(s=>s.map((x,i)=>i===si?{...x,name:v}:x))}/>
              <SubEventDateInput value={se.date} onChange={v=>setEditSubEvents(s=>s.map((x,i)=>i===si?{...x,date:v}:x))}/>
              <SubEventLocInput value={se.location} onChange={v=>setEditSubEvents(s=>s.map((x,i)=>i===si?{...x,location:v}:x))}/>
              <SubEventTplBtn templates={evTemplates} onPick={tpl=>loadTemplateIntoEditSub(si,tpl)} onImport={items=>setEditSubEvents(s=>s.map((x,i)=>i===si?{...x,items}:x))}/>
              <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--red)',fontSize:14}}
                onClick={()=>setEditSubEvents(s=>s.filter((_,i)=>i!==si))}>🗑</button>
            </div>
            <FastEntryTable key={se.id||se.sub_event_id} items={se.items||[]} onChange={items=>setEditSubEvents(s=>s.map((x,i)=>i===si?{...x,items}:x))}/>
          </div>
        ))}
        <div style={{marginTop:8,paddingTop:8,borderTop:'1px dashed var(--grey-200)'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
            <div style={{fontSize:12,color:'var(--grey-400)',flex:1}}>Main event items</div>
            <SubEventTplBtn templates={evTemplates} onPick={tpl=>loadTemplateIntoEditMain(tpl)} onImport={items=>setEditMainItems(items)}/>
          </div>
          <FastEntryTable key="main-items" items={editMainItems} onChange={setEditMainItems}/>
        </div>
      </div>
    </div>
  );
}
function NewEventWizard({onSave, onCancel, referenceEvent=null}) {
  const eventTypes = useEventTypes();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [errors, setErrors] = useState({});
  const [clients, setClients] = useState([]);
  const [altContacts, setAltContacts] = useState([]);
  const [clientSearch, setClientSearch] = useState('');
  const [staffList, setStaffList] = useState([]);

  // Step 1 form
  const [form, setForm] = useState({
    name:'', type:'', status:'planning', main_date:'', location:'Hyderabad',
    guest_count:'', budget:'', assigned_staff_id:'', assigned_staff_name:'', internal_notes:''
  });

  // Step 2
  const [selectedClient, setSelectedClient] = useState(null);
  const [primaryContactId, setPrimaryContactId] = useState('client');
  const [primaryContactName, setPrimaryContactName] = useState('');
  const [secondaryContactId, setSecondaryContactId] = useState('');
  const [secondaryContactName, setSecondaryContactName] = useState('');
  const [showClientForm, setShowClientForm] = useState(false);

  // Step 3 - sub events with items
  const [subEvents, setSubEvents] = useState([
    {id:Date.now(), name:'', date:'', location:'', items:[]}
  ]);
  const [mainItems, setMainItems] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [showTplMenu, setShowTplMenu] = useState(false);
  const excelFileRef = React.useRef();

  useEffect(()=>{
    supabase.from('clients').select('client_id,first_name,last_name,phone_1,status').eq('is_deleted',false).neq('status','inactive').order('first_name').then(({data})=>{ if(data) setClients(data); });
    supabase.from('users').select('user_id,first_name,last_name,role').eq('status','active').then(({data})=>{ if(data) setStaffList(data); });
    supabase.from('event_templates').select('*').eq('is_deleted',false).eq('is_active',true).order('name').then(({data})=>{ if(data) setTemplates(data); });
    // Pre-fill from reference event if provided
    if(referenceEvent){
      setForm(f=>({...f,
        type:referenceEvent.type||'',
        location:referenceEvent.location||'',
        guest_count:referenceEvent.guest_count||'',
        assigned_staff_id:referenceEvent.assigned_staff_id||'',
        assigned_staff_name:referenceEvent.assigned_staff_name||'',
        internal_notes:referenceEvent.internal_notes?`[Based on: ${referenceEvent.name}] ${referenceEvent.internal_notes}`:`Based on: ${referenceEvent.name}`,
        name:'', main_date:'', budget:'', status:'planning'
      }));
      // Load sub-events and items from reference event
      Promise.all([
        supabase.from('sub_events').select('*').eq('event_id',referenceEvent.event_id).eq('is_deleted',false).order('sort_order'),
        supabase.from('sub_event_items').select('*').eq('event_id',referenceEvent.event_id).eq('is_deleted',false).order('sort_order'),
      ]).then(([{data:subs},{data:items}])=>{
        if(subs&&items){
          const grouped = subs.map(se=>({
            id:'se-ref-'+se.sub_event_id+Date.now(),
            name:se.name, date:'', location:se.location||'',
            items:items.filter(i=>i.sub_event_id===se.sub_event_id).map(i=>({
              id:'i-ref-'+i.item_id+Math.random(),
              description:i.description, quantity:i.quantity, unit_price:0
            }))
          }));
          setSubEvents(grouped.length>0?grouped:[{id:Date.now(),name:'',date:'',location:'',items:[]}]);
          const mainItems = items.filter(i=>!i.sub_event_id).map(i=>({
            id:'i-ref-'+i.item_id+Math.random(),
            description:i.description, quantity:i.quantity, unit_price:0
          }));
          setMainItems(mainItems);
        }
      });
    }
  },[]);

  useEffect(()=>{
    if(selectedClient){
      supabase.from('alternative_contacts').select('*').eq('client_id',selectedClient.client_id).eq('is_deleted',false).then(({data})=>{ if(data) setAltContacts(data); });
      setPrimaryContactId('client');
      setPrimaryContactName(`${selectedClient.first_name} ${selectedClient.last_name}`);
      setSecondaryContactId('');
      setSecondaryContactName('');
    }
  },[selectedClient]);

  const setF = (field, val) => {
    setForm(f=>({...f,[field]:val}));
    if(errors[field]) setErrors(e=>({...e,[field]:''}));
    setSaveError('');
  };

  const validateStep1 = () => {
    const e={};
    if(!form.name?.trim()) e.name='Event name is required';
    if(!form.type) e.type='Event type is required';
    if(!form.main_date) e.main_date='Main event date is required';
    if(!form.location?.trim()) e.location='Location is required';
    return e;
  };

  const validateStep2 = () => {
    const e={};
    if(!selectedClient) e.client='Please select a client';
    return e;
  };

  const nextStep = () => {
    if(step===1){ const e=validateStep1(); if(Object.keys(e).length>0){setErrors(e);return;} }
    if(step===2){ const e=validateStep2(); if(Object.keys(e).length>0){setErrors(e);return;} }
    setErrors({});
    setStep(s=>s+1);
  };

  const addSubEvent = () => setSubEvents(s=>[...s,{id:Date.now(),name:'',date:'',location:'',items:[]}]);
  const removeSubEvent = (id) => setSubEvents(s=>s.filter(se=>se.id!==id));
  const updateSubEvent = (id, field, val) => setSubEvents(s=>s.map(se=>se.id===id?{...se,[field]:val}:se));
  const updateSubItems = (id, items) => setSubEvents(s=>s.map(se=>se.id===id?{...se,items}:se));

  const grandTotal = subEvents.reduce((s,se)=>s+se.items.reduce((ss,r)=>ss+(parseFloat(r.quantity)||0)*(parseFloat(r.unit_price)||0),0),0)
    + mainItems.reduce((s,r)=>s+(parseFloat(r.quantity)||0)*(parseFloat(r.unit_price)||0),0);

  const loadTemplate = async (tpl) => {
    if(subEvents.some(se=>se.items.length>0)||mainItems.length>0){
      if(!window.confirm('Loading a template will replace current sub-events and items. Continue?')) return;
    }
    setShowTplMenu(false);
    const {data} = await supabase.from('event_template_items').select('*').eq('template_id',tpl.template_id).order('sub_event_name').order('sort_order');
    if(!data) return;
    const groups = {};
    data.forEach(item=>{
      if(!groups[item.sub_event_name]) groups[item.sub_event_name]={id:'se-'+item.sub_event_name+Date.now(),name:item.sub_event_name,date:'',location:'',items:[]};
      if(item.sub_event_name!=='Main Event'){
        groups[item.sub_event_name].items.push({id:'i-'+item.item_id,description:item.description,quantity:item.default_quantity,unit_price:0});
      }
    });
    const mainEventItems = data.filter(i=>i.sub_event_name==='Main Event').map(i=>({id:'i-'+i.item_id,description:i.description,quantity:i.default_quantity,unit_price:0}));
    const ses = Object.values(groups).filter(g=>g.name!=='Main Event');
    setSubEvents(ses.length>0?ses:[{id:'se-'+Date.now(),name:'',date:'',location:'',items:[]}]);
    setMainItems(mainEventItems);
  };
  // Load a template's items into ONE sub-event block (matched by sub-event name, else all template items).
  const loadTemplateIntoSubEvent = async (seId, tpl) => {
    const se = subEvents.find(s=>s.id===seId);
    if(se && (se.items||[]).some(i=>i.description&&i.description.trim()) && !window.confirm('Replace this sub-event’s items with the template?')) return;
    const {data} = await supabase.from('event_template_items').select('*').eq('template_id',tpl.template_id).order('sort_order');
    if(!data) return;
    const seName=((se&&se.name)||'').trim().toLowerCase();
    let src = data.filter(i=>i.sub_event_name!=='Main Event');
    const matched = src.filter(i=>(i.sub_event_name||'').trim().toLowerCase()===seName);
    if(seName && matched.length) src = matched;
    if(src.length===0) src = data; // template had only Main Event items — still let the user pull them in
    const newItems = src.map(i=>({id:'i-'+i.item_id+'-'+Math.random(),description:i.description,quantity:i.default_quantity,unit_price:0}));
    setSubEvents(s=>s.map(x=>x.id===seId?{...x,items:newItems}:x));
  };
  // Load a template's items into the Main event items block (Main Event group, else all template items).
  const loadTemplateIntoMain = async (tpl) => {
    if((mainItems||[]).some(i=>i.description&&i.description.trim()) && !window.confirm('Replace the main event items with the template?')) return;
    const {data} = await supabase.from('event_template_items').select('*').eq('template_id',tpl.template_id).order('sort_order');
    if(!data) return;
    let src = data.filter(i=>(i.sub_event_name||'')==='Main Event');
    if(src.length===0) src = data;
    setMainItems(src.map(i=>({id:'i-'+i.item_id+'-'+Math.random(),description:i.description,quantity:i.default_quantity,unit_price:0})));
  };

  const handleExcelImport = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const sheets = await readWorkbook(evt.target.result);
        const newSubEvents = [];
        sheets.forEach(({ name: sheetName, aoa: data })=>{
          if(data.length<2) return;
          const items = data.slice(1).filter(r=>String(r[0]).trim()).map(r=>({
            id:'i-'+Date.now()+Math.random(),
            description:String(r[0]).trim(),
            quantity:parseFloat(r[1])||1,
            unit_price:parseFloat(r[2])||0
          }));
          if(sheetName==='Main Event') { setMainItems(items); }
          else { newSubEvents.push({id:'se-'+Date.now()+Math.random(),name:sheetName,date:'',location:'',items}); }
        });
        if(newSubEvents.length>0) setSubEvents(s=>[...s,...newSubEvents]);
        notify(`Imported ${sheets.length} sheet(s) successfully!`,'success');
      } catch(err){ notify('Could not read file. Please use the provided template.','error'); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value='';
  };

    const handleSave = async () => {
    setSaving(true); setSaveError('');
    try {
      // Determine primary/secondary contact details
      let primId=null, primName=primaryContactName;
      let secId=null, secName=secondaryContactName;
      if(primaryContactId!=='client'){
        const ac=altContacts.find(a=>a.contact_id===primaryContactId);
        if(ac){primId=ac.contact_id; primName=`${ac.first_name} ${ac.last_name}`;}
      }
      if(secondaryContactId&&secondaryContactId!=='none'){
        const ac=altContacts.find(a=>a.contact_id===secondaryContactId);
        if(ac){secId=ac.contact_id; secName=`${ac.first_name} ${ac.last_name}`;}
      }

      // Insert event
      const evRef = await getNextEventRef();
      const {data:eventData, error:eventError} = await supabase.from('events').insert({
        ref_number:evRef,
        name:form.name, type:form.type.toLowerCase(), status:form.status,
        main_date:form.main_date, location:form.location,
        guest_count:form.guest_count?parseInt(form.guest_count):null,
        budget:form.budget?parseFloat(form.budget):null,
        client_id:selectedClient.client_id,
        client_name:`${selectedClient.first_name} ${selectedClient.last_name}`,
        primary_contact_id:primId, primary_contact_name:primName,
        secondary_contact_id:secId, secondary_contact_name:secName,
        assigned_staff_id:form.assigned_staff_id||null,
        assigned_staff_name:form.assigned_staff_name||null,
        internal_notes:form.internal_notes||null,
        created_at:new Date().toISOString(), updated_at:new Date().toISOString(), is_deleted:false
      }).select().single();
      if(eventError) throw eventError;

      // Insert sub events and their items
      for(const se of subEvents){
        if(!se.name.trim()) continue;
        const {data:seData,error:wsie} = await supabase.from('sub_events').insert({
          event_id:eventData.event_id, name:se.name, date:se.date||null,
          location:se.location||null, sort_order:subEvents.indexOf(se),
          created_at:new Date().toISOString(), is_deleted:false
        }).select().single();
        if(wsie) throw wsie;
        if(seData && se.items.length>0){
          const itemRows = se.items.filter(r=>r.description.trim()).map((r,i)=>({
            sub_event_id:seData.sub_event_id, event_id:eventData.event_id,
            description:r.description, quantity:parseFloat(r.quantity)||1,
            unit_price:parseFloat(r.unit_price)||0,
            sub_items:Array.isArray(r.sub_items)?r.sub_items:[],
            sort_order:i, created_at:new Date().toISOString(), is_deleted:false
          }));
          if(itemRows.length>0){ const {error:irie}=await supabase.from('sub_event_items').insert(itemRows); if(irie) throw irie; }
        }
      }

      // Insert main event items
      const mainRows = mainItems.filter(r=>r.description?.trim()).map((r,i)=>({
        sub_event_id:null, event_id:eventData.event_id,
        description:r.description, quantity:parseFloat(r.quantity)||1,
        unit_price:parseFloat(r.unit_price)||0,
        sub_items:Array.isArray(r.sub_items)?r.sub_items:[],
        sort_order:i, created_at:new Date().toISOString(), is_deleted:false
      }));
      if(mainRows.length>0){ const {error:wmrie}=await supabase.from('sub_event_items').insert(mainRows); if(wmrie) throw wmrie; }

      await onSave(eventData);
    } catch(err){
      console.error('[Isheeka ERP] event creation failed:', err);
      setSaveError('Could not save event. Please try again.');
    } finally { setSaving(false); }
  };

  const handleCreateClient = async (form) => {
    const ref_number = await getNextClientRef();
    const payload = {
      ...form, ref_number,
      preferred_contact: form.preferred_contact||null, source: form.source||null,
      phone_2: form.phone_2||null, phone_3: form.phone_3||null,
      email_2: form.email_2||null, email_3: form.email_3||null,
      gst_number: form.gst_number||null, notes: form.notes||null,
      created_by: form.created_by||null, updated_by: form.updated_by||null, lead_id: form.lead_id||null,
      client_since: new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    };
    const {data,error} = await runDb(supabase.from('clients').insert(payload).select().single(),'create client');
    if(error||!data) return;
    setClients(cs=>[data,...cs]);
    setSelectedClient(data);
    setShowClientForm(false);
    notify('Client created — selected for this event.','success');
  };
  const steps = ['Event details','Client & contact','Sub-events & items','Review & save'];
  const filteredClients = clients.filter(c=>{
    const q=clientSearch.toLowerCase();
    return !q || `${c.first_name} ${c.last_name} ${c.phone_1}`.toLowerCase().includes(q);
  });
  const statusColors = {active:{bg:'var(--green-light)',color:'var(--green)'},inactive:{bg:'var(--grey-100)',color:'var(--grey-400)'},vip:{bg:'var(--pink-light)',color:'var(--pink)'}};

  return (
    <div style={{background:'white',borderRadius:'var(--radius-lg)',border:'1px solid var(--grey-100)',overflow:'hidden'}} onClick={()=>showTplMenu&&setShowTplMenu(false)}>
      {showClientForm&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1200,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 20px',overflowY:'auto'}} onClick={e=>{if(e.target===e.currentTarget) setShowClientForm(false);}}>
          <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:680,boxShadow:'var(--shadow-lg)',padding:'8px 4px'}}>
            <ClientForm title="New client" onSave={handleCreateClient} onCancel={()=>setShowClientForm(false)}/>
          </div>
        </div>
      )}
      {/* Step bar */}
      <div style={{background:'var(--grey-50)',padding:'14px 24px',borderBottom:'1px solid var(--grey-100)',display:'flex',alignItems:'center',gap:0}}>
        {steps.map((s,i)=>(
          <React.Fragment key={i}>
            <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:i+1===step?'#A01044':i+1<step?'var(--green)':'var(--grey-400)',fontWeight:i+1===step?500:400}}>
              <div style={{width:22,height:22,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,flexShrink:0,
                background:i+1===step?'#A01044':i+1<step?'var(--green-light)':'transparent',
                color:i+1===step?'#F4C0D1':i+1<step?'var(--green)':'var(--grey-400)',
                border:i+1<step?'1.5px solid var(--green)':i+1===step?'none':'1.5px solid var(--grey-200)'}}>
                {i+1<step?'✓':i+1}
              </div>
              {s}
            </div>
            {i<steps.length-1&&<div style={{flex:1,height:1,background:'var(--grey-200)',margin:'0 8px'}}/>}
          </React.Fragment>
        ))}
      </div>

      <div style={{padding:24}}>
        {saveError&&<div style={{background:'var(--red-light)',color:'var(--red)',borderRadius:'var(--radius-sm)',padding:'10px 14px',fontSize:13,marginBottom:16,border:'1px solid rgba(163,45,45,0.2)'}}>⚠️ {saveError}</div>}

        {/* Step 1 - Event details */}
        {step===1&&(
          <div>
            {referenceEvent&&<div style={{background:'var(--blue-light)',borderRadius:'var(--radius-md)',padding:'8px 14px',fontSize:12,color:'var(--blue)',marginBottom:12}}>📋 Creating new event based on <strong>{referenceEvent.name}</strong> — original event is not affected. Prices have been reset to ₹0.</div>}
            <div style={{fontSize:14,fontWeight:600,color:'var(--grey-800)',marginBottom:16}}>Event details <span style={{fontSize:12,fontWeight:400,color:'var(--grey-400)'}}>— fields marked <span style={{color:'var(--pink)'}}>*</span> are required</span></div>
            <div className="form-grid three" style={{marginBottom:14}}>
              <InputField label="Event name" required value={form.name} onChange={v=>setF('name',v)} placeholder="e.g. Sharma Wedding" error={errors.name}/>
              <SelectField label="Event type" required value={form.type} onChange={v=>setF('type',v)} options={eventTypes.map(t=>({value:t.value,label:t.label}))} error={errors.type}/>
              <SelectField label="Status" value={form.status} onChange={v=>setF('status',v)} options={EVENT_STATUS_ORDER.map(s=>({value:s,label:EVENT_STATUS_LABELS[s]}))}/>
            </div>
            <div className="form-grid three" style={{marginBottom:14}}>
              <InputField label="Main event date" required type="date" value={form.main_date} onChange={v=>setF('main_date',v)} error={errors.main_date}/>
              <AutocompleteInput label="Location" required value={form.location} onChange={v=>setF('location',v)} placeholder="e.g. Hyderabad" error={errors.location} table="events" column="location"/>
              <InputField label="Guest count" type="number" value={form.guest_count} onChange={v=>setF('guest_count',v)} placeholder="e.g. 300"/>
            </div>
            <div className="form-grid" style={{marginBottom:14}}>
              <InputField label="Budget (₹)" type="number" value={form.budget} onChange={v=>setF('budget',v)} placeholder="e.g. 1200000" hint="Approximate budget for planning"/>
              <SelectField label="Assigned staff" value={form.assigned_staff_id} onChange={v=>{
                const staff=staffList.find(s=>s.user_id===v);
                setF('assigned_staff_id',v);
                setForm(f=>({...f,assigned_staff_name:staff?`${staff.first_name} ${staff.last_name}`:''}));
              }} options={staffList.map(s=>({value:s.user_id,label:`${s.first_name} ${s.last_name}`}))} placeholder="Select staff..."/>
            </div>
            <div className="form-grid one">
              <InputField label="Internal notes" type="textarea" value={form.internal_notes} onChange={v=>setF('internal_notes',v)} placeholder="Any internal notes..."/>
            </div>
          </div>
        )}

        {/* Step 2 - Client & contact */}
        {step===2&&(
          <div>
            <div style={{fontSize:14,fontWeight:600,color:'var(--grey-800)',marginBottom:16}}>Select client & event contacts</div>
            {errors.client&&<div style={{background:'var(--red-light)',color:'var(--red)',borderRadius:'var(--radius-sm)',padding:'8px 12px',fontSize:13,marginBottom:12}}>⚠ {errors.client}</div>}
            <div style={{background:'white',borderRadius:'var(--radius-md)',border:'1px solid var(--grey-100)',padding:16,marginBottom:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,gap:8}}>
                <div style={{fontSize:13,fontWeight:500,color:'var(--grey-800)'}}>Select client <span style={{color:'var(--pink)'}}>*</span></div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <input className="field-input" style={{width:170,fontSize:12}} placeholder="Search clients..." value={clientSearch} onChange={e=>setClientSearch(e.target.value)}/>
                  <button className="btn sm" style={{fontSize:12,whiteSpace:'nowrap'}} onClick={()=>setShowClientForm(true)}>+ New client</button>
                </div>
              </div>
              <div style={{maxHeight:220,overflowY:'auto',display:'flex',flexDirection:'column',gap:6}}>
                {filteredClients.map(c=>{
                  const sc=statusColors[c.status?.toLowerCase()]||statusColors.active;
                  const sel=selectedClient?.client_id===c.client_id;
                  return (
                    <div key={c.client_id} onClick={()=>setSelectedClient(c)}
                      style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',border:`1px solid ${sel?'#A01044':'var(--grey-100)'}`,borderRadius:'var(--radius-md)',cursor:'pointer',background:sel?'#FCEAF1':'white',transition:'all .15s'}}>
                      <div style={{width:32,height:32,borderRadius:'50%',background:'var(--pink-light)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:600,color:'var(--pink)',flexShrink:0}}>
                        {c.first_name?.charAt(0)}{c.last_name?.charAt(0)}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:500,color:'var(--grey-800)'}}>{c.first_name} {c.last_name}</div>
                        <div style={{fontSize:12,color:'var(--grey-400)'}}>{c.phone_1}</div>
                      </div>
                      <span style={{padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:500,background:sc.bg,color:sc.color}}>{c.status?.toUpperCase()}</span>
                      {sel&&<span style={{color:'var(--green)',fontSize:16}}>✓</span>}
                    </div>
                  );
                })}
                {filteredClients.length===0&&<div style={{textAlign:'center',padding:20,color:'var(--grey-400)',fontSize:13}}>No clients found. <button className="btn sm" style={{fontSize:12,marginLeft:6}} onClick={()=>setShowClientForm(true)}>+ Create new client</button></div>}
              </div>
            </div>

            {selectedClient&&(
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                {/* Primary contact */}
                <div style={{border:'1.5px solid #A01044',borderRadius:'var(--radius-md)',padding:14,background:'#FCEAF1'}}>
                  <div style={{fontSize:11,fontWeight:600,color:'#A01044',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:10}}>Primary contact <span style={{color:'#A01044'}}>*</span></div>
                  {[{id:'client',name:`${selectedClient.first_name} ${selectedClient.last_name}`,sub:'Client themselves'},...altContacts.map(ac=>({id:ac.contact_id,name:`${ac.first_name} ${ac.last_name}`,sub:`${ac.relationship} · ${ac.phone}`}))].map(opt=>(
                    <div key={opt.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:'1px solid rgba(153,53,86,0.15)',cursor:'pointer'}} onClick={()=>{setPrimaryContactId(opt.id);setPrimaryContactName(opt.name);}}>
                      <input type="radio" name="pc" checked={primaryContactId===opt.id} onChange={()=>{}} style={{width:'auto',flexShrink:0}}/>
                      <div><div style={{fontSize:13,fontWeight:500,color:'var(--grey-800)'}}>{opt.name}</div><div style={{fontSize:11,color:'var(--grey-400)'}}>{opt.sub}</div></div>
                    </div>
                  ))}
                </div>
                {/* Secondary contact */}
                <div style={{border:'1px solid var(--grey-200)',borderRadius:'var(--radius-md)',padding:14}}>
                  <div style={{fontSize:11,fontWeight:600,color:'var(--grey-400)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:10}}>Secondary contact <span style={{fontSize:10,fontWeight:400}}>(optional)</span></div>
                  {[{id:'none',name:'None',sub:'No secondary contact'},...altContacts.map(ac=>({id:ac.contact_id,name:`${ac.first_name} ${ac.last_name}`,sub:`${ac.relationship} · ${ac.phone}`}))].map(opt=>(
                    <div key={opt.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:'1px solid var(--grey-100)',cursor:'pointer'}} onClick={()=>{setSecondaryContactId(opt.id);setSecondaryContactName(opt.id==='none'?'':opt.name);}}>
                      <input type="radio" name="sc" checked={secondaryContactId===opt.id||(opt.id==='none'&&!secondaryContactId)} onChange={()=>{}} style={{width:'auto',flexShrink:0}}/>
                      <div><div style={{fontSize:13,fontWeight:500,color:opt.id==='none'?'var(--grey-400)':'var(--grey-800)'}}>{opt.name}</div><div style={{fontSize:11,color:'var(--grey-400)'}}>{opt.sub}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3 - Sub events */}
        {step===3&&(
          <div>
            <div style={{fontSize:14,fontWeight:600,color:'var(--grey-800)',marginBottom:6}}>Sub-events & line items</div>

            {/* Toolbar */}
            <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12,flexWrap:'wrap'}}>
              <div style={{fontSize:12,color:'var(--grey-400)'}}>Use the <b>Template</b> / <b>Excel</b> buttons on each section below.</div>
              <div style={{flex:1}}/>
              <div style={{background:'white',borderRadius:'var(--radius-md)',padding:'6px 14px',border:'1px solid var(--grey-100)',fontSize:13}}>
                Grand total: <span style={{fontWeight:600,color:'var(--green)'}}>₹{grandTotal.toLocaleString('en-IN')}</span>
              </div>
            </div>

            <div style={{background:'var(--blue-light)',borderRadius:'var(--radius-md)',padding:'8px 14px',fontSize:12,color:'var(--blue)',marginBottom:12}}>ℹ️ Line items roll up into quotation & invoice grouped by sub-event. Tab between cells, Enter to add new row.</div>

            {subEvents.map((se,idx)=>(
              <div key={se.id} style={{background:'var(--grey-50)',borderRadius:'var(--radius-lg)',padding:'14px 16px',marginBottom:10,border:'1px solid var(--grey-100)'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,paddingBottom:8,borderBottom:'1px solid var(--grey-200)'}}>
                  <div style={{width:9,height:9,borderRadius:'50%',background:'#e8185a',flexShrink:0}}></div>
                  <SubEventNameInput value={se.name} onChange={v=>updateSubEvent(se.id,'name',v)}/>
                  <SubEventDateInput value={se.date} onChange={v=>updateSubEvent(se.id,'date',v)}/>
                  <SubEventLocInput value={se.location} onChange={v=>updateSubEvent(se.id,'location',v)}/>
                  <SubEventTplBtn templates={templates} onPick={tpl=>loadTemplateIntoSubEvent(se.id,tpl)} onImport={items=>updateSubItems(se.id,items)}/>
                  {subEvents.length>1&&<button style={{background:'none',border:'none',cursor:'pointer',color:'var(--red)',fontSize:14,flexShrink:0}} onClick={()=>removeSubEvent(se.id)}>🗑</button>}
                </div>
                <FastEntryTable items={se.items} onChange={items=>updateSubItems(se.id,items)}/>
              </div>
            ))}

            {/* Main event items */}
            <div style={{background:'var(--grey-50)',borderRadius:'var(--radius-lg)',padding:'14px 16px',marginBottom:10,border:'1px dashed var(--grey-200)'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,paddingBottom:8,borderBottom:'1px solid var(--grey-200)'}}>
                <div style={{width:9,height:9,borderRadius:'50%',background:'#9A938A',flexShrink:0}}></div>
                <span style={{fontSize:13,fontWeight:500,color:'var(--grey-800)',flex:1}}>Main event items</span>
                <span style={{fontSize:11,color:'var(--grey-400)'}}>Items not tied to a specific sub-event</span>
                <SubEventTplBtn templates={templates} onPick={tpl=>loadTemplateIntoMain(tpl)} onImport={items=>setMainItems(items)}/>
              </div>
              <FastEntryTable items={mainItems} onChange={setMainItems}/>
            </div>

            <button className="btn" style={{border:'1px dashed var(--grey-200)',color:'var(--grey-400)'}} onClick={addSubEvent}>+ Add sub-event</button>
          </div>
        )}

        {/* Step 4 - Review */}
        {step===4&&(
          <div>
            <div style={{fontSize:14,fontWeight:600,color:'var(--grey-800)',marginBottom:16}}>Review before saving</div>
            <div style={{background:'white',borderRadius:'var(--radius-md)',border:'1px solid var(--grey-100)',overflow:'hidden',marginBottom:16}}>
              {[
                ['Event name',form.name],['Type',form.type],['Status',EVENT_STATUS_LABELS[form.status]],
                ['Main date',form.main_date],['Location',form.location],
                ['Guest count',form.guest_count||'—'],['Budget',form.budget?`₹${parseFloat(form.budget).toLocaleString('en-IN')}`:'—'],
                ['Client',selectedClient?`${selectedClient.first_name} ${selectedClient.last_name}`:'—'],
                ['Primary contact',primaryContactName||'—'],
                ['Secondary contact',secondaryContactName||'None'],
                ['Assigned staff',form.assigned_staff_name||'—'],
              ].map(([l,v],i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'9px 16px',borderBottom:'1px solid var(--grey-100)',fontSize:13}}>
                  <span style={{color:'var(--grey-400)'}}>{l}</span>
                  <span style={{fontWeight:500,color:'var(--grey-800)'}}>{v}</span>
                </div>
              ))}
              <div style={{display:'flex',justifyContent:'space-between',padding:'9px 16px',fontSize:13}}>
                <span style={{color:'var(--grey-400)'}}>Sub-events</span>
                <span style={{display:'flex',flexWrap:'wrap',gap:4,justifyContent:'flex-end'}}>
                  {subEvents.filter(se=>se.name.trim()).map(se=>(
                    <span key={se.id} style={{padding:'2px 8px',borderRadius:20,fontSize:11,background:'var(--pink-light)',color:'var(--pink)',fontWeight:500}}>{se.name}{se.date?` · ${se.date}`:''}</span>
                  ))}
                  {subEvents.filter(se=>se.name.trim()).length===0&&<span style={{color:'var(--grey-400)'}}>None</span>}
                </span>
              </div>
            </div>
            <div style={{background:'var(--blue-light)',borderRadius:'var(--radius-md)',padding:'10px 14px',fontSize:13,color:'var(--blue)',marginBottom:16}}>
              ℹ️ Saving will create the event record and link it to {selectedClient?.first_name} {selectedClient?.last_name}'s profile.
            </div>
            {grandTotal>0&&<div style={{background:'var(--green-light)',borderRadius:'var(--radius-md)',padding:'10px 14px',fontSize:13,color:'var(--green)',marginBottom:16}}>
              💰 Grand total from line items: <strong>₹{grandTotal.toLocaleString('en-IN')}</strong>
            </div>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{padding:'14px 24px',borderTop:'1px solid var(--grey-100)',display:'flex',justifyContent:'space-between',background:'var(--grey-50)'}}>
        <button className="btn" onClick={step===1?onCancel:()=>setStep(s=>s-1)}>
          {step===1?'✕ Cancel':'← Back'}
        </button>
        {step<4
          ? <button className="btn primary" onClick={nextStep}>Next →</button>
          : <button className="btn primary" onClick={handleSave} disabled={saving}>{saving?'⏳ Saving...':'💾 Save event'}</button>
        }
      </div>
    </div>
  );
}
export function EventsModule({nav, onNavigate, onBack}) {
  const eventTypes = useEventTypes();
  const [events, setEvents] = useState([]);
  // Stack-driven view: nav carries {eventId} (detail), {mode:'new', referenceEvent} (wizard), or null (list).
  const detailId = nav && nav.eventId;
  const isNew = !!(nav && nav.mode==='new');
  const referenceEvent = (nav && nav.referenceEvent) || null;
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  const [budgetFilter, setBudgetFilter] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [staffList, setStaffList] = useState([]);
  const [eventFunnels, setEventFunnels] = useState({});
  const [refPicker, setRefPicker] = useState(false);
  const [refSearch, setRefSearch] = useState('');

  useEffect(()=>{ loadEvents(); loadStaff(); },[]);
  // Reload the list whenever we return to it (detail/wizard closed) so funnel badges + rows stay fresh.
  useEffect(()=>{ if(!detailId && !isNew) loadEvents(); },[detailId, isNew]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    const {data} = await supabase.from('events').select('*').eq('is_deleted',false);
    if(data){
      // Sort by urgency then date
      const sorted = [...data].sort((a,b)=>{
        const ao=EVENT_STATUS_ORDER.indexOf(a.status?.toLowerCase());
        const bo=EVENT_STATUS_ORDER.indexOf(b.status?.toLowerCase());
        if(ao!==bo) return ao-bo;
        return new Date(a.main_date||0)-new Date(b.main_date||0);
      });
      setEvents(sorted);
      // Build the derived funnel badge for every row from batched aggregates (4 queries, not per-row).
      try{
        const [{data:invs},{data:evs},{data:qs}] = await Promise.all([
          supabase.from('invoices').select('invoice_id,event_id,status,grand_total,total_received,total_outstanding').eq('is_deleted',false),
          supabase.from('event_vendors').select('event_id,outstanding').eq('is_deleted',false),
          supabase.from('quotations').select('event_id,status').eq('is_deleted',false),
        ]);
        const invToEvent={}; (invs||[]).forEach(i=>{ invToEvent[i.invoice_id]=i.event_id; });
        let insts=[];
        const invIds=(invs||[]).map(i=>i.invoice_id);
        if(invIds.length){ const {data:iin}=await supabase.from('invoice_installments').select('invoice_id,balance,is_deleted').in('invoice_id',invIds).eq('is_deleted',false); insts=iin||[]; }
        const invByEvent={}; (invs||[]).forEach(i=>{ (invByEvent[i.event_id]=invByEvent[i.event_id]||[]).push(i); });
        const instByEvent={}; insts.forEach(x=>{ const eid=invToEvent[x.invoice_id]; if(eid){ (instByEvent[eid]=instByEvent[eid]||[]).push(x); } });
        const vOutByEvent={}; (evs||[]).forEach(v=>{ vOutByEvent[v.event_id]=(vOutByEvent[v.event_id]||0)+(parseFloat(v.outstanding)||0); });
        const apprByEvent={}; (qs||[]).forEach(q=>{ if(['approved','converted','invoiced'].includes((q.status||'').toLowerCase())) apprByEvent[q.event_id]=true; });
        const fmap={};
        sorted.forEach(e=>{ fmap[e.event_id]=eventFunnel({invoices:invByEvent[e.event_id]||[], installments:instByEvent[e.event_id]||[], vendorOutstanding:vOutByEvent[e.event_id]||0, hasApprovedQuote:!!apprByEvent[e.event_id]}); });
        setEventFunnels(fmap);
      }catch(err){ /* badge is best-effort; never block the list */ }
    }
    setLoading(false);
  },[]);

  const loadStaff = async () => {
    const {data} = await supabase.from('users').select('user_id,first_name,last_name').eq('status','active');
    if(data) setStaffList(data);
  };

  const handleSaveNew = async (eventData) => {
    setSaveSuccess(`Event "${eventData.name}" created successfully!`);
    setTimeout(()=>setSaveSuccess(''),4000);
    loadEvents();
    onBack&&onBack();
  };

  const filtered = events.filter(e=>{
    const q=search.toLowerCase();
    const matchSearch = !q || `${e.name} ${e.client_name} ${e.location} ${e.type} ${e.ref_number||''}`.toLowerCase().includes(q);
    const matchStatus = !statusFilter || e.status?.toLowerCase()===statusFilter;
    const matchType = !typeFilter || e.type?.toLowerCase()===typeFilter.toLowerCase();
    const matchStaff = !staffFilter || e.assigned_staff_id===staffFilter;
    const matchBudget = matchesBudget(e.budget, budgetFilter);
    return matchSearch && matchStatus && matchType && matchStaff && matchBudget;
  });

  if(detailId) return (
    <EventDetail
      eventId={detailId}
      onBack={onBack}
      onUseAsReference={(evt)=>onNavigate('events',{mode:'new',referenceEvent:evt,label:'New event'})}
      onNavigate={onNavigate}
    />
  );
  if(isNew) return <NewEventWizard
    referenceEvent={referenceEvent}
    onSave={handleSaveNew}
    onCancel={onBack}
  />;

  return (
    <div>
      {saveSuccess&&<div style={{background:'var(--green-light)',color:'var(--green)',borderRadius:'var(--radius-sm)',padding:'10px 14px',fontSize:13,marginBottom:16,border:'1px solid rgba(15,110,86,0.2)'}}>✅ {saveSuccess}</div>}

      {refPicker&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1100,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'48px 20px',overflowY:'auto'}} onClick={e=>{if(e.target===e.currentTarget)setRefPicker(false);}}>
          <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:560,maxHeight:'80vh',display:'flex',flexDirection:'column'}}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid var(--grey-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><div style={{fontSize:15,fontWeight:600,color:'var(--grey-800)'}}>Create from reference</div><div style={{fontSize:12,color:'var(--grey-400)'}}>Pick an event to copy its sub-events &amp; items into a new one (prices reset).</div></div>
              <button className="btn sm" onClick={()=>setRefPicker(false)}>✕</button>
            </div>
            <div style={{padding:'12px 20px',borderBottom:'1px solid var(--grey-100)'}}>
              <input className="field-input" autoFocus placeholder="Search by name, ref, client, type…" value={refSearch} onChange={e=>setRefSearch(e.target.value)}/>
            </div>
            <div style={{overflowY:'auto',padding:'6px 0'}}>
              {(()=>{ const q=refSearch.toLowerCase(); const list=events.filter(e=>e.status?.toLowerCase()!=='cancelled').filter(e=>!q||`${e.name} ${e.client_name||''} ${e.type||''} ${e.ref_number||''} ${e.location||''}`.toLowerCase().includes(q)); if(list.length===0) return <div style={{padding:'24px 20px',textAlign:'center',fontSize:13,color:'var(--grey-400)'}}>No matching events.</div>; return list.map(e=>(
                <div key={e.event_id} onClick={()=>{setRefPicker(false);onNavigate('events',{mode:'new',referenceEvent:e,label:'New event'});}} style={{padding:'10px 20px',cursor:'pointer',borderBottom:'1px solid var(--grey-50)',display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}
                  onMouseEnter={ev=>ev.currentTarget.style.background='var(--grey-50)'} onMouseLeave={ev=>ev.currentTarget.style.background='white'}>
                  <div><div style={{fontSize:13,fontWeight:500,color:'var(--grey-800)'}}>{e.name}</div><div style={{fontSize:12,color:'var(--grey-400)'}}>{e.ref_number?(e.ref_number+' · '):''}{e.type?eventTypeLabel(e.type):''}{e.client_name?(' · '+e.client_name):''}</div></div>
                  <span style={{color:'var(--pink)',fontSize:12,fontWeight:500,whiteSpace:'nowrap'}}>Use →</span>
                </div>
              )); })()}
            </div>
          </div>
        </div>
      )}

      {/* Metrics */}
      <div className="metrics-grid" style={{marginBottom:20}}>
        <div className="metric-card pink"><div className="metric-icon">🎪</div><div className="metric-value">{events.length}</div><div className="metric-label">Total events</div></div>
        <div className="metric-card orange"><div className="metric-icon">📅</div><div className="metric-value">{events.filter(e=>['planning','confirmed'].includes(e.status?.toLowerCase())).length}</div><div className="metric-label">Upcoming</div></div>
        <div className="metric-card pink"><div className="metric-icon">⚡</div><div className="metric-value">{events.filter(e=>e.status?.toLowerCase()==='in_progress').length}</div><div className="metric-label">In progress</div></div>
        <div className="metric-card green"><div className="metric-icon">✅</div><div className="metric-value">{events.filter(e=>e.status?.toLowerCase()==='completed').length}</div><div className="metric-label">Completed</div></div>
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:10,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:200,position:'relative'}}>
          <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:15,color:'var(--grey-400)',pointerEvents:'none'}}>🔍</span>
          <input className="field-input" style={{paddingLeft:36}} placeholder="Search by ref, name, client, location..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <select className="field-input" style={{width:140}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {EVENT_STATUS_ORDER.map(s=><option key={s} value={s}>{EVENT_STATUS_LABELS[s]}</option>)}
        </select>
        <select className="field-input" style={{width:130}} value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {eventTypes.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select className="field-input" style={{width:130}} value={staffFilter} onChange={e=>setStaffFilter(e.target.value)}>
          <option value="">All staff</option>
          {staffList.map(s=><option key={s.user_id} value={s.user_id}>{s.first_name} {s.last_name}</option>)}
        </select>
        <select className="field-input" style={{width:160}} value={budgetFilter} onChange={e=>setBudgetFilter(e.target.value)}>
          {BUDGET_RANGES.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <button className="btn" onClick={()=>{setRefSearch('');setRefPicker(true);}} title="Start a new event pre-filled from an existing one">📋 From reference</button>
        <button className="btn primary" onClick={()=>onNavigate('events',{mode:'new',label:'New event'})}>+ New event</button>
      </div>

      {/* Events list */}
      {loading ? (
        <div style={{padding:60,textAlign:'center'}}><div className="spinner" style={{margin:'0 auto'}}></div></div>
      ) : filtered.length===0 ? (
        <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:60,textAlign:'center',border:'1px solid var(--grey-100)'}}>
          <div style={{fontSize:48,marginBottom:12}}>🎪</div>
          <div style={{fontSize:15,fontWeight:600,color:'var(--grey-800)',marginBottom:6}}>{search||statusFilter||typeFilter?'No events found':'No events yet'}</div>
          <div style={{fontSize:13,color:'var(--grey-400)',marginBottom:16}}>{search||statusFilter||typeFilter?'Try adjusting your search or filters':'Create your first event to get started'}</div>
          {!search&&!statusFilter&&!typeFilter&&<button className="btn primary" onClick={()=>onNavigate('events',{mode:'new',label:'New event'})}>+ Create first event</button>}
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {filtered.map(e=>{
            const es=effectiveEventStatus(e); const sc=EVENT_STATUS_COLORS[es]||EVENT_STATUS_COLORS.planning;
            return (
              <div key={e.event_id} style={{background:'white',borderRadius:'var(--radius-lg)',border:'1px solid var(--grey-100)',overflow:'hidden',cursor:'pointer',transition:'border-color .15s'}}
                onMouseEnter={ev=>ev.currentTarget.style.borderColor='var(--grey-200)'}
                onMouseLeave={ev=>ev.currentTarget.style.borderColor='var(--grey-100)'}
                onClick={()=>onNavigate('events',{eventId:e.event_id,label:e.name})}>
                <div style={{display:'grid',gridTemplateColumns:'6px 1fr auto auto',alignItems:'stretch'}}>
                  <div style={{background:sc.dot,borderRadius:'var(--radius-lg) 0 0 var(--radius-lg)'}}></div>
                  <div style={{padding:'14px 16px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                      <span style={{fontSize:14,fontWeight:500,color:'var(--grey-800)'}}>{e.name}</span>
                      <StatusBadge kind="event" status={es} />
                      {es!=='cancelled'&&<EventFunnelBadge compact funnel={es==='completed'?{...(eventFunnels[e.event_id]||{}),label:null}:eventFunnels[e.event_id]}/>}
                    </div>
                    <div style={{display:'flex',gap:16,fontSize:12,color:'var(--grey-400)',flexWrap:'wrap'}}>
                      {e.ref_number&&<span style={{color:'var(--pink)',fontWeight:500}}>{e.ref_number}</span>}
                      {e.client_name&&<span>👤 <ClientLink clientId={e.client_id} name={e.client_name} onNavigate={onNavigate}>{e.client_name}</ClientLink></span>}
                      {e.main_date&&<span>📅 {fmtDate(e.main_date,{day:'numeric',month:'short',year:'numeric'})}</span>}
                      {e.location&&<span>📍 {e.location}</span>}
                      {e.guest_count&&<span>👥 {e.guest_count} guests</span>}
                      {e.assigned_staff_name&&<span>🧑‍💼 {e.assigned_staff_name}</span>}
                    </div>
                  </div>
                  <div style={{padding:'14px 16px',display:'flex',flexDirection:'column',alignItems:'flex-end',justifyContent:'center',gap:2}}>
                    {e.budget&&<div style={{fontSize:14,fontWeight:600,color:'var(--grey-800)'}}>₹{parseFloat(e.budget).toLocaleString('en-IN')}</div>}
                    {e.budget&&<div style={{fontSize:11,color:'var(--grey-400)'}}>budget</div>}
                  </div>
                  <div style={{padding:'0 6px',display:'flex',alignItems:'center',gap:6}}>
                    <button className="btn sm" style={{fontSize:11,padding:'3px 8px'}}
                      onClick={ev=>{ev.stopPropagation();onNavigate('events',{mode:'new',referenceEvent:e,label:'New event'});}}>
                      📋
                    </button>
                    <span style={{color:'var(--grey-400)',fontSize:18}}>›</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
