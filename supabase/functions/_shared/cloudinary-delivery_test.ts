import { assertEquals } from "jsr:@std/assert@1";
import { signedAuthenticatedDeliveryUrl, temporaryAuthenticatedDownloadUrl } from "./cloudinary-delivery.ts";

Deno.test("authenticated Cloudinary delivery URL has a stable server signature", async () => {
  const url = await signedAuthenticatedDeliveryUrl({
    cloudName: "demo-cloud",
    apiSecret: "test-secret",
    publicId: "drivex/company/chat/message-file",
    resourceType: "image",
    version: 1700000000,
    format: "png",
  });

  assertEquals(
    url,
    "https://res.cloudinary.com/demo-cloud/image/authenticated/s--a39XTNpu--/v1700000000/drivex/company/chat/message-file.png",
  );
});

Deno.test('document download signs expiry and preserves raw extension exactly once', async () => {
  const url = new URL(await temporaryAuthenticatedDownloadUrl({cloudName:'demo',apiKey:'key',
    apiSecret:'secret',publicId:'company/load/file.pdf',resourceType:'raw',format:'pdf',
    timestamp:1700000000,expiresAt:1700000900}));
  assertEquals(url.pathname,'/v1_1/demo/raw/download');
  assertEquals(url.searchParams.get('public_id'),'company/load/file.pdf');
  assertEquals(url.searchParams.has('format'),false);
  assertEquals(url.searchParams.get('expires_at'),'1700000900');
  assertEquals(url.searchParams.get('type'),'authenticated');
  const signed = 'attachment=false&expires_at=1700000900&public_id=company/load/file.pdf&timestamp=1700000000&type=authenticatedsecret';
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signed));
  assertEquals(url.searchParams.get('signature'), [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''));
});
