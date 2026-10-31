import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractText } from 'unpdf';
import { calculateSettlement, effectiveSettings } from './calculation.js';
import { createDemoApi, demoDrivers, demoInitialView, demoLoads } from '../../../tests/fixtures/settlement-samples.js';
import { approveSettlement, reviewSettlement, settlementDraft } from './settlementReviewModel.js';
import { calculatedStatementSnapshot, appendCalculatedEntry } from './calculatedLoads.js';
import { createSettlementPdf } from './pdf.js';
import { statementModel } from './statementModel.js';

async function sourceSnapshot() {
  const record = await createDemoApi().readCalculationSettings();
  return { driver: demoDrivers[0], version: record.version, company: { name: 'T Fleets DEMO' },
    calculation: calculateSettlement(demoLoads.filter(load => demoInitialView.selected.includes(load.id)),
      effectiveSettings(record, demoDrivers[0].id), demoInitialView.period) };
}

test('editing PDF amounts recomputes totals without changing load records or saved settings', async () => {
  const source = await sourceSnapshot();
  const draft = settlementDraft(source);
  draft.loads[0].rate = '6300';
  draft.settings.rules.find(rule => rule.id === 'company').value = '20';
  draft.driverName = 'Edited driver';
  const reviewed = reviewSettlement(source, draft);
  assert.equal(reviewed.calculation.gross, 950000);
  assert.equal(reviewed.calculation.commission, 190000);
  assert.equal(reviewed.calculation.net, 715750);
  assert.equal(reviewed.driver.name, 'Edited driver');
  assert.equal(source.calculation.net, 721250);
  assert.equal(source.calculation.rows[0].load.rate, 5300);
  assert.equal(source.calculation.settings.rules[0].value, '10.00');
  assert.equal(demoLoads[0].rate, 5300);
});

test('edits cannot replace load identities or introduce invalid money and dates', async () => {
  const source = await sourceSnapshot();
  for (const change of [
    draft => { draft.loads[0].id = 'another-load'; },
    draft => { draft.loads.pop(); },
    draft => { draft.loads[0].rate = 'NaN'; },
    draft => { draft.loads[0].miles = '-10'; },
    draft => { draft.driverName = ''; },
    draft => { draft.period.to = '2026-10-01'; },
    draft => { draft.settings.rules[0].value = '101'; },
  ]) {
    const draft = settlementDraft(source); change(draft);
    assert.throws(() => reviewSettlement(source, draft));
  }
});

test('confirmation freezes the reviewed values, tracks approval and prevents duplicate load approval', async () => {
  const source = await sourceSnapshot();
  const draft = settlementDraft(source); draft.loads[0].rate = '6300';
  const reviewed = reviewSettlement(source, draft);
  const approved = approveSettlement(reviewed, '2026-10-23T12:00:00Z');
  assert.equal(approved.approvalStatus, 'approved');
  assert.equal(approved.approvedAt, '2026-10-23T12:00:00Z');
  assert.equal(approved.pdfEdited, true);
  const entries = appendCalculatedEntry([], approved);
  assert.equal(appendCalculatedEntry(entries, approveSettlement(reviewed)), entries);
  const storedNet = approved.calculation.net;
  reviewed.calculation.net = 0;
  assert.equal(approved.calculation.net, storedNet);
  assert.equal(calculatedStatementSnapshot(approved).calculation.net, storedNet);
  assert.throws(() => approveSettlement({ ...source, calculation: { ...source.calculation, net: -1 } }), /negative/);
});

test('reopened approved PDF contains edited load amounts and the reviewed net', async () => {
  const source = await sourceSnapshot();
  const draft = settlementDraft(source); draft.loads[0].rate = '6300';
  draft.settings.rules.find(rule => rule.id === 'company').value = '20';
  const entry = approveSettlement(reviewSettlement(source, draft));
  const fontBytes = await readFile(new URL('../../assets/fonts/DejaVuSans.ttf', import.meta.url));
  const bytes = await createSettlementPdf(calculatedStatementSnapshot(entry), { fontBytes });
  const text = (await extractText(bytes, { mergePages: true })).text;
  assert.match(text, /6,300\.00/);
  assert.match(text, /7,157\.50/);
  assert.match(text, /DEMO-1001/);
  assert.match(text, /DEMO-1002/);
});

