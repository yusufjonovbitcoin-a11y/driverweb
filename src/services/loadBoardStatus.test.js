import test from 'node:test';
import assert from 'node:assert/strict';
import { displayBoardStage, loadBoardStatus } from './loadBoardStatus.js';

test('new and legacy offered loads are unassigned rather than driver offers', () => {
  for (const status of ['draft', 'review', 'ready_for_offer', 'offered']) {
    assert.equal(loadBoardStatus({ status }, null), 'UNASSIGNED');
  }
});

test('board distinguishes pickup, road travel, and actual delivery', () => {
  assert.equal(loadBoardStatus({ status: 'assigned' }, 'accepted'), 'ASSIGNED');
  assert.equal(loadBoardStatus({ status: 'in_progress' }, 'arrived_at_pickup'), 'ASSIGNED');
  assert.equal(loadBoardStatus({ status: 'in_progress' }, 'picked_up'), 'PICKED_UP');
  assert.equal(loadBoardStatus({ status: 'in_progress' }, 'in_transit'), 'ON_ROAD');
  assert.equal(loadBoardStatus({ status: 'delivered' }, 'delivered'), 'DELIVERED');
  assert.equal(loadBoardStatus({ status: 'completed' }, 'completed'), 'COMPLETED');
});

test('driver board keeps delivered trips active until they are actually completed', () => {
  assert.equal(displayBoardStage('DELIVERED', true), 'ON_ROAD');
  assert.equal(displayBoardStage('DELIVERED'), 'DELIVERED');
  assert.equal(displayBoardStage('COMPLETED', true), 'COMPLETED');
  assert.equal(displayBoardStage('ON_ROAD', true), 'ON_ROAD');
});
