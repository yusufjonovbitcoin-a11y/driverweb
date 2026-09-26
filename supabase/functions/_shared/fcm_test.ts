import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildFcmMessage,
  parseFirebaseServiceAccount,
  sendFcmMessage,
} from "./fcm.ts";

Deno.test("Firebase service account parser fails closed", () => {
  assertThrows(() => parseFirebaseServiceAccount("{}"));
  assertThrows(() => parseFirebaseServiceAccount("not-json"));
});

Deno.test("FCM message includes cross-platform high-priority settings", () => {
  const payload = buildFcmMessage("device-token", {
    title: "Title",
    body: "Body",
  }, {
    notificationId: "notification-1",
  });
  assertEquals(payload.message.token, "device-token");
  assertEquals(payload.message.android.priority, "high");
  assertEquals(payload.message.apns.headers["apns-priority"], "10");
});

Deno.test("FCM UNREGISTERED response marks the device token invalid", async () => {
  const result = await sendFcmMessage(
    {
      projectId: "project",
      clientEmail: "service@example.test",
      privateKey: "unused",
    },
    "access-token",
    "device-token",
    { title: "Title", body: "Body" },
    {},
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              status: "NOT_FOUND",
              details: [{ errorCode: "UNREGISTERED" }],
            },
          }),
          { status: 404 },
        ),
      ),
  );
  assertEquals(result.ok, false);
  assertEquals(result.invalidToken, true);
  assertEquals(result.retryable, false);
});

Deno.test("successful FCM response preserves the provider message id", async () => {
  const result = await sendFcmMessage(
    {
      projectId: "project",
      clientEmail: "service@example.test",
      privateKey: "unused",
    },
    "access-token",
    "device-token",
    { title: "Title", body: "Body" },
    {},
    () => Promise.resolve(new Response(JSON.stringify({ name: "projects/p/messages/42" }))),
  );
  assertEquals(result.ok, true);
  assertEquals(result.providerMessageId, "projects/p/messages/42");
});
