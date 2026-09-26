import { assertEquals } from "jsr:@std/assert@1";
import { signedAuthenticatedDeliveryUrl } from "./cloudinary-delivery.ts";

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
