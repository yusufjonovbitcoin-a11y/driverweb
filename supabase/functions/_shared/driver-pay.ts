// Shared by PDF confirmation, direct assignment and trash restore. Assignment
// freezes the rate only. The driver's START transaction captures the origin;
// routing and compensation must never use an earlier dispatcher-side GPS fix.
export async function prepareDriverPay(caller: any, _admin: any, _actorId: string,
  loadId: string, driverId: string) {
  const [{ data: load, error: loadError }, { data: driver, error: driverError }, settings] = await Promise.all([
    caller.from('loads').select('id,current_assignment_id').eq('id', loadId).maybeSingle(),
    caller.from('member_directory').select('id,status,role').eq('id', driverId).maybeSingle(),
    caller.from('driver_pay_settings').select('rate_per_mile').eq('driver_id', driverId).maybeSingle(),
  ]);
  if (loadError || driverError || !load || !driver || driver.status !== 'active' || driver.role !== 'driver') {
    throw new Error('Load or driver is unavailable');
  }
  if (settings.error) throw new Error('Driver pay settings unavailable');
  const access = await caller.rpc('can_access_driver', { target_driver_id: driverId });
  if (access.error || access.data !== true) throw new Error('Driver access denied');
  if (load.current_assignment_id) {
    const { data: existing, error } = await caller.from('assignments')
      .select('driver_id,status').eq('id',load.current_assignment_id).maybeSingle();
    if (error) throw new Error('Current assignment unavailable');
    // Retrying an already successful assignment must not reprice it or require
    // the driver to share their location again.
    if (existing?.driver_id === driverId && existing.status === 'active') {
      return { alreadyAssigned:true };
    }
  }
  if (settings.data?.rate_per_mile == null) return { fixedPay: false };
  return { fixedPay: true, pending: true, reason: 'awaiting_driver_start' };
}
