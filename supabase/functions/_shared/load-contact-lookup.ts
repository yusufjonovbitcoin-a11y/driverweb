import { hasContactLookupAddress, matchesPlaceAddress, validPhone } from './load-enrichment.ts';

export type StopRow = {
  id: string;
  type: "pickup" | "delivery";
  facility_name: string | null;
  address_line: string;
  city: string;
  region: string;
  postal_code: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_source: string | null;
  contact_place_id: string | null;
};

type GooglePlace = {
  addressComponents?: unknown[];
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  googleMapsUri?: string;
};

export type RouteContact = {
  role: "pickup" | "delivery" | "dispatcher" | "broker";
  status: "found" | "not_found" | "provider_error";
  name: string;
  phone: string | null;
  source:
    | "broker_document"
    | "dispatcher"
    | "manual"
    | "google_places"
    | "unavailable";
  confidence: number | null;
  googleMapsUri?: string | null;
};

export type StopContactResult = {
  contact: RouteContact;
  placeId: string | null | undefined;
  providerError?: string;
};

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string | null | undefined) {
  return new Set(
    normalize(value)
      .split(" ")
      .filter((token) => token.length > 1),
  );
}

function similarity(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

function streetNumber(value: string | null | undefined) {
  return normalize(value).match(/\b\d+[a-z]?\b/)?.[0] ?? null;
}

function placeConfidence(stop: StopRow, place: GooglePlace) {
  if (!matchesPlaceAddress(stop, place)) return 0;
  const facility = stop.facility_name ?? "";
  if (facility && similarity(facility, place.displayName?.text) < 0.2) return 0;
  const address = [stop.address_line, stop.city, stop.region, stop.postal_code]
    .filter(Boolean)
    .join(", ");
  const placeAddress = place.formattedAddress ?? "";
  let score = similarity(facility, place.displayName?.text) * 0.35;
  score += similarity(address, placeAddress) * 0.45;

  const normalizedAddress = normalize(placeAddress);
  if (stop.city && normalizedAddress.includes(normalize(stop.city))) {
    score += 0.08;
  }
  if (stop.region && normalizedAddress.includes(normalize(stop.region))) {
    score += 0.05;
  }
  if (
    stop.postal_code && normalizedAddress.includes(normalize(stop.postal_code))
  ) score += 0.07;

  const expectedStreet = streetNumber(stop.address_line);
  const actualStreet = streetNumber(placeAddress);
  if (expectedStreet && actualStreet) {
    score += expectedStreet === actualStreet ? 0.15 : -0.4;
  }
  return Math.max(0, Math.min(1, score));
}

function phoneOf(place: GooglePlace) {
  return validPhone(place.internationalPhoneNumber) ?? validPhone(place.nationalPhoneNumber);
}

async function googleRequest(url: string, apiKey: string, init: RequestInit | undefined, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    ...init,
    signal: AbortSignal.timeout(12_000),
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": init?.method === "POST"
        ? "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.nationalPhoneNumber,places.internationalPhoneNumber,places.googleMapsUri"
        : "id,displayName,formattedAddress,addressComponents,nationalPhoneNumber,internationalPhoneNumber,googleMapsUri",
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.error?.message ??
      `Google Places returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return response.json();
}

export async function findStopContact(
  stop: StopRow,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<StopContactResult> {
  if (validPhone(stop.contact_phone) && stop.contact_source !== 'google_places') {
    const source = stop.contact_source === "broker_document"
      ? "broker_document"
      : stop.contact_source === "dispatcher"
      ? "dispatcher"
      : "manual";
    return {
      contact: {
        role: stop.type,
        status: "found",
        name: stop.contact_name ?? stop.facility_name ??
          (stop.type === "pickup" ? "Shipper" : "Receiver"),
        phone: stop.contact_phone,
        source,
        confidence: null,
      } satisfies RouteContact,
      placeId: stop.contact_place_id,
    };
  }

  if (!hasContactLookupAddress(stop)) {
    return {
      contact: { role: stop.type, status: 'not_found',
        name: stop.facility_name ?? (stop.type === 'pickup' ? 'Shipper' : 'Receiver'),
        phone: null, source: 'unavailable', confidence: null },
      placeId: null,
    };
  }

  try {
    let place: GooglePlace | null = null;
    let confidence = 0;
    if (stop.contact_place_id) {
      place = await googleRequest(
        `https://places.googleapis.com/v1/places/${
          encodeURIComponent(stop.contact_place_id)
        }`,
        apiKey,
        undefined,
        fetcher,
      );
      confidence = placeConfidence(stop, place!);
      if (confidence < 0.72) place = null;
    }
    if (!place) {
      const query = [
        stop.facility_name,
        stop.address_line,
        stop.city,
        stop.region,
        stop.postal_code,
      ].filter(Boolean).join(", ");
      const payload = await googleRequest(
        "https://places.googleapis.com/v1/places:searchText",
        apiKey,
        {
          method: "POST",
          body: JSON.stringify({
            textQuery: query,
            maxResultCount: 5,
            regionCode: "US",
          }),
        },
        fetcher,
      );
      const candidates = (payload.places ?? []) as GooglePlace[];
      const ranked = candidates
        .filter((candidate) => candidate.id && phoneOf(candidate))
        .map((candidate) => ({
          candidate,
          score: placeConfidence(stop, candidate),
        }))
        .sort((a, b) => b.score - a.score);
      if (!ranked.length || ranked[0].score < 0.72
        || (ranked[1] && ranked[0].score - ranked[1].score < 0.1)) {
        return {
          contact: {
            role: stop.type,
            status: "not_found",
            name: stop.facility_name ??
              (stop.type === "pickup" ? "Shipper" : "Receiver"),
            phone: null,
            source: "unavailable",
            confidence: ranked[0]?.score ?? null,
          } satisfies RouteContact,
          placeId: null,
        };
      }
      place = ranked[0].candidate;
      confidence = ranked[0].score;
    }

    const phone = place ? phoneOf(place) : null;
    if (!place || !phone) {
      return {
        contact: {
          role: stop.type,
          status: "not_found",
          name: stop.facility_name ??
            (stop.type === "pickup" ? "Shipper" : "Receiver"),
          phone: null,
          source: "unavailable",
          confidence: null,
        } satisfies RouteContact,
        placeId: place?.id ?? null,
      };
    }

    return {
      contact: {
        role: stop.type,
        status: "found",
        name: place.displayName?.text ?? stop.facility_name ??
          (stop.type === "pickup" ? "Shipper" : "Receiver"),
        phone,
        source: "google_places",
        confidence,
        googleMapsUri: place.googleMapsUri ?? null,
      } satisfies RouteContact,
      placeId: place.id ?? stop.contact_place_id,
    };
  } catch (error) {
    return {
      contact: {
        role: stop.type,
        status: "provider_error",
        name: stop.facility_name ??
          (stop.type === "pickup" ? "Shipper" : "Receiver"),
        phone: null,
        source: "unavailable",
        confidence: null,
      } satisfies RouteContact,
      placeId: null,
      providerError: error instanceof Error
        ? error.message
        : "Google Places is unavailable",
    };
  }
}
