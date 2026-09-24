begin;
select plan(3);

select has_column('public', 'driver_profiles', 'duty_status', 'driver duty status is persisted');
select has_column('public', 'driver_profiles', 'cdl_number', 'driver CDL is persisted');
select has_function(
  'public', 'set_driver_duty_status', array['text'],
  'driver duty command exists'
);

select * from finish();
rollback;
