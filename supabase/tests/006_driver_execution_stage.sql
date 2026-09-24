begin;
select plan(4);

select has_column('public', 'assignments', 'driver_stage', 'driver stage is persisted');
select has_function(
  'public',
  'advance_driver_stage',
  array['uuid', 'text', 'uuid', 'bigint', 'timestamp with time zone', 'numeric', 'numeric'],
  'driver stage command exists'
);
select function_privs_are(
  'public',
  'advance_driver_stage',
  array['uuid', 'text', 'uuid', 'bigint', 'timestamp with time zone', 'numeric', 'numeric'],
  'authenticated',
  array['EXECUTE'],
  'authenticated drivers may execute the command'
);
select function_privs_are(
  'public',
  'advance_driver_stage',
  array['uuid', 'text', 'uuid', 'bigint', 'timestamp with time zone', 'numeric', 'numeric'],
  'anon',
  array[]::text[],
  'anonymous users cannot execute the command'
);

select * from finish();
rollback;
