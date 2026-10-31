import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentImportTiming, documentImportDisplayTiming } from './documentImportTiming.js';

test('separates the browser request from the delay before the review commits', () => {
  let time = 100;
  const clock = () => time;
  const timing = createDocumentImportTiming(clock);
  timing.record({ stage: 'session', durationMs: 120.2, access_token: 'must-not-log' });
  timing.record({ stage: 'request', durationMs: 20400.1, fileName: 'must-not-log.pdf' });
  time = 20620;
  const ready = timing.ready();
  time = 20665;
  const result = documentImportDisplayTiming(ready, clock);
  assert.equal(result.analysisMs, 20520);
  assert.equal(result.responseToCommitMs, 45);
  assert.equal(result.totalMs, 20565);
  assert.deepEqual(result.stages, [{ stage: 'session', durationMs: 120 }, { stage: 'request', durationMs: 20400 }]);
  assert.doesNotMatch(JSON.stringify(result), /must-not-log/);
});
