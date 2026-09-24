-- Idempotent manual document ingestion for dispatcher-uploaded rate confirmations.
-- The browser never writes this table. The authenticated Edge Function records
-- the original file, extraction result, and load created from that result.

create table public.manual_load_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  checksum_sha256 text not null,
  source_file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  storage_path text,
  status public.ingestion_status not null default 'processing',
  model_name text,
  extracted_result jsonb,
  load_id uuid references public.loads(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, checksum_sha256)
);

create index manual_load_imports_company_created_idx
  on public.manual_load_imports (company_id, created_at desc);

create trigger manual_load_imports_set_updated_at
before update on public.manual_load_imports
for each row execute function public.set_updated_at();

alter table public.manual_load_imports enable row level security;

create policy manual_load_imports_privileged_read
on public.manual_load_imports for select to authenticated
using (
  company_id = public.current_company_id()
  and public.current_app_role() in ('company_admin', 'dispatcher')
);

revoke all on public.manual_load_imports from public, anon, authenticated;
grant select on public.manual_load_imports to authenticated;

