import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { secureEqual } from "./secure-equal.ts";

Deno.test("secureEqual handles equal and unequal values", () => {
  assertEquals(secureEqual("worker-token", "worker-token"), true);
  assertEquals(secureEqual("worker-token", "other-token"), false);
  assertEquals(secureEqual("short", "longer"), false);
});
