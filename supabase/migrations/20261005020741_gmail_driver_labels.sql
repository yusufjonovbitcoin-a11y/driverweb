-- A driver's Gmail label is a mailbox label, never an email-sender rule.
alter table public.driver_profiles
  add column gmail_label text
  constraint driver_profiles_gmail_label_valid check (
    gmail_label is null or (
      gmail_label = btrim(gmail_label)
      and char_length(gmail_label) between 1 and 100
      and gmail_label !~ '[[:cntrl:]]'
      and lower(gmail_label) not in ('inbox', '[gmail]', '[googlemail]')
      and lower(gmail_label) not like '[gmail]/%'
      and lower(gmail_label) not like '[googlemail]/%'
    )
  );

create unique index driver_profiles_company_gmail_label_unique
  on public.driver_profiles (company_id, lower(gmail_label))
  where gmail_label is not null;

-- Keep Gmail work out of the assignment transaction. The worker applies a
-- label only after the assignment exists and the exact source message is found.
create function public.enqueue_gmail_label_on_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and exists (
    select 1 from public.loads l
    join public.broker_messages m on m.id = l.broker_message_id
    join public.driver_profiles d on d.user_id = new.driver_id
    where l.id = new.load_id and l.company_id = new.company_id
      and m.company_id = new.company_id and m.gmail_connection_id is not null
      and d.company_id = new.company_id and d.gmail_label is not null
      and exists (
        select 1 from public.broker_attachments a
        where a.message_id = m.id and a.mime_type = 'application/pdf'
      )
  ) then
    insert into public.jobs(company_id, type, payload, idempotency_key)
    values (new.company_id, 'gmail_label_assignment',
      jsonb_build_object('assignment_id', new.id),
      'gmail-label-assignment:' || new.id::text)
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger assignments_enqueue_gmail_label
after insert on public.assignments
for each row execute function public.enqueue_gmail_label_on_assignment();

create function public.enqueue_gmail_label_on_driver()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.gmail_label is null then return new; end if;
  if tg_op = 'UPDATE' and new.gmail_label is not distinct from old.gmail_label then
    return new;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.jobs(company_id, type, payload, idempotency_key)
    values (new.company_id, 'gmail_create_driver_label',
      jsonb_build_object('driver_id', new.user_id, 'label', new.gmail_label),
      'gmail-create-label:' || new.user_id::text || ':' || md5(new.gmail_label))
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger driver_profiles_enqueue_gmail_label
after insert or update of gmail_label on public.driver_profiles
for each row execute function public.enqueue_gmail_label_on_driver();

-- A Gmail worker must not claim another company's jobs.
create function public.claim_company_gmail_label_jobs(
  target_company_id uuid, worker_id text, batch_size integer default 10
)
returns setof public.jobs language plpgsql security definer set search_path = public as $$
begin
  if target_company_id is null or nullif(btrim(worker_id), '') is null then
    raise exception 'Company and worker are required';
  end if;
  return query
  with selected as (
    select j.id from public.jobs j
    where j.company_id = target_company_id
      and j.type in ('gmail_create_driver_label', 'gmail_label_assignment')
      and j.status in ('pending', 'failed')
      and j.available_at <= now() and j.attempt_count < j.max_attempts
    order by j.available_at, j.created_at
    limit least(greatest(batch_size, 1), 25)
    for update skip locked
  )
  update public.jobs j
  set status = 'processing', locked_at = now(), locked_by = worker_id,
      attempt_count = j.attempt_count + 1
  from selected s where j.id = s.id returning j.*;
end;
$$;

revoke all on function public.enqueue_gmail_label_on_assignment() from public, anon, authenticated;
revoke all on function public.enqueue_gmail_label_on_driver() from public, anon, authenticated;
revoke all on function public.claim_company_gmail_label_jobs(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_company_gmail_label_jobs(uuid, text, integer) to service_role;
