// Leads module — list + filters + metrics, LeadDetail (stage actions, quotations
// panel, convert→event link, loss flow), LeadForm (new/edit + from-reference),
// and the lost-lead / reference modals. Ported verbatim from isheeka-erp-v22.html.
// `WelcomeMessageModal` is exported for reuse by QuotationDetail (convert flow).
import React, { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { notify, runDb } from '../lib/toast.jsx';
import { _currentUid } from '../lib/session.js';
import { fmtDate, eventTypeLabel, leadStageDisplay, getFollowUpUrgency, quoteStatusLabel } from '../lib/format.js';
import { LEAD_STAGES, LEAD_STAGE_LABELS, LEAD_STAGE_COLORS, LEAD_SOURCES_DEFAULT, LEAD_LOSS_REASONS, URGENCY_COLORS, QUOT_STATUS_COLORS, QUOT_STATUS_LABELS } from '../lib/constants.js';
import { useEventTypes, fetchLeadSources } from '../lib/data.js';
import { getNextLeadRef } from '../lib/refs.js';
import { InputField, SelectField, AutocompleteInput } from '../components/fields.jsx';
import { ClientLink } from '../components/links.jsx';
import { QuoteGenerationWizard } from '../components/QuoteWizard.jsx';

function LossReasonModal({onSave, onCancel}) {
  const [reason, setReason] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState('');
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:460,boxShadow:'var(--shadow-lg)'}}>
        <div style={{padding:'18px 24px',borderBottom:'1px solid var(--grey-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:15,fontWeight:600,color:'var(--grey-800)'}}>Mark lead as lost</div>
          <button className="btn sm" onClick={onCancel}>✕</button>
        </div>
        <div style={{padding:20}}>
          <div style={{fontSize:13,color:'var(--grey-600)',marginBottom:14}}>Please select a reason — this helps with analysis later.</div>
          {error&&<div style={{color:'var(--red)',fontSize:12,marginBottom:10}}>⚠ {error}</div>}
          <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
            {LEAD_LOSS_REASONS.map(r=>(
              <div key={r.value} onClick={()=>{setReason(r.value);setError('');}}
                style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',border:`1.5px solid ${reason===r.value?'#A01044':'var(--grey-100)'}`,borderRadius:'var(--radius-md)',cursor:'pointer',background:reason===r.value?'#FCEAF1':'white',transition:'all .15s'}}>
                <div style={{width:16,height:16,borderRadius:'50%',border:`2px solid ${reason===r.value?'#A01044':'var(--grey-300)'}`,background:reason===r.value?'#A01044':'white',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                  {reason===r.value&&<div style={{width:6,height:6,borderRadius:'50%',background:'white'}}/>}
                </div>
                <span style={{fontSize:13,color:'var(--grey-800)',fontWeight:reason===r.value?500:400}}>{r.label}</span>
              </div>
            ))}
          </div>
          <div>
            <label className="field-label">Additional notes <span style={{fontWeight:400,color:'var(--grey-400)'}}>(optional)</span></label>
            <LossNotesInput value={notes} onChange={setNotes}/>
          </div>
        </div>
        <div style={{padding:'14px 24px',borderTop:'1px solid var(--grey-100)',display:'flex',justifyContent:'flex-end',gap:8}}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" style={{background:'#A32D2D',border:'none'}} onClick={()=>{if(!reason){setError('Please select a reason');return;}onSave(reason,notes);}}>
            Mark as lost
          </button>
        </div>
      </div>
    </div>
  );
}
function LossNotesInput({value,onChange}) {
  return <textarea className="field-textarea" rows={3} value={value} onChange={e=>onChange(e.target.value)} placeholder="Any additional context..."/>;
}

// ── Welcome Message Modal ─────────────────────────────────────────────────────
export function WelcomeMessageModal({lead, quotRef, clientOutcome, onClose, onGoToEvent}) {
  const msg = `Dear ${lead.first_name} ${lead.last_name},

Thank you for choosing Isheeka Events for your ${lead.event_type?eventTypeLabel(lead.event_type):'upcoming event'}! We are thrilled to confirm your event with us.

${quotRef?`Your quotation (${quotRef}) has been confirmed`:'Your quotation has been confirmed'}, and our team will now begin preparing every detail to make your occasion truly memorable.

For any queries, please reach out to us at:
📞 +91 78423 95867
📧 isheekaevents@gmail.com
🌐 www.isheekaevents.com

Warm regards,
Team Isheeka Events 💕`;

  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    navigator.clipboard.writeText(msg).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),2500); });
  };
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:500,boxShadow:'var(--shadow-lg)'}}>
        <div style={{padding:'18px 24px',borderBottom:'1px solid var(--grey-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontSize:15,fontWeight:600,color:'var(--grey-800)'}}>🎉 Lead converted successfully!</div>
            <div style={{fontSize:12,color:'var(--grey-400)',marginTop:2}}>Copy this welcome message and send via WhatsApp</div>
          </div>
          <button className="btn sm" onClick={onClose}>✕</button>
        </div>
        <div style={{padding:20}}>
          <div style={{background:'var(--grey-50)',borderRadius:'var(--radius-md)',padding:16,fontSize:13,color:'var(--grey-800)',lineHeight:1.7,whiteSpace:'pre-wrap',border:'1px solid var(--grey-100)',marginBottom:16,fontFamily:'inherit'}}>
            {msg}
          </div>
          <button className="btn primary" style={{width:'100%'}} onClick={copy}>
            {copied?'✅ Copied!':'📋 Copy message'}
          </button>
          {clientOutcome&&(
            <div style={{marginTop:10,padding:'8px 12px',background:clientOutcome.type==='created'?'var(--blue-light)':'var(--green-light)',borderRadius:'var(--radius-sm)',fontSize:12,color:clientOutcome.type==='created'?'var(--blue)':'var(--green)'}}>
              {clientOutcome.type==='created'?'✓ New client profile created for '+clientOutcome.name+'.':'✓ Linked to existing client: '+clientOutcome.name+'.'}
            </div>
          )}
        </div>
        <div style={{padding:'12px 24px',borderTop:'1px solid var(--grey-100)',textAlign:'center'}}>
          <button className="btn primary" onClick={()=>{ if(onGoToEvent) onGoToEvent(); else onClose(); }}>Done — go to event</button>
        </div>
      </div>
    </div>
  );
}

