import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Called only by test-load-trash-db.mjs inside its fresh private-socket cluster.
export async function runAuditBackendChecks({ sql, migration, root }) {
  const fix = '20261007130727_audit_backend_integrity_fixes.sql';
  await migration('202609250020_cloudinary_media.sql', 'create or replace function public.cloudinary_media_id', 'create or replace function public.bind_document_version_media');

  await migration('202609240011_realtime_chat_and_calls.sql', 'create table public.chat_conversations', 'create table public.chat_messages');
  await migration('20261007003538_chat_safety_controls.sql', 'create table public.chat_user_blocks', 'create function private.chat_pair_blocked');
  await migration('20261007003538_chat_safety_controls.sql', 'create function public.get_chat_safety_state', 'create function public.set_chat_user_block');
  await migration('20261007003538_chat_safety_controls.sql', 'create function public.list_chat_reports', 'create function public.resolve_chat_report');

  await migration('202609240001_core_schema.sql', 'create or replace function public.upsert_driver_presence', '-- RLS:');
  await migration('202609300001_driver_tracking.sql', 'create function public.ingest_driver_location_batch', 'revoke all on function public.current_driver_tracking_assignment');
  // Apply the complete migration once against all current functions/triggers.
  sql('alter function public.get_driver_analytics(timestamptz,timestamptz) stable;');
  // Restore the complete production view, omitted by the original small harness.
  await migration('202609250002_google_places_load_contacts.sql');
  await migration('202609250004_ai_document_intelligence.sql', 'drop view if exists public.load_overview;', 'create or replace view public.document_review_overview');
  await migration('20261001222100_verified_driver_brief.sql', 'do $$', 'create or replace function');
  await migration('20261005205741_load_trash_restore.sql', 'do $$', 'create function public.guard_trashed_load_update');
  sql('grant select on load_overview to authenticated;');
  await migration(fix);
  await migration('20261007133312_record_dispatch_review_warning_contract.sql');
  sql(await readFile(path.join(root, 'scripts/audit-backend-test-fixtures/document-binding.sql'), 'utf8'));
  sql(await readFile(path.join(root, 'scripts/audit-backend-test-fixtures/chat-read-only.sql'), 'utf8'));
  sql(await readFile(path.join(root, 'scripts/audit-backend-test-fixtures/presence-and-overview.sql'), 'utf8'));
  sql(await readFile(path.join(root, 'scripts/audit-backend-test-fixtures/forward-review-contract.sql'), 'utf8'));
  console.log('PASS: audit backend READ ONLY, document immutability/idempotency, GPS capture age and overview cardinality');
}
