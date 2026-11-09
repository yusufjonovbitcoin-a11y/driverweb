-- Browser access is only through the authenticated company-admin Edge Function.
create table public.samsara_camera_requests (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  generation uuid not null,
  created_by uuid references public.profiles(id) on delete set null,
  vehicle_id text not null,
  camera_input text not null check (camera_input in ('dashcamRoadFacing','dashcamDriverFacing','analog1','analog2','analog3','analog4')),
  media_type text not null check (media_type in ('image','videoHighRes')),
  start_time timestamptz not null,
  end_time timestamptz not null,
  retrieval_id text,
  state text not null check (state in ('submitting','pending','available','unavailable','unknown','failed')),
  created_at timestamptz not null default now(),
  check (end_time >= start_time and end_time <= start_time + interval '30 seconds')
);
create index samsara_camera_history_idx on public.samsara_camera_requests(company_id,generation,vehicle_id,created_at desc);
alter table public.samsara_camera_requests enable row level security;
revoke all on public.samsara_camera_requests from public, anon, authenticated;
grant select, insert, update, delete on public.samsara_camera_requests to service_role;
