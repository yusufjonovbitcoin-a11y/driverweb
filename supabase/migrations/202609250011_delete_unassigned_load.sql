create or replace function public.delete_unassigned_load(target_load_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  target public.loads%rowtype;
begin
  actor := public.current_profile();

  if actor.id is null or actor.role not in ('company_admin', 'dispatcher') then
    raise exception using
      errcode = '42501',
      message = 'Only a company admin or dispatcher can delete a load';
  end if;

  select l.*
  into target
  from public.loads l
  where l.id = target_load_id
    and l.company_id = actor.company_id
  for update;

  if target.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Load not found';
  end if;

  if target.status not in ('draft', 'review', 'ready_for_offer', 'offered')
     or target.current_assignment_id is not null then
    raise exception using
      errcode = '55000',
      message = 'Only an unassigned load can be deleted';
  end if;

  delete from public.notifications n
  where n.company_id = target.company_id
    and (
      (n.entity_type = 'load' and n.entity_id = target.id)
      or (
        n.entity_type = 'offer'
        and n.entity_id in (
          select o.id
          from public.offers o
          where o.load_id = target.id
        )
      )
    );

  insert into public.audit_events (
    company_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    old_value,
    metadata
  )
  values (
    target.company_id,
    actor.id,
    'load.deleted',
    'load',
    target.id,
    to_jsonb(target),
    jsonb_build_object(
      'load_number', target.load_number,
      'source_file_preserved', true
    )
  );

  delete from public.loads
  where id = target.id;

  return target.id;
end;
$$;

revoke all on function public.delete_unassigned_load(uuid) from public, anon;
grant execute on function public.delete_unassigned_load(uuid) to authenticated;
