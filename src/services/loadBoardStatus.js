const defaultStages = {
  draft: 'UNASSIGNED',
  review: 'UNASSIGNED',
  ready_for_offer: 'UNASSIGNED',
  offered: 'UNASSIGNED',
  assigned: 'ASSIGNED',
  in_progress: 'ON_ROAD',
  delivered: 'DELIVERED',
  completed: 'COMPLETED',
  cancelled: 'COMPLETED',
  dispute: 'DELIVERED',
};

export function loadBoardStatus(row, driverStage) {
  if (row.status === 'in_progress') {
    if (['accepted', 'en_route_to_pickup', 'arrived_at_pickup'].includes(driverStage)) return 'ASSIGNED';
    if (driverStage === 'picked_up') return 'PICKED_UP';
    return 'ON_ROAD';
  }
  return defaultStages[row.status] || 'UNASSIGNED';
}

export function displayBoardStage(status, groupDeliveredWithOnRoad = false) {
  return groupDeliveredWithOnRoad && status === 'DELIVERED' ? 'ON_ROAD' : status;
}
