create table if not exists public.broker_message_reads (
  company_id uuid not null references public.companies(id) on delete cascade,
  message_id uuid not null references public.broker_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.broker_message_reads enable row level security;

create policy broker_message_reads_own_select
on public.broker_message_reads for select to authenticated
using (
  user_id = (select auth.uid())
  and company_id = public.current_company_id()
);

create or replace function public.mark_broker_message_read(target_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  target public.broker_messages;
begin
  select * into actor from public.current_profile();
  if actor.id is null or actor.status <> 'active' or actor.role not in ('company_admin', 'dispatcher') then
    raise exception 'Dispatcher permission required';
  end if;
  select * into target from public.broker_messages where id = target_message_id;
  if target.id is null or target.company_id <> actor.company_id then
    raise exception 'Broker message not found';
  end if;
  insert into public.broker_message_reads(company_id, message_id, user_id, read_at)
  values (actor.company_id, target.id, actor.id, now())
  on conflict (message_id, user_id) do update set read_at = excluded.read_at;
end;
$$;

revoke all on table public.broker_message_reads from public, anon;
grant select on table public.broker_message_reads to authenticated;
revoke all on function public.mark_broker_message_read(uuid) from public, anon;
grant execute on function public.mark_broker_message_read(uuid) to authenticated;
