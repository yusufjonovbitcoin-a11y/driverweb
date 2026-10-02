insert into profiles(id,company_id,role) values
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','company_admin'),
('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','driver'),
('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','company_admin');
insert into loads(id,company_id,load_number,status,driver_brief) values
('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','TEST-1','review',
'{"version":1,"checksum":"test-checksum","reviewedAt":null,"blockingFields":[],"fields":[{"key":"loadNumber","value":"TEST-1"}]}');
insert into manual_load_imports values
('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
'30000000-0000-0000-0000-000000000001','test-checksum','needs_review',3,'{}');
set "request.jwt.claim.sub"='10000000-0000-0000-0000-000000000001';
do $$ begin
  begin
    insert into assignments(load_id) values ('30000000-0000-0000-0000-000000000001');
    raise exception 'Unreviewed assignment was allowed';
  exception when raise_exception then
    if sqlerrm <> 'Document review required before assignment' then raise; end if;
  end;
  begin
    insert into offers(load_id) values ('30000000-0000-0000-0000-000000000001');
    raise exception 'Unreviewed offer was allowed';
  exception when raise_exception then
    if sqlerrm <> 'Document review required before assignment' then raise; end if;
  end;
  raise notice 'PASS: both direct assignment and offer bypass are blocked';
end $$;

do $$ begin
  begin
    perform review_and_assign_document_load('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','test-checksum');
    raise exception 'Foreign driver was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Driver is not eligible' then raise; end if;
  end;
end $$;
select test_assert((select driver_brief->>'reviewedAt' is null and status='review' from loads), 'failed assignment rolls review back');

set "request.jwt.claim.sub"='10000000-0000-0000-0000-000000000003';
do $$ begin
  begin
    perform review_and_assign_document_load('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','test-checksum');
    raise exception 'Foreign company review was accepted';
  exception when raise_exception then if sqlerrm <> 'Load not found' then raise; end if;
  end;
end $$;
set "request.jwt.claim.sub"='10000000-0000-0000-0000-000000000001';
update loads set driver_brief=jsonb_set(driver_brief,'{blockingFields}','["pickup.addressLine"]');
do $$ begin
  begin
    perform review_and_assign_document_load('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','test-checksum');
    raise exception 'Unresolved field was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Document has unresolved fields. Upload a clearer complete source' then raise; end if;
  end;
  raise notice 'PASS: unresolved fields block review';
end $$;
update loads set driver_brief=jsonb_set(driver_brief,'{blockingFields}','[]');
select review_and_assign_document_load('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','test-checksum');
select test_assert((select status='assigned' and driver_brief->>'reviewedAt' is not null from loads), 'review and assignment succeed atomically');
select test_assert((select count(*)=1 from assignments), 'exactly one assignment');
select test_assert((select driver_brief->>'checksum'='test-checksum' from load_overview), 'read model retains source identity');
select test_assert(not has_function_privilege('anon','review_and_assign_document_load(uuid,uuid,text)','execute'), 'anonymous cannot review');
select test_assert(not has_function_privilege('authenticated','guard_driver_brief_assignment()','execute'), 'trigger helper is not exposed');
