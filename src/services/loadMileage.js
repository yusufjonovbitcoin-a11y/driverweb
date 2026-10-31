// A route snapshot may fill a missing document distance only for this assignment.
export function loadMileage(load, snapshot) {
  const supplied = load.loaded_miles != null && Number.isFinite(Number(load.loaded_miles)) && Number(load.loaded_miles) >= 0
    && !load.driver_brief?.unknownFields?.includes('loadedMiles');
  const frozen = snapshot && load.current_assignment_id && snapshot.assignment_id === load.current_assignment_id && snapshot.load_id === load.id
    && snapshot.driver_id === load.driver_id && snapshot.currency === 'USD'
    && snapshot.loaded_miles != null && Number.isFinite(Number(snapshot.loaded_miles)) && Number(snapshot.loaded_miles) > 0;
  if (supplied && Number(load.loaded_miles) > 0) return { distanceMiles: Number(load.loaded_miles), distanceKnown: true, mileageSource: 'document' };
  if (frozen) return { distanceMiles: Number(snapshot.loaded_miles), distanceKnown: true, mileageSource: 'assignment_route' };
  return { distanceMiles: supplied ? Number(load.loaded_miles) : 0, distanceKnown: supplied, mileageSource: supplied ? 'document' : null };
}
