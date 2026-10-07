type AccessClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown; error: unknown;
  }>;
};

// A private-rate driver's raw loads row is deliberately hidden by RLS. The
// existing predicate checks active tenant/assignment access without exposing it.
export async function loadContactAccess(client: AccessClient, loadId: string) {
  try {
    const { data, error } = await client.rpc('can_access_load', { target_load_id: loadId });
    return error ? 'unavailable' : data === true ? 'allowed' : 'denied';
  } catch {
    return 'unavailable';
  }
}
