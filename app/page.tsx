'use client';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type Lead={id:number;businessName:string;mapsUrl:string|null;websites:string[];phones:string[];whatsapps:string[];emails:string[];rating:number|null;reviewCount:number;fullAddress:string;country:string;state:string;city:string;category:string;status:string;confidence:string;createdAt:string};
type Summary={total:number;verified:number;withEmail:number;withWhatsapp:number};
type CountryOption={name:string;isoCode:string};
type StateOption={name:string;isoCode:string};
const empty={total:0,verified:0,withEmail:0,withWhatsapp:0};
const date=(v:string)=>new Intl.DateTimeFormat('en',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v));
function Stat({label,value,tone}:{label:string;value:number;tone:string}){return <div className="stat"><i className={tone}>{label[0]}</i><div><small>{label}</small><strong>{value}</strong></div></div>}

export default function Home(){
 const [leads,setLeads]=useState<Lead[]>([]),[summary,setSummary]=useState<Summary>(empty);
 const [loading,setLoading]=useState(true),[running,setRunning]=useState(false),[deleting,setDeleting]=useState<string|null>(null);
 const [q,setQ]=useState(''),[status,setStatus]=useState('all'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[notice,setNotice]=useState('');
 const [countries,setCountries]=useState<CountryOption[]>([]),[states,setStates]=useState<StateOption[]>([]),[cities,setCities]=useState<string[]>([]);
 const [countryCode,setCountryCode]=useState('IN'),[stateCode,setStateCode]=useState('TN'),[city,setCity]=useState('Madurai'),[locationsLoading,setLocationsLoading]=useState(true);
 const [runMode,setRunMode]=useState('now'),[scheduledAt,setScheduledAt]=useState(''),[limitMode,setLimitMode]=useState('all');

 const load=useCallback(async()=>{setLoading(true);try{const p=new URLSearchParams({q,status,from,to}),r=await fetch('/api/leads?'+p),d=await r.json() as {leads:Lead[];summary:Summary};setLeads(d.leads||[]);setSummary(d.summary||empty)}catch{setNotice('Could not load saved leads.')}finally{setLoading(false)}},[q,status,from,to]);
 useEffect(()=>{const t=setTimeout(load,250);return()=>clearTimeout(t)},[load]);
 useEffect(()=>{fetch('/api/locations?type=countries').then(r=>r.json()).then((d:{items:CountryOption[]})=>setCountries(d.items||[])).finally(()=>setLocationsLoading(false))},[]);
 useEffect(()=>{if(!countryCode){setStates([]);return}setLocationsLoading(true);fetch(`/api/locations?type=states&country=${countryCode}`).then(r=>r.json()).then((d:{items:StateOption[]})=>{setStates(d.items||[]);if(!(d.items||[]).some(s=>s.isoCode===stateCode)){setStateCode('');setCity('')}}).finally(()=>setLocationsLoading(false))},[countryCode,stateCode]);
 useEffect(()=>{if(!countryCode||!stateCode){setCities([]);return}setLocationsLoading(true);fetch(`/api/locations?type=cities&country=${countryCode}&state=${stateCode}`).then(r=>r.json()).then((d:{items:string[]})=>{setCities(d.items||[]);if(!(d.items||[]).includes(city))setCity('')}).finally(()=>setLocationsLoading(false))},[countryCode,stateCode,city]);

 async function collect(body:Record<string,FormDataEntryValue>){setRunning(true);setNotice('Collecting every available Google result and enriching official websites…');try{const r=await fetch('/api/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),d=await r.json() as {message?:string;error?:string};if(!r.ok)throw new Error(d.error||'Search failed');setNotice(d.message||'Search complete');await load()}catch(x){setNotice(x instanceof Error?x.message:'Search failed')}finally{setRunning(false)}}
 async function search(e:FormEvent<HTMLFormElement>){e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));if(runMode==='scheduled'){const when=new Date(scheduledAt).getTime(),delay=when-Date.now();if(!scheduledAt||delay<=0){setNotice('Choose a future date and time.');return}setNotice(`Search scheduled for ${new Date(when).toLocaleString()}. Keep this page open until it starts.`);window.setTimeout(()=>collect(body),delay);return}await collect(body)}
 async function deleteData(id?:number){const all=id===undefined;if(!window.confirm(all?'Delete all saved leads? This cannot be undone.':'Delete this lead permanently?'))return;setDeleting(all?'all':String(id));setNotice('');try{const r=await fetch(`/api/leads?${all?'all=true':`id=${id}`}`,{method:'DELETE'}),d=await r.json() as {message?:string;error?:string};if(!r.ok)throw new Error(d.error||'Delete failed');setNotice(d.message||'Data deleted.');await load()}catch(x){setNotice(x instanceof Error?x.message:'Delete failed')}finally{setDeleting(null)}}
 const exportUrl=useMemo(()=>'/api/export?'+new URLSearchParams({q,status,from,to}),[q,status,from,to]);

 return <main>
  <header><a className="brand" href="#top"><b>LF</b><span>LeadForge<small>Business Intelligence</small></span></a><div className="header-actions"><span className="ready"><i/>Collection engine ready</span><span className="avatar">AZ</span></div></header>
  <div className="shell" id="top">
   <aside><nav><a className="active" href="#search">⌕ <span>Lead search</span></a><a href="#leads">◎ <span>All leads</span><b>{summary.total}</b></a><a href="#leads">◷ <span>Search history</span></a><a href="#leads">✓ <span>Validation</span></a><a href="#export">⇩ <span>Exports</span></a></nav><div className="mode"><small>PERSONAL WORKSPACE</small><strong>Professional enrichment</strong><span>Places discovery plus official website contacts.</span></div></aside>
   <section className="content">
    <div className="intro"><div><small>LEAD COLLECTION WORKSPACE</small><h1>Find every available business lead.</h1><p>Paginate Google results, enrich public contacts, deduplicate and export a clean list.</p></div><a id="export" className="export" href={exportUrl}>Download Excel ↓</a></div>
    <form id="search" onSubmit={search} className="search-card">
     <div className="card-title"><div><b>⌕</b><span><strong>Start a comprehensive search</strong><small>Any business category, with website contact enrichment.</small></span></div><em>Places + official websites</em></div>
     <div className="fields">
      <label><span>Country</span><select aria-label="Country" value={countryCode} onChange={e=>{setCountryCode(e.target.value);setStateCode('');setCity('')}} required><option value="">Select country</option>{countries.map(c=><option key={c.isoCode} value={c.isoCode}>{c.name}</option>)}</select><input type="hidden" name="country" value={countries.find(c=>c.isoCode===countryCode)?.name||''}/></label>
      <label><span>State / Province</span><select aria-label="State or province" value={stateCode} onChange={e=>{setStateCode(e.target.value);setCity('')}} disabled={!countryCode||locationsLoading||!states.length} required><option value="">{locationsLoading?'Loading states…':states.length?'Select state':'No states available'}</option>{states.map(s=><option key={s.isoCode} value={s.isoCode}>{s.name}</option>)}</select><input type="hidden" name="state" value={states.find(s=>s.isoCode===stateCode)?.name||''}/></label>
      <label><span>City</span><select aria-label="City" name="city" value={city} onChange={e=>setCity(e.target.value)} disabled={!stateCode||locationsLoading||!cities.length} required><option value="">{locationsLoading?'Loading cities…':cities.length?'Select city':'No cities available'}</option>{cities.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
      <label className="category"><span>Category / Business title</span><input name="category" defaultValue="Dental clinic" required/></label>
      <label><span>Collection size</span><select name="limitMode" value={limitMode} onChange={e=>setLimitMode(e.target.value)}><option value="all">All available (up to 60)</option><option value="custom">Custom limit</option></select></label>
      {limitMode==='custom'&&<label><span>Custom limit</span><input name="limit" type="number" min="1" max="60" defaultValue="20"/></label>}
      <label><span>Start</span><select value={runMode} onChange={e=>setRunMode(e.target.value)}><option value="now">Run now</option><option value="scheduled">Schedule date & time</option></select></label>
      {runMode==='scheduled'&&<label><span>Date and time</span><input type="datetime-local" value={scheduledAt} onChange={e=>setScheduledAt(e.target.value)} required/></label>}
      <button disabled={running||!countryCode||!stateCode||!city}>{running?'Collecting & enriching…':runMode==='scheduled'?'Schedule collection':'Collect all available'} <b>→</b></button>
     </div>
     <p className="source-note">Google currently returns at most 60 businesses per Text Search query. Repeating a search updates matching Place IDs and merges new contacts instead of creating duplicates. Scheduled runs require this page to remain open.</p>
     {notice&&<p className="notice" role="status">{notice}</p>}
     <div className="steps"><span><i>1</i>Discover all pages</span><b>→</b><span><i>2</i>Enrich websites</span><b>→</b><span><i>3</i>Validate & deduplicate</span><b>→</b><span><i>4</i>Export</span></div>
    </form>
    <div className="stats"><Stat label="Total leads" value={summary.total} tone="blue"/><Stat label="High confidence" value={summary.verified} tone="green"/><Stat label="With email" value={summary.withEmail} tone="purple"/><Stat label="With WhatsApp" value={summary.withWhatsapp} tone="amber"/></div>
    <section id="leads" className="leads">
     <div className="leads-head"><div><h2>Collected leads</h2><p>Filter records by the exact date and time they were collected.</p></div><div className="filters"><input aria-label="Search saved leads" placeholder="Search leads" value={q} onChange={e=>setQ(e.target.value)}/><select aria-label="Lead status" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All statuses</option><option>Enriched</option><option>Collected</option></select><label className="filter-date"><span>From date & time</span><input aria-label="From date and time" type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="filter-date"><span>To date & time</span><input aria-label="To date and time" type="datetime-local" value={to} onChange={e=>setTo(e.target.value)}/></label><button className="reset-button" type="button" disabled={!from&&!to} onClick={()=>{setFrom('');setTo('')}}>Reset dates</button><button className="clear-button" type="button" disabled={!summary.total||deleting==='all'} onClick={()=>deleteData()}>{deleting==='all'?'Deleting…':'Clear all'}</button></div></div>
     <div className="table"><table><thead><tr><th>Business</th><th>Location</th><th>All public contacts</th><th>Rating</th><th>Confidence</th><th>Collected</th><th>Action</th></tr></thead><tbody>
      {loading?<tr><td colSpan={7} className="empty">Loading workspace…</td></tr>:!leads.length?<tr><td colSpan={7} className="empty"><strong>No leads yet</strong><small>Run your first search above to collect live business data.</small></td></tr>:leads.map(l=><tr key={l.id}>
       <td><div className="business"><i>{l.businessName.slice(0,2).toUpperCase()}</i><span><strong>{l.businessName}</strong><small>{l.category}</small>{l.mapsUrl&&<a href={l.mapsUrl} target="_blank">Open in Maps ↗</a>}</span></div></td>
       <td><strong>{l.city}, {l.state}</strong><small>{l.fullAddress}</small></td>
       <td className="contacts">{l.phones.map(p=><span key={p}>☎ {p}</span>)}{l.whatsapps.map(p=><span key={'wa'+p}>◉ WhatsApp {p}</span>)}{l.emails.map(e=><span key={e}>✉ {e}</span>)}{l.websites[0]&&<a href={l.websites[0]} target="_blank">Official website ↗</a>}{!l.phones.length&&!l.emails.length&&<small>No public contacts found</small>}</td>
       <td><b className="rating">★ {l.rating||'—'}</b><small>{l.reviewCount} reviews</small></td>
       <td><b className={'confidence '+l.confidence.toLowerCase()}>{l.confidence}</b><small>{l.status}</small></td>
       <td><strong>{date(l.createdAt)}</strong></td>
       <td><button className="delete-button" type="button" disabled={deleting===String(l.id)} onClick={()=>deleteData(l.id)} aria-label={`Delete ${l.businessName}`}>{deleting===String(l.id)?'…':'Delete'}</button></td>
      </tr>)}
     </tbody></table></div>
    </section>
   </section>
  </div>
 </main>
}
