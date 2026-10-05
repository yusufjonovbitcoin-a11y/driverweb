type NotificationSnapshot = {
  type: string;
  title: string;
  body: string;
  chat_message_id?: string | null;
};

// Recheck immediately before sending: a claimed queue payload may predate a
// user's delete action. FCM cannot retract a push already accepted by it.
export function shouldSendPush({
  workerId, lease, notification, message,
}: {
  workerId: string;
  lease: { status: string; locked_by: string | null } | null;
  notification: NotificationSnapshot | null;
  message?: { deleted_at: string | null } | null;
}) {
  if (!lease || lease.status !== "processing" || lease.locked_by !== workerId) return false;
  if (!notification || notification.type === "chat_message_deleted") return false;
  if (notification.chat_message_id && (!message || message.deleted_at)) return false;
  return true;
}
