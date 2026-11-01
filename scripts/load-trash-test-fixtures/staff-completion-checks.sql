-- Isolated synthetic database only; no customer trip is completed by this test.
create function test_completion_seed(n integer) returns uuid language plpgsql as $$
declare target uuid:=('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
begin
 perform test_seed_load(target);
 insert into load_stops(company_id,load_id,type,sequence,address_line,city,region,requires_document)
 select '00000000-0000-0000-0000-000000000020',target,case when i=1 then 'pickup'::stop_type else 'delivery'::stop_type end,
   i,'100 Main Street','Test','NY',true from generate_series(1,2)i;
 return target;
end $$;
create function test_completion_document(target uuid,seq integer) returns uuid language plpgsql as $$
declare stop load_stops; document_id uuid; version_id uuid:=gen_random_uuid();
begin
 select * into stop from load_stops where load_id=target and sequence=seq;
 insert into documents(company_id,load_id,stop_id,document_type,created_by)
 values(stop.company_id,target,stop.id,case when stop.type='pickup' then 'bol' else 'pod' end,'00000000-0000-0000-0000-000000000001') returning id into document_id;
 insert into document_versions(id,company_id,document_id,version_number,file_name,mime_type,storage_path,size_bytes,uploaded_by)
 values(version_id,stop.company_id,document_id,1,'evidence.pdf','application/pdf','fixture/'||version_id::text||'.pdf',123,'00000000-0000-0000-0000-000000000001');
 update documents set current_version_id=version_id where id=document_id;
 return version_id;
end $$;
create function test_completion_versions(target uuid) returns uuid[] language sql as $$
 select array_agg(current_version_id order by current_version_id) from documents where load_id=target and document_type in ('bol','pod') and current_version_id is not null;
$$;
select test_completion_seed(n) from generate_series(99000,99005)n;
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000003','Paid Driver',null,0.9);
select assign_load_directly(('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000003') from generate_series(99000,99005)n;
reset role;
select test_completion_document(('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,i) from generate_series(99000,99005)n cross join generate_series(1,2)i;
select current_assignment_id as assignment,version as version from loads where id='00000000-0000-0000-0000-000000099000' \gset
select test_completion_versions('00000000-0000-0000-0000-000000099000') as evidence \gset
select (now() at time zone 'UTC'-interval '2 days')::timestamp(0) as delivery \gset
select test_assert(not exists(select 1 from private.driver_pay_start_origins where assignment_id=:'assignment'),'fixture has never STARTed');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_error(format('select complete_staff_load(%L,%L,%s,%L,%L,%L,%L,%L)',
 '00000000-0000-0000-0000-000000099000',:'assignment',:'version','00000000-0000-0000-0000-000000099900',:'evidence',:'delivery','UTC','office delivery'),'STAFF_COMPLETION_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_error(format('select complete_staff_load(%L,%L,%s,%L,%L,%L,%L,%L)',
 '00000000-0000-0000-0000-000000099000',:'assignment',:'version','00000000-0000-0000-0000-000000099900',:'evidence',:'delivery','UTC','office delivery'),'STAFF_COMPLETION_UNAVAILABLE');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000006';
select test_error(format('select complete_staff_load(%L,%L,%s,%L,%L,%L,%L,%L)',
 '00000000-0000-0000-0000-000000099000',:'assignment',:'version','00000000-0000-0000-0000-000000099900',:'evidence',:'delivery','UTC','office delivery'),'STAFF_COMPLETION_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select complete_staff_load('00000000-0000-0000-0000-000000099000',:'assignment',:'version',
 '00000000-0000-0000-0000-000000099900',:'evidence',:'delivery','UTC','office delivery') as result \gset
select test_assert(complete_staff_load('00000000-0000-0000-0000-000000099000',:'assignment',:'version',
 '00000000-0000-0000-0000-000000099900',:'evidence',:'delivery','UTC','office delivery')=:'result'::jsonb,'identical retry returns exact receipt');
select test_assert(get_staff_load_completion('00000000-0000-0000-0000-000000099900')->>'status'='completed','lost-response receipt is readable by the same staff actor');
select test_assert((driver_settlement_delivery_dates()->>'00000000-0000-0000-0000-000000099000')::timestamptz=(:'delivery'::timestamp at time zone 'UTC'),'accounting receives historical actual delivery, not assignment date');
select test_error(format('select complete_staff_load(%L,%L,%s,%L,%L,%L,%L,%L)',
 '00000000-0000-0000-0000-000000099000',:'assignment',:'version','00000000-0000-0000-0000-000000099900',:'evidence',:'delivery','UTC','different note'),'STAFF_COMPLETION_CONFLICT');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select test_assert(get_staff_load_completion('00000000-0000-0000-0000-000000099900') is null,'another staff actor cannot reuse a receipt');
reset role;
select test_assert((select status='completed' and version=:'version'::bigint+1 from loads where id='00000000-0000-0000-0000-000000099000'),'unstarted load completed exactly once');
select test_assert((select status='completed' and driver_stage='completed' and ended_at is not null and accepted_at is null from assignments where id=:'assignment'),'assignment closed without inventing driver acceptance');
select test_assert(not exists(select 1 from load_stops where load_id='00000000-0000-0000-0000-000000099000' and status<>'done'),'every stop is done');
select test_assert(not exists(select 1 from private.driver_pay_start_origins where assignment_id=:'assignment'),'no fake START location created');
select test_assert(not exists(select 1 from assignment_driver_pay where assignment_id=:'assignment'),'no mileage amount fabricated');
select test_assert(not exists(select 1 from client_operations where load_id='00000000-0000-0000-0000-000000099000'),'no driver event impersonated');
select test_assert((select count(*)=1 from audit_events where entity_id='00000000-0000-0000-0000-000000099000' and action='load.staff_completed'),'one staff audit event');

-- Missing evidence, newly replaced documents, stale assignments and future
-- timestamps all reject without partial status changes or an applying receipt.
insert into load_stops(company_id,load_id,type,sequence,address_line,city,region,requires_document)
 values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000099001','delivery',3,'200 Main Street','Test','NY',true);
select current_assignment_id as assignment2,version as version2 from loads where id='00000000-0000-0000-0000-000000099001' \gset
select test_completion_versions('00000000-0000-0000-0000-000000099001') as evidence2 \gset
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error(format('select complete_staff_load(%L,%L,%s,%L,%L,%L,%L)',
 '00000000-0000-0000-0000-000000099001',:'assignment2',:'version2','00000000-0000-0000-0000-000000099901',:'evidence2',:'delivery','UTC'),'STAFF_COMPLETION_DOCUMENTS_REQUIRED');
select test_error(format('select complete_staff_load(%L,%L,%s,%L,%L,%L,%L)',
 '00000000-0000-0000-0000-000000099001',:'assignment2',:'version2','00000000-0000-0000-0000-000000099901',:'evidence2',(now() at time zone 'UTC'+interval '1 day')::timestamp,'UTC'),'STAFF_COMPLETION_INVALID_TIME');
select test_error(format('select complete_staff_load(%L,%L,%s,%L,%L,%L,%L)',
 '00000000-0000-0000-0000-000000099001',:'assignment',:'version2','00000000-0000-0000-0000-000000099901',:'evidence2',:'delivery','UTC'),'STAFF_COMPLETION_CONFLICT');
reset role;
select test_assert((select status='assigned' from loads where id='00000000-0000-0000-0000-000000099001'),'rejected completion leaves load unchanged');
select test_assert(not exists(select 1 from private.staff_load_completions where load_id='00000000-0000-0000-0000-000000099001'),'rejected completion leaves no bypass record');
select test_error($$update load_stops set status='done' where load_id='00000000-0000-0000-0000-000000099001' and sequence=1$$,'DRIVER_PAY_APP_UPDATE_REQUIRED');
select test_error($$update loads set status='completed' where id='00000000-0000-0000-0000-000000099001'$$,'Every required');
select test_completion_document('00000000-0000-0000-0000-000000099001',3);
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error(format('select complete_staff_load(%L,%L,%s,%L,%L,%L,%L)',
 '00000000-0000-0000-0000-000000099001',:'assignment2',:'version2','00000000-0000-0000-0000-000000099901',:'evidence2',:'delivery','UTC'),'STAFF_COMPLETION_CONFLICT');
reset role;
select test_assert(not has_table_privilege('authenticated','private.staff_load_completions','insert'),'browser cannot forge receipt rows');
select test_assert(not has_function_privilege('anon','public.complete_staff_load(uuid,uuid,bigint,uuid,uuid[],timestamp,text,text)','execute'),'anonymous completion denied');
select test_assert(not has_function_privilege('authenticated','private.staff_completion_in_progress(uuid,uuid)','execute'),'browser cannot invoke guard helper');

-- Force a failure after stop/assignment updates to prove transaction rollback.
create function test_completion_fail() returns trigger language plpgsql as $$
begin raise exception 'SYNTHETIC_COMPLETION_WRITE_FAILURE'; end $$;
create trigger test_completion_fail before update of status on loads for each row
 when(new.id='00000000-0000-0000-0000-000000099003' and new.status='completed') execute function test_completion_fail();
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error(format('select complete_staff_load(%L,%L,%s,%L,%L,%L,%L)',l.id,l.current_assignment_id,l.version,
 '00000000-0000-0000-0000-000000099903',test_completion_versions(l.id),:'delivery','UTC'),'SYNTHETIC_COMPLETION_WRITE_FAILURE')
 from loads l where id='00000000-0000-0000-0000-000000099003';
reset role;
drop trigger test_completion_fail on loads;
drop function test_completion_fail();
select test_assert(not exists(select 1 from private.staff_load_completions where load_id='00000000-0000-0000-0000-000000099003'),'failed final write rolls back receipt');
select test_assert((select status='assigned' from loads where id='00000000-0000-0000-0000-000000099003'),'failed final write leaves load assigned');
select test_assert(not exists(select 1 from load_stops where load_id='00000000-0000-0000-0000-000000099003' and status<>'pending'),'failed final write rolls back every stop');
select test_assert((select a.status='active' and a.driver_stage='accepted' and a.ended_at is null from assignments a join loads l on l.current_assignment_id=a.id where l.id='00000000-0000-0000-0000-000000099003'),'failed final write rolls back assignment');
