import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { statementModel, statementMoney } from "./statementModel.js";

/** Landscape settlement template based on the supplied Mirwell statement. */
export async function createSettlementPdf(snapshot, { fontBytes, logoBytes }) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const unicode = await pdf.embedFont(fontBytes, { subset: true }),
    serif = await pdf.embedFont(StandardFonts.TimesRoman),
    bold = await pdf.embedFont(StandardFonts.TimesRomanBold),
    sans = await pdf.embedFont(StandardFonts.Helvetica);
  const logo = logoBytes ? await pdf.embedPng(logoBytes) : null;
  const c = snapshot.calculation,
    m = statementModel(snapshot);
  const blue = rgb(0.43, 0.66, 0.86),
    gray = rgb(0.93, 0.93, 0.93),
    pale = rgb(0.86, 0.93, 0.88),
    black = rgb(0, 0, 0),
    white = rgb(1, 1, 1);
  const x = 50,
    width = 598,
    half = 295,
    columns = [92, 137, 85, 70, 49, 66, 44, 55];
  let page, y;
  function face(value, kind = "serif") {
    return /[^\x20-\x7e]/.test(String(value))
      ? unicode
      : kind === "bold"
        ? bold
        : kind === "sans"
          ? sans
          : serif;
  }
  function draw(value, left, top, size = 7, kind = "serif", color = black) {
    const str = String(value ?? "");
    page.drawText(str, {
      x: left,
      y: 612 - top - size,
      font: face(str, kind),
      size,
      color,
    });
  }
  function fit(value, left, top, maxWidth, size = 8, kind = "sans") {
    const str = String(value ?? "—");
    const f = face(str, kind);
    draw(
      str,
      left,
      top,
      Math.min(size, maxWidth / Math.max(f.widthOfTextAtSize(str, 1), 1)),
      kind,
    );
  }
  function box(left, top, w, h, color) {
    page.drawRectangle({
      x: left,
      y: 612 - top - h,
      width: w,
      height: h,
      color,
    });
  }
  function center(value, left, top, w, size = 9) {
    draw(
      value,
      left + (w - face(value, "sans").widthOfTextAtSize(value, size)) / 2,
      top,
      size,
      "sans",
      white,
    );
  }
  function band(label, w = width) {
    box(x, y, w, 12, blue);
    center(label, x, y + 1, w, 9);
    y += 12;
  }
  function newPage() {
    page = pdf.addPage([792, 612]);
    if (logo)
      page.drawImage(logo, { x: 66, y: 612 - 155, width: 200, height: 93 });
    else fit(m.company.name || "T Fleets", 70, 90, 195, 25, "bold");
    (m.company.address || [])
      .slice(0, 2)
      .forEach((s, i) => fit(s, 90, 159 + i * 10, 180, 8));
    const truck = snapshot.driver.vehicle?.number || snapshot.driver.truck;
    const header = [
      [
        "DRIVER:",
        `${snapshot.driver.name}${truck ? ` / TRUCK #${String(truck).replace(/^#/, "")}` : ""}`,
      ],
      ["WEEK:", periodLabel(c.period)],
      ["EMAIL:", snapshot.driver.email || "—"],
    ];
    header.forEach(([label, value], i) => {
      draw(label, 365, 77 + i * 11, 8, "sans");
      fit(value, 436, 77 + i * 11, 305, 8);
    });
    draw("PHONE:", 365, 134, 8, "sans");
    fit(m.company.phone || "—", 436, 134, 300, 8);
    draw("EMAIL:", 365, 145, 8, "sans");
    fit(m.company.email || "—", 436, 145, 300, 8);
    y = 178;
  }
  function room(height) {
    if (y + height > 560) newPage();
  }
  function wrap(value, maxWidth, size = 7, kind = "serif") {
    const lines = [];
    let line = "";
    for (const ch of String(value ?? "").replace(/[\n\r\t]/g, " ")) {
      if (
        line &&
        face(line + ch, kind).widthOfTextAtSize(line + ch, size) > maxWidth
      ) {
        lines.push(line);
        line = ch;
      } else line += ch;
    }
    lines.push(line);
    return lines;
  }
  function loadHeader() {
    band("Earnings");
    row(m.columns, { header: true });
  }
  function row(values, { header = false, total = false } = {}) {
    const lines = values.map((v, i) =>
      wrap(
        v,
        columns[i] - 4,
        header ? 7 : 7,
        header || total ? "bold" : "serif",
      ),
    );
    const height = Math.max(11, ...lines.map((l) => l.length * 8 + 3));
    if (y + height > 550) {
      newPage();
      if (!header) loadHeader();
    }
    if (header || total)
      box(x, y, width, height, total ? pale : rgb(0.92, 0.94, 0.96));
    let left = x;
    lines.forEach((l, i) => {
      l.forEach((s, j) =>
        draw(s, left + 2, y + 1 + j * 8, 7, header || total ? "bold" : "serif"),
      );
      left += columns[i];
    });
    y += height;
  }
  function fee(label, value, index, { total = false } = {}) {
    const lines = wrap(label, half - 70, 7, "sans");
    const height = Math.max(11, lines.length * 9 + 2);
    if (y + height > 550) {
      newPage();
      band("Deductions", half);
    }
    if (total || index % 2 === 0) box(x, y, half, height, total ? pale : gray);
    lines.forEach((s, i) =>
      draw(s, x + 2, y + 1 + i * 9, 7, total ? "bold" : "sans"),
    );
    draw(value, x + half - 64, y + 1, 7, total ? "bold" : "serif");
    y += height;
  }
  newPage();
  if (c.settings.pdf.loads) {
    loadHeader();
    for (const values of m.rows) row(values);
    row(m.totals, { total: true });
    y += 12;
  }
  if (c.settings.pdf.deductions) {
    room(24);
    band("Deductions", half);
    m.deductions.forEach((r, i) => fee(r.label, r.amount, i));
    fee("TOTAL DEDUCTIONS:", statementMoney(c.deducted / 100), 0, {
      total: true,
    });
    y += 12;
  }
  if (c.settings.pdf.total) {
    room(55);
    band("Driver Pay Settlement", half);
    fee("TOTAL EARNINGS", statementMoney(c.earnings / 100), 0);
    fee("TOTAL DEDUCTIONS", statementMoney(c.deducted / 100), 1);
    box(x, y, half, 12, rgb(0, 1, 0));
    draw("Total to driver", x + 2, y + 1, 9, "bold");
    const amount = "$" + statementMoney(c.net / 100);
    draw(
      amount,
      x + half - face(amount, "bold").widthOfTextAtSize(amount, 9) - 2,
      y + 1,
      9,
      "bold",
    );
    y += 12;
  }
  const pages = pdf.getPages();
  for (let i = 0; i < pages.length; i++) {
    page = pages[i];
    draw(
      "Calculation only - not a payment confirmation." +
        (c.rows.some((row) => !row.load.deliveredAt)
          ? " Preliminary - actual delivery date missing."
          : ""),
      50,
      574,
      6,
      "sans",
      rgb(0.5, 0.5, 0.5),
    );
    draw(
      `Settings version: ${snapshot.version} | ${i + 1} / ${pages.length}`,
      50,
      584,
      6,
      "sans",
      rgb(0.5, 0.5, 0.5),
    );
  }
  pdf.setTitle(`Driver Pay Settlement - ${snapshot.driver.name}`);
  pdf.setProducer("T Fleets");
  return pdf.save();
}
function periodLabel(period) {
  const format = (s) =>
    new Date(s + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return `${format(period.from)} - ${format(period.to)}, ${period.to.slice(0, 4)}`;
}
