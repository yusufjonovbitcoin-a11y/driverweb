begin;
insert into public.companies values
 ('10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002');
insert into public.gmail_connections(id,company_id) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
select test_assert(not exists(select 1 from gmail_cloud_worker_controls), 'migration seeds no controls');
select test_assert((select bool_and(not p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like '%gmail_cloud%'), 'all worker routines SECURITY INVOKER');
select test_assert((select bool_and(not has_function_privilege('anon',p.oid,'execute')
 and not has_function_privilege('authenticated',p.oid,'execute')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like '%gmail_cloud%'), 'all RPCs and trigger private');
set local role authenticated;
do $$ begin
 begin perform public.claim_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
   raise exception 'authenticated unexpectedly called claim';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.gmail_cloud_worker_controls;
   raise exception 'authenticated unexpectedly read controls';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
select test_assert(claim_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001')->>'status'='paused','missing row paused');
select test_assert(not exists(select 1 from gmail_cloud_worker_controls), 'paused claim inserts nothing');
insert into gmail_cloud_worker_controls(company_id) values ('10000000-0000-0000-0000-000000000001');
select test_assert((select not enabled and lease_owner is null from gmail_cloud_worker_controls),'default disabled');
select test_assert(claim_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001')->>'status'='paused','existing row paused');
select test_assert((select provider_history_id is null and last_synced_at is null from gmail_connections where company_id='10000000-0000-0000-0000-000000000001'),'disabled leaves mailbox untouched');
update gmail_cloud_worker_controls set enabled=true;
select test_assert(claim_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001')->>'status'='claimed','enabled claims');
select test_assert(claim_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002')->>'status'='busy','second owner busy');
select test_assert(assert_gmail_cloud_worker('10000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1)->>'status'='lost','cross-company fails');
select test_assert(assert_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',1)->>'status'='lost','cross-connection fails');
select test_assert(assert_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'123')->>'status'='uid_validity_unverified','empty cursor cannot implicitly bind UIDVALIDITY');
select test_assert((select uid_validity is null from gmail_cloud_worker_controls),'assert never seeds baseline');
update gmail_cloud_worker_controls set uid_validity='123'; -- Synthetic operator verification only.
select test_assert(assert_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'123')->>'status'='valid','explicit baseline accepted');
select test_assert(checkpoint_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'123',10)->>'provider_history_id'='10','checkpoint first');
select test_assert(checkpoint_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'123',5)->>'provider_history_id'='10','cursor cannot regress');
select test_assert(checkpoint_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'124',50)->>'status'='uid_validity_mismatch','generation mismatch');
select test_assert(checkpoint_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,null,50)->>'status'='uid_validity_unverified','generation required');
select test_assert((select provider_history_id='10' from gmail_connections where company_id='10000000-0000-0000-0000-000000000001'),'generation failure leaves cursor');
select test_assert(heartbeat_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1)->>'status'='valid','heartbeat owner');
update gmail_cloud_worker_controls set lease_until=clock_timestamp()-interval '1 second';
select test_assert(heartbeat_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1)->>'status'='lost','expired cannot revive');
select test_assert(claim_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002')->>'status'='claimed','new owner after expiry');
select test_assert(checkpoint_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'123',99)->>'status'='lost','old owner cannot checkpoint');
select test_assert(release_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1)->>'status'='lost','old owner cannot release successor');
update gmail_cloud_worker_controls set enabled=false;
select test_assert((select lease_owner is null and lease_until is null from gmail_cloud_worker_controls),'disable revokes lease');
select test_assert(checkpoint_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',1,'123',99)->>'status'='lost','disabled rejects checkpoint');
update gmail_cloud_worker_controls set enabled=true;
select test_assert(assert_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',1)->>'status'='lost','re-enable does not revive old owner');
select claim_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003');
update gmail_connections set configuration_version=2 where company_id='10000000-0000-0000-0000-000000000001';
select test_assert(assert_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001',1)->>'status'='lost','changed configuration fences owner');
update gmail_cloud_worker_controls set lease_until=clock_timestamp()-interval '1 second';
select claim_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000004');
select test_assert(assert_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001',2,'123')->>'status'='uid_validity_unverified','new configuration cannot trust old baseline');
select test_assert((select provider_history_id='10' from gmail_connections where company_id='10000000-0000-0000-0000-000000000001'),'legacy fail does not reset cursor');
select test_assert(release_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001',2)->>'status'='released','valid owner releases');
-- Synthetic operator-verified baseline, not automatic legacy adoption.
update gmail_cloud_worker_controls set uid_validity='123';
select claim_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000005');
select test_assert(assert_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001',2,'123')->>'status'='valid','explicit verified same-version baseline preserved');
update gmail_connections set status='disabled' where company_id='10000000-0000-0000-0000-000000000001';
select test_assert(checkpoint_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001',2,'123',99)->>'status'='lost','disabled connection fences live owner');
update gmail_cloud_worker_controls set lease_until=clock_timestamp()-interval '1 second';
select test_assert(claim_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000005')->>'status'='unavailable','disabled connection not claimed');
reset role;
-- Defense in depth: even an accidental SELECT grant does not expose controls.
grant select on public.gmail_cloud_worker_controls to authenticated;
set local role authenticated;
select test_assert(not exists(select 1 from public.gmail_cloud_worker_controls),'RLS hides service-only controls');
reset role;
rollback;
