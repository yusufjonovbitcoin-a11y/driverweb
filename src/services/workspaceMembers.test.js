import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionWorkspaceMembers } from './workspaceMembers.js';
test('suspended drivers remain manageable without becoming assignment candidates', () => {
  const rows = [
    { id: 's', role: 'driver', status: 'suspended', full_name: 'B' },
    { id: 'a', role: 'driver', status: 'active', full_name: 'A' },
    { id: 'p', role: 'driver', status: 'pending', full_name: 'C' },
    { id: 'admin', role: 'company_admin', status: 'active', full_name: 'D' },
    { id: 'old', role: 'driver', status: 'deleted', full_name: 'E' },
  ];
  const result = partitionWorkspaceMembers(rows);
  assert.deepEqual(result.roster.map(row => row.id), ['a', 's']);
  assert.deepEqual(result.active.filter(row => row.role === 'driver').map(row => row.id), ['a']);
  assert.deepEqual(result.active.map(row => row.id), ['a', 'admin']);
  assert.equal(rows[0].id, 's');
  rows[0].status = 'active';
  assert.deepEqual(partitionWorkspaceMembers(rows).active.filter(row => row.role === 'driver').map(row => row.id), ['a', 's']);
});
