const MAX_BODY_CHARACTERS = 300_000;

export function extractMessageBody(parsed) {
  const text = String(parsed?.text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\0/g, '')
    .trim();
  return {
    body_text: text.slice(0, MAX_BODY_CHARACTERS),
    body_truncated: text.length > MAX_BODY_CHARACTERS,
  };
}
