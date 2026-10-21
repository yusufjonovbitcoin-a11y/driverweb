-- TMS finance: USD operational ledger. All financial writes go through validated commands.
create schema if not exists private;

create table public.finance_documents (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 number bigint generated always as identity, kind text not null check(kind in ('invoice','settlement','expense','advance')),
 status text not null default 'draft' check(status in ('draft','posted','void')),
 counterparty text not null check(length(counterparty) between 1 and 200), driver_id uuid references public.profiles(id),
 document_date date not null, due_date date not null, period_from date, period_to date,
 currency text not null default 'USD' check(currency='USD'), lines jsonb not null,
 total numeric(14,2) not null, notes text not null default '' check(length(notes)<=2000),
 operation_id uuid not null, request_hash text not null, time_zone text not null default 'UTC', version bigint not null default 1, created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), posted_at timestamptz, void_reason text,
 unique(company_id,operation_id), check(due_date>=document_date),
 check((kind='settlement' and driver_id is not null and period_from is not null and period_to>=period_from) or kind<>'settlement'),
 check(jsonb_typeof(lines)='array' and jsonb_array_length(lines) between 1 and 200),
 check(total>=0)
);
create index finance_documents_company_date on public.finance_documents(company_id,document_date desc,id);
create index finance_documents_driver on public.finance_documents(driver_id);
create index finance_documents_created_by on public.finance_documents(created_by);

create table public.finance_claims (
 company_id uuid not null references public.companies(id), document_id uuid not null references public.finance_documents(id),
 kind text not null, source_id uuid not null, active boolean not null default true,
 primary key(document_id,kind,source_id)
);
create unique index finance_claim_once on public.finance_claims(company_id,kind,source_id) where active;
create index finance_claims_document on public.finance_claims(document_id);

create table public.finance_payments (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 document_id uuid not null references public.finance_documents(id), amount numeric(14,2) not null check(amount>0),
 payment_date date not null, method text not null check(method in ('bank','ach','check','zelle','cash','factoring','other')),
 reference text not null check(length(reference) between 1 and 200), operation_id uuid not null,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 voided_at timestamptz, void_reason text, reconciled_at timestamptz,
 unique(company_id,operation_id)
);
create index finance_payments_document on public.finance_payments(document_id);
create index finance_payments_company_date on public.finance_payments(company_id,payment_date);
create index finance_payments_created_by on public.finance_payments(created_by);

create table public.finance_journal (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 document_id uuid not null references public.finance_documents(id), payment_id uuid references public.finance_payments(id),
 entry_date date not null, memo text not null, entries jsonb not null,
 reversal_of uuid unique references public.finance_journal(id), created_at timestamptz not null default now()
);
create index finance_journal_company_date on public.finance_journal(company_id,entry_date);
create index finance_journal_document on public.finance_journal(document_id);
create index finance_journal_payment on public.finance_journal(payment_id);

create table public.finance_pay_rules (
 company_id uuid not null references public.companies(id), driver_id uuid primary key references public.profiles(id),
 mode text not null check(mode in ('percentage','mileage','flat')),
 rate numeric(12,4) not null check(rate>=0 and rate<=999999), empty_rate numeric(12,4) not null default 0 check(empty_rate=0),
 require_assignment_snapshot boolean not null default true, version bigint not null default 1,
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(),
 check(mode<>'percentage' or rate<=100), check(mode<>'mileage' or rate<=100)
);
create index finance_pay_rules_company on public.finance_pay_rules(company_id);
create index finance_pay_rules_updated_by on public.finance_pay_rules(updated_by);

