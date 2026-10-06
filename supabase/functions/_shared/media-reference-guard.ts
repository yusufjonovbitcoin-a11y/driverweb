// Direct provider deletion must not bypass guarded document/message/profile
// commands. Check every durable reference, not just the asset's original scope:
// import originals may also be attached as a load's Rate Con.
const referenceColumns = [
  ["document_versions", "storage_path"],
  ["chat_messages", "storage_path"],
  ["driver_documents", "storage_path"],
  ["profiles", "avatar_path"],
  ["driver_profiles", "cdl_document_path"],
  ["broker_attachments", "storage_path"],
  ["broker_messages", "raw_storage_path"],
  ["manual_load_imports", "storage_path"],
] as const;

type ReferenceReader = (table: string, column: string, reference: string) =>
  PromiseLike<{ data: unknown[] | null; error: unknown }>;

export async function hasDurableMediaReference(admin: ReferenceReader, reference: string): Promise<boolean> {
  if (!/^cloudinary:[0-9a-f-]{36}$/i.test(reference)) throw new Error("Invalid media reference");
  // Service role is necessary: another authorized user's retained reference
  // must protect the blob even when the deleting user cannot see that row.
  const results = await Promise.all(referenceColumns.map(async ([table, column]) => {
    const { data, error } = await admin(table, column, reference);
    if (error || !Array.isArray(data)) throw new Error("Media reference lookup failed");
    return data.length > 0;
  }));
  return results.some(Boolean);
}
