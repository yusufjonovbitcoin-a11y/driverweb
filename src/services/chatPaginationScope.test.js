import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatPaginationScope } from './chatPaginationScope.js';

test('repeated scroll callbacks reserve only one older-page request', () => {
  const scope = new ChatPaginationScope();
  scope.select('conversation:history');
  const request = scope.begin();
  assert.equal(request.isCurrent(), true);
  assert.equal(scope.begin(), null);
  scope.select('conversation:history');
  assert.equal(scope.begin(), null);
  request.finish();
  assert.ok(scope.begin());
});

test('changing conversation or search invalidates old results and old cleanup cannot release the new request', () => {
  const scope = new ChatPaginationScope();
  scope.select('first:history');
  const first = scope.begin();
  scope.select('second:history');
  const second = scope.begin();
  assert.equal(first.isCurrent(), false);
  first.finish();
  assert.equal(second.isCurrent(), true);
  assert.equal(scope.begin(), null);
  scope.select('second:invoice');
  const search = scope.begin();
  second.finish();
  assert.equal(second.isCurrent(), false);
  assert.equal(search.isCurrent(), true);
});

test('returning to the same conversation cannot reactivate its old request', () => {
  const scope = new ChatPaginationScope();
  scope.select('first:history');
  const old = scope.begin();
  scope.select('second:history');
  scope.select('first:history');
  const current = scope.begin();
  assert.equal(old.isCurrent(), false);
  old.finish();
  assert.equal(current.isCurrent(), true);
});

test('jumping to latest invalidates older pages in the same chat and reserves the replacement window', () => {
  const scope = new ChatPaginationScope();
  scope.select('conversation:history');
  const older = scope.begin();
  scope.invalidate();
  const latest = scope.begin();
  assert.equal(older.isCurrent(), false);
  older.finish();
  assert.equal(latest.isCurrent(), true);
  assert.equal(scope.begin(), null);
  latest.finish();
  assert.ok(scope.begin());
});
