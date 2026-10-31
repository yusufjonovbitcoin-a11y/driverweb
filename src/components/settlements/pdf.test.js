import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { extractText } from "unpdf";
import { createSettlementPdf } from "./pdf.js";
import { defaultSettings, calculateSettlement } from "./calculation.js";
const fontBytes = await readFile(
  new URL("../../assets/fonts/DejaVuSans.ttf", import.meta.url),
);
const options = {
  fontBytes,
  t: (k) => k,
  money: (n) => n.toFixed(2),
  date: (v) => v || "—",
};
function snapshot(count = 2) {
  const settings = defaultSettings();
  Object.assign(settings.rules[0], { enabled: true, value: "10" });
  return {
    driver: { name: "Тестовый водитель O‘ktam" },
    version: 7,
    calculation: calculateSettlement(
      Array.from({ length: count }, (_, i) => ({
        id: String(i),
        driverId: "a",
        loadNumber: "LOAD-" + i,
        rate: 100,
        distanceMiles: 10,
        deliveredAt: "2026-07-21",
        origin: { city: "Origin" },
        destination: { city: "Destination" },
      })),
      settings,
      { from: "2026-07-20", to: "2026-07-26" },
    ),
  };
}
test("PDF preserves Unicode driver name, exact net and repeated headers across pages", async () => {
  const bytes = await createSettlementPdf(snapshot(50), options);
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() > 1);
  assert.deepEqual(doc.getPage(0).getSize(), { width: 792, height: 612 });
  const text = (await extractText(bytes, { mergePages: true })).text;
  assert.match(text, /Тестовый водитель O‘ktam/);
  assert.match(text, /4,500\.00/);
  assert.match(text, /LOAD-49/);
  assert.ok((text.match(/Load number/g) || []).length >= 2);
});
test('inline editing targets follow the rendered PDF rows across page breaks', async () => {
  const source = snapshot(50);
  let fields;
  const bytes = await createSettlementPdf(source, { ...options, onFields: value => { fields = value; } });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 1);
  const loadFields = fields.filter(field => field.loadIndex != null);
  assert.equal(loadFields.length, 50 * 6);
  assert.equal(new Set(loadFields.map(field => field.key)).size, loadFields.length);
  assert.ok(loadFields.find(field => field.loadIndex === 49).page > 1);
  for (const field of fields) {
    assert.ok(field.page > 0 && field.page <= pdf.getPageCount());
    assert.ok(field.x >= 0 && field.x + field.width <= 792);
    assert.ok(field.y >= 0 && field.y + field.height <= 560);
  }
  assert.equal(fields.filter(field => field.key === 'driverName').length, pdf.getPageCount());
  assert.equal(fields.filter(field => field.key === 'netOverride').length, 1);
});

test('reopening an approved statement generates identical bytes for safe delivery retries', async () => {
  const source = { ...snapshot(), approvedAt: '2026-10-24T01:00:00Z' };
  assert.deepEqual(await createSettlementPdf(source, options), await createSettlementPdf(source, options));
});

test("PDF output flags omit optional financial sections", async () => {
  const s = snapshot();
  s.calculation.settings.pdf = {
    loads: false,
    deductions: false,
    total: false,
  };
  const text = (
    await extractText(await createSettlementPdf(s, options), {
      mergePages: true,
    })
  ).text;
  assert.doesNotMatch(text, /LOAD-0|TOTAL DEDUCTIONS|180\.00/);
  assert.match(text, /Settings version/);
});

test("PDF pickup date uses stop timezone and missing delivery remains preliminary", async () => {
  const s = snapshot();
  s.calculation.rows[0].load.origin = {
    city: "Los Angeles",
    appointmentAt: "2026-07-22T02:00:00Z",
    timezone: "America/Los_Angeles",
  };
  s.calculation.rows[0].load.deliveredAt = null;
  const text = (
    await extractText(await createSettlementPdf(s, options), {
      mergePages: true,
    })
  ).text;
  assert.match(text, /07\/21\/2026/);
  assert.doesNotMatch(text, /07\/22\/2026/);
  assert.match(text, /Preliminary - actual delivery date missing/);
  assert.match(text, /not a payment confirmation/);
});
