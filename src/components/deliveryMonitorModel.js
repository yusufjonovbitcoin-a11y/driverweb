import { arrivalJobs, arrivalState } from './arrivalBoardModel.js';

// Pickup travel is not a delivery estimate. Keep it unknown until the driver
// is carrying the load; multiple active loads/stops also need confirmation.
export function deliveryMonitorJobs(drivers, loads, now) {
  return arrivalJobs(drivers, loads, now).map(job => {
    if (!job.load || job.role === 'delivery') return job;
    const value = job.load.destination?.appointmentTo || job.load.destination?.appointmentAt;
    const scheduledAt = typeof value === 'string' && /T.*(Z|[+-]\d{2}:\d{2})$/i.test(value)
      && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
    return { ...job, role: 'delivery', target: null, scheduledAt,
      pendingPickup: true, scope: `${job.scope}:delivery-pending` };
  });
}

export function deliveryMonitorState(job, estimate, now) {
  if (job.pendingPickup) return { status: 'unknown', eta: null, issue: 'awaitingPickup' };
  return arrivalState(job, estimate, now);
}

export function deliveryMonitorGroup(state) {
  return state.status === 'idle' ? 'idle' : state.status === 'onTime' ? 'onTime' : 'attention';
}

export function deliveryMonitorProblemCount(rows) {
  return rows.filter(({ job, state }) => job.load && deliveryMonitorGroup(state) === 'attention').length;
}

const priority = { late: 0, risk: 1, noGps: 2, unknown: 3, onTime: 4, idle: 5 };
export function compareDeliveryRows(a, b) {
  return priority[a.state.status] - priority[b.state.status]
    || (a.job.scheduledAt ?? Infinity) - (b.job.scheduledAt ?? Infinity)
    || String(a.job.driver.name).localeCompare(String(b.job.driver.name));
}
