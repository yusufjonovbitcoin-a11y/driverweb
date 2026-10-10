-- Retry only pending START mileage calculations. The worker uses a dedicated
-- Vault credential, bounded leases, and performs no HTTP request while idle.
do $migration$
begin
  if not exists(select 1 from vault.secrets where name='driver_pay_cron_token') then
    raise exception 'Provision the dedicated driver pay worker credential first';
  end if;
  if exists(select 1 from cron.job where jobname='driver-pay-start-calculation') then
    raise exception 'Driver pay worker is already scheduled; review before changing';
  end if;
  perform cron.schedule(
    'driver-pay-start-calculation',
    '* * * * *',
    $command$select worker_cron.invoke('driver_pay');$command$
  );
end $migration$;