create table public.finance_company_defaults (
 company_id uuid primary key references public.companies(id), fee_percent numeric(5,2) check(fee_percent between 0 and 100),
 version bigint not null default 1, updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
create index finance_company_defaults_actor on public.finance_company_defaults(updated_by);

-- Freeze the applicable pay template when a new dispatch assignment is created.
create table public.finance_assignment_tariffs (
 assignment_id uuid primary key references public.assignments(id) on delete cascade, company_id uuid not null references public.companies(id),
 driver_id uuid not null references public.profiles(id), mode text not null, rate numeric(12,4) not null,
 require_assignment_snapshot boolean not null, rule_version bigint not null, captured_at timestamptz not null default now()
);
create index finance_assignment_tariffs_company on public.finance_assignment_tariffs(company_id);
create index finance_assignment_tariffs_driver on public.finance_assignment_tariffs(driver_id);
create function private.finance_capture_tariff() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.finance_assignment_tariffs(assignment_id,company_id,driver_id,mode,rate,require_assignment_snapshot,rule_version)
 select new.id,new.company_id,new.driver_id,r.mode,r.rate,r.require_assignment_snapshot,r.version
 from public.finance_pay_rules r where r.company_id=new.company_id and r.driver_id=new.driver_id;
 if not found then
  insert into public.finance_assignment_tariffs(assignment_id,company_id,driver_id,mode,rate,require_assignment_snapshot,rule_version)
  select new.id,new.company_id,new.driver_id,'percentage',100-c.fee_percent,true,c.version from public.finance_company_defaults c where c.company_id=new.company_id and c.fee_percent is not null;
 end if;
 return new;
end $$;
revoke all on function private.finance_capture_tariff() from public,anon,authenticated;
create trigger finance_capture_assignment_tariff after insert on public.assignments for each row execute function private.finance_capture_tariff();

create table public.finance_recurring_rules (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 driver_id uuid not null references public.profiles(id), description text not null check(length(description) between 1 and 200),
 direction text not null check(direction in ('addition','deduction')), amount numeric(12,2) not null check(amount>0),
 starts_on date not null, ends_on date, interval_days integer not null check(interval_days between 1 and 366), active boolean not null default true,
 version bigint not null default 1, created_by uuid not null references public.profiles(id),
 check(ends_on is null or ends_on>=starts_on)
);
create index finance_recurring_company on public.finance_recurring_rules(company_id,driver_id);
create index finance_recurring_creator on public.finance_recurring_rules(created_by);
create index finance_recurring_driver on public.finance_recurring_rules(driver_id);
create table public.finance_occurrences (
 company_id uuid not null references public.companies(id), rule_id uuid not null references public.finance_recurring_rules(id),
 due_on date not null, document_id uuid not null references public.finance_documents(id), active boolean not null default true,
 primary key(document_id,rule_id,due_on)
);
create unique index finance_occurrence_once on public.finance_occurrences(rule_id,due_on) where active;
create index finance_occurrence_document on public.finance_occurrences(document_id);
create index finance_occurrence_company on public.finance_occurrences(company_id);

create table public.finance_balance_applications (
 company_id uuid not null references public.companies(id), advance_id uuid not null references public.finance_documents(id),
 settlement_id uuid not null references public.finance_documents(id), amount numeric(14,2) not null check(amount>0), active boolean not null default true,
 primary key(advance_id,settlement_id)
);
create index finance_balance_settlement on public.finance_balance_applications(settlement_id);
create index finance_balance_company on public.finance_balance_applications(company_id);

create function private.finance_actor(write_access boolean default false) returns public.profiles
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles;
begin
 actor := public.current_profile();
 if actor.id is null or actor.company_id is null or actor.status::text<>'active' or actor.role::text not in ('company_admin','dispatcher')
 or (write_access and actor.role::text<>'company_admin') then raise exception 'FINANCE_PERMISSION' using errcode='42501'; end if;
 return actor;
end $$;
revoke all on function private.finance_actor(boolean) from public,anon,authenticated;

create function private.finance_audit(actor public.profiles, doc uuid, action_name text, value jsonb) returns void
language sql security definer set search_path='' as $$
 insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value)
 values(actor.company_id,actor.id,action_name,'finance_document',doc,value);
$$;
revoke all on function private.finance_audit(public.profiles,uuid,text,jsonb) from public,anon,authenticated;

