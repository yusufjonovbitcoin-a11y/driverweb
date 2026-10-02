begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values (
  'f1000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'receipt-admin@test.local', '',
  now(), now(), now()
);

insert into public.companies(id, name)
values ('f2000000-0000-0000-0000-000000000001', 'Receipt Test Company');

insert into public.profiles(id, company_id, role, full_name, email) values (
  'f1000000-0000-0000-0000-000000000001',
  'f2000000-0000-0000-0000-000000000001',
  'company_admin', 'Receipt Admin', 'receipt-admin@test.local'
);

insert into public.loads(
  id, company_id, owner_dispatcher_id, load_number, status,
  broker_rate, loaded_miles
) values (
  'f3000000-0000-0000-0000-000000000001',
  'f2000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000001',
  'RECEIPT-1', 'ready_for_offer', 1000, 100
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f1000000-0000-0000-0000-000000000001';

select extensions.is(
  public.normalize_document_type('Payment Receipt'),
  'receipt',
  'payment receipt aliases normalize to the dedicated document type'
);

select public.begin_document_upload(
  'f3000000-0000-0000-0000-000000000001',
  null,
  'receipt',
  'lumper-receipt.jpg',
  'image/jpeg',
  1024
);

select extensions.is(
  (select document_type from public.documents
   where load_id = 'f3000000-0000-0000-0000-000000000001'
     and document_type = 'receipt'),
  'receipt',
  'a load-scoped payment receipt upload is accepted'
);

select extensions.is(
  (select stop_id from public.documents
   where load_id = 'f3000000-0000-0000-0000-000000000001'
     and document_type = 'receipt'),
  null::uuid,
  'payment receipts are attached to the load rather than a stop'
);

select * from extensions.finish();
rollback;
