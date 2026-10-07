import dotenv from 'dotenv';
import { migrationSources } from './media-migration-sources.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: process.env.CLOUDINARY_ENV_FILE || '.env.cloudinary' });

const required = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
];
for (const key of required) {
  if (!process.env[key]?.trim()) throw new Error(`${key} is required`);
}

const admin = createClient(
  process.env.SUPABASE_URL.trim(),
  process.env.SUPABASE_SERVICE_ROLE_KEY.trim(),
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const deleteSource = String(process.env.CLOUDINARY_DELETE_SOURCE || '').toLowerCase() === 'true';

function signature(params) {
  const serialized = Object.entries(params)
    .filter(([, value]) => value !== '' && value != null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return createHash('sha256')
    .update(`${serialized}${process.env.CLOUDINARY_API_SECRET.trim()}`)
    .digest('hex');
}

function safe(value) {
  return String(value || 'media').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

async function uploadCloudinary(blob, source) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const folder = `drivex/${safe(source.companyId)}/${safe(source.scope)}`;
  const name = source.fileName.replace(/\.[^.]+$/, '');
  const publicId = `${source.contextId ? `${safe(source.contextId)}-` : ''}${randomUUID()}-${safe(name)}`;
  const params = { folder, public_id: publicId, timestamp, type: 'authenticated' };
  const form = new FormData();
  form.set('file', blob, source.fileName);
  form.set('api_key', process.env.CLOUDINARY_API_KEY.trim());
  form.set('timestamp', timestamp);
  form.set('folder', folder);
  form.set('public_id', publicId);
  form.set('type', 'authenticated');
  form.set('signature_algorithm', 'sha256');
  form.set('signature', signature(params));
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(process.env.CLOUDINARY_CLOUD_NAME.trim())}/auto/upload`,
    { method: 'POST', body: form },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Cloudinary upload failed (${response.status})`);
  return payload;
}

async function migrateSource(source) {
  if (!source.path || source.path.startsWith('cloudinary:')) return false;
  const { data: blob, error: downloadError } = await admin.storage.from(source.bucket).download(source.path);
  if (downloadError || !blob) throw new Error(downloadError?.message || `Missing ${source.bucket}/${source.path}`);
  const uploaded = await uploadCloudinary(blob, source);
  const assetId = randomUUID();
  const { error: assetError } = await admin.from('media_assets').insert({
    id: assetId,
    company_id: source.companyId,
    uploaded_by: source.uploadedBy || null,
    scope: source.scope,
    context_id: source.contextId || null,
    cloudinary_asset_id: uploaded.asset_id,
    public_id: uploaded.public_id,
    resource_type: uploaded.resource_type,
    delivery_type: 'authenticated',
    version: uploaded.version,
    format: uploaded.format || null,
    file_name: source.fileName,
    mime_type: source.mimeType || blob.type || 'application/octet-stream',
    size_bytes: uploaded.bytes || blob.size,
    checksum_sha256: source.checksum || null,
  });
  if (assetError) throw assetError;
  const reference = `cloudinary:${assetId}`;
  const { error: updateError } = await admin.from(source.table)
    .update({ [source.column]: reference })
    .eq('id', source.rowId)
    .eq(source.column, source.path);
  if (updateError) throw updateError;
  if (deleteSource) {
    const { error: removeError } = await admin.storage.from(source.bucket).remove([source.path]);
    if (removeError) console.warn(`Source cleanup failed: ${source.bucket}/${source.path}: ${removeError.message}`);
  }
  console.log(`migrated ${source.table}.${source.rowId} -> ${reference}`);
  return true;
}


let migrated = 0;
let failed = 0;
for (const source of await migrationSources(admin)) {
  try {
    if (await migrateSource(source)) migrated += 1;
  } catch (error) {
    failed += 1;
    console.error(`failed ${source.table}.${source.rowId}:`, error.message);
  }
}
console.log(JSON.stringify({ migrated, failed, deleteSource }));
if (failed) process.exitCode = 1;
