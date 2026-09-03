import { LeadInput, saveLead } from '../../../db/leads';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const clean=(v:unknown)=>String(v||'').trim();
const unique=(values:string[])=>[...new Set(values.map(v=>v.trim()).filter(Boolean))];
const emailPattern=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const normalizePhone=(value:string)=>{const v=value.trim();if(!v||/[a-z]/i.test(v)||/[\/|]/.test(v)||/(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/.test(v)||/^\d(?:\.\d)?\s+(?:19|20)\d{2}/.test(v))return '';const digits=v.replace(/\D/g,'');if(digits.length<8||digits.length>15||/012345|123456|234567|345678|456789|567890|678910|987654|876543/.test(digits))return '';return v.startsWith('+')?`+${digits}`:digits};
const uniquePhones=(values:string[])=>{const seen=new Set<string>();return values.map(normalizePhone).filter(Boolean).filter(v=>{const digits=v.replace(/\D/g,''),key=digits.length>=10?digits.slice(-10):digits;if(seen.has(key))return false;seen.add(key);return true})};
const normalizeEmails=(values:string[])=>unique(values.flatMap(raw=>{let value=raw;try{value=decodeURIComponent(raw)}catch{}return value.match(emailPattern)||[]})).map(v=>v.toLowerCase()).filter(v=>{const [local,domain]=v.split('@');return Boolean(local&&domain&&local.length<=64&&domain.length<=253&&!/^(example|test|testing|demo|dummy|sample|email|yourname|name|user|u00[0-9a-f]*)$/i.test(local)&&!/(example\.(com|org|net)|test\.com|domain\.com)$/i.test(domain)&&/^[a-z0-9.-]+\.[a-z]{2,24}$/i.test(domain))});

type GooglePlace={id:string;displayName?:{text:string};formattedAddress?:string;googleMapsUri?:string;websiteUri?:string;nationalPhoneNumber?:string;internationalPhoneNumber?:string;rating?:number;userRatingCount?:number};
type SearchResponse={places?:GooglePlace[];nextPageToken?:string};
type AbstractPhoneResponse={valid?:boolean;phone_validation?:{is_valid?:boolean};format?:{international?:string};phone_format?:{international?:string}};
type AbstractEmailResponse={email_deliverability?:{status?:string;is_format_valid?:boolean;is_mx_valid?:boolean;is_smtp_valid?:boolean};email_quality?:{is_disposable?:boolean};email_risk?:{address_risk_status?:string}};

async function validatePhone(phone:string,keepTrustedOnError=false){
 const apiKey=process.env.ABSTRACT_PHONE_INTELLIGENCE_API_KEY;
 if(!apiKey)return {phone:keepTrustedOnError?phone:'',verified:false};
 try{
  const url=new URL('https://phoneintelligence.abstractapi.com/v1/');
  url.searchParams.set('api_key',apiKey);
  url.searchParams.set('phone',phone);
  const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000),cache:'no-store'});
  if(!response.ok)throw new Error(`AbstractAPI returned ${response.status}`);
  const data=await response.json() as AbstractPhoneResponse;
  const valid=data.valid??data.phone_validation?.is_valid??false;
  const international=data.format?.international||data.phone_format?.international||phone;
  return {phone:valid?normalizePhone(international):'',verified:valid};
 }catch(error){
  console.error('AbstractAPI phone validation failed; keeping the Google-listed phone.',error);
  return {phone:keepTrustedOnError?phone:'',verified:false};
 }
}

