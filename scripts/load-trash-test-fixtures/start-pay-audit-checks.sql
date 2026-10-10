-- Synthetic fixture: regression of the three independently reproduced holes.
select test_seed_load(('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid) from generate_series(900,911)n;
insert into load_stops(company_id,load_id,type,sequence,address_line,city,region,requires_document)
select '00000000-0000-0000-0000-000000000020',l.id,
 case when n=1 then 'pickup'::stop_type else 'delivery'::stop_type end,n,'100 Pay street','City','NY',false
from loads l cross join generate_series(1,2)n where l.id between
 '00000000-0000-0000-0000-000000000900' and '00000000-0000-0000-0000-000000000911';
update load_stops set address_line='' where load_id in ('00000000-0000-0000-0000-000000000910','00000000-0000-0000-0000-000000000911');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000003','Paid driver',null,0.9);
select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000004','Other driver',null,0.8);
select test_error($$select assign_load_directly('00000000-0000-0000-0000-000000000910','00000000-0000-0000-0000-000000000003')$$,'DRIVER_PAY_START_ADDRESS_REQUIRED');
select assign_load_directly(('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-0000-0000-000000000003') from generate_series(900,909)n;
select (assign_load_directly('00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-000000000004')).id as handoff_before_start \gset
select test_assert(get_assignment_driver_pay(:'handoff_before_start','00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-000000000004')->>'status'='awaiting_start','unstarted paid reassignment remains allowed');
reset role;
select current_assignment_id as started_assignment from loads where id='00000000-0000-0000-0000-000000000900' \gset
select current_assignment_id as blocked_assignment from loads where id='00000000-0000-0000-0000-000000000902' \gset
select current_assignment_id as retry_assignment from loads where id='00000000-0000-0000-0000-000000000903' \gset
select current_assignment_id as deterministic_assignment from loads where id='00000000-0000-0000-0000-000000000904' \gset
select current_assignment_id as changed_assignment from loads where id='00000000-0000-0000-0000-000000000905' \gset
select id as blocked_pickup from load_stops where load_id='00000000-0000-0000-0000-000000000902' and sequence=1 \gset
select version as blocked_version from loads where id='00000000-0000-0000-0000-000000000902' \gset
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_start_pay(900);
select test_start_pay(903);
select test_start_pay(904);
select test_start_pay(905);
select test_start_pay(909);
select test_error(format('select transition_stop(%L,%L,gen_random_uuid(),%s)',:'blocked_pickup','arrived',:'blocked_version'),'DRIVER_PAY_APP_UPDATE_REQUIRED');
select test_error(format('select transition_stop(%L,%L,gen_random_uuid(),%s)',:'blocked_pickup','skipped',:'blocked_version'),'DRIVER_PAY_APP_UPDATE_REQUIRED');
select test_error(format('select advance_driver_stage(%L,%L,gen_random_uuid(),%s)','00000000-0000-0000-0000-000000000902','en_route_to_pickup',:'blocked_version'),'DRIVER_PAY_APP_UPDATE_REQUIRED');
select test_error(format('select advance_driver_route(%L,%L,gen_random_uuid(),%s)','00000000-0000-0000-0000-000000000902','en_route_to_pickup',:'blocked_version'),'DRIVER_PAY_APP_UPDATE_REQUIRED');
select test_assert(get_assignment_driver_pay(:'blocked_assignment','00000000-0000-0000-0000-000000000902','00000000-0000-0000-0000-000000000003')->>'status'='awaiting_start','own driver sees awaiting start without coordinates or broker pay');
reset role;
select test_assert((select status='pending' from load_stops where id=:'blocked_pickup')
 and not exists(select 1 from private.driver_pay_start_origins where assignment_id=:'blocked_assignment'),'rejected legacy command is fully rolled back');
select test_error(format('update load_stops set status=%L where id=%L','done',:'blocked_pickup'),'DRIVER_PAY_APP_UPDATE_REQUIRED');
select test_error(format('update loads set status=%L where id=%L','delivered','00000000-0000-0000-0000-000000000902'),'DRIVER_PAY_APP_UPDATE_REQUIRED');
select test_error(format('update assignments set status=%L where id=%L','completed',:'blocked_assignment'),'DRIVER_PAY_APP_UPDATE_REQUIRED');
-- Historical invalid state may exist already; the staff command must not bless it.
alter table loads disable trigger require_load_driver_pay_start;
update loads set status='delivered' where id='00000000-0000-0000-0000-000000000902';
alter table loads enable trigger require_load_driver_pay_start;
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error($$select complete_load('00000000-0000-0000-0000-000000000902')$$,'DRIVER_PAY_APP_UPDATE_REQUIRED');
select test_error($$select assign_load_directly('00000000-0000-0000-0000-000000000900','00000000-0000-0000-0000-000000000004')$$,'DRIVER_PAY_HANDOFF_REQUIRES_REVIEW');
select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000004','Other driver',null,null);
select (assign_load_directly('00000000-0000-0000-0000-000000000911','00000000-0000-0000-0000-000000000004')).id as city_only_unpaid \gset
select test_assert(get_assignment_driver_pay(:'city_only_unpaid','00000000-0000-0000-0000-000000000911','00000000-0000-0000-0000-000000000004') is null,'nonfixed city-only loads keep their previous assignment behavior');
select test_assert((select current_assignment_id is null from loads where id='00000000-0000-0000-0000-000000000910')
 and not exists(select 1 from assignment_driver_pay_pending where load_id='00000000-0000-0000-0000-000000000910'),
 'malformed paid assignment rolls back atomically before stranding pending pay');
select test_error($$select assign_load_directly('00000000-0000-0000-0000-000000000900','00000000-0000-0000-0000-000000000004')$$,'DRIVER_PAY_HANDOFF_REQUIRES_REVIEW');
select test_assert((select current_assignment_id=:'started_assignment'::uuid from loads where id='00000000-0000-0000-0000-000000000900')
 and (select status='active' from assignments where id=:'started_assignment'),'failed paid or nonpaid handoff preserves original active assignment');
-- Explicit user-selected trash/restore is a new trip execution, not a handoff.
select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000004','Other driver',null,0.8);
select (trash_load('00000000-0000-0000-0000-000000000900',(select version from loads where id='00000000-0000-0000-0000-000000000900'))).version as reset_version \gset
select restore_trashed_load('00000000-0000-0000-0000-000000000900',:'reset_version','00000000-0000-0000-0000-000000000004');
select current_assignment_id as reset_assignment from loads where id='00000000-0000-0000-0000-000000000900' \gset
select test_assert(:'reset_assignment'<>:'started_assignment'
 and (select driver_stage='accepted' from assignments where id=:'reset_assignment'),
 'trash then restore to other driver creates accepted assignment, not inherited stage');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_start_pay(900);
reset role;
select test_assert(claim_driver_pay_calculation('audit-old-cancelled-worker',:'started_assignment') is null,'old cancelled job cannot finalize new driver pay');
select claim_driver_pay_calculation('audit-new-restored-worker',:'reset_assignment') as reset_job \gset
select test_assert(finish_driver_pay_calculation((:'reset_job'::jsonb->>'jobId')::uuid,'audit-new-restored-worker',50,3,'mapbox',false,null),'new driver START calculates independent restored trip');
select test_assert((select rate_per_mile=0.8 and driver_id='00000000-0000-0000-0000-000000000004' and amount=42.4 from assignment_driver_pay where assignment_id=:'reset_assignment')
 and exists(select 1 from private.driver_pay_start_origins where assignment_id=:'started_assignment')
 and exists(select 1 from assignment_driver_pay_pending where assignment_id=:'started_assignment'),
 'restored trip uses its own frozen rate; previous START and unresolved history remain intact');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select update_driver_contact_and_pay('00000000-0000-0000-0000-000000000003','Paid driver',null,1.1);
reset role;

-- START address rejection happens before origin/job/stage writes. No provider traffic.
do $$ declare bad text; begin
 foreach bad in array array['','Road without number','25','25City',' 25 Main St'] loop
   update load_stops set address_line=bad where load_id='00000000-0000-0000-0000-000000000906' and sequence=1;
   perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
   perform test_error('select test_start_pay(906)','DRIVER_PAY_START_ROUTE_INVALID');
 end loop;
end $$;
update load_stops set address_line='25 Main St',city=' ' where load_id='00000000-0000-0000-0000-000000000906' and sequence=1;
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_error('select test_start_pay(906)','DRIVER_PAY_START_ROUTE_INVALID');
reset role;
update load_stops set city=E'\t\n' where load_id='00000000-0000-0000-0000-000000000906' and sequence=1;
set role authenticated;
select test_error('select test_start_pay(906)','DRIVER_PAY_START_ROUTE_INVALID');
reset role;
update load_stops set city='City',region='' where load_id='00000000-0000-0000-0000-000000000906' and sequence=1;
set role authenticated;
select test_error('select test_start_pay(906)','DRIVER_PAY_START_ROUTE_INVALID');
reset role;
select test_assert(not exists(select 1 from private.driver_pay_start_origins where load_id='00000000-0000-0000-0000-000000000906')
 and not exists(select 1 from jobs where payload->>'assignmentId'=(select current_assignment_id::text from loads where id='00000000-0000-0000-0000-000000000906')),'invalid addresses leave no immutable capture or queued work');

-- Eight transient failures retain immutable evidence and expose terminal failure.
do $$ declare a uuid; job jsonb; i integer; begin
 select current_assignment_id into a from loads where id='00000000-0000-0000-0000-000000000903';
 for i in 1..8 loop
  update jobs set available_at=now() where payload->>'assignmentId'=a::text;
  job:=claim_driver_pay_calculation('audit-provider-worker',a);
  perform test_assert(job is not null,'provider retry obtains real lease');
  perform test_assert(finish_driver_pay_calculation((job->>'jobId')::uuid,'audit-provider-worker',null,null,null,true),'legacy six-argument worker remains compatible');
 end loop;
end $$;
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_assert(get_assignment_driver_pay(:'retry_assignment','00000000-0000-0000-0000-000000000903','00000000-0000-0000-0000-000000000003')->>'status'='failed','terminal failures are not falsely reported calculating');
select test_error(format('select retry_assignment_driver_pay(%L,%L,%L,gen_random_uuid())',:'retry_assignment','00000000-0000-0000-0000-000000000903','00000000-0000-0000-0000-000000000003'),'DRIVER_PAY_RETRY_COOLDOWN');
select test_error(format('select get_assignment_driver_pay(%L,%L,%L)',:'retry_assignment','00000000-0000-0000-0000-000000000904','00000000-0000-0000-0000-000000000003'),'DRIVER_PAY_PERMISSION_DENIED');
select test_error(format('select get_assignment_driver_pay(%L,%L,%L)',:'retry_assignment','00000000-0000-0000-0000-000000000903','00000000-0000-0000-0000-000000000004'),'DRIVER_PAY_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
begin read only;
select test_assert((select value->>'driver_pay_status'='pending' and value->>'driver_pay_calculation_status'='failed'
 and value->>'driver_pay_error_code'='DRIVER_PAY_PROVIDER_UNAVAILABLE' and value->'driver_pay'='null'::jsonb
 and value->'broker_rate'='null'::jsonb and value->>'broker_terms_hidden'='true'
 from get_driver_load_rows(array['00000000-0000-0000-0000-000000000903'::uuid]) value),'mobile projection reports terminal failure while retaining privacy and unknown money');
select test_assert(not (get_assignment_driver_pay(:'retry_assignment','00000000-0000-0000-0000-000000000903','00000000-0000-0000-0000-000000000003')->>'canRetry')::boolean,'driver cannot initiate staff retry');
rollback;
select test_error(format('select retry_assignment_driver_pay(%L,%L,%L,gen_random_uuid())',:'retry_assignment','00000000-0000-0000-0000-000000000903','00000000-0000-0000-0000-000000000003'),'DRIVER_PAY_RETRY_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_error(format('select get_assignment_driver_pay(%L,%L,%L)',:'retry_assignment','00000000-0000-0000-0000-000000000903','00000000-0000-0000-0000-000000000003'),'DRIVER_PAY_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_error(format('select get_assignment_driver_pay(%L,%L,%L)',:'retry_assignment','00000000-0000-0000-0000-000000000903','00000000-0000-0000-0000-000000000003'),'DRIVER_PAY_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000006';
select test_error(format('select get_assignment_driver_pay(%L,%L,%L)',:'retry_assignment','00000000-0000-0000-0000-000000000903','00000000-0000-0000-0000-000000000003'),'DRIVER_PAY_PERMISSION_DENIED');
reset role;
-- Dispatcher scoping is enforced separately from same-company membership.
insert into dispatcher_driver_access(company_id,dispatcher_id,driver_id)
 values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004')
 on conflict do nothing;
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select test_error(format('select get_assignment_driver_pay(%L,%L,%L)',:'retry_assignment','00000000-0000-0000-0000-000000000903','00000000-0000-0000-0000-000000000003'),'DRIVER_PAY_PERMISSION_DENIED');
select test_error(format('select retry_assignment_driver_pay(%L,%L,%L,gen_random_uuid())',:'retry_assignment','00000000-0000-0000-0000-000000000903','00000000-0000-0000-0000-000000000003'),'DRIVER_PAY_RETRY_PERMISSION_DENIED');
reset role;
select test_assert(not has_function_privilege('anon','get_assignment_driver_pay(uuid,uuid,uuid)','execute')
 and not has_function_privilege('anon','retry_assignment_driver_pay(uuid,uuid,uuid,uuid)','execute')
 and not has_function_privilege('authenticated','finish_driver_pay_calculation(uuid,text,numeric,numeric,text,boolean,text)','execute')
 and not has_function_privilege('authenticated','private.assignment_driver_pay_state(uuid,boolean)','execute')
 and not has_table_privilege('authenticated','private.driver_pay_retry_requests','select'),'new pay endpoints and internal helpers have least-privilege grants');
select claim_driver_pay_calculation('audit-deterministic-worker',:'deterministic_assignment') as deterministic_job \gset
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_error(format('select retry_assignment_driver_pay(%L,%L,%L,gen_random_uuid())',:'deterministic_assignment','00000000-0000-0000-0000-000000000904','00000000-0000-0000-0000-000000000003'),'DRIVER_PAY_RETRY_UNAVAILABLE');
reset role;
select test_error(format('select finish_driver_pay_calculation(%L,%L,null,null,null,true,%L)',:'deterministic_job'::jsonb->>'jobId','audit-deterministic-worker','raw provider GPS error'),'DRIVER_PAY_ERROR_CODE_INVALID');
select test_assert(finish_driver_pay_calculation((:'deterministic_job'::jsonb->>'jobId')::uuid,'audit-deterministic-worker',null,null,null,true,'DRIVER_PAY_ROUTE_ADDRESS_INCOMPLETE'),'explicit deterministic routing failure terminates without eight futile calls');
update jobs set available_at=now() where payload->>'assignmentId'=:'deterministic_assignment';
update load_stops set address_line='200 Changed road' where load_id='00000000-0000-0000-0000-000000000905' and sequence=1;
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_assert(get_assignment_driver_pay(:'deterministic_assignment','00000000-0000-0000-0000-000000000904','00000000-0000-0000-0000-000000000003')->>'status'='failed','deterministic failure is exposed safely');
select test_error(format('select retry_assignment_driver_pay(%L,%L,%L,gen_random_uuid())',:'deterministic_assignment','00000000-0000-0000-0000-000000000904','00000000-0000-0000-0000-000000000003'),'DRIVER_PAY_RETRY_UNAVAILABLE');
select test_assert(get_assignment_driver_pay(:'changed_assignment','00000000-0000-0000-0000-000000000905','00000000-0000-0000-0000-000000000003')->>'errorCode'='DRIVER_PAY_ROUTE_INVALID','changed immutable route explicitly needs help, not provider retry');
select test_error(format('select retry_assignment_driver_pay(%L,%L,%L,gen_random_uuid())',:'changed_assignment','00000000-0000-0000-0000-000000000905','00000000-0000-0000-0000-000000000003'),'DRIVER_PAY_RETRY_UNAVAILABLE');
reset role;
-- The parent harness now races idempotent staff retries on this due terminal job.
update jobs set available_at=now() where payload->>'assignmentId'=:'retry_assignment';
-- Last-attempt worker death becomes visible without a jobs subscription.
select current_assignment_id as crashed_assignment from loads where id='00000000-0000-0000-0000-000000000909' \gset
select claim_driver_pay_calculation('audit-crashed-worker',:'crashed_assignment') as crashed_job \gset
select load_revision as crashed_revision from assignments where id=:'crashed_assignment' \gset
update jobs set locked_at=now()-interval '3 minutes',attempt_count=max_attempts where id=(:'crashed_job'::jsonb->>'jobId')::uuid;
select test_assert(claim_driver_pay_calculation('audit-recovery-cron',:'crashed_assignment') is null,'eighth crashed claim is terminalized by cron');
select test_assert((select load_revision=:'crashed_revision'::bigint+1 from assignments where id=:'crashed_assignment'),'claim-side terminal state emits assignment realtime revision');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert((select value->>'driver_pay_calculation_status'='failed' from get_driver_load_rows(array['00000000-0000-0000-0000-000000000909'::uuid]) value),'crashed terminal work is visible as failed');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_assert((get_assignment_driver_pay(:'crashed_assignment','00000000-0000-0000-0000-000000000909','00000000-0000-0000-0000-000000000003')->>'canRetry')::boolean,'only explicit expired worker timeout is staff-retryable');
select retry_assignment_driver_pay(:'crashed_assignment','00000000-0000-0000-0000-000000000909','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000999');
reset role;
select claim_driver_pay_calculation('audit-new-timeout-worker',:'crashed_assignment') as new_timeout_job \gset
select test_assert(not finish_driver_pay_calculation((:'crashed_job'::jsonb->>'jobId')::uuid,'audit-crashed-worker',999,999,'mapbox'),'late expired worker is fenced after staff retry and new lease');
select test_assert(finish_driver_pay_calculation((:'new_timeout_job'::jsonb->>'jobId')::uuid,'audit-new-timeout-worker',100,5,'mapbox'),'new timeout recovery worker may finalize original START evidence');
reset role;
