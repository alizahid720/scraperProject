import { LeadInput, saveLead } from '../../../db/leads';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const clean=(v:unknown)=>String(v||'').trim();
const unique=(values:string[])=>[...new Set(values.map(v=>v.trim()).filter(Boolean))];
const emailPattern=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const normalizePhone=(value:string)=>{const v=value.trim();if(!v||/[a-z]/i.test(v)||/[\/|]/.test(v)||/(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/.test(v)||/^\d(?:\.\d)?\s+(?:19|20)\d{2}/.test(v))return '';const digits=v.replace(/\D/g,'');if(digits.startsWith('91')&&digits.length!==12)return '';if(!digits.startsWith('91')&&(digits.length<10||digits.length>11))return '';if(/(\d)\1{7,}/.test(digits)||/012345|123456|234567|345678|456789|567890|678910|987654|876543/.test(digits))return '';return v.startsWith('+')?`+${digits}`:digits};
const expandPhoneRange=(value:string)=>{const match=value.match(/(\d{3,5})\s*[- ]\s*(\d{5,8})\s*[-–]\s*(\d{2})(?!\d)/);if(!match)return [value];const start=Number(match[2].slice(-2)),end=Number(match[3]);if(end<start||end-start>9)return [value];const stem=match[2].slice(0,-2);return Array.from({length:end-start+1},(_,index)=>`${match[1]}${stem}${start+index}`)};
const uniquePhones=(values:string[])=>{const seen=new Set<string>();return values.flatMap(expandPhoneRange).map(normalizePhone).filter(Boolean).filter(v=>{const digits=v.replace(/\D/g,''),key=digits.length>=10?digits.slice(-10):digits;if(seen.has(key))return false;seen.add(key);return true})};
const normalizeEmails=(values:string[])=>unique(values.flatMap(raw=>{let value=raw;try{value=decodeURIComponent(raw)}catch{}return value.match(emailPattern)||[]})).map(v=>v.toLowerCase()).filter(v=>{const [local,domain]=v.split('@');return Boolean(local&&domain&&local.length<=64&&domain.length<=253&&!/^(example|test|testing|demo|dummy|sample|email|yourname|name|user|u00[0-9a-f]*)$/i.test(local)&&!/(example\.(com|org|net)|test\.com|domain\.com)$/i.test(domain)&&/^[a-z0-9.-]+\.[a-z]{2,24}$/i.test(domain))});

type GooglePlace={id:string;displayName?:{text:string};formattedAddress?:string;googleMapsUri?:string;websiteUri?:string;nationalPhoneNumber?:string;internationalPhoneNumber?:string;rating?:number;userRatingCount?:number};
type SearchResponse={places?:GooglePlace[];nextPageToken?:string};
type AbstractPhoneResponse={valid?:boolean;phone_validation?:{is_valid?:boolean};format?:{international?:string};phone_format?:{international?:string}};
type AbstractEmailResponse={email_deliverability?:{status?:string;is_format_valid?:boolean;is_mx_valid?:boolean;is_smtp_valid?:boolean};email_quality?:{is_disposable?:boolean};email_risk?:{address_risk_status?:string}};
type OutscraperResponse={status?:string;data?:unknown;error?:boolean;errorMessage?:string};

export const maxDuration=300;

async function validatePhone(phone:string,keepTrustedOnError=false){
 const apiKey=process.env.ABSTRACT_PHONE_INTELLIGENCE_API_KEY;
 if(!apiKey)return {phone:keepTrustedOnError?phone:'',verified:false};
 try{
  const url=new URL('https://phoneintelligence.abstractapi.com/v1/');
  url.searchParams.set('api_key',apiKey);
  const digits=phone.replace(/\D/g,''),validationPhone=digits.length===10?`+91${digits}`:digits.length===11&&digits.startsWith('0')?`+91${digits.slice(1)}`:phone;
  url.searchParams.set('phone',validationPhone);
  const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000),cache:'no-store'});
  if(!response.ok)throw new Error(`AbstractAPI returned ${response.status}`);
  const data=await response.json() as AbstractPhoneResponse;
  const valid=data.valid??data.phone_validation?.is_valid??false;
  const international=data.format?.international||data.phone_format?.international||phone;
  return {phone:valid?normalizePhone(international):'',verified:valid};
 }catch(error){
  console.error('AbstractAPI phone validation unavailable; retaining only source-matched contact data.',error);
  return {phone:keepTrustedOnError?phone:'',verified:false};
 }
}

