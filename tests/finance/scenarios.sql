-- Run ONLY in the isolated fixture database created by tests/finance/run-local.sh.
\set ON_ERROR_STOP on
insert into companies values('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into profiles values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','company_admin','active','Admin'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','driver','active','Driver'),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','company_admin','active','Other company'),
 ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','dispatcher','active','Dispatcher');
insert into loads(id,company_id,load_number,status,broker_name,broker_rate,loaded_miles,current_assignment_id) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','TEST-1','completed','Test Broker',5300,1417,'40000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','TEST-2','completed','Test Broker',3200,1210,'40000000-0000-0000-0000-000000000002');
insert into assignments(id,company_id,driver_id,load_id,ended_at) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','2026-10-12 15:00:00Z'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','2026-10-13 15:00:00Z');
select set_config('test.user','20000000-0000-0000-0000-000000000001',false);
create function public.test_expect_error(command text,expected text) returns void language plpgsql as $$begin
 begin execute command; exception when others then if sqlerrm like '%'||expected||'%' then return;else raise exception 'Wrong error: %, expected %',sqlerrm,expected;end if;end;
 raise exception 'Expected failure: %',expected;
end$$;
DO $$
declare inv uuid; adv uuid; settled uuid; payment uuid; net numeric; data jsonb;
 op uuid:=gen_random_uuid(); payload jsonb; driver uuid:='20000000-0000-0000-0000-000000000002';
begin
 payload:='{"counterparty":"Test Broker","document_date":"2026-10-14","due_date":"2026-10-30","load_ids":["30000000-0000-0000-0000-000000000001","30000000-0000-0000-0000-000000000002"],"items":[]}';
 inv:=finance_create_document(op,'invoice',payload);
 if inv is distinct from finance_create_document(op,'invoice',payload) then raise exception 'Idempotent create failed';end if;
 perform test_expect_error(format('select finance_create_document(%L,%L,%L::jsonb)',op,'invoice',payload||'{"notes":"changed"}'),'FINANCE_IDEMPOTENCY_MISMATCH');
 perform test_expect_error(format('select finance_document_action(%L,null,%L)',inv,'post'),'FINANCE_CONFLICT');
 perform finance_document_action(inv,1,'post');
 payment:=finance_record_payment(gen_random_uuid(),inv,3000,'2026-10-15','bank','fixture-payment');
 perform test_expect_error(format('select finance_record_payment(gen_random_uuid(),%L,6000,%L,%L,%L)',inv,'2026-10-15','bank','over'),'FINANCE_OVERPAYMENT');
 select finance_workspace() into data;
 if (select (d->>'paid')::numeric from jsonb_array_elements(data->'documents') d where d->>'id'=inv::text)<>3000 then raise exception 'Partial payment failed'; end if;
 perform test_expect_error(format('select finance_document_action(%L,2,%L,%L)',inv,'void','test void'),'FINANCE_HAS_PAYMENTS');
 perform finance_payment_action(payment,'void','fixture reversal');
 perform finance_document_action(inv,2,'void','fixture reversal');
 -- Voiding releases the invoice claim, permitting a corrected invoice.
 perform finance_create_document(gen_random_uuid(),'invoice',payload);
 perform finance_save_rule(driver,0,'percentage',90,0,true);
 adv:=finance_create_document(gen_random_uuid(),'advance',jsonb_build_object('counterparty','Driver','driver_id',driver,'document_date','2026-10-01','due_date','2026-10-01','items',jsonb_build_array(jsonb_build_object('description','Cash advance','amount','1000'))));
 perform finance_document_action(adv,1,'post');
 perform finance_recurring_command(gen_random_uuid(),jsonb_build_object('driver_id',driver,'description','Insurance','direction','deduction','amount','350','starts_on','2026-10-12','interval_days',7));
 payload:=jsonb_build_object('counterparty','Driver','driver_id',driver,'document_date','2026-10-14','due_date','2026-10-14','period_from','2026-10-12','period_to','2026-10-18','time_zone','UTC','load_ids',jsonb_build_array('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002'),'items',jsonb_build_array(jsonb_build_object('description','Reimbursement','amount','100','type','reimbursement')),'advances',jsonb_build_array(jsonb_build_object('id',adv,'amount','250')));
 perform test_expect_error(format('select finance_create_document(gen_random_uuid(),%L,%L::jsonb)','settlement',payload||'{"period_from":"2026-10-14"}'),'FINANCE_PERIOD');
 settled:=finance_create_document(gen_random_uuid(),'settlement',payload);
 select total into net from finance_documents where id=settled;
 if net<>7150 then raise exception 'Settlement expected 7150 got %',net; end if;
 select finance_workspace() into data;
 if (select (d->>'recovered')::numeric from jsonb_array_elements(data->'documents') d where d->>'id'=adv::text)<>0 then raise exception 'Draft recovery incorrectly posted'; end if;
 if (select (d->>'applied')::numeric from jsonb_array_elements(data->'documents') d where d->>'id'=adv::text)<>250 then raise exception 'Advance reservation missing'; end if;
 perform finance_document_action(settled,1,'post');
 select finance_workspace() into data;
 if (select (d->>'recovered')::numeric from jsonb_array_elements(data->'documents') d where d->>'id'=adv::text)<>250 then raise exception 'Advance recovery not posted'; end if;
 perform test_expect_error(format('select finance_create_document(gen_random_uuid(),%L,%L::jsonb)','settlement',payload),'FINANCE_RECURRING_USED');
 perform finance_document_action(settled,2,'void','test correction');
 -- After reversal no applied advances or duplicate recurring occurrence remain.
 settled:=finance_create_document(gen_random_uuid(),'settlement',payload);
 if exists(select 1 from finance_journal j cross join lateral(select sum((x->>'debit')::numeric-(x->>'credit')::numeric) balance from jsonb_array_elements(j.entries) x) b where balance<>0) then raise exception 'Unbalanced journal';end if;
 if exists(select 1 from finance_journal j where reversal_of is not null and not exists(select 1 from finance_journal original where original.id=j.reversal_of)) then raise exception 'Missing reversal origin';end if;
 perform test_expect_error(format('select finance_document_action(%L,1,%L,null)',settled,'void'),'FINANCE_REASON');
 perform test_expect_error(format('select finance_recurring_command(gen_random_uuid(),%L::jsonb)',jsonb_build_object('driver_id',driver,'description','Bad','direction','deduction','amount','NaN','starts_on','2026-10-12','interval_days',7)),'FINANCE_INVALID_LINE');
 raise notice 'PASS: invoices, partial payment, reversal, CAS, duplicate claims, percentage settlement, recurring charge, advance reservation/recovery, balanced journals';
