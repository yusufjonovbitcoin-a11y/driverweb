const json = (error: string, status: number) => new Response(JSON.stringify({ error }), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

type Row = Record<string, unknown>;
type Dependencies = {
  readVersion: (id: string) => Promise<Row | null>;
  readAsset: (id: string) => Promise<Row | null>;
  deliveryUrl: (asset: Row) => Promise<string>;
  previewUrl?: (asset: Row) => Promise<string>;
  previewFallbackUrl?: (asset: Row) => Promise<string>;
  fetcher?: typeof fetch;
};

// Call only after authenticating the caller. Both readers must use that caller's
// RLS client, never a service-role client. The permanent upstream signature stays
// server-side; the response contains file bytes and no delivery URL/redirect.
export async function documentContentResponse(versionId: unknown, dependencies: Dependencies, signal?: AbortSignal, range?: string | null, preview = false) {
  if (typeof versionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(versionId)) return json('Invalid document version', 400);
  if (range && !/^bytes=\d+-\d*$/.test(range)) return json('Invalid byte range', 416);
  const version = await dependencies.readVersion(versionId);
  if (!version) return json('Document not found', 404);
  if (version.mime_type !== 'application/pdf') return json('PDF document required', 415);
  if (Number(version.size_bytes) > 50 * 1024 * 1024) return json('Document too large', 413);
  const reference = String(version.storage_path || '');
  if (!/^cloudinary:[0-9a-f-]{36}$/i.test(reference)) return json('Unsupported document storage', 415);
  const asset = await dependencies.readAsset(reference.slice(11));
  if (!asset || asset.deleted_at || asset.scope !== 'load_document' || asset.mime_type !== 'application/pdf') return json('Document not found', 404);
  if (!['raw', 'image'].includes(String(asset.resource_type)) || asset.delivery_type !== 'authenticated') return json('Unsupported document storage', 415);
  if (preview && (asset.resource_type !== 'image' || !dependencies.previewUrl)) return json('Preview unavailable', 415);
  const url = await (preview ? dependencies.previewUrl!(asset) : dependencies.deliveryUrl(asset));
  const deliverySignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  const read = (value: string, host: string) => {
    const target = new URL(value);
    if (target.protocol !== 'https:' || target.hostname !== host) throw new Error('Invalid media host');
    return (dependencies.fetcher || fetch)(value, {
      headers: { 'Accept-Encoding': 'identity', ...(range && !preview ? { Range: range } : {}) }, redirect: 'manual', signal: deliverySignal,
    });
  };
  let upstream = await read(url, 'res.cloudinary.com');
  // New authenticated PDFs may not have this derived image yet. Generate it
  // through the expiring API once; later requests use authenticated CDN delivery.
  if (preview && [400, 401, 404].includes(upstream.status) && dependencies.previewFallbackUrl) {
    await upstream.body?.cancel();
    upstream = await read(await dependencies.previewFallbackUrl(asset), 'api.cloudinary.com');
  }
  // Never forward a redirect, Cloudinary metadata, or an error containing a URL.
  if (!upstream.ok) { await upstream.body?.cancel(); return json('Document delivery failed', upstream.status === 404 ? 404 : 502); }
  if (preview && !upstream.headers.get('Content-Type')?.startsWith('image/jpeg')) { await upstream.body?.cancel(); return json('Preview unavailable', 502); }
  const length = upstream.headers.get('Content-Length');
  if (length && Number(length) > 50 * 1024 * 1024) { await upstream.body?.cancel(); return json('Document too large', 413); }
  const headers = new Headers({
    'Content-Type': preview ? 'image/jpeg' : 'application/pdf', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  });
  // Fetch can transparently decompress a response; never advertise the old
  // compressed byte length for a decoded stream.
  if (length && !upstream.headers.has('Content-Encoding')) headers.set('Content-Length', length);
  if (upstream.headers.get('Accept-Ranges') === 'bytes') headers.set('Accept-Ranges', 'bytes');
  const contentRange = upstream.headers.get('Content-Range');
  if (upstream.status === 206 && contentRange && /^bytes \d+-\d+\/\d+$/.test(contentRange)) headers.set('Content-Range', contentRange);
  return new Response(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers });
}
