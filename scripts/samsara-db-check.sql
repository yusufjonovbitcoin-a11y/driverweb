-- Run against the target database after both Samsara migrations. All fixture
-- writes are rolled back; an existing company connection is never overwritten.
begin;
do $test$
declare c uuid; actor uuid; lease_a uuid := gen_random_uuid(); lease_b uuid := gen_random_uuid();
  attempt uuid := gen_random_uuid(); old_generation uuid; n integer;
begin
  if has_table_privilege('anon','public.samsara_connections','SELECT')
    or has_table_privilege('authenticated','public.samsara_connections','SELECT')
    or has_table_privilege('authenticated','public.samsara_oauth_states','DELETE')
    or has_function_privilege('authenticated','public.get_samsara_server_config()','EXECUTE')
    or has_function_privilege('anon','public.claim_samsara_connection(uuid,uuid)','EXECUTE')
    or has_schema_privilege('authenticated','samsara_private','USAGE') then
    raise exception 'Samsara private access leaked';
  end if;
  if not has_function_privilege('service_role','public.get_samsara_server_config()','EXECUTE')
    or not has_table_privilege('service_role','public.samsara_connections','UPDATE') then
    raise exception 'Server permissions missing';
  end if;
  if (select count(*) from pg_class where oid in ('public.samsara_connections'::regclass,'public.samsara_oauth_states'::regclass) and relrowsecurity) <> 2 then
    raise exception 'RLS is missing';
  end if;
  select p.company_id,p.id into c,actor from public.profiles p
    where p.role='company_admin' and p.status='active' and p.company_id is not null
      and not exists(select 1 from public.samsara_connections s where s.company_id=p.company_id)
    limit 1;
  if c is null then raise exception 'No unconnected fixture company; run in a test database'; end if;
  insert into public.samsara_connections(company_id,status,credentials,oauth_attempt)
    values(c,'active','synthetic-encrypted-fixture',attempt) returning generation into old_generation;
  select count(*) into n from public.claim_samsara_connection(c,lease_a);
  if n<>1 then raise exception 'Initial lock not acquired'; end if;
  select count(*) into n from public.claim_samsara_connection(c,lease_b);
  if n<>0 then raise exception 'Concurrent refresh was allowed'; end if;
  update public.samsara_connections set lease_until=now()-interval '1 second' where company_id=c;
  select count(*) into n from public.claim_samsara_connection(c,lease_b);
  if n<>1 then raise exception 'Expired lease did not recover'; end if;
  update public.samsara_connections set snapshot='{"invalid":true}' where company_id=c and lease_id=lease_a;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Old worker overwrote new lease'; end if;
  insert into public.samsara_oauth_states(state_hash,attempt_id,company_id,actor_id,return_origin,expires_at)
    values(repeat('a',64),attempt,c,actor,'https://managefleets.com',now()+interval '10 minutes'),
    (repeat('b',64),attempt,c,actor,'https://managefleets.com',now()-interval '1 minute');
  delete from public.samsara_oauth_states where state_hash=repeat('a',64) and expires_at>now();
  get diagnostics n=row_count;
  if n<>1 then raise exception 'Valid state not consumed'; end if;
  delete from public.samsara_oauth_states where state_hash=repeat('a',64) and expires_at>now();
  get diagnostics n=row_count;
  if n<>0 then raise exception 'OAuth replay was accepted'; end if;
  delete from public.samsara_oauth_states where state_hash=repeat('b',64) and expires_at>now();
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Expired OAuth state was accepted'; end if;
  update public.samsara_connections set generation=gen_random_uuid(),status='disconnected',credentials=null where company_id=c;
  update public.samsara_connections set status='active' where company_id=c and generation=old_generation;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Stale sync resurrected a disconnected connection'; end if;
end;
$test$;
rollback;
select 'Samsara permissions, encryption boundary, state replay, expiry, lock and generation checks passed' as result;
