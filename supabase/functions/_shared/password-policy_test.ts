import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { accountPasswordError, driverPasswordError } from "./password-policy.ts";

Deno.test("account password policy rejects short passwords", () => {
  assertEquals(accountPasswordError("short-pass") !== null, true);
  assertEquals(accountPasswordError("twelve-chars") === null, true);
});

Deno.test("driver passwords accept six characters and reject shorter or blank values", () => {
  assertEquals(driverPasswordError("abcde") !== null, true);
  assertEquals(driverPasswordError("abcdef"), null);
  assertEquals(driverPasswordError("longer-driver-password"), null);
  assertEquals(driverPasswordError("      ") !== null, true);
  assertEquals(driverPasswordError("a".repeat(129)) !== null, true);
});
