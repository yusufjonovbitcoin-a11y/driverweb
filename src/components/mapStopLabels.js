// Count each stop role before coordinate filtering, so missing points keep their numbers.
export function labelMapStops(stops = []) {
  const roles = stops.map((stop, index) => stop?.role === 'pickup' || stop?.role === 'delivery'
    ? stop.role : index === 0 ? 'pickup' : 'delivery');
  const totals = { pickup: 0, delivery: 0 };
  roles.forEach(role => { totals[role] += 1; });
  const counts = { pickup: 0, delivery: 0 };
  return stops.map((stop, index) => {
    const role = roles[index];
    const number = ++counts[role];
    return { ...stop, role, markerLabel: `${role === 'pickup' ? 'P' : 'D'}${totals[role] > 1 ? number : ''}` };
  });
}
