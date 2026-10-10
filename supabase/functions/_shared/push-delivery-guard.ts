type NotificationSnapshot = {
  type: string;
  title: string;
  body: string;
  chat_message_id?: string | null;
  read_at?: string | null;
  created_at?: string | null;
};

export const CHAT_PUSH_MAX_AGE_MS = 60 * 60 * 1000;

// Recheck immediately before sending: a claimed queue payload may predate a
// user's delete action. FCM cannot retract a push already accepted by it.
export function shouldSendPush({
  workerId, lease, notification, message, now = Date.now(), webMessagesEnabled = true,
}: {
  workerId: string;
  lease: { status: string; locked_by: string | null } | null;
  notification: NotificationSnapshot | null;
  message?: { deleted_at: string | null; read_at?: string | null } | null;
  now?: number;
  webMessagesEnabled?: boolean;
}) {
  if (!lease || lease.status !== "processing" || lease.locked_by !== workerId) return false;
  if (!notification || notification.type === "chat_message_deleted") return false;
  if (notification.chat_message_id && (!message || message.deleted_at)) return false;
  // Catch-up delivery must not re-alert already-read or stale chat messages.
  // Operational notifications keep their existing delivery lifetime.
  if (notification.type === "chat_message") {
    const createdAt = Date.parse(notification.created_at ?? "");
    if (!webMessagesEnabled || notification.read_at || message?.read_at || !Number.isFinite(createdAt) ||
      now - createdAt > CHAT_PUSH_MAX_AGE_MS) return false;
  }
  return true;
}
