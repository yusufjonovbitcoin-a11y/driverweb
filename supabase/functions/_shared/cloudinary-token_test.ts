import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { requireCloudinaryTokenKey } from "./cloudinary-token.ts";

Deno.test("Cloudinary token-auth fails closed when missing", () => {
  assertThrows(() => requireCloudinaryTokenKey(undefined));
  assertThrows(() => requireCloudinaryTokenKey("not-hex"));
  const validKey = "aabbccdd".repeat(8);
  assertEquals(requireCloudinaryTokenKey(validKey), validKey);
});
