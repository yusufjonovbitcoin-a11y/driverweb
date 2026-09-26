import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { allowedCorsOrigin, withCors } from "./cors.ts";

Deno.test("CORS permits local development origins", () => {
  assertEquals(
    allowedCorsOrigin("http://127.0.0.1:5174"),
    "http://127.0.0.1:5174",
  );
  assertEquals(
    allowedCorsOrigin("http://localhost:3000"),
    "http://localhost:3000",
  );
});

Deno.test("CORS denies an unconfigured remote origin", async () => {
  const response = await withCors(
    new Request("https://example.invalid", {
      method: "OPTIONS",
      headers: { Origin: "https://untrusted.invalid" },
    }),
    () => new Response("unused"),
  );
  assertEquals(response.status, 403);
});

Deno.test("CORS does not execute handlers for denied origins", async () => {
  let executed = false;
  const response = await withCors(
    new Request("https://functions.test", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    }),
    () => {
      executed = true;
      return new Response("unsafe");
    },
  );
  assertEquals(response.status, 403);
  assertEquals(executed, false);
});

Deno.test("CORS strips legacy wildcard headers", async () => {
  const response = await withCors(
    new Request("https://example.invalid", {
      headers: { Origin: "https://untrusted.invalid" },
    }),
    () =>
      new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } }),
  );
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
});