async function validateEmail(email:string,keepTrustedOnError=true){
 const apiKey=process.env.ABSTRACT_EMAIL_REPUTATION_API_KEY;
 if(!apiKey)return {email:keepTrustedOnError?email:'',verified:false};
 try{
  const url=new URL('https://emailreputation.abstractapi.com/v1/');
  url.searchParams.set('api_key',apiKey);
  url.searchParams.set('email',email);
  const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000),cache:'no-store'});
  if(!response.ok)throw new Error(`AbstractAPI returned ${response.status}`);
  const data=await response.json() as AbstractEmailResponse;
  const delivery=data.email_deliverability,status=delivery?.status?.toLowerCase(),risk=data.email_risk?.address_risk_status?.toLowerCase();
  const valid=Boolean(delivery?.is_format_valid&&delivery?.is_mx_valid&&status!=='undeliverable'&&!data.email_quality?.is_disposable&&risk!=='high');
  return {email:valid?email:'',verified:valid};
 }catch(error){
  console.error('AbstractAPI email validation failed; dropping the unverified email.',error);
  return {email:keepTrustedOnError?email:'',verified:false};
 }
}

async function validatePhones(googlePhones:string[],websitePhones:string[]){
 const trusted=new Set(uniquePhones([...googlePhones,...websitePhones]).map(phone=>phone.replace(/\D/g,'').slice(-10)));
 const candidates=uniquePhones([...googlePhones,...websitePhones]).slice(0,8);
 const checked=await Promise.all(candidates.map(phone=>validatePhone(phone,trusted.has(phone.replace(/\D/g,'').slice(-10)))));
 return {
  phones:uniquePhones(checked.map(result=>result.phone)).slice(0,4),
  verified:checked.some(result=>result.verified)
 };
}

function demo(category:string,city:string,state:string,country:string,count:number):LeadInput[]{
 const names=['Carewell','Prime','Aster','City','Nova','Harmony','Greenleaf','Sunrise','Apollo','Everbright'];
 return names.slice(0,Math.min(count,10)).map((n,i)=>({businessName:`${n} ${category}`,mapsUrl:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${n} ${category} ${city}`)}`,websites:[],phones:[],whatsapps:[],emails:[],rating:4+(i%8)/10,reviewCount:32+i*17,fullAddress:`${12+i}, Central Road, ${city}, ${state}`,country,state,city,category,status:'Collected',confidence:'Low'}));
}

