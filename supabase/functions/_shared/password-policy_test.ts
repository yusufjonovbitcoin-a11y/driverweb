import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { accountPasswordError } from "./password-policy.ts";

Deno.test("account password policy rejects short passwords", () => {
  assertEquals(accountPasswordError("short-pass") !== null, true);
  assertEquals(accountPasswordError("twelve-chars") === null, true);
});
