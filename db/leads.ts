import { neon } from '@neondatabase/serverless';

export type LeadInput={businessName:string;placeId?:string;mapsUrl?:string;websites?:string[];phones?:string[];whatsapps?:string[];emails?:string[];rating?:number|null;reviewCount?:number;fullAddress:string;country:string;state:string;city:string;category:string;status?:string;confidence?:string};
export type LeadRecord={id:number;businessName:unknown;mapsUrl:unknown;websites:string[];phones:string[];whatsapps:string[];emails:string[];rating:number|null;reviewCount:number;fullAddress:unknown;country:unknown;state:unknown;city:unknown;category:unknown;status:unknown;confidence:unknown;createdAt:string};

const table=`CREATE TABLE IF NOT EXISTS leads (
 id BIGSERIAL PRIMARY KEY,business_name TEXT NOT NULL,place_id TEXT,maps_url TEXT,
 websites JSONB NOT NULL DEFAULT '[]'::jsonb,phones JSONB NOT NULL DEFAULT '[]'::jsonb,
 whatsapps JSONB NOT NULL DEFAULT '[]'::jsonb,emails JSONB NOT NULL DEFAULT '[]'::jsonb,
 rating DOUBLE PRECISION,review_count INTEGER NOT NULL DEFAULT 0,full_address TEXT NOT NULL,
 country TEXT NOT NULL,state TEXT NOT NULL,city TEXT NOT NULL,category TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Collected',confidence TEXT NOT NULL DEFAULT 'Medium',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;

let client:ReturnType<typeof neon>|null=null,initialized=false;
function sql(){const url=process.env.DATABASE_URL;if(!url)throw new Error('DATABASE_URL is not configured. Connect a Neon database in Vercel.');client??=neon(url);return client}
async function db(){const d=sql();if(!initialized){await d.query(table);await d.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_identity ON leads (business_name, full_address)');await d.query('CREATE INDEX IF NOT EXISTS idx_leads_place_id ON leads (place_id) WHERE place_id IS NOT NULL');await d.query('CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at)');initialized=true}return d}

export async function saveLead(l:LeadInput){
 const d=await db(),values=[l.businessName,l.placeId||null,l.mapsUrl||null,JSON.stringify(l.websites||[]),JSON.stringify(l.phones||[]),JSON.stringify(l.whatsapps||[]),JSON.stringify(l.emails||[]),l.rating??null,l.reviewCount||0,l.fullAddress,l.country,l.state,l.city,l.category,l.status||'Collected',l.confidence||'Medium'];
 if(l.placeId){
  const updated=await d.query(`UPDATE leads SET business_name=$1,maps_url=$3,websites=$4::jsonb,phones=$5::jsonb,whatsapps=$6::jsonb,emails=$7::jsonb,rating=$8,review_count=$9,full_address=$10,country=$11,state=$12,city=$13,category=$14,status=$15,confidence=$16,updated_at=NOW() WHERE place_id=$2 RETURNING id`,values) as unknown as unknown[];
  if(updated.length)return;
 }
 await d.query(`INSERT INTO leads (business_name,place_id,maps_url,websites,phones,whatsapps,emails,rating,review_count,full_address,country,state,city,category,status,confidence)
 VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16)
 ON CONFLICT (business_name,full_address) DO UPDATE SET place_id=COALESCE(leads.place_id,EXCLUDED.place_id),maps_url=EXCLUDED.maps_url,websites=EXCLUDED.websites,phones=EXCLUDED.phones,whatsapps=EXCLUDED.whatsapps,emails=EXCLUDED.emails,rating=EXCLUDED.rating,review_count=EXCLUDED.review_count,status=EXCLUDED.status,confidence=EXCLUDED.confidence,updated_at=NOW()`,values);
}

const array=(v:unknown)=>Array.isArray(v)?v:typeof v==='string'?JSON.parse(v):[];
const normalizePhone=(value:string)=>{const v=String(value).trim();if(!v||/[a-z]/i.test(v)||/[\/|]/.test(v)||/(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/.test(v)||/^\d(?:\.\d)?\s+(?:19|20)\d{2}/.test(v))return '';const digits=v.replace(/\D/g,'');if(digits.length<8||digits.length>15||/012345|123456|234567|345678|456789|567890|678910|987654|876543/.test(digits))return '';return v.startsWith('+')?`+${digits}`:digits};
const phones=(v:unknown)=>{const seen=new Set<string>();return (array(v) as string[]).map(normalizePhone).filter(Boolean).filter(value=>{const digits=value.replace(/\D/g,''),key=digits.length>=10?digits.slice(-10):digits;if(seen.has(key))return false;seen.add(key);return true})};
const emails=(v:unknown)=>{const seen=new Set<string>();return (array(v) as string[]).flatMap(raw=>{let value=String(raw);try{value=decodeURIComponent(value)}catch{}return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi)||[]}).map(value=>value.toLowerCase()).filter(value=>{const [local,domain]=value.split('@');if(!local||!domain||/^(example|test|testing|demo|dummy|sample|email|yourname|name|user|u00[0-9a-f]*)$/i.test(local)||/(example\.(com|org|net)|test\.com|domain\.com)$/i.test(domain)||seen.has(value))return false;seen.add(value);return true})};

export function output(r:Record<string,unknown>):LeadRecord{
 const query=encodeURIComponent(`${String(r.business_name)}, ${String(r.full_address)}`),mapsUrl=r.place_id?`https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${encodeURIComponent(String(r.place_id))}`:r.maps_url;
 return {id:Number(r.id),businessName:r.business_name,mapsUrl,websites:array(r.websites),phones:phones(r.phones),whatsapps:phones(r.whatsapps),emails:emails(r.emails),rating:r.rating===null?null:Number(r.rating),reviewCount:Number(r.review_count),fullAddress:r.full_address,country:r.country,state:r.state,city:r.city,category:r.category,status:r.status,confidence:r.confidence,createdAt:new Date(String(r.created_at)).toISOString()};
}

export async function list(u:URL):Promise<LeadRecord[]>{
 const d=await db(),q=u.searchParams.get('q')||'',status=u.searchParams.get('status')||'all',from=u.searchParams.get('from')||'',to=u.searchParams.get('to')||'';
 let query='SELECT * FROM leads WHERE 1=1',args:unknown[]=[];
 if(q){args.push(`%${q}%`);query+=` AND (business_name ILIKE $${args.length} OR category ILIKE $${args.length} OR city ILIKE $${args.length})`}
 if(status!=='all'){args.push(status);query+=` AND status=$${args.length}`}
 if(from){args.push(from);query+=` AND created_at >= $${args.length}::timestamptz`}
 if(to){args.push(to.includes('T')?to:to+'T23:59:59.999Z');query+=` AND created_at <= $${args.length}::timestamptz`}
 query+=' ORDER BY created_at DESC LIMIT 1000';
 const rows=await d.query(query,args) as unknown as Record<string,unknown>[];return rows.map(output);
}

export async function removeLead(id?:number){const d=await db();const rows=(id?await d.query('DELETE FROM leads WHERE id=$1 RETURNING id',[id]):await d.query('DELETE FROM leads RETURNING id')) as unknown as unknown[];return rows.length}
