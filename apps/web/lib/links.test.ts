import { describe, expect, it } from 'vitest';
import { splitLinks } from './links';

const links = (text: string) => splitLinks(text).filter((part) => part.type === 'link');

describe('splitLinks', () => {
  it('keeps plain text as one part', () => {
    expect(splitLinks('merhaba nasılsın')).toEqual([{ type: 'text', text: 'merhaba nasılsın' }]);
  });

  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1', 'example.com'],
    ['http://example.org', 'http://example.org/', 'example.org'],
    ['www.example.net', 'https://www.example.net/', 'www.example.net'],
    ['example.com.tr', 'https://example.com.tr/', 'example.com.tr'],
  ])('detects %s', (text, href, host) => {
    expect(links(text)).toEqual([{ type: 'link', text, href, host }]);
  });

  it('keeps surrounding text and trailing punctuation outside the link', () => {
    expect(splitLinks('bak: example.com, güzel')).toEqual([
      { type: 'text', text: 'bak: ' },
      { type: 'link', text: 'example.com', href: 'https://example.com/', host: 'example.com' },
      { type: 'text', text: ', güzel' },
    ]);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'vbscript:x'])(
    'never links the unsafe scheme in %s',
    (text) => {
      expect(links(text)).toEqual([]);
    },
  );

  it('does not treat an e-mail domain as a link', () => {
    expect(links('yaz bana a@example.com')).toEqual([]);
  });

  it('rebuilds the original text from its parts', () => {
    const text = 'a https://x.com/y. b www.z.org! c';
    expect(
      splitLinks(text)
        .map((part) => part.text)
        .join(''),
    ).toBe(text);
  });
});
