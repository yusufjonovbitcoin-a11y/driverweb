import { readAllRows } from '../src/services/readAllRows.js';

const fileNameFromPath = path => path.split('/').pop() || 'media';

export async function migrationSources(admin) {
  const [profiles, driverDocuments, versions, documents, messages, attachments, brokerMessages, imports] = await Promise.all([
    () => admin.from('profiles').select('id,company_id,avatar_path').not('avatar_path', 'is', null),
    () => admin.from('driver_documents').select('id,company_id,driver_id,file_name,mime_type,storage_path,size_bytes'),
    () => admin.from('document_versions').select('id,company_id,document_id,uploaded_by,file_name,mime_type,storage_path,size_bytes,checksum_sha256'),
    () => admin.from('documents').select('id,load_id'),
    () => admin.from('chat_messages').select('id,company_id,conversation_id,sender_id,file_name,mime_type,storage_path,size_bytes').not('storage_path', 'is', null),
    () => admin.from('broker_attachments').select('id,company_id,message_id,file_name,mime_type,storage_path,size_bytes,checksum_sha256'),
    () => admin.from('broker_messages').select('id,company_id,raw_storage_path').not('raw_storage_path', 'is', null),
    () => admin.from('manual_load_imports').select('id,company_id,created_by,source_file_name,mime_type,storage_path,size_bytes,checksum_sha256').not('storage_path', 'is', null),
  ].map(buildQuery => readAllRows(buildQuery)));
  const loadIdByDocument = new Map(documents.map((row) => [row.id, row.load_id]));
  return [
    ...profiles.map((row) => ({
      table: 'profiles', column: 'avatar_path', rowId: row.id, companyId: row.company_id,
      uploadedBy: row.id, bucket: 'profile-media', path: row.avatar_path,
      scope: 'profile_avatar', contextId: row.id, fileName: fileNameFromPath(row.avatar_path), mimeType: 'image/jpeg',
    })),
    ...driverDocuments.map((row) => ({
      table: 'driver_documents', column: 'storage_path', rowId: row.id, companyId: row.company_id,
      uploadedBy: row.driver_id, bucket: 'profile-media', path: row.storage_path,
      scope: 'driver_document', contextId: row.driver_id, fileName: row.file_name, mimeType: row.mime_type,
    })),
    ...versions.map((row) => ({
      table: 'document_versions', column: 'storage_path', rowId: row.id, companyId: row.company_id,
      uploadedBy: row.uploaded_by, bucket: 'load-documents', path: row.storage_path,
      scope: 'load_document', contextId: loadIdByDocument.get(row.document_id), fileName: row.file_name,
      mimeType: row.mime_type, checksum: row.checksum_sha256,
    })),
    ...messages.map((row) => ({
      table: 'chat_messages', column: 'storage_path', rowId: row.id, companyId: row.company_id,
      uploadedBy: row.sender_id, bucket: 'chat-media', path: row.storage_path,
      scope: 'chat', contextId: row.conversation_id, fileName: row.file_name || fileNameFromPath(row.storage_path),
      mimeType: row.mime_type || 'application/octet-stream',
    })),
    ...attachments.map((row) => ({
      table: 'broker_attachments', column: 'storage_path', rowId: row.id, companyId: row.company_id,
      bucket: 'broker-originals', path: row.storage_path, scope: 'broker_original', contextId: row.message_id,
      fileName: row.file_name, mimeType: row.mime_type, checksum: row.checksum_sha256,
    })),
    ...brokerMessages.map((row) => ({
      table: 'broker_messages', column: 'raw_storage_path', rowId: row.id, companyId: row.company_id,
      bucket: 'broker-originals', path: row.raw_storage_path, scope: 'gmail_raw', contextId: row.id,
      fileName: fileNameFromPath(row.raw_storage_path), mimeType: 'message/rfc822',
    })),
    ...imports.map((row) => ({
      table: 'manual_load_imports', column: 'storage_path', rowId: row.id, companyId: row.company_id,
      uploadedBy: row.created_by, bucket: 'broker-originals', path: row.storage_path,
      scope: 'manual_import', contextId: row.id, fileName: row.source_file_name,
      mimeType: row.mime_type, checksum: row.checksum_sha256,
    })),
  ];
}
