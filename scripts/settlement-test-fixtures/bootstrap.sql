create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema private;create schema storage;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,storage to authenticated,anon;
create table companies(id uuid primary key);
create table profiles(id uuid primary key,company_id uuid references companies,full_name text,role text,status text,unique(id,company_id));
create table assignments(id uuid primary key,company_id uuid,driver_id uuid);
create table loads(id uuid primary key,company_id uuid,current_assignment_id uuid,trashed_at timestamptz,status text,version bigint,unique(id,company_id));
create table audit_events(id uuid primary key default gen_random_uuid(),company_id uuid,actor_id uuid,action text,entity_type text,entity_id uuid,new_value jsonb);
create table company_accounting_settings(company_id uuid primary key,version bigint);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant select,insert,update,delete on storage.objects to authenticated;
create function current_profile() returns profiles language sql stable security definer set search_path=public as $$select * from profiles where id=auth.uid() and status='active'$$;
create function current_company_id() returns uuid language sql stable security definer set search_path=public as $$select company_id from profiles where id=auth.uid() and status='active'$$;
create function current_app_role() returns text language sql stable security definer set search_path=public as $$select role from profiles where id=auth.uid() and status='active'$$;
insert into companies values('00000000-0000-0000-0000-000000000100'),('00000000-0000-0000-0000-000000000200');
insert into profiles values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000100','Admin A','company_admin','active'),
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000100','Admin B','company_admin','active'),
 ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000100','Dispatcher','dispatcher','active'),
 ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000200','Other Admin','company_admin','active'),
 ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000100','Suspended','company_admin','suspended'),
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000100','Driver A','driver','active'),
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000200','Other Driver','driver','active');
insert into company_accounting_settings values('00000000-0000-0000-0000-000000000100',1);
insert into assignments select ('00000000-0000-0000-0000-'||lpad((n+10)::text,12,'0'))::uuid,
 '00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000010' from generate_series(21,24)n;
insert into loads select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-0000-0000-000000000100',('00000000-0000-0000-0000-'||lpad((n+10)::text,12,'0'))::uuid,null,'completed',1 from generate_series(21,24)n;
create function test_statement(id uuid,load_id uuid) returns jsonb language sql stable as $$
 select jsonb_build_object('id','calc:'||id::text,'deliveryId',id,'driver',jsonb_build_object('id','00000000-0000-0000-0000-000000000010','name','Driver A'),
  'settingsVersion',1,'approvalStatus','approved','company',jsonb_build_object('name','Test Co'),
  'calculation',jsonb_build_object('gross',10000,'net',9000,'commission',1000,'earnings',9000,'deducted',0,
   'settings',jsonb_build_object('rules',jsonb_build_array(jsonb_build_object('id','company','enabled',true,'value','10'))),
   'deductions','[]'::jsonb,'period',jsonb_build_object('from','2026-10-01','to','2026-10-07'),
   'rows',jsonb_build_array(jsonb_build_object('gross',10000,'commission',1000,'net',9000,'miles',100,
    'load',jsonb_build_object('id',load_id,'version',1,'driverId','00000000-0000-0000-0000-000000000010','loadNumber','TEST-1','origin',jsonb_build_object('city','Boston'),'destination',jsonb_build_object('city','Newark'))))));
$$;
create function test_assert(value boolean,description text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'FAIL: %',description;end if;raise notice 'PASS: %',description;end$$;
create function test_reject(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then
  if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'FAIL: expected rejection %',expected;end$$;