create function private.finance_entry(c uuid,d uuid,p uuid,day date,label text,items jsonb,rev uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare balance numeric; bad integer; entry_id uuid;
begin
 select sum((x->>'debit')::numeric-(x->>'credit')::numeric), count(*) filter(where
  (x->>'debit')::numeric<0 or (x->>'credit')::numeric<0 or (x->>'debit')::numeric*(x->>'credit')::numeric<>0
  or x->>'account' not in ('1000','1100','1150','2000','2100','4000','4100','5000','5100','5200','5300','5400','5500','5600','5700'))
 into balance,bad from jsonb_array_elements(items) x;
 if balance is distinct from 0 or bad>0 then raise exception 'FINANCE_UNBALANCED'; end if;
 insert into public.finance_journal(company_id,document_id,payment_id,entry_date,memo,entries,reversal_of) values(c,d,p,day,label,items,rev) returning id into entry_id;
 return entry_id;
end $$;
revoke all on function private.finance_entry(uuid,uuid,uuid,date,text,jsonb,uuid) from public,anon,authenticated;

create function public.finance_save_defaults(p_version bigint,p_fee_percent numeric) returns void
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=private.finance_actor(true); existing_version bigint;
begin
 perform 1 from public.companies where id=actor.company_id for update;
 select version into existing_version from public.finance_company_defaults where company_id=actor.company_id;
 if coalesce(existing_version,0) is distinct from p_version then raise exception 'FINANCE_CONFLICT';end if;
 if p_fee_percent is not null and (p_fee_percent::text in ('NaN','Infinity','-Infinity') or p_fee_percent not between 0 and 100 or p_fee_percent<>round(p_fee_percent,2)) then raise exception 'FINANCE_PAY_RULE';end if;
 insert into public.finance_company_defaults(company_id,fee_percent,updated_by) values(actor.company_id,p_fee_percent,actor.id)
 on conflict(company_id) do update set fee_percent=excluded.fee_percent,version=finance_company_defaults.version+1,updated_by=actor.id,updated_at=now();
 perform private.finance_audit(actor,actor.company_id,'finance.defaults_saved',jsonb_build_object('fee_percent',p_fee_percent));
end $$;
revoke all on function public.finance_save_defaults(bigint,numeric) from public,anon;
grant execute on function public.finance_save_defaults(bigint,numeric) to authenticated;

create function public.finance_create_document(p_operation_id uuid,p_kind text,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=private.finance_actor(true); doc uuid; source uuid; l public.loads; a public.assignments;
 rule public.finance_pay_rules; tariff public.finance_assignment_tariffs; snap public.assignment_driver_pay; price public.load_price_snapshots;
 item jsonb; lines jsonb:='[]'; amount numeric; gross numeric; miles numeric; total numeric:=0;
 driver uuid; date_from date; date_to date; rec record; next_day date; adv public.finance_documents;
 available numeric; base_amount numeric; cat text; party text; operation public.finance_documents; zone text; request_fingerprint text;
begin
 if p_operation_id is null or p_kind is null or p_kind not in ('invoice','settlement','expense','advance') or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'FINANCE_INVALID'; end if;
 perform 1 from public.companies where id=actor.company_id for update;
 select * into operation from public.finance_documents where company_id=actor.company_id and operation_id=p_operation_id;
 if found then
  if operation.request_hash is distinct from md5(p_kind||p_payload::text) then raise exception 'FINANCE_IDEMPOTENCY_MISMATCH'; end if;
  return operation.id;
 end if;
 request_fingerprint:=md5(p_kind||p_payload::text);
 zone:=coalesce(p_payload->>'time_zone','UTC');
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then raise exception 'FINANCE_DATE'; end if;
 driver:=nullif(p_payload->>'driver_id','')::uuid; date_from:=case when p_kind='settlement' then nullif(p_payload->>'period_from','')::date end; date_to:=case when p_kind='settlement' then nullif(p_payload->>'period_to','')::date end;
 if driver is not null and not exists(select 1 from public.profiles where id=driver and company_id=actor.company_id and role::text='driver') then raise exception 'FINANCE_DRIVER'; end if;
 if p_kind='settlement' and (driver is null or date_from is null or date_to is null or date_to<date_from or date_to-date_from>366) then raise exception 'FINANCE_PERIOD'; end if;
 if p_kind='advance' and driver is null then raise exception 'FINANCE_DRIVER'; end if;
 if length(coalesce(p_payload->>'notes',''))>2000 then raise exception 'FINANCE_INVALID'; end if;
 party:=btrim(p_payload->>'counterparty');
 if party is null or length(party) not between 1 and 200 then raise exception 'FINANCE_PARTY'; end if;
 if p_payload->>'document_date' is null or p_payload->>'due_date' is null then raise exception 'FINANCE_DATE'; end if;
 if coalesce(jsonb_array_length(p_payload->'load_ids'),0)>100 then raise exception 'FINANCE_TOO_MANY'; end if;
 if p_kind in ('invoice','settlement') then
  if coalesce(jsonb_array_length(p_payload->'load_ids'),0)=0 then raise exception 'FINANCE_SELECT_LOADS'; end if;
  if p_kind='settlement' then select * into rule from public.finance_pay_rules where driver_id=driver and company_id=actor.company_id; end if;
  for source in select distinct value::uuid from jsonb_array_elements_text(p_payload->'load_ids') loop
   select * into l from public.loads where id=source and company_id=actor.company_id and public.can_access_load(id);
   if l.id is null or l.current_assignment_id is null or l.status::text not in ('delivered','completed') or l.trashed_at is not null then raise exception 'FINANCE_NOT_DELIVERED'; end if;
   select * into a from public.assignments where id=l.current_assignment_id and company_id=actor.company_id;
   if a.id is null or a.load_id<>l.id then raise exception 'FINANCE_ASSIGNMENT'; end if;
   if p_kind='settlement' and (a.id is null or a.driver_id<>driver or a.requires_reconfirmation) then raise exception 'FINANCE_ASSIGNMENT'; end if;
   if p_kind='settlement' and (l.status::text<>'completed' or a.ended_at is null or (a.ended_at at time zone zone)::date not between date_from and date_to) then raise exception 'FINANCE_PERIOD'; end if;
   if p_kind='settlement' then
    select * into tariff from public.finance_assignment_tariffs where assignment_id=a.id and company_id=actor.company_id and driver_id=driver;
    select * into rule from public.finance_pay_rules where driver_id=driver and company_id=actor.company_id;
    if rule.driver_id is null then
     select fee_percent into amount from public.finance_company_defaults where company_id=actor.company_id;
     if amount is not null then rule.driver_id:=driver;rule.mode:='percentage';rule.rate:=100-amount;rule.require_assignment_snapshot:=true;end if;
    end if;
    if tariff.assignment_id is not null then rule.driver_id:=driver;rule.mode:=tariff.mode;rule.rate:=tariff.rate;rule.require_assignment_snapshot:=tariff.require_assignment_snapshot;end if;
   end if;
   select * into price from public.load_price_snapshots where id=a.accepted_price_snapshot_id and company_id=actor.company_id and load_id=l.id;
   gross:=coalesce(price.broker_rate,l.broker_rate); miles:=coalesce(price.loaded_miles,l.loaded_miles);
   if coalesce(l.driver_brief->'unknownFields','[]'::jsonb) ? 'brokerRate' then gross:=null; end if;
   if coalesce(l.driver_brief->'unknownFields','[]'::jsonb) ? 'loadedMiles' then miles:=null; end if;
   if p_kind='invoice' then
    if l.broker_name is null or btrim(l.broker_name)<>party then raise exception 'FINANCE_BROKER_MISMATCH'; end if;
    amount:=gross;
   else
    select * into snap from public.assignment_driver_pay where assignment_id=a.id and company_id=actor.company_id and driver_id=driver and load_id=l.id;
    if snap.assignment_id is not null then amount:=snap.amount;
    elsif rule.driver_id is null then raise exception 'FINANCE_PAY_RULE';
    elsif rule.mode='percentage' then amount:=round(gross*rule.rate/100,2);
    elsif rule.mode='flat' then amount:=round(rule.rate,2);
    elsif rule.require_assignment_snapshot then raise exception 'FINANCE_SNAPSHOT_PENDING';
    else amount:=round(miles*rule.rate,2); end if;
   end if;
   if amount is null or amount<0 then raise exception 'FINANCE_UNKNOWN_AMOUNT'; end if;
   lines:=lines||jsonb_build_array(jsonb_build_object('description',l.load_number,'amount',amount,'type','earning','account',case when p_kind='invoice' then '4000' else '5000' end,'load_id',l.id,'assignment_id',a.id,'gross',gross,'miles',miles,'tariff_source',case when p_kind='invoice' then 'contract' when tariff.assignment_id is not null or snap.assignment_id is not null then 'assignment' else 'current_profile_at_statement' end,'basis',case when p_kind='invoice' then 'contract' when snap.assignment_id is not null then 'assignment_snapshot' else rule.mode end));
  end loop;
 end if;
 if coalesce(jsonb_array_length(p_payload->'items'),0)>60 then raise exception 'FINANCE_TOO_MANY'; end if;
 for item in select value from jsonb_array_elements(coalesce(p_payload->'items','[]')) loop
  if length(btrim(coalesce(item->>'description',''))) not between 1 and 200 or coalesce(item->>'amount','') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' then raise exception 'FINANCE_INVALID_LINE'; end if;
  if coalesce(item->>'calculation','fixed') not in ('fixed','percentage') then raise exception 'FINANCE_INVALID_LINE'; end if;
  amount:=(item->>'amount')::numeric;
  if item->>'calculation'='percentage' then
   if p_kind not in ('invoice','settlement') or amount>100 then raise exception 'FINANCE_INVALID_LINE'; end if;
   if exists(select 1 from jsonb_array_elements(lines) source_line where source_line ? 'load_id' and (source_line->>'gross') is null) then raise exception 'FINANCE_UNKNOWN_AMOUNT'; end if;
   select sum((source_line->>'gross')::numeric) into base_amount from jsonb_array_elements(lines) source_line where source_line ? 'load_id';
   if base_amount is null then raise exception 'FINANCE_UNKNOWN_AMOUNT'; end if;
   amount:=round(base_amount*amount/100,2);
  end if;
  if amount<=0 then raise exception 'FINANCE_INVALID_LINE'; end if;
  cat:=coalesce(item->>'account','5600');
  if cat not in ('5100','5200','5300','5400','5500','5600','5700') then raise exception 'FINANCE_ACCOUNT'; end if;
  if p_kind='settlement' and coalesce(item->>'type','') not in ('addition','deduction','reimbursement') then raise exception 'FINANCE_INVALID_LINE'; end if;
  if p_kind='settlement' and item->>'type'='deduction' then amount:=-amount; cat:='4100'; end if;
  if p_kind='invoice' then cat:='4000'; end if;
  if p_kind='advance' then cat:='1150'; end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('description',btrim(item->>'description'),'amount',amount,'type',coalesce(item->>'type','charge'),'account',cat,'calculation',coalesce(item->>'calculation','fixed'),'input_rate',item->>'amount','base',case when item->>'calculation'='percentage' then base_amount else null end));
 end loop;
 if p_kind='settlement' then
  for rec in select * from public.finance_recurring_rules where company_id=actor.company_id and driver_id=driver and active loop
   next_day:=rec.starts_on+greatest(0,ceil((date_from-rec.starts_on)::numeric/rec.interval_days)::integer)*rec.interval_days;
   while next_day<=date_to and (rec.ends_on is null or next_day<=rec.ends_on) loop
    if exists(select 1 from public.finance_occurrences where rule_id=rec.id and due_on=next_day and active) then raise exception 'FINANCE_RECURRING_USED'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('description',rec.description,'amount',case when rec.direction='deduction' then -rec.amount else rec.amount end,'type',rec.direction,'account',case when rec.direction='deduction' then '4100' else '5000' end,'rule_id',rec.id,'due_on',next_day));
    next_day:=next_day+rec.interval_days;
   end loop;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(p_payload->'advances','[]')) loop
   if coalesce(item->>'amount','') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' then raise exception 'FINANCE_INVALID_LINE'; end if;
   select * into adv from public.finance_documents where id=(item->>'id')::uuid and company_id=actor.company_id and driver_id=driver and kind='advance' and status='posted';
   if adv.id is null then raise exception 'FINANCE_ADVANCE'; end if;
   select adv.total-coalesce(sum(f.amount),0) into available from public.finance_balance_applications f where f.advance_id=adv.id and f.active;
   amount:=(item->>'amount')::numeric;
   if amount<=0 or amount>available then raise exception 'FINANCE_ADVANCE_BALANCE'; end if;
   lines:=lines||jsonb_build_array(jsonb_build_object('description',adv.counterparty||' #'||adv.number,'amount',-amount,'type','advance_recovery','account','1150','advance_id',adv.id));
  end loop;
 end if;
 if jsonb_array_length(lines) not between 1 and 200 then raise exception 'FINANCE_INVALID_LINE'; end if;
 select sum((x->>'amount')::numeric) into total from jsonb_array_elements(lines) x;
 if total is null or total<0 or total>999999999999.99 then raise exception 'FINANCE_NEGATIVE_NET'; end if;
 insert into public.finance_documents(company_id,kind,counterparty,driver_id,document_date,due_date,period_from,period_to,lines,total,notes,operation_id,request_hash,time_zone,created_by)
 values(actor.company_id,p_kind,party,driver,(p_payload->>'document_date')::date,(p_payload->>'due_date')::date,date_from,date_to,lines,total,coalesce(p_payload->>'notes',''),p_operation_id,request_fingerprint,zone,actor.id) returning id into doc;
 for item in select value from jsonb_array_elements(lines) loop
  if item ? 'load_id' then
   insert into public.finance_claims(company_id,document_id,kind,source_id) values(actor.company_id,doc,p_kind,case when p_kind='invoice' then (item->>'load_id')::uuid else (item->>'assignment_id')::uuid end);
  end if;
  if item ? 'rule_id' then insert into public.finance_occurrences(company_id,rule_id,due_on,document_id) values(actor.company_id,(item->>'rule_id')::uuid,(item->>'due_on')::date,doc); end if;
  if item ? 'advance_id' then insert into public.finance_balance_applications(company_id,advance_id,settlement_id,amount) values(actor.company_id,(item->>'advance_id')::uuid,doc,-(item->>'amount')::numeric); end if;
 end loop;
 perform private.finance_audit(actor,doc,'finance.created',jsonb_build_object('kind',p_kind,'total',total));
 return doc;
