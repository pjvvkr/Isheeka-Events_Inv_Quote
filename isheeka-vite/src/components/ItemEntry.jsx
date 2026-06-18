// Shared item-entry components (ported verbatim from isheeka-erp-v22.html).
// Used by the Quote wizard (FastEntryTable) and the Events sub-event editors
// (SubEventItemsTable / ItemDescInput / ItemNumInput / SubEventTplBtn).
import React from 'react';
import { fetchSuggestions } from './fields.jsx';
import { notify } from '../lib/toast.jsx';
import * as XLSX from 'xlsx';

const FastItemDesc = React.forwardRef(({value, onChange, onTab, onEnter, onPaste}, ref) => {
  const [suggestions, setSuggestions] = React.useState([]);
  const [filtered, setFiltered] = React.useState([]);
  const [open, setOpen] = React.useState(false);

  const handleFocus = async () => {
    const suggs = await fetchSuggestions('sub_event_items','description');
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
  const handleSelect = (val) => { onChange(val); setOpen(false); onTab&&onTab(); };

  return (
    <div style={{position:'relative',width:'100%'}}>
      <input
        ref={ref}
        style={{border:'none',background:'transparent',fontSize:12,width:'100%',outline:'none',color:'var(--grey-800)'}}
        value={value} onChange={e=>handleChange(e.target.value)}
        onFocus={handleFocus} onBlur={()=>setTimeout(()=>setOpen(false),150)}
        onPaste={onPaste}
        placeholder="Description"
        onKeyDown={e=>{ if(e.key==='Tab'){e.preventDefault();setOpen(false);onTab&&onTab();} if(e.key==='Enter'){e.preventDefault();setOpen(false);onEnter&&onEnter();} }}
      />
      {open && filtered.length>0 && (
        <div style={{position:'absolute',top:'100%',left:0,zIndex:500,background:'white',border:'1.5px solid var(--pink)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-md)',minWidth:220,maxHeight:160,overflowY:'auto'}}>
          {filtered.map((s,i)=>(
            <div key={i} onMouseDown={()=>handleSelect(s)}
              style={{padding:'6px 12px',fontSize:12,cursor:'pointer',color:'var(--grey-800)',borderBottom:'1px solid var(--grey-100)'}}
              onMouseEnter={e=>e.currentTarget.style.background='var(--pink-light)'}
              onMouseLeave={e=>e.currentTarget.style.background='white'}>
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
const MAX_QTY = 9999;
const MAX_PRICE = 9999999; // 99,99,999 — ~1 crore per item
const sanitizeNum = (val, max) => {
  const n = parseFloat(String(val).replace(/[^0-9.]/g,''));
  if(isNaN(n)||n<0) return 0;
  if(n>max){ notify('Value '+n.toLocaleString('en-IN')+' seems too high — please check. Maximum allowed is '+max.toLocaleString('en-IN')+'.','error'); return max; }
  return n;
};
const FastItemQty = React.forwardRef(({value, onChange, onTab, onPaste}, ref) => {
  const validate=(v)=>{ const s=sanitizeNum(v,MAX_QTY); onChange(s); };
  return <input type="number" ref={ref}
    style={{border:'none',background:'transparent',fontSize:12,width:'100%',outline:'none',textAlign:'right',color:'var(--grey-800)',MozAppearance:'textfield'}}
    value={value} onChange={e=>onChange(e.target.value)}
    onBlur={e=>validate(e.target.value)}
    onPaste={onPaste}
    onKeyDown={e=>{ if(e.key==='Tab'){e.preventDefault();validate(e.target.value);onTab&&onTab();} }}
  />;
});
const FastItemPrice = React.forwardRef(({value, onChange, onTab, onPaste}, ref) => {
  const validate=(v)=>{ const s=sanitizeNum(v,MAX_PRICE); onChange(s); };
  return <input type="number" ref={ref}
    style={{border:'none',background:'transparent',fontSize:12,width:'100%',outline:'none',textAlign:'right',color:'var(--grey-800)',MozAppearance:'textfield'}}
    value={value} onChange={e=>onChange(e.target.value)}
    onBlur={e=>validate(e.target.value)}
    onPaste={onPaste}
    onKeyDown={e=>{ if(e.key==='Tab'){e.preventDefault();validate(e.target.value);onTab&&onTab();} }}
  />;
});

export function FastEntryTable({items, onChange}) {
  const refs = React.useRef({});
  const [pasteMsg, setPasteMsg] = React.useState('');

  const ensureMinRows = (arr, min=10) => {
    const rows = [...arr];
    while(rows.length < min) rows.push({id:'r-'+Date.now()+Math.random(),description:'',quantity:1,unit_price:0});
    return rows;
  };

  const [rows, setRows] = React.useState(()=>ensureMinRows(items||[]));

  // Sync when items prop changes (e.g. when edit mode opens with existing data)
  React.useEffect(()=>{
    if(items && items.length > 0){
      setRows(ensureMinRows(items));
    }
  },[JSON.stringify(items)]);

  React.useEffect(()=>{
    const filled = rows.filter(r=>r.description?.trim());
    onChange(filled);
  },[rows]);

  const updateRow = (id, field, val) => setRows(r=>r.map(row=>row.id===id?{...row,[field]:val}:row));
  const addRows = (count=10) => setRows(r=>[...r,...Array(count).fill(0).map(()=>({id:'r-'+Date.now()+Math.random(),description:'',quantity:1,unit_price:0}))]);
  const removeRow = (id) => setRows(r=>{ const next=r.filter(row=>row.id!==id); return next.length<1?ensureMinRows([]):next; });

  const focusCell = (rowIdx, col) => {
    const key = rowIdx+'-'+col;
    setTimeout(()=>refs.current[key]?.focus(), 0);
  };

  const handleDescTab = (rowIdx) => focusCell(rowIdx, 'qty');
  const handleQtyTab = (rowIdx) => focusCell(rowIdx, 'price');
  const handlePriceTab = (rowIdx) => {
    if(rowIdx === rows.length-1) addRows(5);
    focusCell(rowIdx+1, 'desc');
  };
  const handleEnter = (rowIdx) => {
    if(rowIdx === rows.length-1) addRows(5);
    focusCell(rowIdx+1, 'desc');
  };

  // ── Paste handler ────────────────────────────────────────────────────────
  const handlePaste = (e, startRowIdx, startColIdx) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;

    // Only intercept if multi-row or multi-column
    const hasNewline = text.includes('\n') || text.includes('\r');
    const hasTab = text.includes('\t');
    if (!hasNewline && !hasTab) return; // single value — let browser handle normally

    e.preventDefault();

    // Parse clipboard — detect delimiter
    const rawRows = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
    const parsed = rawRows
      .map(r => {
        // Try tab first, then comma
        const cols = r.includes('\t') ? r.split('\t') : r.split(',');
        return cols.map(c => c.trim().replace(/^["']|["']$/g,'').replace(/[₹$,]/g,''));
      })
      .filter(r => r.some(c => c.length > 0)); // remove fully empty rows

    if (parsed.length === 0) return;

    // Column mapping: 0=description, 1=qty, 2=price
    const COL_FIELDS = ['description','quantity','unit_price'];

    setRows(prev => {
      const updated = [...prev];

      // Ensure enough rows exist
      const needed = startRowIdx + parsed.length;
      while(updated.length < Math.max(needed + 5, 10)) {
        updated.push({id:'r-'+Date.now()+Math.random(),description:'',quantity:1,unit_price:0});
      }

      parsed.forEach((pastedRow, pi) => {
        const targetRowIdx = startRowIdx + pi;
        const updatedRow = {...updated[targetRowIdx]};

        pastedRow.forEach((cellVal, ci) => {
          const colIdx = startColIdx + ci;
          if (colIdx >= COL_FIELDS.length) return; // ignore extra columns
          const field = COL_FIELDS[colIdx];
          if (!field) return;

          if (field === 'quantity' || field === 'unit_price') {
            const num = parseFloat(cellVal.replace(/[^0-9.]/g,''));
            updatedRow[field] = isNaN(num) ? (field==='quantity'?1:0) : num;
          } else {
            updatedRow[field] = cellVal;
          }
        });

        updated[targetRowIdx] = updatedRow;
      });

      return updated;
    });

    // Show paste confirmation
    setPasteMsg(parsed.length + ' row' + (parsed.length>1?'s':'') + ' pasted from clipboard');
    setTimeout(()=>setPasteMsg(''),3000);

    // Focus first cell after paste
    setTimeout(()=>focusCell(startRowIdx, COL_FIELDS[startColIdx]==='description'?'desc':COL_FIELDS[startColIdx]==='quantity'?'qty':'price'), 50);
  };

  return (
    <div>
      {pasteMsg && (
        <div style={{background:'var(--green-light)',color:'var(--green)',borderRadius:'var(--radius-sm)',padding:'6px 12px',fontSize:12,marginBottom:6,display:'flex',alignItems:'center',gap:6,fontWeight:500}}>
          ✅ {pasteMsg}
        </div>
      )}
      <div style={{fontSize:11,color:'var(--grey-400)',marginBottom:4}}>
        💡 Tip: Copy rows from Excel and paste (Ctrl+V / Cmd+V) into any cell to fill multiple rows at once
      </div>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead>
          <tr style={{background:'#FCEAF1'}}>
            <th style={{padding:'6px 8px',textAlign:'left',fontWeight:700,color:'#A01044',fontSize:10,textTransform:'uppercase',letterSpacing:'.03em',borderBottom:'1.5px solid #e8185a'}}>#</th>
            <th style={{padding:'6px 8px',textAlign:'left',fontWeight:700,color:'#A01044',fontSize:10,textTransform:'uppercase',letterSpacing:'.03em',borderBottom:'1.5px solid #e8185a'}}>Description</th>
            <th style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:'#A01044',fontSize:10,textTransform:'uppercase',letterSpacing:'.03em',borderBottom:'1.5px solid #e8185a',width:'10%'}}>Qty</th>
            <th style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:'#A01044',fontSize:10,textTransform:'uppercase',letterSpacing:'.03em',borderBottom:'1.5px solid #e8185a',width:'18%'}}>Unit price (₹)</th>
            <th style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:'#A01044',fontSize:10,textTransform:'uppercase',letterSpacing:'.03em',borderBottom:'1.5px solid #e8185a',width:'18%'}}>Amount (₹)</th>
            <th style={{borderBottom:'1.5px solid #e8185a',width:28}}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row,ri)=>{
            const amt=(parseFloat(row.quantity)||0)*(parseFloat(row.unit_price)||0);
            const hasData=row.description?.trim();
            return (
              <tr key={row.id} style={{borderBottom:'1px solid var(--grey-100)',background:hasData?'white':'transparent'}}>
                <td style={{padding:'4px 8px',color:'var(--grey-400)',fontSize:11,width:24}}>{hasData?ri+1:''}</td>
                <td style={{padding:'3px 8px'}}>
                  <FastItemDesc value={row.description} onChange={v=>updateRow(row.id,'description',v)}
                    onTab={()=>handleDescTab(ri)} onEnter={()=>handleEnter(ri)}
                    onPaste={e=>handlePaste(e,ri,0)}
                    ref={el=>refs.current[ri+'-desc']=el}/>
                </td>
                <td style={{padding:'3px 8px'}}>
                  <FastItemQty value={row.quantity} onChange={v=>updateRow(row.id,'quantity',v)}
                    onTab={()=>handleQtyTab(ri)}
                    onPaste={e=>handlePaste(e,ri,1)}
                    ref={el=>refs.current[ri+'-qty']=el}/>
                </td>
                <td style={{padding:'3px 8px'}}>
                  <FastItemPrice value={row.unit_price} onChange={v=>updateRow(row.id,'unit_price',v)}
                    onTab={()=>handlePriceTab(ri)}
                    onPaste={e=>handlePaste(e,ri,2)}
                    ref={el=>refs.current[ri+'-price']=el}/>
                </td>
                <td style={{padding:'3px 8px',textAlign:'right',fontWeight:hasData?500:400,color:hasData?'var(--green)':'var(--grey-200)',fontSize:12}}>
                  {hasData?amt.toLocaleString('en-IN',{minimumFractionDigits:0}):'—'}
                </td>
                <td style={{padding:'3px 4px',textAlign:'center',width:28}}>
                  {hasData&&<button title="Remove this item" onClick={()=>removeRow(row.id)}
                    style={{background:'none',border:'none',cursor:'pointer',color:'var(--grey-400)',fontSize:15,lineHeight:1,padding:'2px 4px'}}
                    onMouseEnter={e=>e.currentTarget.style.color='var(--red)'}
                    onMouseLeave={e=>e.currentTarget.style.color='var(--grey-400)'}>{'×'}</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} style={{padding:'8px',textAlign:'right',fontSize:12,color:'var(--grey-400)'}}>Sub-total</td>
            <td colSpan={2} style={{padding:'8px',textAlign:'right',fontSize:13,fontWeight:600,color:'var(--green)'}}>
              ₹{rows.reduce((s,r)=>s+(parseFloat(r.quantity)||0)*(parseFloat(r.unit_price)||0),0).toLocaleString('en-IN')}
            </td>
          </tr>
        </tfoot>
      </table>
      <button className="btn sm" style={{marginTop:6,border:'1px dashed var(--grey-200)',color:'var(--grey-400)',fontSize:11}} onClick={()=>addRows(10)}>+ Add 10 more rows</button>
    </div>
  );
}




// ── Sub Event Items Table ────────────────────────────────────────────────────
export function SubEventItemsTable({ items, onChange }) {
  const addRow = () => onChange([...items, {id:Date.now(), description:'', quantity:1, unit_price:0}]);
  const removeRow = (id) => onChange(items.filter(r=>r.id!==id));
  const updateRow = (id, field, val) => onChange(items.map(r=>r.id===id?{...r,[field]:val}:r));

  return (
    <div>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead>
          <tr style={{background:'#FCEAF1'}}>
            <th style={{padding:'6px 8px',textAlign:'left',fontWeight:700,color:'#A01044',fontSize:10,textTransform:'uppercase',letterSpacing:'.03em',borderBottom:'1.5px solid #e8185a'}}>Description</th>
            <th style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:'#A01044',fontSize:10,textTransform:'uppercase',letterSpacing:'.03em',borderBottom:'1.5px solid #e8185a',width:'10%'}}>Qty</th>
            <th style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:'#A01044',fontSize:10,textTransform:'uppercase',letterSpacing:'.03em',borderBottom:'1.5px solid #e8185a',width:'18%'}}>Unit price</th>
            <th style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:'#A01044',fontSize:10,textTransform:'uppercase',letterSpacing:'.03em',borderBottom:'1.5px solid #e8185a',width:'18%'}}>Amount</th>
            <th style={{borderBottom:'1.5px solid #e8185a',width:'6%'}}></th>
          </tr>
        </thead>
        <tbody>
          {items.map(row=>(
            <tr key={row.id} style={{borderBottom:'1px solid var(--grey-100)'}}>
              <td style={{padding:'5px 8px'}}>
                <ItemDescInput value={row.description} onChange={v=>updateRow(row.id,'description',v)}/>
              </td>
              <td style={{padding:'5px 8px'}}>
                <ItemNumInput value={row.quantity} onChange={v=>updateRow(row.id,'quantity',v)} align="right"/>
              </td>
              <td style={{padding:'5px 8px'}}>
                <ItemNumInput value={row.unit_price} onChange={v=>updateRow(row.id,'unit_price',v)} align="right"/>
              </td>
              <td style={{padding:'5px 8px',textAlign:'right',fontWeight:500,color:'var(--grey-800)',fontSize:12}}>
                ₹{((parseFloat(row.quantity)||0)*(parseFloat(row.unit_price)||0)).toLocaleString('en-IN')}
              </td>
              <td style={{padding:'5px 8px',textAlign:'center'}}>
                <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--grey-400)',fontSize:14,padding:'2px 4px'}} onClick={()=>removeRow(row.id)}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} style={{padding:'8px',textAlign:'right',fontSize:12,color:'var(--grey-400)'}}>Sub-event total</td>
            <td style={{padding:'8px',textAlign:'right',fontSize:13,fontWeight:600,color:'var(--green)'}}>
              ₹{items.reduce((s,r)=>s+(parseFloat(r.quantity)||0)*(parseFloat(r.unit_price)||0),0).toLocaleString('en-IN')}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      <button className="btn sm" style={{marginTop:8,border:'1px dashed var(--grey-200)',color:'var(--grey-400)'}} onClick={addRow}>+ Add item</button>
    </div>
  );
}

// Stable input components to prevent focus loss
export function ItemDescInput({value, onChange}) {
  return <input style={{border:'none',background:'transparent',fontSize:12,width:'100%',outline:'none',color:'var(--grey-800)'}} value={value} onChange={e=>onChange(e.target.value)} placeholder="Description"/>;
}
export function ItemNumInput({value, onChange, align}) {
  return <input type="number" style={{border:'none',background:'transparent',fontSize:12,width:'100%',outline:'none',textAlign:align||'left',color:'var(--grey-800)',MozAppearance:'textfield'}} value={value} onChange={e=>onChange(e.target.value)}/>;
}

// Per-block toolbar (one per sub-event + the main block): load a template's items into THIS block,
// and import an Excel file into THIS block. Both replace the block's items.
export function SubEventTplBtn({templates, onPick, onImport}) {
  const [open,setOpen]=React.useState(false);
  const fileRef=React.useRef(null);
  const parseExcel=(e)=>{
    const file=e.target.files&&e.target.files[0]; if(e.target) e.target.value='';
    if(!file||!onImport) return;
    const reader=new FileReader();
    reader.onload=(ev)=>{
      try{
        const wb=XLSX.read(ev.target.result,{type:'array'});
        const ws=wb.Sheets[wb.SheetNames[0]];
        let rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
        if(rows.length&&String((rows[0]||[])[0]||'').trim().toLowerCase().startsWith('desc')) rows=rows.slice(1);
        const items=rows.filter(r=>String(r[0]).trim()).map(r=>({id:'i-'+Date.now()+Math.random(),description:String(r[0]).trim(),quantity:parseFloat(String(r[1]).replace(/[^0-9.]/g,''))||1,unit_price:parseFloat(String(r[2]).replace(/[^0-9.]/g,''))||0}));
        if(items.length){ onImport(items); notify(items.length+' row'+(items.length>1?'s':'')+' imported into this section.','success'); } else notify('No rows found in the file.','error');
      }catch(err){ console.error('[Isheeka ERP] excel import failed:',err); notify('Could not read the Excel file.','error'); }
    };
    reader.readAsArrayBuffer(file);
  };
  return (
    <div style={{display:'flex',gap:6,flexShrink:0,alignItems:'center'}}>
      <div style={{position:'relative'}}>
        <button className="btn sm" style={{fontSize:11,padding:'3px 8px'}} onClick={()=>setOpen(v=>!v)} onBlur={()=>setTimeout(()=>setOpen(false),180)}>📋 Template ▾</button>
        {open&&(
          <div style={{position:'absolute',top:'100%',right:0,zIndex:120,background:'white',border:'1px solid var(--grey-200)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-md)',minWidth:190,marginTop:4}}>
            {(templates||[]).length===0&&<div style={{padding:'10px 14px',fontSize:13,color:'var(--grey-400)'}}>No templates</div>}
            {(templates||[]).map(t=>(
              <div key={t.template_id} style={{padding:'9px 14px',fontSize:13,cursor:'pointer',color:'var(--grey-800)',borderBottom:'1px solid var(--grey-100)'}}
                onMouseEnter={e=>e.currentTarget.style.background='var(--grey-50)'} onMouseLeave={e=>e.currentTarget.style.background='white'}
                onMouseDown={()=>{ setOpen(false); onPick(t); }}>
                {t.event_type==='wedding'?'💍':t.event_type==='corporate'?'🏢':t.event_type==='birthday'?'🎂':t.event_type==='anniversary'?'💑':'🎪'} {t.name}
              </div>
            ))}
          </div>
        )}
      </div>
      {onImport&&<><button className="btn sm" style={{fontSize:11,padding:'3px 8px'}} onClick={()=>fileRef.current&&fileRef.current.click()} title="Import line items from an Excel file into this section">⬆️ Excel</button>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{display:'none'}} onChange={parseExcel}/></>}
    </div>
  );
}
