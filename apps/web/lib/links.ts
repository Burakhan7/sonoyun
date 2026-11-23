export type TextPart =
  { type: 'text'; text: string } | { type: 'link'; text: string; href: string; host: string };

const LINK_PATTERN =
  /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[\p{L}\d-]+(?:\.[\p{L}\d-]+)*\.(?:com|net|org|tr|io|me|gg)(?:\/[^\s<>"']*)?(?![\p{L}\d])/giu;
const TRAILING_PUNCTUATION = /[.,!?;:)\]}]+$/u;

function toUrl(candidate: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Splits a DM into text and safe http(s) links. Only these two protocols become links. */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;

  for (const match of text.matchAll(LINK_PATTERN)) {
    const start = match.index;
    // The domain of an e-mail address is not a link.
    if (text[start - 1] === '@') continue;

    const raw = match[0].replace(TRAILING_PUNCTUATION, '');
    const url = toUrl(raw);
    if (!url) continue;

    if (start > cursor) parts.push({ type: 'text', text: text.slice(cursor, start) });
    parts.push({ type: 'link', text: raw, href: url.href, host: url.hostname });
    cursor = start + raw.length;
  }
  if (cursor < text.length) parts.push({ type: 'text', text: text.slice(cursor) });
  return parts;
}