async function validateEmail(email:string){
 const apiKey=process.env.ABSTRACT_EMAIL_REPUTATION_API_KEY;
 if(!apiKey)return {email:'',verified:false};
 try{
  const url=new URL('https://emailreputation.abstractapi.com/v1/');
  url.searchParams.set('email',email);
  const response=await fetch(url,{headers:{accept:'application/json',authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(8000),cache:'no-store'});
  if(!response.ok)throw new Error(`AbstractAPI returned ${response.status}`);
  const data=await response.json() as AbstractEmailResponse;
  const delivery=data.email_deliverability,status=delivery?.status?.toLowerCase(),risk=data.email_risk?.address_risk_status?.toLowerCase();
  const valid=Boolean(delivery?.is_format_valid&&delivery?.is_mx_valid&&status!=='undeliverable'&&!data.email_quality?.is_disposable&&risk!=='high');
  return {email:valid?email:'',verified:valid};
 }catch(error){
  console.error('AbstractAPI email validation failed; dropping the unverified email.',error);
  return {email:'',verified:false};
 }
}

async function validatePhones(googlePhones:string[],websitePhones:string[]){
 const googleKeys=new Set(googlePhones.map(phone=>phone.replace(/\D/g,'').slice(-10)));
 const candidates=uniquePhones([...googlePhones,...websitePhones]).slice(0,8);
 const checked=await Promise.all(candidates.map(phone=>validatePhone(phone,googleKeys.has(phone.replace(/\D/g,'').slice(-10)))));
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
function safeWebsite(value:string){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!['localhost','127.0.0.1','::1'].includes(u.hostname)?u:null}catch{return null}}
async function publicTarget(url:URL){if(isIP(url.hostname))return !privateIp(url.hostname);const addresses=await lookup(url.hostname,{all:true});return addresses.length>0&&addresses.every(a=>!privateIp(a.address))}
function contactLinks(html:string,base:URL){const links=[...html.matchAll(/href=["']([^"']+)["']/gi)].map(m=>m[1]);return unique(links.filter(h=>/(contact|about|reach|support)/i.test(h)).map(h=>{try{return new URL(h,base).toString()}catch{return ''}})).filter(h=>{try{return new URL(h).origin===base.origin}catch{return false}}).slice(0,3)}
function contacts(html:string){const withoutCode=html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,' '),text=withoutCode.replace(/<[^>]+>/gi,' '),mailto=[...withoutCode.matchAll(/href=["']mailto:([^"'?]+)/gi)].map(m=>m[1]),emails=normalizeEmails([...mailto,...(text.match(emailPattern)||[])]);const anchorPhones=[...withoutCode.matchAll(/<a[^>]+href=["'](?:tel:|sms:)([^"'?]+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m=>{const target=decodeURIComponent(m[1]),visible=m[2].replace(/<[^>]+>/g,' ').match(/\+?[\d\s().-]{8,}/)?.[0]||'',cleanVisible=normalizePhone(visible),cleanTarget=normalizePhone(target);return cleanVisible&&cleanVisible.replace(/\D/g,'').slice(-10)!==cleanTarget.replace(/\D/g,'').slice(-10)?cleanVisible:cleanTarget||cleanVisible}),schemaPhones=[...withoutCode.matchAll(/["']telephone["']\s*:\s*["']([^"']+)["']/gi)].map(m=>m[1]),labelledPhones=[...text.matchAll(/(?:phone|mobile|contact|call|tel|whatsapp)\s*[:\-]?\s*(\+?[\d\s().-]{8,})/gi)].map(m=>m[1]),phones=uniquePhones([...anchorPhones,...schemaPhones,...labelledPhones]).slice(0,12),phoneKeys=new Set(phones.map(p=>p.replace(/\D/g,'').slice(-10))),whatsapps=uniquePhones([...withoutCode.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\+?\d{8,15})/gi)].map(m=>m[1])).filter(p=>phoneKeys.has(p.replace(/\D/g,'').slice(-10))).slice(0,8);return {emails:emails.slice(0,12),phones,whatsapps}}
async function fetchHtml(url:string){let target=safeWebsite(url);if(!target)return '';for(let hop=0;hop<4;hop++){if(!await publicTarget(target))return '';const r=await fetch(target,{headers:{'user-agent':'LeadForge/1.0 (+public business contact enrichment)','accept':'text/html'},redirect:'manual',signal:AbortSignal.timeout(10000)});if(r.status>=300&&r.status<400){const next=r.headers.get('location');if(!next)return '';target=safeWebsite(new URL(next,target).toString());if(!target)return '';continue}if(!r.ok||!String(r.headers.get('content-type')).includes('text/html'))return '';const length=Number(r.headers.get('content-length')||0);if(length>2_000_000)return '';return (await r.text()).slice(0,2_000_000)}return ''}
async function enrichWebsite(website?:string){if(!website)return {emails:[],phones:[],whatsapps:[]};try{const base=safeWebsite(website);if(!base)return {emails:[],phones:[],whatsapps:[]};const home=await fetchHtml(base.toString()),pages=[home];pages.push(...await Promise.all(contactLinks(home,base).map(fetchHtml)));return pages.reduce((all,html)=>{const c=contacts(html);return {emails:unique([...all.emails,...c.emails]),phones:unique([...all.phones,...c.phones]),whatsapps:unique([...all.whatsapps,...c.whatsapps])}},{emails:[] as string[],phones:[] as string[],whatsapps:[] as string[]})}catch{return {emails:[],phones:[],whatsapps:[]}}}