end$$;
-- Authenticated actors must not bypass command permissions or tenant scope.
set role authenticated;
select set_config('test.user','20000000-0000-0000-0000-000000000003',false);
DO $$begin if jsonb_array_length(finance_workspace()->'documents')<>0 then raise exception 'Cross-tenant leak';end if; if exists(select 1 from finance_documents) then raise exception 'RLS cross-tenant leak';end if;end$$;
select set_config('test.user','20000000-0000-0000-0000-000000000004',false);
select test_expect_error($q$select finance_create_document(gen_random_uuid(),'expense','{}')$q$,'FINANCE_PERMISSION');
select test_expect_error($q$insert into finance_documents(company_id) values('10000000-0000-0000-0000-000000000001')$q$,'permission denied');
select set_config('test.user','20000000-0000-0000-0000-000000000002',false);
select test_expect_error('select finance_workspace()','FINANCE_PERMISSION');
reset role;
select 'PASS: cross-company RLS, driver denial, dispatcher read-only, direct write denial' as result;
select set_config('test.user','20000000-0000-0000-0000-000000000001',false);
DO $$
declare driver uuid:='20000000-0000-0000-0000-000000000002'; d record; sid uuid; inv uuid; credit uuid; payment uuid; payload jsonb; amount numeric;
begin
 for d in select * from finance_documents where kind='settlement' and status='draft' loop perform finance_document_action(d.id,d.version,'void','release fixture');end loop;
 perform finance_save_rule(driver,1,'mileage',0.65,0,false);
 payload:=jsonb_build_object('counterparty','Driver','driver_id',driver,'document_date','2026-10-14','due_date','2026-10-14','period_from','2026-10-12','period_to','2026-10-18','time_zone','UTC','load_ids',jsonb_build_array('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002'),'items',jsonb_build_array(jsonb_build_object('description','Dispatch fee','amount','0.50','type','deduction','calculation','percentage')));
 sid:=finance_create_document(gen_random_uuid(),'settlement',payload);
 select total into amount from finance_documents where id=sid;
 if amount<>1315.05 then raise exception 'Mileage/percent fee expected 1315.05 got %',amount;end if;
 update assignments set ended_at='2026-11-01' where id='40000000-0000-0000-0000-000000000001';
 perform test_expect_error(format('select finance_document_action(%L,1,%L)',sid,'post'),'FINANCE_ASSIGNMENT');
 update assignments set ended_at='2026-10-12 15:00:00Z' where id='40000000-0000-0000-0000-000000000001';
 perform finance_document_action(sid,1,'void','release fixture');
 insert into assignment_driver_pay values('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',driver,900);
 perform finance_save_rule(driver,2,'flat',125,0,true);
 sid:=finance_create_document(gen_random_uuid(),'settlement',payload||'{"items":[]}');
 select total into amount from finance_documents where id=sid;
 if amount<>675 then raise exception 'Immutable snapshot + flat expected 675 got %',amount;end if;
 select id into inv from finance_documents where kind='invoice' and status='draft' limit 1;
 perform finance_document_action(inv,1,'post');
 credit:=finance_credit_invoice(gen_random_uuid(),inv,500,'Synthetic factoring fee','5600');
 payment:=finance_record_payment(gen_random_uuid(),inv,8000,'2026-10-16','factoring','synthetic-factor');
 if (select (doc->>'credited')::numeric+(doc->>'paid')::numeric from jsonb_array_elements(finance_workspace()->'documents') doc where doc->>'id'=inv::text)<>8500 then raise exception 'Factoring close failed';end if;
 perform test_expect_error(format('select finance_record_payment(gen_random_uuid(),%L,1,%L,%L,%L)',inv,'2026-10-16','bank','over'),'FINANCE_OVERPAYMENT');
 perform finance_void_credit(credit,'reverse synthetic fee');
 perform finance_payment_action(payment,'void','reverse synthetic receipt');
 perform finance_document_action(inv,2,'void','reverse synthetic invoice');
 if (select coalesce(sum((x->>'debit')::numeric-(x->>'credit')::numeric),0) from finance_journal j cross join lateral jsonb_array_elements(j.entries) x where document_id=inv and x->>'account'='1100')<>0 then raise exception 'AR reversal mismatch';end if;
 raise notice 'PASS: mileage, percentage deduction, flat rate, immutable snapshot, stale-source guard, factoring fee credit, payment limit and credit reversal';
end$$;
