// Open /scripts/workspace-cache-test.html on the local Vite server.
// Exercises the production provider through real route unmount/remount cycles.
import React, { StrictMode, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { WorkspaceCache, useWorkspaceInvalidation, useWorkspaceQuery, useWorkspaceView } from '../src/hooks/WorkspaceCache';

const root = createRoot(document.getElementById('fixture'));
const snapshots = new Map();
let calls = 0;
let pending = [];
const fetcher = () => {
  calls += 1;
  return new Promise((resolve, reject) => pending.push({ resolve, reject }));
};
// oxlint-disable-next-line react/only-export-components -- standalone test fixture.
function Probe({ id, query, staleTime }) {
  const result = useWorkspaceQuery(query, fetcher, { staleTime, shouldRetryOnError: false, revalidateOnFocus: false });
  const invalidate = useWorkspaceInvalidation();
  const [view, setView] = useWorkspaceView('selection', 'active');
  useLayoutEffect(() => { snapshots.set(id, { ...result, view, setView, invalidate }); });
  return <p>{id}: {result.isLoading ? 'Loading' : result.data?.label || 'Empty'}</p>;
}
function render({ scope = 'user-a:company-a', shown = true, query = ['inbox', 'all'], copies = 1, staleTime } = {}) {
  flushSync(() => root.render(<StrictMode><WorkspaceCache key={scope}>
    {shown && Array.from({ length: copies }, (_, i) => <Probe key={i} id={i} query={query} staleTime={staleTime} />)}
  </WorkspaceCache></StrictMode>));
}
const tick = () => new Promise(resolve => setTimeout(resolve, 50));
function check(condition, label) {
  const item = document.createElement('li');
  item.textContent = `${condition ? 'PASS' : 'FAIL'}: ${label}`;
  document.getElementById('results').append(item);
  if (!condition) throw new Error(label);
}
async function run() {
  render({ copies: 2 });
  await tick();
  check(calls === 1 && snapshots.get(0).isLoading, 'StrictMode and simultaneous consumers share one request');
  pending.shift().resolve({ label: 'cached inbox', read: false });
  await tick();
  check(!snapshots.get(0).isLoading && snapshots.get(1).data.label === 'cached inbox', 'Both consumers receive loaded data');
  flushSync(() => snapshots.get(0).setView('completed'));
  render({ shown: false });
  render();
  check(!snapshots.get(0).isLoading && snapshots.get(0).data.label === 'cached inbox', 'Route return renders cached data immediately without spinner');
  check(snapshots.get(0).view === 'completed', 'View selection survives navigation');
  await tick();
  check(calls === 1, 'Quick navigation does not repeat a fresh request');

  const refresh = snapshots.get(0).mutate().catch(() => {});
  await tick();
  check(snapshots.get(0).isValidating && !snapshots.get(0).isLoading && snapshots.get(0).data.label === 'cached inbox', 'Background refresh keeps content visible');
  pending.shift().reject(new Error('Synthetic offline failure'));
  await refresh;
  await tick();
  check(snapshots.get(0).error && snapshots.get(0).data.label === 'cached inbox', 'Failed refresh preserves last successful data and exposes error');

  await snapshots.get(0).mutate(value => ({ ...value, read: true }), { revalidate: false });
  render({ shown: false });
  render();
  check(snapshots.get(0).data.read === true, 'Successful local mutation survives navigation');
  await tick();
  // A failed revalidation may retry on remount; settle it before the next case.
  for (const request of pending) request.resolve({ label: 'cached inbox', read: true });
  pending = [];
  await tick();

  // Invalidate an inactive entry just as an accounting save invalidates other pages.
  const invalidate = snapshots.get(0).invalidate;
  render({ shown: false });
  await invalidate(key => Array.isArray(key) && key[0] === 'inbox');
  const beforeInvalidatedMount = calls;
  render();
  await tick();
  check(calls === beforeInvalidatedMount + 1 && !snapshots.get(0).isLoading, 'Invalidated inactive query revalidates without hiding cached content');
  pending.shift().resolve({ label: 'updated inbox', read: true });
  await tick();

  render({ shown: false });
  render({ staleTime: 0 });
  check(snapshots.get(0).data.label === 'updated inbox', 'Expired data remains immediately visible during revalidation');

  render({ query: ['inbox', 'unread'] });
  await tick();
  check(snapshots.get(0).data === undefined, 'Different filters never reuse another filter result');
  const oldRequest = pending.shift();
  render({ scope: 'user-b:company-b', query: ['inbox', 'unread'] });
  await tick();
  check(snapshots.get(0).data === undefined && snapshots.get(0).view === 'active', 'User/company switch starts with an isolated empty cache');
  oldRequest.resolve({ label: 'private data from old user' });
  await tick();
  check(snapshots.get(0).data === undefined, 'Late response from old user cannot populate new session');
  pending.shift().resolve({ label: 'new user inbox' });
  await tick();
  check(snapshots.get(0).data.label === 'new user inbox', 'New session receives only its own response');
  document.title = 'PASS: 14 cache checks';
  root.unmount();
}
run().catch(error => { document.title = 'FAIL: cache regression'; document.getElementById('fixture').textContent = error.stack; });
