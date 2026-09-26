begin;

revoke all on function public.enqueue_abandoned_document_upload_cleanup()
from public, anon, authenticated;

revoke all on function public.enqueue_push_notification()
from public, anon, authenticated;

commit;
