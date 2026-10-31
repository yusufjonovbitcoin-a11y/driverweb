import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { signedAuthenticatedDeliveryUrl, temporaryAuthenticatedDownloadUrl } from '../supabase/functions/_shared/cloudinary-delivery.ts';

// Reversible provider rename, with a durable resume journal. Never deletes bytes.
// New signed URLs must already expire before --apply is used.
const env = { ...dotenv.parse(await fs.readFile('.env.cloudinary')), ...process.env };
if (new URL(env.SUPABASE_URL).hostname !== 'gsnbjpqwwpvqtmphsyfs.supabase.co') throw Error('Unexpected project');
for (const key of ['SUPABASE_SERVICE_ROLE_KEY','CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']) if (!env[key]) throw Error(`Missing ${key}`);
const client=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const journalPath='output/security-media-rotation-2026-10-24.json';
const base=`https://api.cloudinary.com/v1_1/${encodeURIComponent(env.CLOUDINARY_CLOUD_NAME)}`;
async function inspect(asset, publicId) {
 const response=await fetch(`${base}/resources/${asset.resource_type}/authenticated/${encodeURIComponent(publicId)}`,{
  headers:{Authorization:'Basic '+Buffer.from(`${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`).toString('base64')},
  redirect:'error',signal:AbortSignal.timeout(20000)});
 if(response.status===404)return null;if(!response.ok)throw Error(`Provider lookup failed: ${response.status}`);return response.json();
}
let journal;try{journal=JSON.parse(await fs.readFile(journalPath,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;}
if(!journal){
 const {data,error}=await client.from('media_assets').select('id,scope,resource_type,public_id,version,format,delivery_type').in('scope',['chat','profile_avatar']).is('deleted_at',null);
 if(error)throw error;
 journal={project:'gsnbjpqwwpvqtmphsyfs',createdAt:new Date().toISOString(),items:[]};
 for(const asset of data){if(asset.delivery_type!=='authenticated'||!['image','video','raw'].includes(asset.resource_type))throw Error('Unsupported media');
  const provider=await inspect(asset,asset.public_id);if(!provider?.asset_id)throw Error('Original media unavailable');
  journal.items.push({...asset,providerAssetId:provider.asset_id,newPublicId:asset.public_id+'_access_'+randomUUID().slice(0,8),state:'planned'});
 }
 await fs.writeFile(journalPath,JSON.stringify(journal,null,2));
}
const save=()=>fs.writeFile(journalPath,JSON.stringify(journal,null,2));
if(process.argv.includes('--apply'))for(const asset of journal.items){
 const {data:current,error}=await client.from('media_assets').select('public_id,deleted_at').eq('id',asset.id).single();if(error)throw error;
 if(current.deleted_at)throw Error('Media changed after plan');
 if(current.public_id===asset.newPublicId){asset.state='applied';await save();continue;}
 if(current.public_id!==asset.public_id)throw Error('Media identifier changed after plan');
 let renamed=await inspect(asset,asset.newPublicId);
 if(!renamed){
  const params={from_public_id:asset.public_id,to_public_id:asset.newPublicId,type:'authenticated',overwrite:'false',invalidate:'true',timestamp:String(Math.floor(Date.now()/1000))};
  const signature=createHash('sha256').update(Object.keys(params).sort().map(k=>`${k}=${params[k]}`).join('&')+env.CLOUDINARY_API_SECRET).digest('hex');
  const response=await fetch(`${base}/${asset.resource_type}/rename`,{method:'POST',body:new URLSearchParams({...params,api_key:env.CLOUDINARY_API_KEY,signature}),redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Provider rename failed: ${response.status}`);renamed=await response.json();
 }
 if(renamed.asset_id!==asset.providerAssetId||renamed.public_id!==asset.newPublicId||!Number.isSafeInteger(renamed.version))throw Error('Provider identity mismatch');
 const update=await client.from('media_assets').update({public_id:renamed.public_id,version:renamed.version}).eq('id',asset.id).eq('public_id',asset.public_id).is('deleted_at',null).select('id');
 if(update.error)throw update.error;if(update.data?.length!==1)throw Error('Media update conflict; resume from journal');
 asset.state='applied';asset.appliedAt=new Date().toISOString();await save();
}
if(process.argv.includes('--verify'))for(const asset of journal.items){
 if(asset.state!=='applied')continue;
 const oldUrl=await signedAuthenticatedDeliveryUrl({cloudName:env.CLOUDINARY_CLOUD_NAME,apiSecret:env.CLOUDINARY_API_SECRET,publicId:asset.public_id,resourceType:asset.resource_type,version:Number(asset.version),format:asset.format});
 const response=await fetch(oldUrl,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(20000)});
 asset.oldUrlStatus=response.status;asset.verifiedAt=new Date().toISOString();await save();
 const currentUrl=await temporaryAuthenticatedDownloadUrl({cloudName:env.CLOUDINARY_CLOUD_NAME,apiKey:env.CLOUDINARY_API_KEY,apiSecret:env.CLOUDINARY_API_SECRET,publicId:asset.newPublicId,resourceType:asset.resource_type,format:asset.format,expiresAt:Math.floor(Date.now()/1000)+60});
 const current=await fetch(currentUrl,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000)});
 asset.currentUrlStatus=current.status;await current.body?.cancel();await save();
}
console.log(JSON.stringify({planned:journal.items.length,applied:journal.items.filter(x=>x.state==='applied').length,
 oldUrlsDenied:journal.items.filter(x=>[401,403,404].includes(x.oldUrlStatus)).length,
 currentUrlsAvailable:journal.items.filter(x=>x.currentUrlStatus===200).length,
 scopes:journal.items.reduce((s,x)=>(s[x.scope]=(s[x.scope]||0)+1,s),{})}));