function privateIp(ip:string){return ip==='::1'||ip.startsWith('10.')||ip.startsWith('127.')||ip.startsWith('169.254.')||ip.startsWith('192.168.')||/^172\.(1[6-9]|2\d|3[01])\./.test(ip)||ip.startsWith('fc')||ip.startsWith('fd')||ip.startsWith('fe80:')}
function safeWebsite(value:string){try{let source=value.trim();source=source.replace(/\/%3[fF]([^#]*)$/,(_,query:string)=>`/?${decodeURIComponent(query)}`);const u=new URL(source);u.hash='';return ['http:','https:'].includes(u.protocol)&&!['localhost','127.0.0.1','::1'].includes(u.hostname)?u:null}catch{return null}}
async function publicTarget(url:URL){if(isIP(url.hostname))return !privateIp(url.hostname);const addresses=await lookup(url.hostname,{all:true});return addresses.length>0&&addresses.every(a=>!privateIp(a.address))}
function contactLinks(html:string,base:URL){const links=[...html.matchAll(/href=["']([^"']+)["']/gi)].map(m=>m[1]);return unique(links.filter(h=>/(contact|about|reach|support)/i.test(h)).map(h=>{try{return new URL(h,base).toString()}catch{return ''}})).filter(h=>{try{return new URL(h).origin===base.origin}catch{return false}}).slice(0,3)}
function contacts(html:string){const withoutCode=html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,' '),text=withoutCode.replace(/<[^>]+>/gi,' '),mailto=[...withoutCode.matchAll(/href=["']mailto:([^"'?]+)/gi)].map(m=>m[1]),emails=normalizeEmails([...mailto,...(text.match(emailPattern)||[])]);const anchorPhones=[...withoutCode.matchAll(/<a[^>]+href=["'](?:tel:|sms:)([^"'?]+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m=>{const target=decodeURIComponent(m[1]),visible=m[2].replace(/<[^>]+>/g,' ').match(/\+?[\d\s().-]{8,}/)?.[0]||'',cleanVisible=normalizePhone(visible),cleanTarget=normalizePhone(target);return cleanVisible&&cleanVisible.replace(/\D/g,'').slice(-10)!==cleanTarget.replace(/\D/g,'').slice(-10)?cleanVisible:cleanTarget||cleanVisible}),schemaPhones=[...withoutCode.matchAll(/["']telephone["']\s*:\s*["']([^"']+)["']/gi)].map(m=>m[1]),labelledPhones=[...text.matchAll(/(?:phone|mobile|contact|call|tel|whatsapp)\s*[:\-]?\s*(\+?[\d\s().-]{8,})/gi)].map(m=>m[1]),internationalPhones=[...text.matchAll(/(?:^|[^\d])(\+\d[\d\s().-]{6,18}\d)(?!\d)/g)].map(m=>m[1]),phones=uniquePhones([...anchorPhones,...schemaPhones,...labelledPhones,...internationalPhones]).slice(0,12),phoneKeys=new Set(phones.map(p=>p.replace(/\D/g,'').slice(-10))),whatsapps=uniquePhones([...withoutCode.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\+?\d{8,15})/gi)].map(m=>m[1])).filter(p=>phoneKeys.has(p.replace(/\D/g,'').slice(-10))).slice(0,8);return {emails:emails.slice(0,12),phones,whatsapps}}
async function fetchHtml(url:string){let target=safeWebsite(url);if(!target)return '';for(let hop=0;hop<4;hop++){if(!await publicTarget(target))return '';const r=await fetch(target,{headers:{'user-agent':'LeadForge/1.0 (+public business contact enrichment)','accept':'text/html'},redirect:'manual',signal:AbortSignal.timeout(10000)});if(r.status>=300&&r.status<400){const next=r.headers.get('location');if(!next)return '';target=safeWebsite(new URL(next,target).toString());if(!target)return '';continue}if(!r.ok||!String(r.headers.get('content-type')).includes('text/html'))return '';const length=Number(r.headers.get('content-length')||0);if(length>2_000_000)return '';return (await r.text()).slice(0,2_000_000)}return ''}
type EnrichmentContext={businessName:string;fullAddress:string;city:string;state:string};
const normalizedWords=(value:string)=>value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();
const identityTokens=(value:string)=>normalizedWords(value).split(' ').filter(token=>token.length>=4&&!['dental','clinic','hospital','centre','center','care','best','india'].includes(token));
function relevantPage(html:string,url:URL,context:EnrichmentContext){const text=normalizedWords(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi,' ')),host=normalizedWords(url.hostname.replace(/^www\./,'')),nameTokens=identityTokens(context.businessName),addressTokens=identityTokens(`${context.fullAddress} ${context.city}`),city=normalizedWords(context.city.split(',').pop()||context.city),state=normalizedWords(context.state);const identity=nameTokens.length===0||nameTokens.some(token=>host.includes(token)||text.includes(token));const location=(city.length>=4&&text.includes(city))||(state.length>=4&&text.includes(state))||addressTokens.some(token=>text.includes(token));if(!identity||!location)return '';const specific=addressTokens.filter(token=>token!==city&&token!==state);const positions=specific.flatMap(token=>{const found:number[]=[];let at=text.indexOf(token);while(at>=0&&found.length<4){found.push(at);at=text.indexOf(token,at+token.length)}return found});if(!positions.length)return html;return positions.map(at=>text.slice(Math.max(0,at-900),Math.min(text.length,at+1300))).join(' ')}
async function enrichWebsite(website:string|undefined,context:EnrichmentContext){if(!website)return {emails:[],phones:[],whatsapps:[],matched:false};try{const base=safeWebsite(website);if(!base)return {emails:[],phones:[],whatsapps:[],matched:false};const home=await fetchHtml(base.toString()),pages=[{html:home,url:base}];const links=contactLinks(home,base);const linked=await Promise.all(links.map(async link=>({html:await fetchHtml(link),url:new URL(link)})));pages.push(...linked);return pages.reduce((all,page)=>{const scoped=relevantPage(page.html,page.url,context);if(!scoped)return all;const c=contacts(scoped);return {emails:unique([...all.emails,...c.emails]),phones:uniquePhones([...all.phones,...c.phones]),whatsapps:uniquePhones([...all.whatsapps,...c.whatsapps]),matched:true}},{emails:[] as string[],phones:[] as string[],whatsapps:[] as string[],matched:false})}catch{return {emails:[],phones:[],whatsapps:[],matched:false}}}
async function enrichWebsites(websites:string[],context:EnrichmentContext){const results=await Promise.all(websites.map(website=>enrichWebsite(website,context)));return results.reduce((all,result)=>({emails:unique([...all.emails,...result.emails]),phones:uniquePhones([...all.phones,...result.phones]),whatsapps:uniquePhones([...all.whatsapps,...result.whatsapps]),matched:all.matched||result.matched}),{emails:[] as string[],phones:[] as string[],whatsapps:[] as string[],matched:false})}

function nestedStrings(value:unknown):string[]{
 if(typeof value==='string'||typeof value==='number')return [String(value)];
 if(Array.isArray(value))return value.flatMap(nestedStrings);
 if(value&&typeof value==='object')return Object.values(value as Record<string,unknown>).flatMap(nestedStrings);
 return [];
}

function valuesFor(place:Record<string,unknown>,pattern:RegExp){return Object.entries(place).filter(([key])=>pattern.test(key)).flatMap(([,value])=>nestedStrings(value))}
function websiteValues(place:Record<string,unknown>){const normalize=(values:string[])=>unique(values.map(value=>safeWebsite(/^https?:\/\//i.test(value)?value:`https://${value}`)?.toString()||'').filter(Boolean));const listed=normalize(valuesFor(place,/^website$/i));if(listed.length)return listed.slice(0,1);return normalize(valuesFor(place,/^(websites|site|domain|domains|company_website|company_websites)$/i)).slice(0,1)}
function relevantEmails(values:string[],websites:string[]){const hosts=websites.flatMap(website=>{try{return [new URL(website).hostname.toLowerCase().replace(/^www\./,'')]}catch{return []}}),publicDomains=new Set(['gmail.com','googlemail.com','yahoo.com','yahoo.co.in','outlook.com','hotmail.com','live.com','icloud.com','proton.me','protonmail.com']);return normalizeEmails(values).filter(email=>{const domain=email.split('@')[1];return publicDomains.has(domain)||hosts.some(host=>domain===host||domain.endsWith(`.${host}`)||host.endsWith(`.${domain}`))})}
function outscraperPlaces(data:unknown):Record<string,unknown>[] {const rows=Array.isArray(data)?data:[];return (Array.isArray(rows[0])?rows.flat():rows).filter(value=>value&&typeof value==='object') as Record<string,unknown>[]}

async function outscraper(category:string,city:string,state:string,country:string,requested:number|null):Promise<LeadInput[]>{
 const apiKey=process.env.OUTSCRAPER_API_KEY;
 if(!apiKey)return google(category,city,state,country,requested);
 const url=new URL('https://api.outscraper.cloud/google-maps-search');
 url.searchParams.set('query',`${category}, ${city}, ${state}, ${country}`);
 url.searchParams.set('limit',String(requested||500));
 url.searchParams.set('dropDuplicates','true');
 url.searchParams.set('async','false');
 url.searchParams.append('enrichment','contacts_n_leads');
 url.searchParams.append('enrichment','company_websites_finder');
 const response=await fetch(url,{headers:{'X-API-KEY':apiKey,accept:'application/json'},signal:AbortSignal.timeout(280000),cache:'no-store'});
 const payload=await response.json().catch(()=>({})) as OutscraperResponse;
 if(!response.ok||payload.error)throw new Error(payload.errorMessage||`Outscraper request failed (${response.status}).`);
 if(payload.status&&payload.status.toLowerCase()!=='success')throw new Error(`Outscraper job did not complete synchronously (${payload.status}). Please retry.`);
 const places=outscraperPlaces(payload.data),leads:LeadInput[]=[];
 for(let i=0;i<places.length;i+=4){
  const batch=places.slice(i,i+4);
  leads.push(...await Promise.all(batch.map(async place=>{
   const businessName=clean(place.name)||category,fullAddress=clean(place.full_address||place.address)||`${city}, ${state}`;
   const websites=websiteValues(place),websiteExtra=await enrichWebsites(websites,{businessName,fullAddress,city,state});
   const listedPhones=uniquePhones(valuesFor(place,/^(phone|phone_number|primary_phone)$/i)).slice(0,1);
   const discoveredPhones=websiteExtra.phones;
   const providerEmails=websiteExtra.matched?valuesFor(place,/email/i):[];
   const discoveredEmails=relevantEmails([...providerEmails,...websiteExtra.emails],websites);
   const [validated,emailChecks]=await Promise.all([validatePhones(listedPhones,discoveredPhones),Promise.all(discoveredEmails.slice(0,8).map(email=>validateEmail(email)))]);
   const phones=validated.phones,phoneKeys=new Set(phones.map(phone=>phone.replace(/\D/g,'').slice(-10)));
   const whatsapps=websiteExtra.whatsapps.filter(phone=>phoneKeys.has(phone.replace(/\D/g,'').slice(-10))).slice(0,4);
   const emails=unique(emailChecks.map(result=>result.email)).slice(0,4),emailVerified=emailChecks.some(result=>result.verified);
   const mapsUrl=clean(place.location_link)||`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${businessName}, ${fullAddress}`)}`;
   const hasVerifiedContact=validated.verified||emailVerified;
   return {businessName,placeId:clean(place.place_id||place.google_id),mapsUrl,websites:websiteExtra.matched?websites:[],phones,whatsapps,emails,rating:Number(place.rating)||null,reviewCount:Number(place.reviews)||0,fullAddress,country:clean(place.country)||country,state:clean(place.state)||state,city:clean(place.city)||city,category,status:hasVerifiedContact?'Validated':websiteExtra.matched&&(emails.length+phones.length>listedPhones.length)?'Enriched':'Collected',confidence:validated.verified&&emailVerified&&websiteExtra.matched?'High':hasVerifiedContact||websiteExtra.matched?'Medium':'Low'};
  })));
 }
 return leads;
}

async function google(category:string,city:string,state:string,country:string,requested:number|null):Promise<LeadInput[]>{
 const key=process.env.GOOGLE_MAPS_API_KEY;if(!key)return demo(category,city,state,country,requested||10);
 const textQuery=`${category} in ${city}, ${state}, ${country}`;
 const found=new Map<string,GooglePlace>();let pageToken:string|undefined;
 do{const body:Record<string,unknown>={textQuery,pageSize:Math.min(20,requested?Math.max(1,requested-found.size):20)};if(pageToken)body.pageToken=pageToken;const r=await fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'content-type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.rating,places.userRatingCount,nextPageToken'},body:JSON.stringify(body)});if(!r.ok)throw new Error('Google Places request failed. Check the API key, Places API access, and billing configuration.');const data=await r.json() as SearchResponse;for(const p of data.places||[])found.set(p.id,p);pageToken=data.nextPageToken}while(pageToken&&found.size<Math.min(requested||60,60));
 const places=[...found.values()].slice(0,requested||60),leads:LeadInput[]=[];
 for(let i=0;i<places.length;i+=4){const batch=places.slice(i,i+4);leads.push(...await Promise.all(batch.map(async p=>{const businessName=p.displayName?.text||category,fullAddress=p.formattedAddress||`${city}, ${state}`,extra=await enrichWebsite(p.websiteUri,{businessName,fullAddress,city,state}),googlePhones=uniquePhones([p.internationalPhoneNumber||'',p.nationalPhoneNumber||'']).slice(0,1),[validated,emailChecks]=await Promise.all([validatePhones(googlePhones,extra.phones),Promise.all(extra.emails.slice(0,8).map(email=>validateEmail(email)))]),phones=validated.phones,phoneKeys=new Set(phones.map(phone=>phone.replace(/\D/g,'').slice(-10))),whatsapps=extra.whatsapps.filter(phone=>phoneKeys.has(phone.replace(/\D/g,'').slice(-10))).slice(0,4),emails=unique(emailChecks.map(result=>result.email)).slice(0,4),emailVerified=emailChecks.some(result=>result.verified),query=encodeURIComponent(`${businessName}, ${fullAddress}`),hasVerifiedContact=validated.verified||emailVerified;return {businessName,placeId:p.id,mapsUrl:`https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${encodeURIComponent(p.id)}`,websites:p.websiteUri&&extra.matched?[safeWebsite(p.websiteUri)?.toString()||p.websiteUri]:[],phones,whatsapps,emails,rating:p.rating,reviewCount:p.userRatingCount||0,fullAddress,country,state,city,category,status:hasVerifiedContact?'Validated':extra.matched&&(emails.length+phones.length>googlePhones.length)?'Enriched':'Collected',confidence:validated.verified&&emailVerified&&extra.matched?'High':hasVerifiedContact||extra.matched?'Medium':'Low'}})))}return leads;
}

function sameOrganization(a:LeadInput,b:LeadInput){const left=new Set(identityTokens(a.businessName)),right=identityTokens(b.businessName);return right.some(token=>left.has(token))}
function removeCrossBusinessContactLeaks(leads:LeadInput[]){
 const phoneOwners=new Map<string,number[]>(),emailOwners=new Map<string,number[]>();
 leads.forEach((lead,index)=>{(lead.phones||[]).forEach(phone=>{const key=phone.replace(/\D/g,'').slice(-10);phoneOwners.set(key,[...(phoneOwners.get(key)||[]),index])});(lead.emails||[]).forEach(email=>emailOwners.set(email.toLowerCase(),[...(emailOwners.get(email.toLowerCase())||[]),index]))});
 for(const [key,owners] of phoneOwners){const uniqueOwners=[...new Set(owners)];if(uniqueOwners.length<2||uniqueOwners.every(index=>sameOrganization(leads[uniqueOwners[0]],leads[index])))continue;for(const index of uniqueOwners){const phones=leads[index].phones||[];if(phones[0]?.replace(/\D/g,'').slice(-10)!==key)leads[index].phones=phones.filter(phone=>phone.replace(/\D/g,'').slice(-10)!==key)}}
 for(const [email,owners] of emailOwners){const uniqueOwners=[...new Set(owners)];if(uniqueOwners.length<2||uniqueOwners.every(index=>sameOrganization(leads[uniqueOwners[0]],leads[index])))continue;for(const index of uniqueOwners)leads[index].emails=(leads[index].emails||[]).filter(value=>value.toLowerCase()!==email)}
 return leads;
}

export async function POST(req:Request){try{const b=await req.json() as Record<string,unknown>,country=clean(b.country),state=clean(b.state),city=clean(b.city),category=clean(b.category),mode=clean(b.limitMode)||'all',requested=mode==='all'?null:Math.min(500,Math.max(1,Number(b.limit)||20));if(!country||!state||!city||!category)return Response.json({error:'Country, state, city and category are required.'},{status:400});const leads=removeCrossBusinessContactLeaks(await outscraper(category,city,state,country,requested));for(const l of leads)await saveLead(l);return Response.json({message:`Collected and quality-checked ${leads.length} businesses using ${process.env.OUTSCRAPER_API_KEY?'Outscraper':'Google Places'}. Businesses without websites are included. Contacts were matched to the business location, normalized, deduplicated, and validated where API results were available.`,collected:leads.length})}catch(e){return Response.json({error:e instanceof Error?e.message:'Search failed'},{status:500})}}
