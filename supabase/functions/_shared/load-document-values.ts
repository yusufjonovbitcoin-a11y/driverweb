import { singlePassValueSupported } from "./load-single-pass.ts";

// Both extraction and final preview verification use the same conservative
// normalization. No currency conversion, timezone conversion or unit inference.
export function documentValueSupported(
  path: string,
  value: unknown,
  quote: string,
) {
  if (path === "currency" && typeof value === "string") {
    return /^(?:USD|CAD|EUR|GBP|\$|€|£)$/i.test(value) && quote.includes(value);
  }
  if (
    typeof value === "string" &&
    /\.(?:timePrinted|appointmentPrinted)$/.test(path)
  ) {
    const clocks = (text: string) =>
      [...text.toLowerCase().matchAll(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/g)].map(
        ([, hour, minute, period]) => {
          const h = Number(hour), m = Number(minute);
          return h < 24 && m < 60 && (!period || (h >= 1 && h <= 12))
            ? (period ? h % 12 + (period === "pm" ? 12 : 0) : h) * 60 + m
            : -1;
        },
      );
    const proposed = clocks(value), actual = clocks(quote);
    if (
      proposed.length &&
      proposed.every((time) => time >= 0 && actual.includes(time))
    ) return true;
  }
  if (typeof value === "boolean") {
    if (singlePassValueSupported(path, value, quote)) return true;
    return value &&
      quote.split(/\r?\n/).some((line) =>
        /^(?:hazmat|hazardous)$/i.test(line.trim()) ||
        /^(?:van|flatbed|reefer|dry van),\s*hazmat$/i.test(line.trim())
      );
  }
  if (typeof value === "string" && /\.addressLine$/.test(path)) {
    const words = (text: string) =>
      text.normalize("NFKC").toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(
          /\b(avenue|boulevard|road|street|drive|terrace|place|north|south|east|west)\b/g,
          (word) =>
            ({
              avenue: "ave",
              boulevard: "blvd",
              road: "rd",
              street: "st",
              drive: "dr",
              terrace: "ter",
              place: "pl",
              north: "n",
              south: "s",
              east: "e",
              west: "w",
            })[word]!,
        );
    return (` ${words(quote)} `).includes(` ${words(value)} `);
  }
  return singlePassValueSupported(path, value, quote);
}

export function numericDocumentValue(path: string, value: unknown) {
  if (typeof value !== "string") return value;
  if (
    !/^(?:brokerRate|loadedMiles|weightLbs|temperatureFahrenheit|palletCount|caseCount|pieceCount|packageCount)$/
      .test(path)
  ) return value;
  const text = path === "temperatureFahrenheit"
    ? value.replace(/^(?:continuous(?:\s+run)?|cycle(?:\s+mode)?)\s+/i, "")
    : value;
  const match = text.trim().match(
    /^(?:\$\s*)?(-?\d[\d,]*(?:\.\d+)?)\s*(?:USD|lbs?|pounds?|mi(?:les)?|°?\s*F|Fahrenheit)?$/i,
  );
  return match ? Number(match[1].replace(/,/g, "")) : value;
}
