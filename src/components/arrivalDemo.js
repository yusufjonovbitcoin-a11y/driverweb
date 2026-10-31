// Synthetic presentation data; operational actions are disabled for demo jobs.
export function arrivalDemo(now) {
  const rows = [
    ['Amin', 'Hilton, NY', 'Wind Gap, PA', 65, 110, 'onTime'],
    ['James', 'Chicago, IL', 'Detroit, MI', 95, 25, 'late'],
    ['Maria', 'Columbus, OH', 'Pittsburgh, PA', 150, 165, 'risk'],
    ['Brian', 'Baltimore, MD', 'Richmond, VA', 200, 260, 'onTime'],
    ['Daniel', 'Dallas, TX', 'Houston, TX', 310, 380, 'onTime'],
    ['Alex', 'Newark, NJ', 'Boston, MA', null, 180, 'noGps'],
    ['Kevin', '', '', null, null, 'idle'],
  ];
  const at = minutes => minutes == null ? null : now + minutes * 60_000;
  return rows.map(([name, origin, destination, etaMinutes, appointment, status], index) => ({
    job: {
      id: `demo:${index}`, demo: true,
      driver: { id: `demo-driver:${index}`, name, driverNumber: `D${101 + index}`, truck: `${110 + index}` },
      load: status === 'idle' ? null : { id: `demo-load:${index}`, loadNumber: `#${2536705 + index}` },
      origin, destination, role: index === 3 ? 'pickup' : 'delivery', scheduledAt: at(appointment),
      estimatedFreeAt: ['onTime', 'late', 'risk'].includes(status) ? at(etaMinutes + 45) : null,
    },
    state: { status, eta: at(etaMinutes), issue: ({ risk: 'tightWindow', late: 'late', noGps: 'noGps', idle: 'idle', onTime: 'onTime' })[status], minutes: status === 'late' ? 70 : 0 },
  }));
}
