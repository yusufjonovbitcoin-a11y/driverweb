begin;
insert into companies values ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into gmail_connections(id,company_id) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
insert into gmail_cloud_worker_controls(company_id,enabled) values ('10000000-0000-0000-0000-000000000001',true);
insert into jobs(id,company_id,type,status,attempt_count,locked_at,locked_by) values
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','gmail_create_driver_label','processing',1,now()-interval '5 minutes','gmail-cloud:old'),
 ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','gmail_label_assignment','processing',8,now()-interval '4 minutes','gmail-cloud:old'),
 ('50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','gmail_label_assignment','processing',1,now()-interval '5 minutes','gmail-cloud:30000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','gmail_label_assignment','processing',1,now(),'gmail-cloud:old'),
 ('50000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000002','gmail_label_assignment','processing',1,now()-interval '5 minutes','gmail-cloud:old'),
 ('50000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','document.ai_check','processing',1,now()-interval '5 minutes','gmail-cloud:old');
insert into broker_messages(id,company_id,gmail_connection_id,status) values
 ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','queued'),
 ('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','needs_review'),
 ('60000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','queued');
-- 200 terminal rows before unfinished work must not starve the selector.
insert into broker_attachments(id,company_id,message_id,mime_type,created_at)
 select ('40000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 '10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','application/pdf',now()-interval '1 day'
 from generate_series(1,207) n;
insert into ai_extractions(company_id,message_id,attachment_id,status)
 select company_id,message_id,id,'extracted' from broker_attachments where id<'40000000-0000-0000-0000-000000000201';
update broker_attachments set message_id='60000000-0000-0000-0000-000000000002' where id='40000000-0000-0000-0000-000000000202';
update broker_attachments set company_id='10000000-0000-0000-0000-000000000002',message_id='60000000-0000-0000-0000-000000000003' where id='40000000-0000-0000-0000-000000000203';
update broker_attachments set ai_last_attempt_at=now() where id='40000000-0000-0000-0000-000000000204';
insert into ai_extractions(company_id,message_id,attachment_id,status,processed_at) values
 ('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000205','parse_failed',now()),
 ('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000206','parse_failed',now()-interval '1 hour');
update broker_attachments set mime_type='text/plain' where id='40000000-0000-0000-0000-000000000207';
set local role service_role;
select claim_gmail_cloud_worker('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
select test_assert(recover_gmail_cloud_label_jobs('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1)->>'status'='uid_validity_unverified','maintenance requires baseline');
select test_assert(select_gmail_cloud_pending_attachments('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1)->>'status'='uid_validity_unverified','selector requires baseline');
update gmail_cloud_worker_controls set uid_validity='123'; -- Explicit synthetic verification.
select test_assert(recover_gmail_cloud_label_jobs('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,1)->>'count'='1','bounded recovery');
select test_assert((select status='failed' and locked_by is null from jobs where id='50000000-0000-0000-0000-000000000001'),'stale job recoverable');
select test_assert(recover_gmail_cloud_label_jobs('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1)->>'count'='1','only remaining exhausted stale job recovered');
select test_assert((select status='dead_letter' from jobs where id='50000000-0000-0000-0000-000000000002'),'exhausted job stays terminal');
select test_assert((select count(*)=4 from jobs where status='processing'),'currentowner/recent/foreign/unrelated jobs unchanged');
select test_assert(jsonb_array_length(select_gmail_cloud_pending_attachments('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1)->'attachments')=2,'SQL excludes terminal recent review foreign and unsupported rows before limit');
select test_assert(select_gmail_cloud_pending_attachments('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,1)->'attachments'->0->>'id'='40000000-0000-0000-0000-000000000201','unfinished work beyond first200 selected');
select test_assert(select_gmail_cloud_pending_attachments('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',1)->>'status'='lost','selector rejects stale owner');
select test_assert(recover_gmail_cloud_label_jobs('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',1)->>'status'='lost','recovery rejects stale owner');
update gmail_connections set configuration_version=2 where company_id='10000000-0000-0000-0000-000000000001';
select test_assert(recover_gmail_cloud_label_jobs('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1)->>'status'='lost','recovery fences configuration');
select test_assert(select_gmail_cloud_pending_attachments('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1)->>'status'='lost','selector fences configuration');
update gmail_cloud_worker_controls set enabled=false;
select test_assert(recover_gmail_cloud_label_jobs('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1)->>'status'='lost','disabled recovery does nothing');
select test_assert(select_gmail_cloud_pending_attachments('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1)->>'status'='lost','disabled selector returns no rows');
reset role;
rollback;
