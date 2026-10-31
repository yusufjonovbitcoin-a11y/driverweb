import type { PdfSource } from "./pdf-source.ts";
import { evidenceFromSource } from "./pdf-source.ts";

const words = (value: unknown) =>
  String(value ?? "").normalize("NFKC").toLowerCase().replace(
    /[^\p{L}\p{N}]+/gu,
    " ",
  ).trim();
const street = (value: unknown) =>
  words(value).replace(
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

export function applyDocumentRules(candidate: any, source: PdfSource) {
  const index = new Map(
    source.pages.flatMap((page) =>
      page.blocks.map((block) =>
        [block.id, { ...block, page: page.number }] as const
      )
    ),
  );
  const issues = candidate.engineIssues;
  const restore = (
    field: string,
    value: unknown,
    ids: string[],
    reason: string,
  ) => {
    const evidence = evidenceFromSource(ids, source, field);
    if (!evidence) return;
    const keys = field.split(".");
    let parent = candidate;
    for (const key of keys.slice(0, -1)) parent = parent[key] ??= {};
    parent[keys.at(-1)!] = value;
    candidate.evidence = candidate.evidence.filter((item: any) =>
      item.field !== field
    );
    candidate.evidence.push(evidence);
    candidate.sourceRepairs ??= [];
    candidate.sourceRepairs.push({ field, reason, sourceIds: ids });
    for (let i = issues.length - 1; i >= 0; i--) {
      if (
        issues[i].field === field &&
        !issues[i].reason.startsWith("conflicting_")
      ) issues.splice(i, 1);
    }
    candidate.documentReview.uncertainFields = candidate.documentReview
      .uncertainFields.filter((item: string) => item !== field);
  };
  if (candidate.documentType !== "bill_of_lading" && !candidate.broker.name) {
    // Only an unambiguous company heading, not an email domain, bill-to name,
    // known carrier identity, generic legal clause or driver contact.
    const headings = source.pages[0].blocks.filter((block) =>
      block.bbox[1] < 155
    )
      .flatMap((block) => {
        const mc = block.text.match(
          /^([\p{L}\p{N} .&'-]+)\s+-\s+MC\s*#\s*\d+/iu,
        );
        const contact = block.text.match(/^([A-Z]{2,6})\s+CONTACT INFO$/);
        const company = block.text.match(
          /^([\p{L}\p{N} .&'-]+\b(?:Logistics|Logistix|Freight)(?:,?\s+LLC)?)$/iu,
        );
        const value = mc?.[1]?.trim() ?? contact?.[1] ?? company?.[1];
        return value && words(value) !== words(candidate.carrierName)
          ? [{ value, id: block.id }]
          : [];
      });
    const unique = [...new Set(headings.map((item) => words(item.value)))];
    if (unique.length === 1) {
      restore(
        "broker.name",
        headings[0].value,
        [headings[0].id],
        "unique_broker_heading",
      );
    }
  }
  if (candidate.weightLbs == null) {
    const totals = [...index.values()].flatMap((block) => {
      const match = block.text.match(
        /\b(?:total\s+)?weight\s*:\s*([\d,]+(?:\.\d+)?)\s*(?:lbs?|pounds?)\b/i,
      );
      return match
        ? [{ value: Number(match[1].replace(/,/g, "")), id: block.id }]
        : [];
    });
    if (totals.length && new Set(totals.map((item) => item.value)).size === 1) {
      restore(
        "weightLbs",
        totals[0].value,
        [totals[0].id],
        "unique_explicit_total_weight",
      );
    }
  }
  if (candidate.isHazmat == null) {
    const statuses = [...index.values()].filter((block) =>
      /^(?:(?:non|not)[- ]hazardous|hazmat\s*:\s*(?:yes|no|true|false))$/i.test(
        block.text.trim(),
      )
    );
    const values = statuses.map((block) =>
      /(?:non|not)[- ]hazardous|\b(?:no|false)$/i.test(block.text)
        ? false
        : true
    );
    if (values.length && new Set(values).size === 1) {
      restore(
        "isHazmat",
        values[0],
        [statuses[0].id],
        "explicit_shipment_hazmat_status",
      );
    }
  }
  // A uniquely printed identifier can be restored without another model call.
  const loadIds: Array<{ value: string; ids: string[] }> = [];
  for (const page of source.pages) {
    for (const block of page.blocks) {
      const labelled = block.text.match(
        /\b(?:LOAD|SHIPMENT|PRO)\s*(?:NO\.?|NUMBER|ID)?\s*[:#-]\s*([A-Z0-9][A-Z0-9/-]*)\b/i,
      ) ??
        block.text.match(/\b(?:TQL|IEL)\s+PO\s*#\s*([A-Z0-9][A-Z0-9/-]*)\b/i);
      if (labelled && /\d/.test(labelled[1])) {
        loadIds.push({ value: labelled[1], ids: [block.id] });
      }
      if (
        /^(?:LOAD|SHIPMENT)\s*(?:NO\.?|NUMBER|ID)\s*[:#]?$/i.test(
          block.text.trim(),
        )
      ) {
        const below = page.blocks.filter((cell) =>
          cell.bbox[1] >= block.bbox[3] && cell.bbox[1] - block.bbox[3] < 20 &&
          cell.bbox[0] <= block.bbox[2] + 3 &&
          cell.bbox[2] >= block.bbox[0] - 3 &&
          /^[A-Z0-9][A-Z0-9/-]{2,}$/i.test(cell.text) && /\d/.test(cell.text)
        );
        if (below.length === 1) {
          loadIds.push({ value: below[0].text, ids: [block.id, below[0].id] });
        }
      }
    }
  }
  const identifiers = [...new Set(loadIds.map((item) => item.value))];
  if (
    !candidate.loadNumber && identifiers.length === 1 &&
    candidate.documentType !== "bill_of_lading"
  ) {
    const found = loadIds[0];
    const record = evidenceFromSource(found.ids, source, "loadNumber");
    if (record) {
      candidate.loadNumber = found.value;
      candidate.evidence.push(record);
      candidate.sourceRepairs ??= [];
      candidate.sourceRepairs.push({
        field: "loadNumber",
        reason: "unique_explicit_source_label",
        sourceIds: found.ids,
      });
      for (let i = issues.length - 1; i >= 0; i--) {
        if (
          issues[i].field === "loadNumber" &&
          !issues[i].reason.startsWith("conflicting_")
        ) {
          issues.splice(i, 1);
        }
      }
      candidate.documentReview.uncertainFields = candidate.documentReview
        .uncertainFields.filter((
          field: string,
        ) => field !== "loadNumber");
    }
  } else if (identifiers.length > 1) {
    issues.push({
      field: "loadNumber",
      reason: "conflicting_load_numbers",
      alternatives: identifiers,
    });
  }
  const context = (field: string) => {
    const cited = candidate.evidence.find((entry: any) =>
      entry.field === field
    );
    const selected = (cited?.sourceIds ?? []).map((id: string) => index.get(id))
      .filter(Boolean);
    return [...index.values()].filter((block) =>
      selected.some((item: any) =>
        block.page === item.page &&
        ((Math.abs(block.bbox[1] - item.bbox[1]) < 7 &&
          block.bbox[0] < item.bbox[2]) ||
          (item.bbox[1] >= block.bbox[3] && item.bbox[1] - block.bbox[3] < 24 &&
            block.bbox[0] <= item.bbox[2] && block.bbox[2] >= item.bbox[0] - 8))
      )
    );
  };
  const reject = (field: string, reason: string, alternatives?: unknown[]) => {
    const keys = field.split(".");
    let parent = candidate;
    for (const key of keys.slice(0, -1)) parent = parent[key];
    const value = parent[keys.at(-1)!];
    parent[keys.at(-1)!] = null;
    candidate.evidence = candidate.evidence.filter((entry: any) =>
      entry.field !== field
    );
    issues.push({
      field,
      reason,
      value,
      ...(alternatives ? { alternatives } : {}),
    });
  };
  const printedRates = [...index.values()].flatMap((block) =>
    [...block.text.matchAll(
      /\b(?:total\s+(?:(?:freight|carrier)\s+)?(?:rate|pay)|(?:freight|carrier)\s+(?:rate|pay))\s*[:=]?\s*(?:USD\s*)?\$\s*([\d,]+(?:\.\d{1,2})?)/gi,
    )].map((match) => Number(match[1].replace(/,/g, "")))
  );
  const uniqueRates = [...new Set(printedRates)];
  if (uniqueRates.length > 1) {
    reject("brokerRate", "conflicting_freight_rates", uniqueRates);
  }
  if (candidate.loadNumber != null) {
    const label = context("loadNumber").map((block) => block.text).join(" ");
    if (
      !/\b(?:load|shipment|order|pro)\s*(?:#|no\.?|number|id)?|\b(?:TQL|IEL)\s+PO\s*#|\brate\s+confirmation\b.*\bPO\s*#/i
        .test(label)
    ) {
      reject("loadNumber", "load_label_missing");
    }
  }
  if (candidate.brokerRate != null) {
    const label = context("brokerRate").map((block) => block.text).join(" ");
    if (
      !/\b(?:total|rate|line\s*haul|freight|carrier\s+pay)\b/i.test(label) ||
      /\b(?:cargo|declared|insured)\s+value\b/i.test(label)
    ) reject("brokerRate", "freight_rate_label_missing");
  }
  if (candidate.temperatureFahrenheit != null) {
    const label = context("temperatureFahrenheit").map((block) => block.text)
      .join(" ");
    if (!/(?:\d\s*°?\s*F\b|\bfahrenheit\b)/i.test(label)) {
      reject("temperatureFahrenheit", "fahrenheit_unit_missing");
    }
  }
  for (const [i, stop] of candidate.stops.entries()) {
    if (
      stop.addressLine &&
      [
        stop.city,
        `${stop.city ?? ""} ${stop.region ?? ""}`,
        `${stop.city ?? ""} ${stop.region ?? ""} ${stop.postalCode ?? ""}`,
      ].some((value) => words(value) === words(stop.addressLine))
    ) {
      reject(`stops.${i}.addressLine`, "city_is_not_street");
    }
    if (stop.addressLine && stop.postalCode) {
      const matching = [...index.values()].filter((block) =>
        street(block.text).includes(street(stop.addressLine))
      );
      const postalCodes = [
        ...new Set(
          matching.flatMap((block) =>
            [...block.text.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)]
              .filter((match) => block.text.slice(0, match.index).includes(","))
              .map((match) => match[1])
          ),
        ),
      ];
      if (postalCodes.length > 1) {
        reject(
          `stops.${i}.postalCode`,
          "conflicting_postal_codes",
          postalCodes,
        );
      }
    }
    if (stop.appointmentPrinted) {
      const cited = candidate.evidence.find((entry: any) =>
        entry.field === `stops.${i}.appointmentPrinted`
      );
      if (/\b(?:Appt|Appointment)\s*#/i.test(cited?.quote ?? "")) {
        stop.appointmentReference = stop.appointmentPrinted;
        stop.appointmentPrinted = null;
        candidate.evidence = candidate.evidence.filter((entry: any) =>
          entry.field !== `stops.${i}.appointmentReference`
        );
        cited.field = `stops.${i}.appointmentReference`;
        issues.push({
          field: `stops.${i}.appointmentReference`,
          reason: "appointment_reference_ambiguity",
          value: stop.appointmentReference,
        });
      }
    }
  }
  candidate.documentReview.uncertainFields = [
    ...new Set([
      ...candidate.documentReview.uncertainFields,
      ...issues.map((issue: any) => issue.field),
    ]),
  ];
  return candidate;
}

const OPERATIONAL =
  /\b(?:driver|tracking|GPS|ELD|HOS|reefer|trailer|photos?|photographs?|BOL|POD|check[ -]?(?:in|out)|call|arrival|departure|loading|unloading|co[ -]?load)\b/i;
const OBLIGATION =
  /\b(?:must|shall|required?|responsib|prohibit|forbidden|not allowed|do not|cannot|need to|prior|before|within|notify|send|submit|upload|provide|maintain|failure|penalt|fine|deduct|agree|payment|invoice|insurance|liability|rebroke|re-broke)/i;

// Preserve clauses from every page locally. The LLM's shorter selection cannot
// remove the original condition, exception, deadline or penalty.
export function preserveSourceInstructions(candidate: any, source: PdfSource) {
  for (const page of source.pages) {
    const paragraphs = new Map<string, typeof page.blocks>();
    for (const block of page.blocks) {
      const id = block.id.replace(/_line_\d+$/, "");
      paragraphs.set(id, [...(paragraphs.get(id) ?? []), block]);
    }
    for (const blocks of paragraphs.values()) {
      const text = blocks.map((block) => block.text).join("\n");
      if (!OBLIGATION.test(text)) continue;
      const key = OPERATIONAL.test(text) ? "requirements" : "contractTerms";
      let chunk: typeof blocks = [];
      const append = () => {
        if (!chunk.length) return;
        const value = chunk.map((block) => block.text).join("\n");
        // Do not duplicate clauses already included in a larger original span.
        if (
          !candidate[key].some((item: string) =>
            words(item).includes(words(value))
          )
        ) {
          if (candidate[key].length >= 128) {
            candidate.documentReview.documentDetailsComplete = false;
            candidate.documentReview.uncertainFields.push(key);
          } else {
            const field = `${key}.${candidate[key].length}`;
            const evidence = evidenceFromSource(
              chunk.map((block) => block.id),
              source,
              field,
            );
            if (evidence) {
              candidate[key].push(value);
              candidate.evidence.push(evidence);
            }
          }
        }
        chunk = [];
      };
      for (const block of blocks) {
        if (
          chunk.length >= 70 ||
          chunk.reduce((sum, item) => sum + item.text.length + 1, 0) +
                block.text.length > 3500
        ) append();
        chunk.push(block);
      }
      append();
    }
  }
  return candidate;
}