end $$;
revoke all on function public.finance_create_document(uuid,text,jsonb) from public,anon;
grant execute on function public.finance_create_document(uuid,text,jsonb) to authenticated;

create function public.finance_document_action(p_id uuid,p_version bigint,p_action text,p_reason text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=private.finance_actor(true); d public.finance_documents; item jsonb; entries jsonb; j record; amount numeric; control text; source_load public.loads; source_assignment public.assignments;
begin
 perform 1 from public.companies where id=actor.company_id for update;
 select * into d from public.finance_documents where id=p_id and company_id=actor.company_id for update;
 if d.id is null then raise exception 'FINANCE_NOT_FOUND'; end if;
 if d.version is distinct from p_version then raise exception 'FINANCE_CONFLICT'; end if;
 if p_action='post' then
  if d.status<>'draft' then raise exception 'FINANCE_STATE'; end if;
  for item in select value from jsonb_array_elements(d.lines) where value ? 'load_id' order by value->>'load_id' loop
   select * into source_load from public.loads where id=(item->>'load_id')::uuid and company_id=actor.company_id for update;
   if source_load.id is null or source_load.status::text not in ('delivered','completed') or source_load.trashed_at is not null or source_load.current_assignment_id is distinct from (item->>'assignment_id')::uuid then raise exception 'FINANCE_ASSIGNMENT'; end if;
   select * into source_assignment from public.assignments where id=(item->>'assignment_id')::uuid and company_id=actor.company_id for update;
   if source_assignment.id is null or source_assignment.load_id<>source_load.id then raise exception 'FINANCE_ASSIGNMENT'; end if;
   if d.kind='settlement' and (source_assignment.driver_id is distinct from d.driver_id or source_assignment.requires_reconfirmation or source_load.status::text<>'completed' or source_assignment.ended_at is null or (source_assignment.ended_at at time zone d.time_zone)::date not between d.period_from and d.period_to) then raise exception 'FINANCE_ASSIGNMENT'; end if;
  end loop;
  if d.kind='advance' then
   perform private.finance_entry(actor.company_id,d.id,null,d.document_date,'Advance issued',jsonb_build_array(jsonb_build_object('account','1150','debit',d.total,'credit',0),jsonb_build_object('account','1000','debit',0,'credit',d.total)));
  else
   control:=case d.kind when 'invoice' then '1100' when 'settlement' then '2100' else '2000' end;
   for item in select value from jsonb_array_elements(d.lines) loop
    amount:=(item->>'amount')::numeric;
    if d.kind='invoice' then
     entries:=jsonb_build_array(jsonb_build_object('account',control,'debit',amount,'credit',0),jsonb_build_object('account',item->>'account','debit',0,'credit',amount));
    elsif amount>=0 then
     entries:=jsonb_build_array(jsonb_build_object('account',item->>'account','debit',amount,'credit',0),jsonb_build_object('account',control,'debit',0,'credit',amount));
    else
     entries:=jsonb_build_array(jsonb_build_object('account',control,'debit',-amount,'credit',0),jsonb_build_object('account',item->>'account','debit',0,'credit',-amount));
    end if;
    perform private.finance_entry(actor.company_id,d.id,null,d.document_date,item->>'description',entries);
   end loop;
  end if;
  update public.finance_documents set status='posted',posted_at=now(),version=version+1 where id=d.id;
 elsif p_action='void' then
  if d.status='void' or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'FINANCE_REASON'; end if;
  if exists(select 1 from public.finance_payments where document_id=d.id and voided_at is null)
   or exists(select 1 from public.finance_credits where document_id=d.id and voided_at is null)
   or exists(select 1 from public.finance_balance_applications where advance_id=d.id and active) then raise exception 'FINANCE_HAS_PAYMENTS'; end if;
  for j in select * from public.finance_journal where document_id=d.id and reversal_of is null and payment_id is null and not exists(select 1 from public.finance_journal reversed where reversed.reversal_of=finance_journal.id) loop
   select jsonb_agg(jsonb_build_object('account',x->>'account','debit',(x->>'credit')::numeric,'credit',(x->>'debit')::numeric)) into entries from jsonb_array_elements(j.entries) x;
   perform private.finance_entry(actor.company_id,d.id,null,current_date,'Reversal: '||p_reason,entries,j.id);
  end loop;
  update public.finance_documents set status='void',void_reason=p_reason,version=version+1 where id=d.id;
  update public.finance_claims set active=false where document_id=d.id;
  update public.finance_occurrences set active=false where document_id=d.id;
  update public.finance_balance_applications set active=false where settlement_id=d.id;
 else raise exception 'FINANCE_ACTION'; end if;
 perform private.finance_audit(actor,d.id,'finance.'||p_action,jsonb_build_object('reason',p_reason)); return d.id;
end $$;
revoke all on function public.finance_document_action(uuid,bigint,text,text) from public,anon;
grant execute on function public.finance_document_action(uuid,bigint,text,text) to authenticated;

create table public.finance_credits (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 document_id uuid not null references public.finance_documents(id), amount numeric(14,2) not null check(amount>0),
 reason text not null check(length(reason) between 3 and 500), account text not null check(account in ('4000','5100','5200','5300','5400','5500','5600','5700')),
 operation_id uuid not null, journal_id uuid references public.finance_journal(id),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), voided_at timestamptz,
 unique(company_id,operation_id)
);
create index finance_credits_document on public.finance_credits(document_id);
create index finance_credits_company on public.finance_credits(company_id);
create index finance_credits_journal on public.finance_credits(journal_id);
create index finance_credits_actor on public.finance_credits(created_by);
create function public.finance_credit_invoice(p_operation_id uuid,p_id uuid,p_amount numeric,p_reason text,p_account text default '4000') returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=private.finance_actor(true); d public.finance_documents; prior public.finance_credits; cid uuid; paid numeric; credited numeric; jid uuid;
begin
 perform 1 from public.companies where id=actor.company_id for update;
 select * into prior from public.finance_credits where company_id=actor.company_id and operation_id=p_operation_id;
 if found then
  if prior.document_id is distinct from p_id or prior.amount is distinct from p_amount or prior.reason is distinct from p_reason or prior.account is distinct from p_account then raise exception 'FINANCE_IDEMPOTENCY_MISMATCH';end if;return prior.id;
 end if;
 select * into d from public.finance_documents where id=p_id and company_id=actor.company_id for update;
 if d.id is null or d.kind<>'invoice' or d.status<>'posted' then raise exception 'FINANCE_STATE';end if;
 if p_operation_id is null or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount<>round(p_amount,2) or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'FINANCE_INVALID_LINE';end if;
 select coalesce(sum(amount),0) into paid from public.finance_payments where document_id=d.id and voided_at is null;
 select coalesce(sum(amount),0) into credited from public.finance_credits where document_id=d.id and voided_at is null;
 if p_amount>d.total-paid-credited then raise exception 'FINANCE_OVERPAYMENT';end if;
 insert into public.finance_credits(company_id,document_id,amount,reason,account,operation_id,created_by) values(actor.company_id,d.id,p_amount,p_reason,p_account,p_operation_id,actor.id) returning id into cid;
 jid:=private.finance_entry(actor.company_id,d.id,null,current_date,'Credit: '||p_reason,jsonb_build_array(jsonb_build_object('account',p_account,'debit',p_amount,'credit',0),jsonb_build_object('account','1100','debit',0,'credit',p_amount)));
 update public.finance_credits set journal_id=jid where id=cid;
 perform private.finance_audit(actor,d.id,'finance.credit_recorded',jsonb_build_object('credit',cid,'amount',p_amount,'account',p_account));return cid;
