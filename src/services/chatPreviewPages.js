// IDs are immutable; last_message_at can change while pages are being read.
export async function readChatPreviewPages(fetchPage) {
  const rows = new Map();
  let after = null;
  while (true) {
    const page = await fetchPage(after, 100);
    if (!page.length) break;
    const cursor = page.at(-1).id;
    if (!cursor || (after && cursor <= after)) throw new Error('CHAT_PREVIEW_CURSOR_INVALID');
    for (const row of page) rows.set(row.id, row);
    after = cursor;
    // A short page can reflect the server's row cap, not the end of history.
  }
  return [...rows.values()].sort((a, b) => String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')) || a.id.localeCompare(b.id));
}