function LeadForm({initial={}, onSave, onCancel, title='New lead', referenceData=null, originalLead=null, originalSubEvents=null, lockEventFields=false}) {
  const eventTypes = useEventTypes();
  const empty = {
    first_name:'',last_name:'',phone:'',phone_2:'',email:'',
    source:'',event_type:'',tentative_date:'',location:'Hyderabad',
    budget:'',guest_count:'',venue_preference:'',referred_by:'',
    stage:'new',assigned_to:'',notes:'',follow_up_date:'',
  };
  const initData = referenceData || initial;
  const [form, setForm] = React.useState({...empty,...initData});
  const [errors, setErrors] = React.useState({});
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');
  const [staffList, setStaffList] = React.useState([]);

  const [leadSources, setLeadSources] = React.useState(LEAD_SOURCES_DEFAULT);
  React.useEffect(()=>{
    supabase.from('users').select('user_id,first_name,last_name').eq('status','active').then(({data})=>{ if(data) setStaffList(data); });
    fetchLeadSources().then(setLeadSources);
  },[]);

  const set = (field,val) => { setForm(f=>({...f,[field]:val})); if(errors[field]) setErrors(e=>({...e,[field]:''})); setSaveError(''); };

  const validate = () => {
    const e={};
    if(!form.first_name?.trim()) e.first_name='First name is required';
    if(!form.last_name?.trim()) e.last_name='Last name is required';
    if(!form.phone?.trim()) e.phone='Phone is required';
    if(!form.source) e.source='Source is required';
    if(!form.event_type) e.event_type='Event type is required';
    return e;
  };

  const handleSave = async () => {
    // Detect no changes when editing
    if(originalLead) {
      const fields = ['first_name','last_name','phone','phone_2','email','source',
        'referred_by','event_type','tentative_date','location','budget','guest_count',
        'venue_preference','stage','assigned_to','notes','follow_up_date'];
      const hasFormChanges = fields.some(f=>String(form[f]||'')!==String(originalLead[f]||''));
      if(!hasFormChanges) {
        setSaveError('No changes have been made.');
        return;
      }
    }
    const e=validate();
    if(Object.keys(e).length>0){setErrors(e);setSaveError('Please fix the errors below.');return;}
    setSaving(true); setSaveError('');
    try { await onSave(form); }
    catch(err){
      const msg = err?.message || err?.toString() || 'Unknown error';
      setSaveError('Could not save lead: ' + msg);
      console.error('Lead save error:', err);
    }
    finally { setSaving(false); }
  };

  const typeOpts = eventTypes.map(t=>({value:t.value,label:t.label}));
  const staffOpts = staffList.map(s=>({value:s.user_id,label:s.first_name+' '+s.last_name}));

  return (
    <div style={{background:'white',borderRadius:'var(--radius-lg)',border:'1px solid var(--grey-100)',overflow:'hidden'}}>
      <div style={{padding:'18px 24px',borderBottom:'1px solid var(--grey-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:16,fontWeight:600,color:'var(--grey-800)'}}>{referenceData?'New lead from reference':title}</div>
        <button className="btn sm" onClick={onCancel}>✕ Cancel</button>
      </div>
      <div style={{padding:24}}>
        {referenceData&&<div style={{background:'var(--blue-light)',borderRadius:'var(--radius-md)',padding:'8px 14px',fontSize:12,color:'var(--blue)',marginBottom:14}}>
          📋 All fields pre-filled from reference lead — update whatever you need before saving.
        </div>}
        {saveError&&<div style={{background:'var(--red-light)',color:'var(--red)',borderRadius:'var(--radius-sm)',padding:'10px 14px',fontSize:13,marginBottom:16,border:'1px solid rgba(163,45,45,0.2)'}}>⚠️ {saveError}</div>}

        <div style={{fontSize:12,fontWeight:600,color:'var(--grey-400)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:12}}>Contact details</div>
        <div className="form-grid" style={{marginBottom:14}}>
          <InputField label="First name" required value={form.first_name} onChange={v=>set('first_name',v)} error={errors.first_name} placeholder="e.g. Priya"/>
          <InputField label="Last name" required value={form.last_name} onChange={v=>set('last_name',v)} error={errors.last_name} placeholder="e.g. Sharma"/>
        </div>
        <div className="form-grid three" style={{marginBottom:14}}>
          <InputField label="Phone 1" required value={form.phone} onChange={v=>set('phone',v)} error={errors.phone} placeholder="+91 98765 43210"/>
          <InputField label="Phone 2" value={form.phone_2} onChange={v=>set('phone_2',v)} placeholder="+91 XXXXX XXXXX"/>
          <InputField label="Email" value={form.email} onChange={v=>set('email',v)} placeholder="priya@email.com"/>
        </div>
        <div className="form-grid three" style={{marginBottom:14}}>
          <SelectField label="Source" required value={form.source} onChange={v=>set('source',v)} options={leadSources} error={errors.source} placeholder="How did they find us?"/>
          {form.source==='referral'&&<InputField label="Referred by" value={form.referred_by} onChange={v=>set('referred_by',v)} placeholder="Name or phone"/>}
        </div>

        <div style={{height:1,background:'var(--grey-100)',margin:'16px 0'}}/>
        <div style={{fontSize:12,fontWeight:600,color:'var(--grey-400)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:12}}>Event details</div>
        {lockEventFields&&<div style={{background:'#FFF8E1',borderRadius:'var(--radius-sm)',padding:'8px 12px',fontSize:12,color:'#8A6D1B',marginBottom:12,border:'1px solid #FFE082'}}>
          🔒 Event details are locked because a quotation has already been generated for this lead. To change these, revise or cancel the active quotation first.
        </div>}
        <div className="form-grid three" style={{marginBottom:14}}>
          <SelectField label="Event type" required value={form.event_type} onChange={v=>set('event_type',v)} options={typeOpts} error={errors.event_type} placeholder="Select type..." disabled={lockEventFields}/>
          <InputField label="Tentative date" type="date" value={form.tentative_date} onChange={v=>set('tentative_date',v)} disabled={lockEventFields}/>
          <AutocompleteInput label="Location / City" value={form.location} onChange={v=>set('location',v)} placeholder="e.g. Hyderabad" table="leads" column="location" disabled={lockEventFields}/>
        </div>
        <div className="form-grid three" style={{marginBottom:14}}>
          <InputField label="Approx. budget (₹)" type="number" value={form.budget} onChange={v=>set('budget',v)} placeholder="e.g. 1200000" disabled={lockEventFields}/>
          <InputField label="Guest count (approx)" type="number" value={form.guest_count} onChange={v=>set('guest_count',v)} placeholder="e.g. 300" disabled={lockEventFields}/>
          <InputField label="Venue preference" value={form.venue_preference} onChange={v=>set('venue_preference',v)} placeholder="e.g. 5-star hotel" disabled={lockEventFields}/>
        </div>

        <div style={{height:1,background:'var(--grey-100)',margin:'16px 0'}}/>
        <div style={{fontSize:12,fontWeight:600,color:'var(--grey-400)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:6}}>Pipeline</div>
        <div style={{fontSize:12,marginBottom:12,background:'var(--blue-light)',borderRadius:'var(--radius-sm)',padding:'6px 10px',color:'var(--blue)'}}>
          ℹ️ Stage is managed automatically via action buttons on the lead screen.
        </div>
        <div className="form-grid" style={{marginBottom:14}}>
          <InputField label="Follow-up date" type="date" value={form.follow_up_date} onChange={v=>set('follow_up_date',v)} hint="When to next contact this lead"/>
          <SelectField label="Assigned staff" value={form.assigned_to} onChange={v=>set('assigned_to',v)} options={staffOpts} placeholder="Select staff..."/>
        </div>
        <div className="form-grid one" style={{marginBottom:14}}>
          <InputField label="Notes" type="textarea" value={form.notes} onChange={v=>set('notes',v)} placeholder="Any notes about this lead..."/>
        </div>
      </div>
      <div style={{padding:'14px 24px',borderTop:'1px solid var(--grey-100)',display:'flex',justifyContent:'space-between',alignItems:'center',background:'var(--grey-50)'}}>
        <div style={{fontSize:12,color:'var(--grey-400)'}}>Fields marked <span style={{color:'var(--pink)'}}>*</span> are required</div>
        <button className="btn primary" onClick={handleSave} disabled={saving}>{saving?'⏳ Saving...':'💾 Save lead'}</button>
      </div>
    </div>
  );
}

// Stable sub-event inputs for lead form
function LeadSENameInput({value,onChange}) {
  return <input className="field-input" style={{flex:1}} value={value} onChange={e=>onChange(e.target.value)} placeholder="Sub-event name (e.g. Mehendi)"/>;
}
function LeadSEDateInput({value,onChange}) {
  return <input type="date" className="field-input" style={{width:160}} value={value||''} onChange={e=>onChange(e.target.value)}/>;
}
function LeadSELocInput({value,onChange}) {
  return <input className="field-input" style={{width:160}} value={value||''} onChange={e=>onChange(e.target.value)} placeholder="Location"/>;
}

function LeadDetail({leadId, onBack, onConverted, onCreateFromReference, onNavigate}) {
  const [lead, setLead] = React.useState(null);
  const [subEvents, setSubEvents] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [mode, setMode] = React.useState('view');
  const [saving, setSaving] = React.useState(false);
  const [showLoss, setShowLoss] = React.useState(false);
  const [showWelcome, setShowWelcome] = React.useState(false);
  const [convertedEventId, setConvertedEventId] = React.useState(null);
  const [showOldQuotes, setShowOldQuotes] = React.useState(false);
  const [convertClientOutcome, setConvertClientOutcome] = React.useState(null); // {type:'created'|'reused', name:string}
  const [showLostConfirm, setShowLostConfirm] = React.useState(false);
  const [showQuoteWizard, setShowQuoteWizard] = React.useState(false);
  const [leadQuotations, setLeadQuotations] = React.useState([]);
  const [leadRfqs, setLeadRfqs] = React.useState([]);
  const [linkedEvent, setLinkedEvent] = React.useState(null);
  const [successMsg, setSuccessMsg] = React.useState('');
  const [staffList, setStaffList] = React.useState([]);

  React.useEffect(()=>{ loadLead(); },[leadId]);

  const loadLead = async () => {
    setLoading(true); setMode('view');
    const [{data:l},{data:ses},{data:staff},{data:quots},{data:rfqs}] = await Promise.all([
      supabase.from('leads').select('*').eq('lead_id',leadId).single(),
      supabase.from('lead_sub_events').select('*').eq('lead_id',leadId).eq('is_deleted',false).order('sort_order'),
      supabase.from('users').select('user_id,first_name,last_name').eq('status','active'),
      supabase.from('quotations').select('quotation_id,ref_number,status,grand_total,valid_until,revision_number,created_at').eq('lead_id',leadId).eq('is_deleted',false).order('created_at',{ascending:false}),
      supabase.from('rfqs').select('rfq_id,ref_number,status,client_submitted_at,created_at').eq('lead_id',leadId).eq('party_type','client').eq('is_deleted',false).order('created_at',{ascending:false}),
    ]);
    if(l) setLead(l);
    if(ses) setSubEvents(ses);
    if(staff) setStaffList(staff);
    if(quots) setLeadQuotations(quots);
    if(rfqs) setLeadRfqs(rfqs);
    if(l && l.event_id){
      const {data:ev} = await supabase.from('events').select('event_id,ref_number,name,status,main_date,location,type').eq('event_id',l.event_id).single();
      setLinkedEvent(ev||null);
    } else { setLinkedEvent(null); }
    setLoading(false);
  };

  const handleSave = async (form, ses) => {
    setSaving(true);
    try {
      const {error} = await supabase.from('leads').update({
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone,
        phone_2: form.phone_2||null,
        email: form.email||null,
        source: form.source||null,
        referred_by: form.referred_by||null,
        event_type: form.event_type||null,
        tentative_date: form.tentative_date||null,
        location: form.location||null,
        budget: form.budget?parseFloat(form.budget):null,
        guest_count: form.guest_count?parseInt(form.guest_count):null,
        venue_preference: form.venue_preference||null,
        stage: form.stage||'new',
        assigned_to: form.assigned_to||null,
        notes: form.notes||null,
        follow_up_date: form.follow_up_date||null,
        updated_at: new Date().toISOString()
      }).eq('lead_id',leadId);
      if(error) throw error;

      // Item 8: cascade name / phone / email changes to the linked client + active quotations
      const nameChanged = (form.first_name!==lead.first_name)||(form.last_name!==lead.last_name);
      const phoneChanged = (form.phone||'')!==(lead.phone||'');
      const emailChanged = (form.email||'')!==(lead.email||'');
      if((nameChanged||phoneChanged||emailChanged) && lead.client_id){
        const {error:cce}=await supabase.from('clients').update({
          first_name:form.first_name,last_name:form.last_name,
          phone_1:form.phone,email_1:form.email||null,
          updated_at:new Date().toISOString()
        }).eq('client_id',lead.client_id);
        if(cce) throw cce;
      }
      if(nameChanged){
        const newClientName=form.first_name+' '+form.last_name;
        const {data:quots}=await supabase.from('quotations').select('quotation_id,status').eq('lead_id',leadId).eq('is_deleted',false);
        const targets=(quots||[]).filter(q=>!['superseded','rejected','expired','converted'].includes(q.status));
        for(const q of targets){
          const {error:qcce}=await supabase.from('quotations').update({client_name:newClientName,updated_at:new Date().toISOString()}).eq('quotation_id',q.quotation_id); if(qcce) throw qcce;
        }
      }

      await loadLead();
      setSuccessMsg('Lead updated successfully!');
      setTimeout(()=>setSuccessMsg(''),4000);
    } catch(err) {
      setSuccessMsg('');
      console.error('[Isheeka ERP] lead save failed:', err);
      notify('Could not save lead: '+(err?.message||'Please try again.'),'error');
    } finally { setSaving(false); }
  };



  const handleStageChange = async (newStage) => {
    try {
      const {error} = await supabase.from('leads')
        .update({stage:newStage, updated_at:new Date().toISOString()})
        .eq('lead_id',leadId);
      if(error) throw error;
      setLead(l=>({...l,stage:newStage}));
      // Item 16: confirming the quote approves the active quotation
      if(newStage==='quote_confirmed' && lead.active_quotation_id){
        const {error:ae}=await supabase.from('quotations').update({status:'approved',updated_at:new Date().toISOString()}).eq('quotation_id',lead.active_quotation_id); if(ae) throw ae;
        const {data:quots}=await supabase.from('quotations').select('quotation_id,ref_number,status,grand_total,valid_until,revision_number,created_at').eq('lead_id',leadId).eq('is_deleted',false).order('created_at',{ascending:false});
        if(quots) setLeadQuotations(quots);
      }
      const labels = {
        contacted:'Lead marked as Contacted.',
        quote_sent:'Quote sent to client.',
        quote_revision_pending:'Revision requested — lead updated.',
        revised_quote_sent:'Revised quote sent to client.',
        quote_confirmed:'Quote confirmed by client! Ready to convert.',
      };
      setSuccessMsg(labels[newStage]||'Stage updated.');
      setTimeout(()=>setSuccessMsg(''),4000);
    } catch(err) {
      console.error('[Isheeka ERP] stage update failed:', err);
      notify('Could not update stage: '+(err?.message||'Please try again.'),'error');
    }
  };

  const handleCreateFromLostLead = async () => {
    setShowLostConfirm(false);
    // Load sub-events for this lead
    const {data:ses} = await supabase.from('lead_sub_events')
      .select('*').eq('lead_id',leadId).eq('is_deleted',false).order('sort_order');
    // Build reference data — copy all, reset stage to new
    const refData = {
      first_name: lead.first_name||'',
      last_name: lead.last_name||'',
      phone: lead.phone||'',
      phone_2: lead.phone_2||'',
      email: lead.email||'',
      source: lead.source||'',
      referred_by: lead.referred_by||'',
      event_type: lead.event_type||'',
      tentative_date: lead.tentative_date||'',
      location: lead.location||'',
      budget: lead.budget||'',
      guest_count: lead.guest_count||'',
      venue_preference: lead.venue_preference||'',
      stage: 'new',
      assigned_to: lead.assigned_to||'',
      follow_up_date: '',
      notes: lead.notes ? '[Based on lost lead: '+lead.first_name+' '+lead.last_name+'] '+lead.notes : 'Based on lost lead: '+lead.first_name+' '+lead.last_name,
      subEvents: (ses||[]).map(se=>({name:se.name,date:se.date||'',location:se.location||''})),
    };
    onCreateFromReference && onCreateFromReference(refData);
  };

  const handleLoss = async (reason, notes) => {
    const {error:lle}=await runDb(supabase.from('leads').update({
      stage:'lost',lost_reason:reason,lost_notes:notes||null,
      lost_at:new Date().toISOString(),updated_at:new Date().toISOString()
    }).eq('lead_id',leadId),'mark lead as lost');
    if(lle) return;
    // Sync: reject the lead's active quote so quote + lead don't diverge.
    const activeQ=(leadQuotations||[]).find(q=>!['superseded','rejected','expired','converted','invoiced'].includes(q.status));
    if(activeQ){
      const rl=(LEAD_LOSS_REASONS.find(r=>r.value===reason)||{}).label||reason;
      await supabase.from('quotations').update({status:'rejected',updated_at:new Date().toISOString()}).eq('quotation_id',activeQ.quotation_id);
      try{ await supabase.from('quotation_activity_log').insert({quotation_id:activeQ.quotation_id, action:'rejected', notes:'Lead marked lost — '+rl+(notes?(': '+notes):''), logged_by:await _currentUid()}); }catch(e){}
    }
    setShowLoss(false);
    await loadLead();
    setSuccessMsg('Lead marked as lost.'+(activeQ?' Active quote '+activeQ.ref_number+' rejected.':''));
    setTimeout(()=>setSuccessMsg(''),4000);
  };

  // Phone normalization for client dedup
  const normPhone = (s) => (s||'').replace(/\D/g,'').replace(/^91(\d{10})$/,'$1');

  // (lead-origin conversion now lives on the quote page via createEventFromQuote; the
  //  in-lead convert flow + its ConvertLeadModal/ClientMatchModal mounts were removed.)

  if(loading) return <div style={{padding:60,textAlign:'center'}}><div className="spinner" style={{margin:'0 auto'}}/></div>;
  if(!lead) return <div style={{padding:40,textAlign:'center',color:'var(--grey-400)'}}>Lead not found.</div>;

  if(mode==='edit') return (
    <LeadForm
      initial={{...lead,subEvents}}
      originalLead={lead}
      originalSubEvents={subEvents}
      title="Edit lead"
      lockEventFields={leadQuotations.some(q=>!['superseded','rejected','expired'].includes(q.status))}
      onSave={async (form,ses)=>{ await handleSave(form,ses); setMode('view'); }}
      onCancel={()=>setMode('view')}
    />
  );

  const sc = lead.stage==='lost'
    ? {bg:'#FCEBEB',color:'#A32D2D'}
    : LEAD_STAGE_COLORS[lead.stage]||LEAD_STAGE_COLORS.new;
  const urgency = getFollowUpUrgency(lead.follow_up_date);
  const uc = URGENCY_COLORS[urgency];
  const isLost = lead.stage==='lost';
  const isConverted = lead.stage==='event_triggered';
  const lossLabel = LEAD_LOSS_REASONS.find(r=>r.value===lead.lost_reason)?.label||lead.lost_reason;

  return (
    <div>
      {showLoss&&<LossReasonModal onSave={handleLoss} onCancel={()=>setShowLoss(false)}/>}
      {showLostConfirm&&<LostLeadEditModal
        onEditAnyway={()=>{setShowLostConfirm(false);setMode('edit');}}
        onCreateFromReference={handleCreateFromLostLead}
        onCancel={()=>setShowLostConfirm(false)}
      />}
      {showQuoteWizard&&<QuoteGenerationWizard
        lead={lead}
        leadSubEvents={subEvents}
        isRevision={lead.stage==='quote_revision_pending'}
        isContinuation={lead.stage==='quote_generation_in_progress'||(!!(lead.active_quotation_id)&&lead.stage==='contacted')}
        existingQuotationId={(lead.stage==='quote_revision_pending'||lead.stage==='quote_generation_in_progress'||lead.active_quotation_id)?lead.active_quotation_id:null}
        onComplete={async()=>{ setShowQuoteWizard(false); await loadLead(); }}
        onCancel={()=>setShowQuoteWizard(false)}
      />}
      {showWelcome&&<WelcomeMessageModal
        lead={lead}
        quotRef={(leadQuotations.find(q=>q.quotation_id===lead.active_quotation_id)||{}).ref_number}
        clientOutcome={convertClientOutcome}
        onGoToEvent={()=>{ setShowWelcome(false); if(onNavigate&&convertedEventId){ onNavigate('events',{eventId:convertedEventId}); } else { onConverted&&onConverted(); } }}
        onClose={()=>{ setShowWelcome(false); onConverted&&onConverted(); }}
      />}


      {successMsg&&<div style={{background:'var(--green-light)',color:'var(--green)',borderRadius:'var(--radius-sm)',padding:'10px 14px',fontSize:13,marginBottom:12,border:'1px solid rgba(15,110,86,0.2)'}}>✅ {successMsg}</div>}

      {/* Header */}
      <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'18px 24px',border:'1px solid var(--grey-100)',marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12}}>
        <div>
          <div style={{fontSize:18,fontWeight:600,color:'var(--grey-800)',marginBottom:4}}><ClientLink clientId={lead.client_id} name={(lead.first_name+' '+lead.last_name).trim()} onNavigate={onNavigate} title="Open client (converted lead)">{lead.first_name} {lead.last_name}</ClientLink>{lead.ref_number&&<span style={{fontSize:13,fontWeight:400,color:'var(--grey-400)',marginLeft:8}}>{lead.ref_number}</span>}</div>
          <div style={{fontSize:12,color:'var(--grey-400)',marginBottom:6}}>{lead.phone}{lead.email?' · '+lead.email:''}</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <span style={{padding:'2px 10px',borderRadius:20,fontSize:11,fontWeight:500,background:sc.bg,color:sc.color}}>
              {isLost?'LOST':leadStageDisplay(lead.stage)}
            </span>
            {lead.event_type&&<span style={{padding:'2px 10px',borderRadius:20,fontSize:11,fontWeight:500,background:'var(--blue-light)',color:'var(--blue)',textTransform:'capitalize'}}>{eventTypeLabel(lead.event_type)}</span>}
            {lead.source&&<span style={{padding:'2px 10px',borderRadius:20,fontSize:11,fontWeight:500,background:'var(--grey-100)',color:'var(--grey-400)',textTransform:'capitalize'}}>{lead.source.replace('_',' ')}</span>}
          </div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          {/* Stage badge — always visible */}
          <span style={{padding:'4px 12px',borderRadius:20,fontSize:12,fontWeight:500,background:sc.bg,color:sc.color}}>
            {isLost?'LOST':isConverted?'CONVERTED':leadStageDisplay(lead.stage)}
          </span>
          {lead.client_id&&<button className="btn sm" title="Open this client's 360" onClick={()=>onNavigate&&onNavigate('clients',{clientId:lead.client_id,label:(lead.first_name+' '+lead.last_name).trim()||'Client'})}>👤 View client →</button>}
          {!isLost&&(()=>{ const activeRfq=leadRfqs.find(r=>!['converted','withdrawn','expired'].includes(r.status)); const tip=activeRfq?('An active RFQ ('+activeRfq.ref_number+') already exists — open it below.'):'Send a requirements link to capture event details'; return (
            <span title={tip} style={{display:'inline-flex'}}>
              <button className="btn sm" disabled={!!activeRfq} style={activeRfq?{opacity:0.5,cursor:'not-allowed',pointerEvents:'none'}:{}} onClick={()=>onNavigate&&onNavigate('rfqs',{mode:'new',label:'New RFQ',prefill:{lead_id:lead.lead_id,client_id:lead.client_id||null,contact_first_name:lead.first_name,contact_last_name:lead.last_name,contact_phone:lead.phone,contact_email:lead.email,event_type:lead.event_type,location:lead.location}})}>📝 Send RFQ</button>
            </span>
          ); })()}
          {!isLost&&!isConverted&&(
            <>
              {/* Next action buttons — context aware per stage */}
              {lead.stage==='new'&&(
                <button className="btn sm" style={{background:'var(--blue-light)',color:'var(--blue)',border:'1px solid #93C5FD'}}
                  onClick={()=>handleStageChange('contacted')}>✓ Mark as contacted</button>
              )}
              {lead.stage==='contacted'&&(
                <button className="btn sm" style={{background:'#F3E5F5',color:'#6A1B9A',border:'1px solid #CE93D8'}}
                  onClick={()=>setShowQuoteWizard(true)}>📋 Generate quote</button>
              )}
              {/* Once a quote exists, all quote work lives on the quote page — the lead just links to it. */}
              {['quote_generation_in_progress','quote_sent','quote_revision_pending','revised_quote_sent','quote_confirmed'].includes(lead.stage)&&lead.active_quotation_id&&(
                <button className="btn sm primary" onClick={()=>onNavigate&&onNavigate('quotations',{quotId:lead.active_quotation_id,label:(leadQuotations.find(q=>q.quotation_id===lead.active_quotation_id)||{}).ref_number||'Quote'})}>📄 Open active quote →</button>
              )}
              <button className="btn sm" style={{color:'#A32D2D',border:'1px solid #FCEBEB'}}
                onClick={()=>setShowLoss(true)}>✕ Lost</button>
              <button className="btn sm" onClick={()=>setMode('edit')}>✏️ Edit</button>
            </>
          )}
          {isConverted&&<button className="btn sm" onClick={()=>setMode('edit')}>✏️ Edit</button>}
          {isLost&&<button className="btn sm" onClick={()=>setShowLostConfirm(true)}>✏️ Edit</button>}
        </div>
      </div>

      {/* Info grid */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        {/* Event details */}
        <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'16px 20px',border:'1px solid var(--grey-100)'}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)',marginBottom:14}}>Event details</div>
          {[
            ['Event type',lead.event_type?eventTypeLabel(lead.event_type):'—'],
            ['Tentative date',lead.tentative_date?fmtDate(lead.tentative_date,{day:'numeric',month:'long',year:'numeric'}):'—'],
            ['Location',lead.location||'—'],
            ['Approx. budget',lead.budget?'₹'+parseFloat(lead.budget).toLocaleString('en-IN'):'—'],
            ['Guest count',lead.guest_count||'—'],
            ['Venue preference',lead.venue_preference||'—'],
          ].map(([l,v],i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid var(--grey-100)',fontSize:13}}>
              <span style={{color:'var(--grey-400)'}}>{l}</span>
              <span style={{fontWeight:500,color:'var(--grey-800)'}}>{v}</span>
            </div>
          ))}
        </div>

        {/* Follow-up + pipeline */}
        <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'16px 20px',border:'1px solid var(--grey-100)'}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)',marginBottom:14}}>Pipeline & follow-up</div>

          {/* Follow-up date */}
          <div style={{background:uc.bg,borderRadius:'var(--radius-md)',padding:'12px 14px',marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontSize:11,color:uc.color,fontWeight:600,textTransform:'uppercase',letterSpacing:'.04em',marginBottom:2}}>Follow-up</div>
              <div style={{fontSize:14,fontWeight:500,color:uc.color}}>
                {lead.follow_up_date?fmtDate(lead.follow_up_date,{day:'numeric',month:'short',year:'numeric'}):'Not set'}
              </div>
              {urgency!=='none'&&<div style={{fontSize:11,color:uc.color,marginTop:2}}>{uc.label}</div>}
            </div>
            <div style={{width:10,height:10,borderRadius:'50%',background:uc.dot}}/>
          </div>

          {[
            ['Assigned staff',staffList.find(s=>s.user_id===lead.assigned_to)?staffList.find(s=>s.user_id===lead.assigned_to).first_name+' '+staffList.find(s=>s.user_id===lead.assigned_to).last_name:'—'],
            ['Source',lead.source?lead.source.replace('_',' '):'—'],
            ['Referred by',lead.referred_by||'—'],
            ['Created',lead.created_at?new Date(lead.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—'],
          ].map(([l,v],i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid var(--grey-100)',fontSize:13}}>
              <span style={{color:'var(--grey-400)'}}>{l}</span>
              <span style={{fontWeight:500,color:'var(--grey-800)',textTransform:'capitalize'}}>{v}</span>
            </div>
          ))}

          {isLost&&(
            <div style={{marginTop:12,background:'#FCEBEB',borderRadius:'var(--radius-md)',padding:'10px 14px'}}>
              <div style={{fontSize:11,fontWeight:600,color:'#A32D2D',marginBottom:4,textTransform:'uppercase',letterSpacing:'.04em'}}>Lost reason</div>
              <div style={{fontSize:13,color:'#A32D2D',fontWeight:500}}>{lossLabel||'—'}</div>
              {lead.lost_notes&&<div style={{fontSize:12,color:'#A32D2D',marginTop:4,opacity:.8}}>{lead.lost_notes}</div>}
            </div>
          )}

          {isConverted&&(
            <div style={{marginTop:12,background:'var(--green-light)',borderRadius:'var(--radius-md)',padding:'10px 14px'}}>
              <div style={{fontSize:11,fontWeight:600,color:'var(--green)',marginBottom:4,textTransform:'uppercase',letterSpacing:'.04em'}}>Converted</div>
              <div style={{fontSize:13,color:'var(--green)'}}>{lead.converted_at?new Date(lead.converted_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):''}</div>
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      {lead.notes&&(
        <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'16px 20px',border:'1px solid var(--grey-100)',marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)',marginBottom:10}}>Notes</div>
          <div style={{fontSize:13,color:'var(--grey-600)',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{lead.notes}</div>
        </div>
      )}

      {/* RFQs panel — surfaces the lead's client RFQs (party_type='client' only). */}
      {leadRfqs.length>0&&(
        <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'16px 20px',border:'1px solid var(--grey-100)',marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)',marginBottom:12}}>RFQs</div>
          {leadRfqs.map((r,i)=>{ const isActive=!['converted','withdrawn','expired'].includes(r.status); return (
            <div key={r.rfq_id} onClick={()=>onNavigate&&onNavigate('rfqs',{rfqId:r.rfq_id,label:r.ref_number})} title="Open RFQ"
              style={{display:'flex',alignItems:'center',gap:12,padding:'10px 8px',margin:'0 -8px',borderRadius:'var(--radius-sm)',cursor:'pointer',borderBottom:i<leadRfqs.length-1?'1px solid var(--grey-100)':'none'}}
              onMouseEnter={e=>e.currentTarget.style.background='var(--grey-50)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <div style={{width:10,height:10,borderRadius:'50%',flexShrink:0,background:isActive?'var(--green)':'var(--grey-300)'}}/>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:13,fontWeight:500,color:'var(--grey-800)'}}>{r.ref_number}</span>
                  {isActive&&<span style={{fontSize:10,fontWeight:700,color:'var(--green)',textTransform:'uppercase',letterSpacing:'.04em'}}>ACTIVE</span>}
                </div>
                <div style={{fontSize:12,color:'var(--grey-400)',marginTop:2}}>{r.client_submitted_at?('Responded '+fmtDate(r.client_submitted_at,{day:'numeric',month:'short'})):('Sent '+fmtDate(r.created_at,{day:'numeric',month:'short'}))}</div>
              </div>
              <span style={{padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:500,background:isActive?'var(--green-light)':'var(--grey-100)',color:isActive?'var(--green)':'var(--grey-400)',textTransform:'capitalize'}}>{(r.status||'').replace('_',' ')}</span>
            </div>
          ); })}
        </div>
      )}

      {/* Quotations panel */}
      {leadQuotations.length>0&&(
        <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'16px 20px',border:'1px solid var(--grey-100)',marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)',marginBottom:12}}>Quotations</div>
          {(()=>{
            const renderRow=(q,showBorder)=>{
              const isActive=lead.active_quotation_id===q.quotation_id;
              const sc=QUOT_STATUS_COLORS?QUOT_STATUS_COLORS[q.status]||{bg:'var(--grey-100)',color:'var(--grey-400)'}:{bg:'var(--grey-100)',color:'var(--grey-400)'};
              const statusLabel=quoteStatusLabel(q);
              return (
                <div key={q.quotation_id} onClick={()=>onNavigate&&onNavigate('quotations',{quotId:q.quotation_id,label:q.ref_number})} title="Open quotation"
                  style={{display:'flex',alignItems:'center',gap:12,padding:'10px 8px',margin:'0 -8px',borderRadius:'var(--radius-sm)',cursor:'pointer',borderBottom:showBorder?'1px solid var(--grey-100)':'none',opacity:q.status==='superseded'?0.5:1}}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--grey-50)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <div style={{width:10,height:10,borderRadius:'50%',flexShrink:0,background:isActive?'var(--green)':'var(--grey-300)'}}/>
                  <div style={{flex:1}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:13,fontWeight:500,color:'var(--grey-800)'}}>{q.ref_number}</span>
                      {isActive&&<span style={{fontSize:10,fontWeight:700,color:'var(--green)',textTransform:'uppercase',letterSpacing:'.04em'}}>ACTIVE</span>}
                    </div>
                    <div style={{fontSize:12,color:'var(--grey-400)',marginTop:2}}>
                      {'Rs.'+parseFloat(q.grand_total||0).toLocaleString('en-IN')}
                      {q.valid_until&&(' · Valid until '+fmtDate(q.valid_until,{day:'numeric',month:'short'}))}
                    </div>
                  </div>
                  <span style={{padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:500,background:sc.bg,color:sc.color}}>{statusLabel}</span>
                </div>
              );
            };
            const current=leadQuotations.filter(q=>q.status!=='superseded');
            const older=leadQuotations.filter(q=>q.status==='superseded');
            return <>
              {current.map((q,i)=>renderRow(q,i<current.length-1||(older.length>0)))}
              {older.length>0&&<div onClick={()=>setShowOldQuotes(v=>!v)} style={{fontSize:12,fontWeight:500,color:'var(--blue)',cursor:'pointer',padding:'8px 0 2px',userSelect:'none'}}>{showOldQuotes?'▾ Hide':'▸ Show'} {older.length} earlier revision{older.length>1?'s':''}</div>}
              {showOldQuotes&&older.map((q,i)=>renderRow(q,i<older.length-1))}
            </>;
          })()}
        </div>
      )}

      {linkedEvent&&(
        <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:'16px 20px',border:'1px solid var(--grey-100)',marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)',marginBottom:12}}>Converted to event</div>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:10,height:10,borderRadius:'50%',flexShrink:0,background:'var(--blue)'}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                {linkedEvent.ref_number&&<span style={{fontSize:13,fontWeight:500,color:'var(--pink)'}}>{linkedEvent.ref_number}</span>}
                <span style={{fontSize:13,color:'var(--grey-800)'}}>{linkedEvent.name}</span>
              </div>
              <div style={{fontSize:12,color:'var(--grey-400)',marginTop:2}}>
                {linkedEvent.type?linkedEvent.type.charAt(0).toUpperCase()+linkedEvent.type.slice(1):''}
                {linkedEvent.main_date&&(' · '+fmtDate(linkedEvent.main_date,{day:'numeric',month:'short',year:'numeric'}))}
                {linkedEvent.location&&(' · '+linkedEvent.location)}
              </div>
            </div>
            <button className="btn primary" onClick={()=>onNavigate&&onNavigate('events',{eventId:linkedEvent.event_id,label:linkedEvent.name||linkedEvent.ref_number||'Event'})}>View event →</button>
          </div>
        </div>
      )}

      {/* Sub-events panel removed in v21 — sub-events are now managed in the quotation wizard */}
    </div>
  );
}



// ── Lost Lead Edit Confirmation Modal ────────────────────────────────────────
function LostLeadEditModal({onEditAnyway, onCreateFromReference, onCancel}) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:420,boxShadow:'var(--shadow-lg)'}}>
        <div style={{padding:'20px 24px',borderBottom:'1px solid var(--grey-100)'}}>
          <div style={{fontSize:15,fontWeight:600,color:'#A32D2D',marginBottom:4}}>⚠️ This lead is marked as Lost</div>
          <div style={{fontSize:13,color:'var(--grey-400)'}}>What would you like to do?</div>
        </div>
        <div style={{padding:20,display:'flex',flexDirection:'column',gap:10}}>
          <button
            onClick={onCreateFromReference}
            style={{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',border:'1.5px solid var(--pink)',borderRadius:'var(--radius-md)',background:'#FCEAF1',cursor:'pointer',textAlign:'left',width:'100%'}}>
            <span style={{fontSize:22}}>📋</span>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:'var(--pink)',marginBottom:2}}>Create a new lead from this one</div>
              <div style={{fontSize:12,color:'var(--grey-400)'}}>Pre-fill a fresh lead with this lead's details. Stage will be reset to New.</div>
            </div>
          </button>
          <button
            onClick={onEditAnyway}
            style={{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',border:'1px solid var(--grey-200)',borderRadius:'var(--radius-md)',background:'white',cursor:'pointer',textAlign:'left',width:'100%'}}>
            <span style={{fontSize:22}}>✏️</span>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:'var(--grey-800)',marginBottom:2}}>Edit this lost lead anyway</div>
              <div style={{fontSize:12,color:'var(--grey-400)'}}>Make changes to the existing lost lead record.</div>
            </div>
          </button>
        </div>
        <div style={{padding:'12px 24px',borderTop:'1px solid var(--grey-100)',display:'flex',justifyContent:'flex-end'}}>
          <button className="btn sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Lead Reference Modal ──────────────────────────────────────────────────────
function LeadReferenceModal({onSelect, onCancel}) {
  const [search, setSearch] = React.useState('');
  const [leads, setLeads] = React.useState([]);
  const [filtered, setFiltered] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(()=>{
    supabase.from('leads').select('*').eq('is_deleted',false)
      .order('created_at',{ascending:false})
      .then(({data})=>{
        if(data){ setLeads(data); setFiltered(data); }
        setLoading(false);
      });
  },[]);

  React.useEffect(()=>{
    if(!search.trim()){ setFiltered(leads); return; }
    const q = search.toLowerCase();
    setFiltered(leads.filter(l=>
      (l.first_name+' '+l.last_name).toLowerCase().includes(q) ||
      (l.phone||'').includes(q) ||
      (l.email||'').toLowerCase().includes(q) ||
      (l.event_type||'').toLowerCase().includes(q) ||
      (l.location||'').toLowerCase().includes(q) ||
      (l.source||'').toLowerCase().includes(q) ||
      (l.venue_preference||'').toLowerCase().includes(q)
    ));
  },[search, leads]);

  const typeIcons = {wedding:'💍',corporate:'🏢',birthday:'🎂',anniversary:'💑',other:'🎪'};

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:'white',borderRadius:'var(--radius-xl)',width:'100%',maxWidth:560,maxHeight:'80vh',display:'flex',flexDirection:'column',boxShadow:'var(--shadow-lg)'}}>

        {/* Header */}
        <div style={{padding:'18px 24px',borderBottom:'1px solid var(--grey-100)',flexShrink:0}}>
          <div style={{fontSize:15,fontWeight:600,color:'var(--grey-800)',marginBottom:2}}>📋 Create from reference lead</div>
          <div style={{fontSize:12,color:'var(--grey-400)'}}>Search a past lead to use as a starting point. Contact details will be cleared.</div>
        </div>

        {/* Search */}
        <div style={{padding:'12px 24px',borderBottom:'1px solid var(--grey-100)',flexShrink:0}}>
          <div style={{position:'relative'}}>
            <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:15,color:'var(--grey-400)',pointerEvents:'none'}}>🔍</span>
            <LeadRefSearchInput value={search} onChange={setSearch}/>
          </div>
        </div>

        {/* Results */}
        <div style={{flex:1,overflowY:'auto',padding:'8px 12px'}}>
          {loading && <div style={{padding:40,textAlign:'center'}}><div className="spinner" style={{margin:'0 auto'}}/></div>}
          {!loading && filtered.length===0 && (
            <div style={{padding:40,textAlign:'center',color:'var(--grey-400)',fontSize:13}}>
              No leads found matching "{search}"
            </div>
          )}
          {!loading && filtered.map(lead=>{
            const sc = lead.stage==='lost'
              ? {bg:'#FCEBEB',color:'#A32D2D'}
              : LEAD_STAGE_COLORS[lead.stage]||LEAD_STAGE_COLORS.new;
            const isLost = lead.stage==='lost';
            const isConverted = lead.stage==='event_triggered';
            return (
              <div key={lead.lead_id}
                style={{padding:'12px 14px',borderRadius:'var(--radius-md)',border:'1px solid var(--grey-100)',marginBottom:6,cursor:'pointer',opacity:isLost?.65:1,transition:'all .15s'}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--pink)';e.currentTarget.style.background='#FCEAF1';}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--grey-100)';e.currentTarget.style.background='white';}}
                onClick={()=>onSelect(lead)}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
                  <div style={{fontSize:13,fontWeight:500,color:'var(--grey-800)'}}>
                    {typeIcons[lead.event_type]||'🎪'} {lead.first_name} {lead.last_name}
                  </div>
                  <span style={{padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:500,background:sc.bg,color:sc.color,flexShrink:0,marginLeft:8}}>
                    {isLost?'Lost':isConverted?'Converted':leadStageDisplay(lead.stage)}
                  </span>
                </div>
                <div style={{display:'flex',gap:12,fontSize:12,color:'var(--grey-400)',flexWrap:'wrap'}}>
                  {lead.event_type&&<span style={{textTransform:'capitalize'}}>{eventTypeLabel(lead.event_type)}</span>}
                  {lead.location&&<span>📍 {lead.location}</span>}
                  {lead.budget&&<span>💰 ₹{parseFloat(lead.budget).toLocaleString('en-IN')}</span>}
                  {lead.guest_count&&<span>👥 {lead.guest_count}</span>}
                  {lead.source&&<span style={{textTransform:'capitalize'}}>{lead.source.replace('_',' ')}</span>}
                  {lead.tentative_date&&<span>📅 {fmtDate(lead.tentative_date,{day:'numeric',month:'short',year:'numeric'})}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{padding:'12px 24px',borderTop:'1px solid var(--grey-100)',flexShrink:0,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:12,color:'var(--grey-400)'}}>{filtered.length} lead{filtered.length!==1?'s':''} shown</div>
          <button className="btn sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
function LeadRefSearchInput({value, onChange}) {
  return <input className="field-input" style={{paddingLeft:36}}
    value={value} onChange={e=>onChange(e.target.value)}
    placeholder="Search by name, phone, email, event type, location..."
    autoFocus/>;
}

// ── Leads Module ──────────────────────────────────────────────────────────────
export function LeadsModule({nav, onNavigate, onBack}) {
  const eventTypes = useEventTypes();
  const [leads, setLeads] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [stageFilter, setStageFilter] = React.useState('');
  const [sourceFilter, setSourceFilter] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState('');
  const [followUpFilter, setFollowUpFilter] = React.useState('');
  const [saveSuccess, setSaveSuccess] = React.useState('');
  const [leadSources, setLeadSources] = React.useState(LEAD_SOURCES_DEFAULT);
  const [showRefModal, setShowRefModal] = React.useState(false);
  // Stack-driven: nav carries {leadId} (detail) or {mode:'new', referenceData} (form) or null (list).
  const detailId = nav && nav.leadId;
  const isNew = !!(nav && nav.mode==='new');
  const referenceData = (nav && nav.referenceData) || null;

  React.useEffect(()=>{ loadLeads(); fetchLeadSources().then(setLeadSources); },[]);
  React.useEffect(()=>{ if(!detailId && !isNew) loadLeads(); },[detailId, isNew]);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    const {data} = await supabase.from('leads').select('*').eq('is_deleted',false).order('created_at',{ascending:false});
    if(data) setLeads(data);
    setLoading(false);
  },[]);

  const handleSelectReference = async (lead) => {
    const {data:ses} = await supabase.from('lead_sub_events')
      .select('*').eq('lead_id',lead.lead_id).eq('is_deleted',false).order('sort_order');
    // Copy ALL fields — user can update whatever they want
    const rd = {
      first_name: lead.first_name||'',
      last_name: lead.last_name||'',
      phone: lead.phone||'',
      phone_2: lead.phone_2||'',
      email: lead.email||'',
      source: lead.source||'',
      referred_by: lead.referred_by||'',
      event_type: lead.event_type||'',
      tentative_date: lead.tentative_date||'',
      location: lead.location||'',
      budget: lead.budget||'',
      guest_count: lead.guest_count||'',
      venue_preference: lead.venue_preference||'',
      stage: 'new',
      assigned_to: lead.assigned_to||'',
      follow_up_date: lead.follow_up_date||'',
      notes: lead.notes||'',
      subEvents: (ses||[]).map(se=>({name:se.name,date:se.date||'',location:se.location||''})),
    };
    setShowRefModal(false);
    onNavigate('leads',{mode:'new',referenceData:rd,label:'New lead'});
  };

  const handleSaveNew = async (form, subEvents) => {
    const ref_number = await getNextLeadRef();
    const insertPayload = {
      ref_number,
      first_name: form.first_name,
      last_name: form.last_name,
      phone: form.phone,
      phone_2: form.phone_2||null,
      email: form.email||null,
      source: form.source||null,
      event_type: form.event_type||null,
      tentative_date: form.tentative_date||null,
      location: form.location||null,
      budget: form.budget?parseFloat(form.budget):null,
      guest_count: form.guest_count?parseInt(form.guest_count):null,
      venue_preference: form.venue_preference||null,
      referred_by: form.referred_by||null,
      stage: form.stage||'new',
      assigned_to: form.assigned_to||null,
      notes: form.notes||null,
      follow_up_date: form.follow_up_date||null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_deleted: false
    };
    const {data,error} = await supabase.from('leads').insert(insertPayload).select().single();
    if(error) throw error;
    setSaveSuccess('Lead '+form.first_name+' '+form.last_name+' added successfully!');
    setTimeout(()=>setSaveSuccess(''),4000);
    loadLeads();
    onBack&&onBack();
  };

  // Filter leads
  const filtered = leads.filter(l=>{
    const q=search.toLowerCase();
    const matchSearch = !q || (l.first_name+' '+l.last_name+' '+(l.phone||'')+' '+(l.email||'')+' '+(l.ref_number||'')).toLowerCase().includes(q);
    const matchStage = !stageFilter || l.stage===stageFilter;
    const matchSource = !sourceFilter || l.source===sourceFilter;
    const matchType = !typeFilter || l.event_type===typeFilter;
    const matchFollowUp = !followUpFilter || getFollowUpUrgency(l.follow_up_date)===followUpFilter;
    return matchSearch && matchStage && matchSource && matchType && matchFollowUp;
  }).sort((a,b)=>{ const d=s=>s==='lost'?2:(s==='event_triggered'?1:0); return d(a.stage)-d(b.stage) || (b.created_at||'').localeCompare(a.created_at||''); });

  // Sort: overdue first, then today, then week, then future, then none; lost at bottom
  const sorted = [...filtered].sort((a,b)=>{
    if(a.stage==='lost'&&b.stage!=='lost') return 1;
    if(b.stage==='lost'&&a.stage!=='lost') return -1;
    const order={overdue:0,today:1,week:2,future:3,none:4};
    const ao=order[getFollowUpUrgency(a.follow_up_date)]??4;
    const bo=order[getFollowUpUrgency(b.follow_up_date)]??4;
    return ao-bo;
  });

  // Metrics
  const active = leads.filter(l=>l.stage!=='lost'&&l.stage!=='event_triggered');
  const today = leads.filter(l=>getFollowUpUrgency(l.follow_up_date)==='today'||getFollowUpUrgency(l.follow_up_date)==='overdue');
  const converted = leads.filter(l=>l.stage==='event_triggered');
  const convRate = leads.length>0?Math.round((converted.length/leads.length)*100):0;

  if(isNew) return <LeadForm
    referenceData={referenceData}
    onSave={handleSaveNew}
    onCancel={onBack}
  />;
  if(detailId) return (
    <LeadDetail
      leadId={detailId}
      onBack={onBack}
      onConverted={onBack}
      onNavigate={onNavigate}
      onCreateFromReference={(refData)=>onNavigate('leads',{mode:'new',referenceData:refData,label:'New lead'})}
    />
  );

  return (
    <div>
      {saveSuccess&&<div style={{background:'var(--green-light)',color:'var(--green)',borderRadius:'var(--radius-sm)',padding:'10px 14px',fontSize:13,marginBottom:16,border:'1px solid rgba(15,110,86,0.2)'}}>✅ {saveSuccess}</div>}
      {showRefModal&&<LeadReferenceModal onSelect={handleSelectReference} onCancel={()=>setShowRefModal(false)}/>}

      {/* Metrics */}
      <div className="metrics-grid" style={{marginBottom:20}}>
        <div className="metric-card pink"><div className="metric-icon">📋</div><div className="metric-value">{leads.length}</div><div className="metric-label">Total leads</div></div>
        <div className="metric-card orange"><div className="metric-icon">⚡</div><div className="metric-value">{active.length}</div><div className="metric-label">Active leads</div></div>
        <div className="metric-card blue"><div className="metric-icon">📅</div><div className="metric-value">{today.length}</div><div className="metric-label">Follow-up due</div></div>
        <div className="metric-card green"><div className="metric-icon">🎉</div><div className="metric-value">{convRate}%</div><div className="metric-label">Conversion rate</div></div>
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:200,position:'relative'}}>
          <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:15,color:'var(--grey-400)',pointerEvents:'none'}}>🔍</span>
          <input className="field-input" style={{paddingLeft:36}} placeholder="Search by ref, name, phone, email..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <select className="field-input" style={{width:150}} value={stageFilter} onChange={e=>setStageFilter(e.target.value)}>
          <option value="">All stages</option>
          {LEAD_STAGES.map(s=><option key={s} value={s}>{LEAD_STAGE_LABELS[s]}</option>)}
          <option value="lost">Lost</option>
        </select>
        <select className="field-input" style={{width:130}} value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {eventTypes.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select className="field-input" style={{width:130}} value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)}>
          <option value="">All sources</option>
          {leadSources.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button className="btn primary" onClick={()=>onNavigate('leads',{mode:'new',label:'New lead'})}>+ New lead</button>
        <button className="btn" onClick={()=>setShowRefModal(true)}>📋 From reference</button>
      </div>

      {/* Follow-up quick filters */}
      <div style={{display:'flex',gap:6,marginBottom:16}}>
        {[
          {value:'',label:'All'},
          {value:'overdue',label:'🔴 Overdue'},
          {value:'today',label:'🟡 Today'},
          {value:'week',label:'🟢 This week'},
        ].map(f=>(
          <button key={f.value} onClick={()=>setFollowUpFilter(f.value)}
            className="btn sm"
            style={{fontWeight:followUpFilter===f.value?600:400,background:followUpFilter===f.value?'var(--pink-light)':'white',color:followUpFilter===f.value?'var(--pink)':'var(--grey-600)',border:`1px solid ${followUpFilter===f.value?'var(--pink)':'var(--grey-200)'}`}}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Leads list */}
      {loading ? (
        <div style={{padding:60,textAlign:'center'}}><div className="spinner" style={{margin:'0 auto'}}/></div>
      ) : sorted.length===0 ? (
        <div style={{background:'white',borderRadius:'var(--radius-lg)',padding:60,textAlign:'center',border:'1px solid var(--grey-100)'}}>
          <div style={{fontSize:48,marginBottom:12}}>📋</div>
          <div style={{fontSize:15,fontWeight:600,color:'var(--grey-800)',marginBottom:6}}>{search||stageFilter||typeFilter||followUpFilter?'No leads found':'No leads yet'}</div>
          <div style={{fontSize:13,color:'var(--grey-400)',marginBottom:16}}>{search||stageFilter?'Try adjusting your filters':'Add your first lead to get started'}</div>
          {!search&&!stageFilter&&<button className="btn primary" onClick={()=>onNavigate('leads',{mode:'new',label:'New lead'})}>+ Add first lead</button>}
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {sorted.map(lead=>{
            const urgency = getFollowUpUrgency(lead.follow_up_date);
            const uc = URGENCY_COLORS[urgency];
            const sc = lead.stage==='lost'?{bg:'#FCEBEB',color:'#A32D2D'}:LEAD_STAGE_COLORS[lead.stage]||LEAD_STAGE_COLORS.new;
            const isLost = lead.stage==='lost';
            const isConverted = lead.stage==='event_triggered';
            return (
              <div key={lead.lead_id}
                style={{background:'white',borderRadius:'var(--radius-lg)',border:'1px solid var(--grey-100)',overflow:'hidden',cursor:'pointer',opacity:isLost?.6:1,transition:'border-color .15s'}}
                onMouseEnter={e=>e.currentTarget.style.borderColor='var(--grey-200)'}
                onMouseLeave={e=>e.currentTarget.style.borderColor='var(--grey-100)'}
                onClick={()=>onNavigate('leads',{leadId:lead.lead_id,label:((lead.first_name||'')+' '+(lead.last_name||'')).trim()||lead.ref_number||'Lead'})}>
                <div style={{display:'grid',gridTemplateColumns:'6px 1fr auto auto',alignItems:'stretch'}}>
                  <div style={{background:uc.dot,borderRadius:'var(--radius-lg) 0 0 var(--radius-lg)'}}/>
                  <div style={{padding:'14px 16px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                      <span style={{fontSize:14,fontWeight:500,color:'var(--grey-800)'}}>{lead.first_name} {lead.last_name}</span>
                      {lead.ref_number&&<span style={{fontSize:11,color:'var(--grey-400)',fontWeight:400}}>{lead.ref_number}</span>}
                      <span style={{padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:500,background:sc.bg,color:sc.color}}>
                        {isLost?'LOST':isConverted?'CONVERTED':leadStageDisplay(lead.stage)}
                      </span>
                      {lead.event_type&&<span style={{padding:'2px 8px',borderRadius:20,fontSize:11,background:'var(--blue-light)',color:'var(--blue)',textTransform:'capitalize'}}>{eventTypeLabel(lead.event_type)}</span>}
                    </div>
                    <div style={{display:'flex',gap:14,fontSize:12,color:'var(--grey-400)',flexWrap:'wrap'}}>
                      {lead.phone&&<span>📞 {lead.phone}</span>}
                      {lead.tentative_date&&<span>📅 {fmtDate(lead.tentative_date,{day:'numeric',month:'short',year:'numeric'})}</span>}
                      {lead.budget&&<span>💰 ₹{parseFloat(lead.budget).toLocaleString('en-IN')}</span>}
                      {lead.follow_up_date&&<span style={{color:uc.color,fontWeight:500}}>🔔 {uc.label}: {fmtDate(lead.follow_up_date,{day:'numeric',month:'short'})}</span>}
                    </div>
                  </div>
                  <div style={{padding:'14px 16px',display:'flex',alignItems:'center'}}>
                    {lead.source&&<span style={{padding:'2px 8px',borderRadius:20,fontSize:11,background:'var(--grey-100)',color:'var(--grey-400)',textTransform:'capitalize'}}>{lead.source.replace('_',' ')}</span>}
                  </div>
                  <div style={{padding:'0 14px',display:'flex',alignItems:'center',color:'var(--grey-400)',fontSize:18}}>›</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
