import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { hasDurableMediaReference } from "./media-reference-guard.ts";

const reference = "cloudinary:11111111-1111-4111-8111-111111111111";
const targets = ["document_versions.storage_path", "chat_messages.storage_path", "driver_documents.storage_path",
  "profiles.avatar_path", "driver_profiles.cdl_document_path", "broker_attachments.storage_path",
  "broker_messages.raw_storage_path", "manual_load_imports.storage_path"];

function fixture(found: string | null = null, failure: string | null = null) {
  const queried: string[] = [];
  return { queried, read(table: string, column: string, value: string) {
    const key = `${table}.${column}`;
    queried.push(key);
    assertEquals(value, reference);
    return Promise.resolve({ data: key === found ? [{ [column]: reference }] : [],
      error: key === failure ? new Error("lookup unavailable") : null });
  } };
}

Deno.test("each retained reference protects a Cloudinary asset independently of uploader or scope", async () => {
  for (const target of targets) {
    const reader = fixture(target);
    assertEquals(await hasDurableMediaReference(reader.read, reference), true, target);
    assertEquals(reader.queried, targets);
  }
});

Deno.test("unreferenced orphan uploads remain eligible for cleanup after ownership check", async () => {
  assertEquals(await hasDurableMediaReference(fixture().read, reference), false);
});

Deno.test("any failed reference lookup fails closed, including another reference table", async () => {
  for (const target of targets) {
    await assertRejects(() => hasDurableMediaReference(fixture(null, target).read, reference), Error, "Media reference lookup failed");
  }
  await assertRejects(() => hasDurableMediaReference(fixture().read, "cloudinary:not-an-id"), Error, "Invalid media reference");
});
