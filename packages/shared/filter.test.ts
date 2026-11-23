import { describe, expect, it } from 'vitest';
import { containsContactInfo, createWordFilter, normalizeText, parseWordList } from './filter.js';

// Neutral stand-ins: the real list stays in the server-only file.
const filter = createWordFilter(['aptal', 'ez']);

describe('normalizeText', () => {
  it.each([
    ['İSTANBUL', 'istanbul'],
    ['IŞIK', 'isik'],
    ['şçğıöü', 'scgiou'],
    ['Ap7a1', 'aptai'],
    ['@pt@l', 'aptal'],
    ['0k3y', 'okey'],
    ['$elam', 'selam'],
    ['aaaaptaaaal', 'aptal'],
    ['a-p_t.a!l', 'aptal'],
    ['😀 selam 👍', 'selam'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });
});

describe('createWordFilter', () => {
  it.each(['aptal', 'APTAL', 'Aptaaaal', '@pt@l', 'a p t a l', 'a.p.t.a.l', 'aptallar'])(
    'masks %s',
    (word) => {
      const result = filter.mask(`sen ${word} misin`);
      expect(result).toEqual({ text: 'sen *** misin', masked: true });
    },
  );

  it('keeps the rest of the message and masks every match', () => {
    expect(filter.mask('Merhaba aptal, sen de aptal!').text).toBe('Merhaba ***, sen de ***!');
  });

  it('matches short roots only as whole words', () => {
    expect(filter.mask('ez').masked).toBe(true);
    expect(filter.mask('beni E Z').masked).toBe(true);
    expect(filter.mask('bu da ez, tamam').text).toBe('bu da ***, tamam');
    for (const safe of ['ezber', 'gezmek', 'beze', 'teze']) {
      expect(filter.mask(safe)).toEqual({ text: safe, masked: false });
    }
  });

  it('does not join separate words into a long root', () => {
    expect(filter.mask('kap tal').masked).toBe(false);
    expect(filter.mask('sana apt alındı').masked).toBe(false);
  });

  it('leaves text unchanged with an empty list', () => {
    const empty = createWordFilter([]);
    expect(empty.mask('aptal')).toEqual({ text: 'aptal', masked: false });
  });
});

describe('containsContactInfo', () => {
  it.each([
    'https://example.com',
    'http://a.b',
    'www.example.org',
    'siteme gel ornek.com',
    'ORNEK.NET',
    'site.com.tr bak',
    'bana yaz: isim@example.com',
    '0532 123 45 67',
    '+90 532 123 45 67',
    '532-123-45-67',
    '5321234567',
    'instagram @kullanici_adi',
    '@kullanici',
  ])('blocks %s', (text) => {
    expect(containsContactInfo(text)).toBe(true);
  });

  it.each([
    'merhaba nasılsın',
    'saat 5 gibi geldim.',
    'dedim. me dedi',
    '2013 yılında 500 kişi vardı',
    'k@le gibi',
    'skor 5-3 bitti',
    'güzel. tr tr',
  ])('allows %s', (text) => {
    expect(containsContactInfo(text)).toBe(false);
  });
});

describe('parseWordList', () => {
  it('ignores comments, blank lines and Windows line endings', () => {
    expect(parseWordList('# not\r\naptal\r\n\r\n  ez  \n')).toEqual(['aptal', 'ez']);
  });
});
