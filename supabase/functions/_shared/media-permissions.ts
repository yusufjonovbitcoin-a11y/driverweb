type MediaActor = {
  userId: string | null;
  worker: boolean;
  profile: { company_id?: unknown; role?: unknown; status?: unknown } | null;
};
type MediaAsset = { company_id?: unknown; uploaded_by?: unknown };

// Read permission alone is not deletion permission. Worker-imported assets have
// no uploader and must never implicitly become deletable by a driver.
export function canDeleteMedia(actor: MediaActor, asset: MediaAsset): boolean {
  if (actor.worker || !actor.userId || actor.profile?.status !== "active") return false;
  if (!asset.company_id || asset.company_id !== actor.profile.company_id) return false;
  return asset.uploaded_by === actor.userId ||
    ["company_admin", "dispatcher"].includes(String(actor.profile.role));
}
