// A preview lives only in the browser. Its signed extraction can be finalized
// without paying for a second model call or trusting client-edited facts.
const MAX_TICKET_BYTES = 8 * 1024 * 1024;
const PREVIEW_LIFETIME_MS = 30 * 60_000;
const encoder = new TextEncoder();

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(`load-preview-v1:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw Error('PREVIEW_TICKET_INVALID');
  return Uint8Array.from(value.match(/.{2}/g)!, part => parseInt(part, 16));
}

export async function issueLoadPreviewTicket(
  candidate: unknown,
  binding: { actorId: string; companyId: string; checksum: string; fileName: string; mimeType: string; version: number },
  secret: string,
  now = Date.now(),
) {
  const payload = JSON.stringify({ ...binding, candidate, expiresAt: now + PREVIEW_LIFETIME_MS });
  if (encoder.encode(payload).length > MAX_TICKET_BYTES) throw Error('PREVIEW_TICKET_TOO_LARGE');
  const signature = bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload))));
  return { payload, signature };
}

async function verifyBoundPreviewTicket(
  ticket: { payload: unknown; signature: unknown },
  binding: Record<string, unknown>,
  secret: string,
  now = Date.now(),
) {
  if (typeof ticket?.payload !== 'string' || encoder.encode(ticket.payload).length > MAX_TICKET_BYTES) {
    throw Error('PREVIEW_TICKET_INVALID');
  }
  const signature = hexToBytes(String(ticket.signature ?? ''));
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), signature, encoder.encode(ticket.payload));
  if (!valid) throw Error('PREVIEW_TICKET_INVALID');
  let parsed: any;
  try { parsed = JSON.parse(ticket.payload); } catch { throw Error('PREVIEW_TICKET_INVALID'); }
  if (!parsed || !parsed.candidate || !Number.isSafeInteger(parsed.expiresAt)
    || parsed.expiresAt <= now || parsed.expiresAt > now + PREVIEW_LIFETIME_MS
    || Object.entries(binding).some(([key, value]) => parsed[key] !== value)) {
    throw Error('PREVIEW_TICKET_EXPIRED_OR_MISMATCHED');
  }
  return parsed.candidate;
}

export async function verifyLoadPreviewTicket(
  ticket: { payload: unknown; signature: unknown },
  binding: { actorId: string; companyId: string; checksum: string; fileName: string; mimeType: string; version: number },
  secret: string,
  now = Date.now(),
) {
  return verifyBoundPreviewTicket(ticket, binding, secret, now);
}

// Read-only enrichment needs no file re-upload. Finalizing a load must still use
// the full file/checksum/version binding in verifyLoadPreviewTicket above.
export async function verifyLoadPreviewContactsTicket(
  ticket: { payload: unknown; signature: unknown },
  binding: { actorId: string; companyId: string },
  secret: string,
  now = Date.now(),
) {
  return verifyBoundPreviewTicket(ticket, binding, secret, now);
}
