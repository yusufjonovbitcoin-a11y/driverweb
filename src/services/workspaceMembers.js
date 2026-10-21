export function partitionWorkspaceMembers(rows) {
  const sorted = [...rows].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  return {
    active: sorted.filter((member) => member.status === 'active'),
    roster: sorted.filter((member) => member.role === 'driver' && ['active', 'suspended'].includes(member.status)),
  };
}
