-- Seed actual legacy states BEFORE applying the ordered-route migration.
reset role;
select test_seed_load(('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid)
from generate_series(410,416)n;
insert into load_stops(company_id,load_id,type,sequence,address_line,city,region,status,requires_document)
select l.company_id,l.id,case when n<3 then 'pickup'::stop_type else 'delivery'::stop_type end,
  n,'Upgrade street '||n,'City','NJ',case when n=1 then 'done'::stop_status else 'pending'::stop_status end,false
from loads l cross join generate_series(1,4)n
where l.id between '00000000-0000-0000-0000-000000000410' and '00000000-0000-0000-0000-000000000416';
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select assign_load_directly(l.id,'00000000-0000-0000-0000-000000000004') from loads l
where l.id between '00000000-0000-0000-0000-000000000410' and '00000000-0000-0000-0000-000000000416';
reset role;
update assignments set driver_stage=case right(load_id::text,3)
  when '410' then 'picked_up' when '411' then 'in_transit' when '412' then 'in_transit'
  when '413' then 'in_transit' when '414' then 'completed' when '416' then 'arrived_at_delivery'
  else 'accepted' end where load_id between '00000000-0000-0000-0000-000000000410' and '00000000-0000-0000-0000-000000000416';
update assignments set status='completed',ended_at=now() where load_id='00000000-0000-0000-0000-000000000414';
update load_stops set status='skipped',requires_document=(load_id='00000000-0000-0000-0000-000000000413')
where load_id in ('00000000-0000-0000-0000-000000000412','00000000-0000-0000-0000-000000000413') and sequence=2;
create table test_upgrade_stops_before as select id,status,version from load_stops
where load_id between '00000000-0000-0000-0000-000000000410' and '00000000-0000-0000-0000-000000000416';
