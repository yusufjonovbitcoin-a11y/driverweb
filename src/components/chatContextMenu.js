export function positionChatContextMenu({ x, y, viewportWidth, viewportHeight }) {
  const width = 230;
  const height = 52;
  const margin = 8;
  return {
    left: Math.max(margin, Math.min(x, viewportWidth - width - margin)),
    top: Math.max(margin, Math.min(y, viewportHeight - height - margin)),
  };
}
