import dotenv from 'dotenv';
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

function fileNameFromPath(path) {
  return path.split('/').pop() || 'media';
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

async function sources() {
  const [profiles, driverDocuments, versions, documents, messages, attachments, brokerMessages, imports] = await Promise.all([
    admin.from('profiles').select('id,company_id,avatar_path').not('avatar_path', 'is', null),
    admin.from('driver_documents').select('id,company_id,driver_id,file_name,mime_type,storage_path,size_bytes'),
    admin.from('document_versions').select('id,company_id,document_id,uploaded_by,file_name,mime_type,storage_path,size_bytes,checksum_sha256'),
    admin.from('documents').select('id,load_id'),
    admin.from('chat_messages').select('id,company_id,conversation_id,sender_id,file_name,mime_type,storage_path,size_bytes').not('storage_path', 'is', null),
    admin.from('broker_attachments').select('id,company_id,message_id,file_name,mime_type,storage_path,size_bytes,checksum_sha256'),
    admin.from('broker_messages').select('id,company_id,raw_storage_path').not('raw_storage_path', 'is', null),
    admin.from('manual_load_imports').select('id,company_id,created_by,source_file_name,mime_type,storage_path,size_bytes,checksum_sha256').not('storage_path', 'is', null),
  ]);
  for (const result of [profiles, driverDocuments, versions, documents, messages, attachments, brokerMessages, imports]) {
    if (result.error) throw result.error;
  }
  const loadIdByDocument = new Map(documents.data.map((row) => [row.id, row.load_id]));
  return [
    ...profiles.data.map((row) => ({
      table: 'profiles', column: 'avatar_path', rowId: row.id, companyId: row.company_id,
      uploadedBy: row.id, bucket: 'profile-media', path: row.avatar_path,
      scope: 'profile_avatar', contextId: row.id, fileName: fileNameFromPath(row.avatar_path), mimeType: 'image/jpeg',
    })),
    ...driverDocuments.data.map((row) => ({
      table: 'driver_documents', column: 'storage_path', rowId: row.id, companyId: row.company_id,
      uploadedBy: row.driver_id, bucket: 'profile-media', path: row.storage_path,
      scope: 'driver_document', contextId: row.driver_id, fileName: row.file_name, mimeType: row.mime_type,
    })),
    ...versions.data.map((row) => ({
      table: 'document_versions', column: 'storage_path', rowId: row.id, companyId: row.company_id,
      uploadedBy: row.uploaded_by, bucket: 'load-documents', path: row.storage_path,
      scope: 'load_document', contextId: loadIdByDocument.get(row.document_id), fileName: row.file_name,
      mimeType: row.mime_type, checksum: row.checksum_sha256,
    })),
    ...messages.data.map((row) => ({
      table: 'chat_messages', column: 'storage_path', rowId: row.id, companyId: row.company_id,
      uploadedBy: row.sender_id, bucket: 'chat-media', path: row.storage_path,
      scope: 'chat', contextId: row.conversation_id, fileName: row.file_name || fileNameFromPath(row.storage_path),
      mimeType: row.mime_type || 'application/octet-stream',
    })),
    ...attachments.data.map((row) => ({
      table: 'broker_attachments', column: 'storage_path', rowId: row.id, companyId: row.company_id,
      bucket: 'broker-originals', path: row.storage_path, scope: 'broker_original', contextId: row.message_id,
      fileName: row.file_name, mimeType: row.mime_type, checksum: row.checksum_sha256,
    })),
    ...brokerMessages.data.map((row) => ({
      table: 'broker_messages', column: 'raw_storage_path', rowId: row.id, companyId: row.company_id,
      bucket: 'broker-originals', path: row.raw_storage_path, scope: 'gmail_raw', contextId: row.id,
      fileName: fileNameFromPath(row.raw_storage_path), mimeType: 'message/rfc822',
    })),
    ...imports.data.map((row) => ({
      table: 'manual_load_imports', column: 'storage_path', rowId: row.id, companyId: row.company_id,
      uploadedBy: row.created_by, bucket: 'broker-originals', path: row.storage_path,
      scope: 'manual_import', contextId: row.id, fileName: row.source_file_name,
      mimeType: row.mime_type, checksum: row.checksum_sha256,
    })),
  ];
}

let migrated = 0;
let failed = 0;
for (const source of await sources()) {
  try {
    if (await migrateSource(source)) migrated += 1;
  } catch (error) {
    failed += 1;
    console.error(`failed ${source.table}.${source.rowId}:`, error.message);
  }
}
console.log(JSON.stringify({ migrated, failed, deleteSource }));
if (failed) process.exitCode = 1;
