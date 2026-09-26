import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deleteCloudinaryMedia,
  MediaCleanupError,
  parseMediaCleanupPayload,
} from "./media-cleanup.ts";

const validCloudinaryPayload = {
  provider: "cloudinary",
  documentVersionId: "version-1",
  mediaRef: "cloudinary:asset-1",
  mediaAssetId: "asset-1",
  assetId: "provider-asset-1",
  publicId: "drivex/company/document",
  resourceType: "image",
  deliveryType: "authenticated",
};

Deno.test("media cleanup payload accepts known providers only", () => {
  assertEquals(
    parseMediaCleanupPayload(validCloudinaryPayload).provider,
    "cloudinary",
  );
  assertEquals(
    parseMediaCleanupPayload(validCloudinaryPayload).mediaAssetId,
    "asset-1",
  );
  assertThrows(
    () =>
      parseMediaCleanupPayload({
        ...validCloudinaryPayload,
        provider: "unknown",
      }),
    MediaCleanupError,
  );
});

Deno.test("storage cleanup rejects traversal and unknown buckets", () => {
  assertThrows(
    () =>
      parseMediaCleanupPayload({
        provider: "supabase_storage",
        documentVersionId: "version-1",
        bucket: "load-documents",
        storagePath: "company/../secret",
      }),
    MediaCleanupError,
  );
  assertThrows(
    () =>
      parseMediaCleanupPayload({
        provider: "supabase_storage",
        documentVersionId: "version-1",
        bucket: "avatars",
        storagePath: "company/file.pdf",
      }),
    MediaCleanupError,
  );
});

Deno.test("Cloudinary not found is an idempotent cleanup success", async () => {
  await deleteCloudinaryMedia(
    parseMediaCleanupPayload(validCloudinaryPayload),
    {
      cloudName: "cloud",
      apiKey: "key",
      apiSecret: "secret",
      fetcher: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ result: "not found" }),
            { status: 200 },
          ),
        ),
    },
  );
});

Deno.test("Cloudinary provider errors preserve retryability", async () => {
  const error = await assertRejects(
    () =>
      deleteCloudinaryMedia(parseMediaCleanupPayload(validCloudinaryPayload), {
        cloudName: "cloud",
        apiKey: "key",
        apiSecret: "secret",
        fetcher: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({ error: { message: "busy" } }),
              { status: 503 },
            ),
          ),
      }),
    MediaCleanupError,
  );
  assertEquals(error.retryable, true);
});

Deno.test("Cloudinary cleanup aborts a provider request at its timeout", async () => {
  const error = await assertRejects(
    () =>
      deleteCloudinaryMedia(parseMediaCleanupPayload(validCloudinaryPayload), {
        cloudName: "cloud",
        apiKey: "key",
        apiSecret: "secret",
        timeoutMs: 1_000,
        fetcher: (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")));
          }),
      }),
    MediaCleanupError,
  );
  assertEquals(error.retryable, true);
  assertEquals(error.message, "Cloudinary delete timed out");
});
