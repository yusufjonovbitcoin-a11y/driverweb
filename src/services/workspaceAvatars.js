import { mapWithConcurrency } from './readAllRows.js';

export function preserveWorkspaceAvatars(next, previous) {
  const byId = new Map(previous.map(member => [member.id, member]));
  return next.map(member => {
    const old = byId.get(member.id);
    return old?.avatar && member.avatarPath && old.avatarPath === member.avatarPath
      ? { ...member, avatar: old.avatar }
      : member;
  });
}

export function applyWorkspaceAvatar(members, source, avatar) {
  return members.map(member => member.id === source.id && member.avatarPath === source.avatarPath
    ? { ...member, avatar }
    : member);
}

// Optional media must not block core data, fail the whole page, or publish into
// a newer workspace snapshot. Already cached signing is reused by the resolver.
export async function hydrateWorkspaceAvatars(members, resolve, publish, isCurrent) {
  await mapWithConcurrency(members.filter(member => member.avatarPath), async member => {
    if (!isCurrent()) return;
    let avatar;
    try { avatar = await resolve(member); }
    catch { return; } // Retry on the next refresh; keep any last good avatar.
    if (isCurrent()) publish(member, avatar);
  });
}