test('load Net overrides reconcile earnings without changing company fees or source data', async () => {
  const source = await sourceSnapshot();
  const original = structuredClone(source);
  const draft = settlementDraft(source);
  draft.loads[0].netOverride = '5000.01';
  draft.loads[1].netOverride = '2700.02';
  const { calculation: c } = reviewSettlement(source, draft);
  assert.deepEqual(c.rows.map(row => row.net), [500001, 270002]);
  assert.equal(c.earnings, 770003);
  assert.equal(c.loadNetAdjustment, 5003);
  assert.equal(c.commission, source.calculation.commission);
  assert.deepEqual(c.deductions, source.calculation.deductions);
  assert.equal(c.net, 726253);
  assert.equal(c.gross - c.commission + c.loadNetAdjustment - c.deducted, c.net);
  assert.deepEqual(source, original);
});

test('final Net supports deductions, credits, zero and automatic reset without accumulating edits', async () => {
  const source = await sourceSnapshot();
  for (const [value, target] of [['7000.25', 700025], ['8000', 800000], ['0', 0]]) {
    const draft = settlementDraft(source);
    draft.loads[0].netOverride = '5000';
    draft.netOverride = value;
    const reviewed = reviewSettlement(source, draft);
    const c = reviewed.calculation;
    assert.equal(c.net, target);
    assert.equal(c.earnings - c.deducted, target);
    assert.equal(c.deductions.reduce((sum, rule) => sum + rule.amount, 0), c.deducted);
    assert.equal(c.deductions.find(rule => rule.id === 'pdf_net_adjustment').amount, c.netBeforeOverride - target);
    const reopened = calculatedStatementSnapshot(approveSettlement(reviewed));
    assert.deepEqual(reviewSettlement(reopened, settlementDraft(reopened)).calculation, c);
    const reset = settlementDraft(reopened);
    reset.netOverride = '';
    reset.loads.forEach(load => { load.netOverride = ''; });
    const automatic = reviewSettlement(reopened, reset).calculation;
    assert.equal(automatic.net, source.calculation.net);
    assert.equal(automatic.loadNetAdjustment, 0);
    assert.equal(automatic.deductions.some(rule => rule.id === 'pdf_net_adjustment'), false);
  }
});

test('Net overrides reject invalid money and preserve explicit zero per load', async () => {
  const source = await sourceSnapshot();
  for (const value of ['-1', 'NaN', '1.001', '1e3', '10000000', 'Infinity', null]) {
    const draft = settlementDraft(source);
    draft.netOverride = value;
    assert.throws(() => reviewSettlement(source, draft), /invalid/);
    draft.netOverride = '';
    draft.loads[0].netOverride = value;
    assert.throws(() => reviewSettlement(source, draft), /invalid/);
  }
  const draft = settlementDraft(source);
  draft.loads[0].netOverride = '0';
  assert.equal(reviewSettlement(source, draft).calculation.rows[0].net, 0);
});

test('confirmed PDF retains load Net overrides and the explicit final adjustment', async () => {
  const source = await sourceSnapshot();
  const draft = settlementDraft(source);
  draft.loads[0].netOverride = '5000.01';
  draft.netOverride = '8000.25';
  const snapshot = calculatedStatementSnapshot(approveSettlement(reviewSettlement(source, draft)));
  const model = statementModel(snapshot);
  assert.equal(model.rows[0][7], '$5,000.01');
  assert.equal(model.totals[7], '$7,880.01');
  assert.equal(model.netAdjustments[0].amount, '+230.01');
  assert.equal(model.deductions.at(-1).amount, '-557.74');
  const fontBytes = await readFile(new URL('../../assets/fonts/DejaVuSans.ttf', import.meta.url));
  const bytes = await createSettlementPdf(snapshot, { fontBytes });
  const text = (await extractText(bytes, { mergePages: true })).text;
  assert.match(text, /5,000\.01/);
  assert.match(text, /8,000\.25/);
  assert.match(text, /Load Net adjustment/);
  assert.match(text, /Final Net adjustment/);
  assert.match(text, /-557\.74/);
});
