const MESSAGE_COLUMNS = 'id,company_id,gmail_connection_id,provider_message_id,provider_thread_id,from_email,subject,received_at,raw_storage_path,status,error_message,created_at';
const ATTACHMENT_COLUMNS = 'id,message_id,file_name,mime_type,size_bytes,created_at';
const RELATION_PAGE_SIZE = 500;

async function readRelationPages(buildQuery) {
  const rows = [];
  for (let offset = 0; ; offset += RELATION_PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + RELATION_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < RELATION_PAGE_SIZE) return rows;
  }
}

export async function fetchBrokerInboxRows(client) {
  const { data: messages = [], error } = await client.from('broker_messages')
    .select(MESSAGE_COLUMNS)
    .order('received_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(100);
  if (error) throw error;
  if (!messages?.length) return [];
  const ids = messages.map((message) => message.id);
  // Scope every relation to this page. An independently limited extraction
  // query can omit the correct extraction for an otherwise visible message.
  const [extractions, attachments, reads] = await Promise.all([
    readRelationPages(() => client.from('ai_extractions').select('*').in('message_id', ids)
      .order('processed_at', { ascending: false }).order('id', { ascending: false })),
    readRelationPages(() => client.from('broker_attachments').select(ATTACHMENT_COLUMNS).in('message_id', ids)
      .order('created_at').order('id')),
    readRelationPages(() => client.from('broker_message_reads').select('message_id').in('message_id', ids)
      .order('message_id')),
  ]);
  const readIds = new Set(reads.map((row) => row.message_id));
  const latestExtractions = new Map();
  for (const extraction of extractions) {
    if (!latestExtractions.has(extraction.message_id)) latestExtractions.set(extraction.message_id, extraction);
  }
  const attachmentsByMessage = new Map();
  for (const attachment of attachments) {
    if (!attachmentsByMessage.has(attachment.message_id)) attachmentsByMessage.set(attachment.message_id, []);
    attachmentsByMessage.get(attachment.message_id).push(attachment);
  }
  return messages.map((message) => ({
    ...message,
    is_read: readIds.has(message.id),
    extraction: latestExtractions.get(message.id) || null,
    attachments: attachmentsByMessage.get(message.id) || [],
  }));
}

const SUPPORTED_ATTACHMENT_FILTER = [
  'mime_type.eq.application/pdf', 'mime_type.like.image/*',
  ...['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif'].map((extension) => `file_name.ilike.*.${extension}`),
].join(',');

export async function fetchBrokerUnreadCount(client) {
  // Count messages, not files, across the entire mailbox. RLS makes `reads`
  // contain only the current user's receipts; the null embed is an anti-join.
  // The explicit composite FK avoids the table's two ambiguous message FKs.
  const { count, error } = await client.from('broker_messages')
    .select('id,attachments:broker_attachments!broker_attachments_message_company_fk!inner(id),reads:broker_message_reads(message_id)', { count: 'exact', head: true })
    .is('reads', null)
    .or(SUPPORTED_ATTACHMENT_FILTER, { referencedTable: 'attachments' });
  if (error) throw error;
  if (!Number.isFinite(count)) throw new Error('Inbox unread count is unavailable.');
  return count;
}