end $$;
revoke all on function public.finance_credit_invoice(uuid,uuid,numeric,text,text) from public,anon;
grant execute on function public.finance_credit_invoice(uuid,uuid,numeric,text,text) to authenticated;
create function public.finance_void_credit(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=private.finance_actor(true); c public.finance_credits;j public.finance_journal;entries jsonb;
begin
 perform 1 from public.companies where id=actor.company_id for update;
 select * into c from public.finance_credits where id=p_id and company_id=actor.company_id for update;
 if c.id is null or c.voided_at is not null then raise exception 'FINANCE_STATE';end if;
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'FINANCE_REASON';end if;
 select * into j from public.finance_journal where id=c.journal_id;
 select jsonb_agg(jsonb_build_object('account',x->>'account','debit',(x->>'credit')::numeric,'credit',(x->>'debit')::numeric)) into entries from jsonb_array_elements(j.entries) x;
 perform private.finance_entry(actor.company_id,c.document_id,null,current_date,'Credit reversal: '||p_reason,entries,j.id);
 update public.finance_credits set voided_at=now() where id=c.id;
 perform private.finance_audit(actor,c.document_id,'finance.credit_voided',jsonb_build_object('credit',c.id,'reason',p_reason));
end $$;
revoke all on function public.finance_void_credit(uuid,text) from public,anon;
grant execute on function public.finance_void_credit(uuid,text) to authenticated;

create function public.finance_record_payment(p_operation_id uuid,p_id uuid,p_amount numeric,p_date date,p_method text,p_reference text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=private.finance_actor(true); d public.finance_documents; pid uuid; prior public.finance_payments; paid numeric; credited numeric; control text; entries jsonb;
begin
 perform 1 from public.companies where id=actor.company_id for update;
 select * into prior from public.finance_payments where company_id=actor.company_id and operation_id=p_operation_id;
 if found then
  if prior.document_id is distinct from p_id or prior.amount is distinct from p_amount or prior.payment_date is distinct from p_date or prior.method is distinct from p_method or prior.reference is distinct from p_reference then raise exception 'FINANCE_IDEMPOTENCY_MISMATCH'; end if;
  return prior.id;
 end if;
 select * into d from public.finance_documents where id=p_id and company_id=actor.company_id for update;
 if d.id is null or d.status<>'posted' or d.kind='advance' then raise exception 'FINANCE_STATE'; end if;
 if p_operation_id is null or p_date is null or p_date<d.document_date or p_date>(now() at time zone d.time_zone)::date or p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or length(btrim(coalesce(p_reference,''))) not between 1 and 200 then raise exception 'FINANCE_INVALID_PAYMENT'; end if;
 select coalesce(sum(amount),0) into paid from public.finance_payments where document_id=d.id and voided_at is null;
 select coalesce(sum(amount),0) into credited from public.finance_credits where document_id=d.id and voided_at is null;
 if p_amount>d.total-paid-credited then raise exception 'FINANCE_OVERPAYMENT'; end if;
 insert into public.finance_payments(company_id,document_id,amount,payment_date,method,reference,operation_id,created_by)
 values(actor.company_id,d.id,p_amount,p_date,p_method,p_reference,p_operation_id,actor.id) returning id into pid;
 control:=case d.kind when 'invoice' then '1100' when 'settlement' then '2100' else '2000' end;
 if d.kind='invoice' then entries:=jsonb_build_array(jsonb_build_object('account','1000','debit',p_amount,'credit',0),jsonb_build_object('account',control,'debit',0,'credit',p_amount));
 else entries:=jsonb_build_array(jsonb_build_object('account',control,'debit',p_amount,'credit',0),jsonb_build_object('account','1000','debit',0,'credit',p_amount)); end if;
 perform private.finance_entry(actor.company_id,d.id,pid,p_date,p_reference,entries);
 perform private.finance_audit(actor,d.id,'finance.payment_recorded',jsonb_build_object('payment',pid,'amount',p_amount)); return pid;
end $$;
revoke all on function public.finance_record_payment(uuid,uuid,numeric,date,text,text) from public,anon;
grant execute on function public.finance_record_payment(uuid,uuid,numeric,date,text,text) to authenticated;

create function public.finance_payment_action(p_id uuid,p_action text,p_reason text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=private.finance_actor(true); p public.finance_payments; j record; entries jsonb;
begin
 perform 1 from public.companies where id=actor.company_id for update;
 select * into p from public.finance_payments where id=p_id and company_id=actor.company_id for update;
 if p.id is null or p.voided_at is not null then raise exception 'FINANCE_STATE'; end if;
 if p_action='reconcile' then
  update public.finance_payments set reconciled_at=now() where id=p.id;
 elsif p_action='void' then
  if p.reconciled_at is not null or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'FINANCE_REASON'; end if;
  for j in select * from public.finance_journal where payment_id=p.id and reversal_of is null loop
   select jsonb_agg(jsonb_build_object('account',x->>'account','debit',(x->>'credit')::numeric,'credit',(x->>'debit')::numeric)) into entries from jsonb_array_elements(j.entries) x;
   perform private.finance_entry(actor.company_id,p.document_id,p.id,current_date,'Payment reversal: '||p_reason,entries,j.id);
  end loop;
  update public.finance_payments set voided_at=now(),void_reason=p_reason where id=p.id;
 else raise exception 'FINANCE_ACTION'; end if;
 perform private.finance_audit(actor,p.document_id,'finance.payment_'||p_action,jsonb_build_object('payment',p.id,'reason',p_reason)); return p.id;
end $$;
revoke all on function public.finance_payment_action(uuid,text,text) from public,anon;
grant execute on function public.finance_payment_action(uuid,text,text) to authenticated;

create function public.finance_save_rule(p_driver uuid,p_version bigint,p_mode text,p_rate numeric,p_empty_rate numeric,p_snapshot boolean) returns void
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=private.finance_actor(true); existing public.finance_pay_rules;
begin
 perform 1 from public.companies where id=actor.company_id for update;
 if not exists(select 1 from public.profiles where id=p_driver and company_id=actor.company_id and role::text='driver') then raise exception 'FINANCE_DRIVER'; end if;
 select * into existing from public.finance_pay_rules where driver_id=p_driver;
 if coalesce(existing.version,0) is distinct from p_version then raise exception 'FINANCE_CONFLICT'; end if;
 if p_rate is null or p_rate::text in ('NaN','Infinity','-Infinity') or p_rate<>round(p_rate,4) or p_empty_rate is distinct from 0 then raise exception 'FINANCE_PAY_RULE'; end if;
 insert into public.finance_pay_rules(company_id,driver_id,mode,rate,empty_rate,require_assignment_snapshot,updated_by)
 values(actor.company_id,p_driver,p_mode,p_rate,p_empty_rate,p_snapshot,actor.id)
 on conflict(driver_id) do update set mode=excluded.mode,rate=excluded.rate,empty_rate=excluded.empty_rate,require_assignment_snapshot=excluded.require_assignment_snapshot,updated_by=actor.id,updated_at=now(),version=finance_pay_rules.version+1;
 perform private.finance_audit(actor,p_driver,'finance.pay_rule_saved',jsonb_build_object('mode',p_mode,'rate',p_rate));
end $$;
revoke all on function public.finance_save_rule(uuid,bigint,text,numeric,numeric,boolean) from public,anon;
grant execute on function public.finance_save_rule(uuid,bigint,text,numeric,numeric,boolean) to authenticated;

create function public.finance_recurring_command(p_operation_id uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=private.finance_actor(true); rid uuid; existing public.finance_recurring_rules;
begin
 perform 1 from public.companies where id=actor.company_id for update;
 rid:=nullif(p_payload->>'id','')::uuid;
 if rid is not null then
  select * into existing from public.finance_recurring_rules where id=rid and company_id=actor.company_id for update;
  if existing.id is null or existing.version is distinct from (p_payload->>'version')::bigint then raise exception 'FINANCE_CONFLICT'; end if;
  update public.finance_recurring_rules set active=not active,version=version+1 where id=rid;
 else
  if p_operation_id is null then raise exception 'FINANCE_INVALID'; end if;
  rid:=p_operation_id;
  if exists(select 1 from public.finance_recurring_rules where id=rid) then
   if not exists(select 1 from public.finance_recurring_rules where id=rid and company_id=actor.company_id and driver_id=(p_payload->>'driver_id')::uuid and description=p_payload->>'description' and direction=p_payload->>'direction' and amount=(p_payload->>'amount')::numeric and starts_on=(p_payload->>'starts_on')::date and interval_days=(p_payload->>'interval_days')::integer and ends_on is not distinct from nullif(p_payload->>'ends_on','')::date) then raise exception 'FINANCE_IDEMPOTENCY_MISMATCH'; end if;
   return rid;
  end if;
  if not exists(select 1 from public.profiles where id=(p_payload->>'driver_id')::uuid and company_id=actor.company_id and role::text='driver') then raise exception 'FINANCE_DRIVER'; end if;
  if coalesce(p_payload->>'amount','') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' or (p_payload->>'amount')::numeric<=0 then raise exception 'FINANCE_INVALID_LINE'; end if;
  insert into public.finance_recurring_rules(id,company_id,driver_id,description,direction,amount,starts_on,ends_on,interval_days,created_by)
  values(rid,actor.company_id,(p_payload->>'driver_id')::uuid,p_payload->>'description',p_payload->>'direction',(p_payload->>'amount')::numeric,(p_payload->>'starts_on')::date,nullif(p_payload->>'ends_on','')::date,(p_payload->>'interval_days')::integer,actor.id);
 end if;
 perform private.finance_audit(actor,rid,'finance.recurring_changed',p_payload); return rid;
end $$;
revoke all on function public.finance_recurring_command(uuid,jsonb) from public,anon;
grant execute on function public.finance_recurring_command(uuid,jsonb) to authenticated;

create function public.finance_workspace() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles:=private.finance_actor(false); result jsonb;
begin
 -- Explicit upper bound rather than silently truncating financial totals.
 if (select count(*) from public.finance_documents where company_id=actor.company_id)>10000 then raise exception 'FINANCE_ARCHIVE_REQUIRED'; end if;
 select jsonb_build_object(
 'defaults',(select to_jsonb(c) from public.finance_company_defaults c where c.company_id=actor.company_id),
 'documents',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('credited',coalesce((select sum(c.amount) from public.finance_credits c where c.document_id=d.id and c.voided_at is null),0),'paid',coalesce((select sum(p.amount) from public.finance_payments p where p.document_id=d.id and p.voided_at is null),0),'applied',coalesce((select sum(b.amount) from public.finance_balance_applications b where b.advance_id=d.id and b.active),0),'recovered',coalesce((select sum(b.amount) from public.finance_balance_applications b join public.finance_documents settled on settled.id=b.settlement_id where b.advance_id=d.id and b.active and settled.status='posted'),0)) order by d.created_at desc) from public.finance_documents d where d.company_id=actor.company_id),'[]'),
 'credits',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.finance_credits c where c.company_id=actor.company_id),'[]'),
 'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.payment_date desc) from public.finance_payments p where p.company_id=actor.company_id),'[]'),
 'rules',coalesce((select jsonb_agg(to_jsonb(r)) from public.finance_pay_rules r where r.company_id=actor.company_id),'[]'),
 'recurring',coalesce((select jsonb_agg(to_jsonb(r)) from public.finance_recurring_rules r where r.company_id=actor.company_id),'[]'),
 'journal',coalesce((select jsonb_agg(to_jsonb(j) order by j.entry_date desc,j.created_at desc) from public.finance_journal j where j.company_id=actor.company_id),'[]'),
 'loads',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'load_number',l.load_number,'status',l.status,'broker',l.broker_name,'gross',case when coalesce(l.driver_brief->'unknownFields','[]'::jsonb) ? 'brokerRate' then null else coalesce(s.broker_rate,l.broker_rate) end,'miles',case when coalesce(l.driver_brief->'unknownFields','[]'::jsonb) ? 'loadedMiles' then null else coalesce(s.loaded_miles,l.loaded_miles) end,'driver_id',a.driver_id,'assignment_id',a.id,'completed_at',a.ended_at,'reconfirmation',a.requires_reconfirmation,'snapshot_pay',pay.amount,'has_pod',exists(select 1 from public.documents doc where doc.load_id=l.id and doc.company_id=actor.company_id and doc.document_type::text='pod' and doc.current_version_id is not null),'invoice_id',(select c.document_id from public.finance_claims c where c.company_id=actor.company_id and c.kind='invoice' and c.source_id=l.id and c.active),'settlement_id',(select c.document_id from public.finance_claims c where c.company_id=actor.company_id and c.kind='settlement' and c.source_id=a.id and c.active),'legacy_accounting',to_jsonb(f)) order by l.created_at desc)
 from public.loads l left join public.assignments a on a.id=l.current_assignment_id and a.company_id=actor.company_id
 left join public.load_price_snapshots s on s.id=a.accepted_price_snapshot_id and s.company_id=actor.company_id
 left join public.assignment_driver_pay pay on pay.assignment_id=a.id and pay.company_id=actor.company_id
 left join public.load_accounting f on f.load_id=l.id and f.company_id=actor.company_id
 where l.company_id=actor.company_id and l.current_assignment_id is not null and l.trashed_at is null and public.can_access_load(l.id)),'[]'),
 'today',current_date,'currency','USD','can_write',actor.role::text='company_admin') into result;
 return result;
end $$;
revoke all on function public.finance_workspace() from public,anon;
grant execute on function public.finance_workspace() to authenticated;

-- No table mutations via the Data API, even for staff. Commands above enforce active actor + tenant.
do $$ declare name text; begin
 foreach name in array array['finance_company_defaults','finance_assignment_tariffs','finance_credits','finance_documents','finance_claims','finance_payments','finance_journal','finance_pay_rules','finance_recurring_rules','finance_occurrences','finance_balance_applications'] loop
 execute format('alter table public.%I enable row level security',name);
 execute format('revoke all on public.%I from public, anon, authenticated',name);
 execute format('grant select on public.%I to authenticated',name);
 execute format('create policy finance_staff_read on public.%I for select to authenticated using (company_id=(select public.current_company_id()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status::text=''active'' and p.role::text in (''company_admin'',''dispatcher'')))',name);
 end loop;
end $$;
