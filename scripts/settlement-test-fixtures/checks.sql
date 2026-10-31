insert into storage.objects(bucket_id,name,owner_id,metadata)
 select 'driver-settlements','00000000-0000-0000-0000-000000000100/00000000-0000-0000-0000-000000000010/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-'||lpad(n::text,12,'0')||'.pdf',
 '00000000-0000-0000-0000-000000000001','{"size":20,"mimetype":"application/pdf"}' from generate_series(70,79)n;
select test_assert(not has_function_privilege('anon','confirm_driver_settlement(uuid,jsonb,text,text,bigint)','execute'),'anonymous confirmation denied');
set role authenticated;set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select test_assert((confirm_driver_settlement('00000000-0000-0000-0000-000000000070',test_statement('00000000-0000-0000-0000-000000000070','00000000-0000-0000-0000-000000000021'),'statement.pdf',repeat('a',64),20)).number=1,'first durable company reference');
select test_assert((confirm_driver_settlement('00000000-0000-0000-0000-000000000070',test_statement('00000000-0000-0000-0000-000000000070','00000000-0000-0000-0000-000000000021'),'statement.pdf',repeat('a',64),20)).number=1,'lost acknowledgement retry is idempotent');
select test_assert((select count(*)=1 from driver_settlements),'reload reads one persisted statement');
select test_assert((select snapshot->'calculation'->>'net'='9000' from driver_settlements),'exact edited snapshot survives reload');
select test_reject($q$select confirm_driver_settlement('00000000-0000-0000-0000-000000000071',test_statement('00000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-000000000021'),'statement.pdf',repeat('a',64),20)$q$,'SETTLEMENT_ALREADY_CONFIRMED');
select test_reject($q$select confirm_driver_settlement('00000000-0000-0000-0000-000000000070',test_statement('00000000-0000-0000-0000-000000000070','00000000-0000-0000-0000-000000000021'),'statement.pdf',repeat('b',64),20)$q$,'SETTLEMENT_ID_CONFLICT');
select test_reject($q$update driver_settlements set net_cents=1$q$,'permission denied');
with removed as(delete from storage.objects where bucket_id='driver-settlements' and name like '%000000000070.pdf' returning *)select test_assert((select count(*)=0 from removed),'approved PDF cannot be deleted');
with changed as(update storage.objects set metadata='{}' where name like '%000000000070.pdf' returning *)select test_assert((select count(*)=0 from changed),'approved PDF cannot be overwritten');
select test_reject($q$select confirm_driver_settlement('00000000-0000-0000-0000-000000000074',jsonb_set(test_statement('00000000-0000-0000-0000-000000000074','00000000-0000-0000-0000-000000000023'),'{calculation,rows,0,load,version}','2'),'statement.pdf',repeat('a',64),20)$q$,'SETTLEMENT_LOAD_CHANGED');
select test_reject($q$select confirm_driver_settlement('00000000-0000-0000-0000-000000000074',jsonb_set(test_statement('00000000-0000-0000-0000-000000000074','00000000-0000-0000-0000-000000000023'),'{settingsVersion}','0'),'statement.pdf',repeat('a',64),20)$q$,'SETTLEMENT_SETTINGS_CHANGED');
select test_reject($q$select confirm_driver_settlement('00000000-0000-0000-0000-000000000074',jsonb_set(test_statement('00000000-0000-0000-0000-000000000074','00000000-0000-0000-0000-000000000023'),'{calculation,net}','-1'),'statement.pdf',repeat('a',64),20)$q$,'SETTLEMENT_INVALID');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert((select count(*)=0 from driver_settlements),'dispatcher cannot read salary snapshots');
select test_reject($q$select confirm_driver_settlement('00000000-0000-0000-0000-000000000074',test_statement('00000000-0000-0000-0000-000000000074','00000000-0000-0000-0000-000000000023'),'statement.pdf',repeat('a',64),20)$q$,'SETTLEMENT_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000004';
select test_assert((select count(*)=0 from driver_settlements),'other company cannot read snapshots');
select test_assert((select count(*)=0 from storage.objects where bucket_id='driver-settlements'),'other company cannot read PDFs');
select test_reject($q$select confirm_driver_settlement('00000000-0000-0000-0000-000000000074',test_statement('00000000-0000-0000-0000-000000000074','00000000-0000-0000-0000-000000000023'),'statement.pdf',repeat('a',64),20)$q$,'SETTLEMENT_PERMISSION_DENIED');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_assert((select count(*)=0 from driver_settlements),'suspended administrator cannot read snapshots');
reset role;
