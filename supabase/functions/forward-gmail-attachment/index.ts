import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { downloadPrivateMedia, uploadPrivateMedia } from "../_shared/cloudinary-media.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MAX_PDF_BYTES = 25 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization) return json({ error: "Authentication required" }, 401);
  if (!supabaseUrl || !publicKey || !serviceRoleKey) return json({ error: "Function environment is incomplete" }, 500);

  const caller = createClient(supabaseUrl, publicKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

  const body = await request.json().catch(() => ({}));
  const attachmentId = typeof body?.attachmentId === "string" ? body.attachmentId : null;
  const driverId = typeof body?.driverId === "string" ? body.driverId : null;
  if (!attachmentId || !driverId) return json({ error: "attachmentId and driverId are required" }, 400);

  const { data: actor, error: actorError } = await caller.from("profiles")
    .select("id,company_id,role,status").eq("id", authData.user.id).maybeSingle();
  if (actorError || !actor || actor.status !== "active" || !["company_admin", "dispatcher"].includes(actor.role)) {
    return json({ error: "Dispatcher permission required" }, 403);
  }

  const [{ data: attachment, error: attachmentError }, { data: driver, error: driverError }] = await Promise.all([
    admin.from("broker_attachments").select("id,company_id,file_name,mime_type,storage_path,size_bytes")
      .eq("id", attachmentId).eq("company_id", actor.company_id).maybeSingle(),
    admin.from("profiles").select("id,role,status,company_id")
      .eq("id", driverId).eq("company_id", actor.company_id).maybeSingle(),
  ]);
  if (attachmentError || !attachment) return json({ error: "Gmail biriktirmasi topilmadi" }, 404);
  if (driverError || !driver || driver.role !== "driver" || driver.status !== "active") {
    return json({ error: "Driver topilmadi yoki faol emas" }, 404);
  }
  const isPdf = attachment.mime_type === "application/pdf" || attachment.file_name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return json({ error: "Hozir faqat PDF fayllarni yuborish mumkin" }, 422);
  if (!attachment.size_bytes || attachment.size_bytes > MAX_PDF_BYTES) {
    return json({ error: "PDF fayl 25 MB dan katta yoki noto‘g‘ri" }, 422);
  }

  const { data: conversationId, error: conversationError } = await caller.rpc("open_direct_chat", { target_user_id: driverId });
  if (conversationError || !conversationId) return json({ error: "Driver chati ochilmadi" }, 422);

  let sourceFile: Blob;
  try {
    sourceFile = await downloadPrivateMedia({
      admin,
      bucket: "broker-originals",
      reference: attachment.storage_path,
      supabaseUrl,
      serviceRoleKey,
    });
  } catch {
    return json({ error: "PDF faylini o‘qib bo‘lmadi" }, 422);
  }
  if (sourceFile.size > MAX_PDF_BYTES) return json({ error: "PDF fayl 25 MB dan katta" }, 422);

  let destinationPath: string;
  try {
    const upload = await uploadPrivateMedia({
      supabaseUrl,
      apiKey: publicKey,
      authorization,
      file: new File([sourceFile], attachment.file_name, { type: "application/pdf" }),
      scope: "chat",
      contextId: conversationId,
    });
    destinationPath = upload.reference;
  } catch {
    return json({ error: "PDF faylini chatga joylab bo‘lmadi" }, 422);
  }

  const { data: message, error: sendError } = await caller.rpc("send_chat_message", {
    conversation_id: conversationId,
    message_kind: "file",
    message_body: null,
    media_storage_path: destinationPath,
    media_file_name: attachment.file_name,
    media_mime_type: "application/pdf",
    media_size_bytes: sourceFile.size,
    media_duration_ms: null,
    reply_to_message_id: null,
    message_client_id: crypto.randomUUID(),
  });
  if (sendError || !message) {
    return json({ error: "PDF driver chatiga yuborilmadi" }, 422);
  }

  return json({ conversationId, messageId: message.id });
});