async function google(category:string,city:string,state:string,country:string,requested:number|null):Promise<LeadInput[]>{
 const key=process.env.GOOGLE_MAPS_API_KEY;if(!key)return demo(category,city,state,country,requested||10);
 const textQuery=`${category} in ${city}, ${state}, ${country}`;
 const found=new Map<string,GooglePlace>();let pageToken:string|undefined;
 do{const body:Record<string,unknown>={textQuery,pageSize:Math.min(20,requested?Math.max(1,requested-found.size):20)};if(pageToken)body.pageToken=pageToken;const r=await fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'content-type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.rating,places.userRatingCount,nextPageToken'},body:JSON.stringify(body)});if(!r.ok)throw new Error('Google Places request failed. Check the API key, Places API access, and billing configuration.');const data=await r.json() as SearchResponse;for(const p of data.places||[])found.set(p.id,p);pageToken=data.nextPageToken}while(pageToken&&found.size<Math.min(requested||60,60));
 const places=[...found.values()].slice(0,requested||60),leads:LeadInput[]=[];
 for(let i=0;i<places.length;i+=4){const batch=places.slice(i,i+4);leads.push(...await Promise.all(batch.map(async p=>{const extra=await enrichWebsite(p.websiteUri),googlePhones=uniquePhones([p.internationalPhoneNumber||'',p.nationalPhoneNumber||'']).slice(0,1),[validated,emailChecks]=await Promise.all([validatePhones(googlePhones,extra.phones),Promise.all(extra.emails.slice(0,8).map(validateEmail))]),phones=validated.phones,phoneKeys=new Set(phones.map(phone=>phone.replace(/\D/g,'').slice(-10))),whatsapps=extra.whatsapps.filter(phone=>phoneKeys.has(phone.replace(/\D/g,'').slice(-10))).slice(0,4),emails=unique(emailChecks.map(result=>result.email)).slice(0,4),emailVerified=emailChecks.some(result=>result.verified),businessName=p.displayName?.text||category,fullAddress=p.formattedAddress||`${city}, ${state}`,query=encodeURIComponent(`${businessName}, ${fullAddress}`);return {businessName,placeId:p.id,mapsUrl:`https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${encodeURIComponent(p.id)}`,websites:p.websiteUri?[p.websiteUri]:[],phones,whatsapps,emails,rating:p.rating,reviewCount:p.userRatingCount||0,fullAddress,country,state,city,category,status:validated.verified||emailVerified?'Validated':whatsapps.length?'Enriched':'Collected',confidence:validated.verified&&emailVerified?'High':validated.verified||emailVerified||p.websiteUri?'Medium':'Low'}})))}return leads;
}

export async function POST(req:Request){try{const b=await req.json() as Record<string,unknown>,country=clean(b.country),state=clean(b.state),city=clean(b.city),category=clean(b.category),mode=clean(b.limitMode)||'all',requested=mode==='all'?null:Math.min(60,Math.max(1,Number(b.limit)||20));if(!country||!state||!city||!category)return Response.json({error:'Country, state, city and category are required.'},{status:400});const leads=await google(category,city,state,country,requested);for(const l of leads)await saveLead(l);return Response.json({message:`Collected and deduplicated ${leads.length} businesses. Google results and official websites were checked. ${process.env.ABSTRACT_PHONE_INTELLIGENCE_API_KEY?'Phone intelligence enabled.':'Phone intelligence is not configured.'} ${process.env.ABSTRACT_EMAIL_REPUTATION_API_KEY?'Email reputation enabled.':'Email reputation is not configured.'}`,collected:leads.length})}catch(e){return Response.json({error:e instanceof Error?e.message:'Search failed'},{status:500})}}
