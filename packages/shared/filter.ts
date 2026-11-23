// Server-side text filter (SPEC §11). The word list is passed in and never ships with this module.
import AhoCorasick from 'ahocorasick';

const MASK = '***';
const SHORT_ROOT_LENGTH = 3;

const FOLDED: Record<string, string> = {
  ş: 's',
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
};

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

interface SourceLetter {
  letter: string;
  start: number;
  end: number;
}

interface Word {
  /** Whitespace-delimited chunk. Spaced-out letters ("a p t a l") share one chunk. */
  chunk: number;
  first: number;
  last: number;
  start: number;
  end: number;
}

interface Normalized {
  value: string;
  words: Word[];
  wordAt: number[];
}

function toLetter(character: string): string | null {
  const lower = character.toLocaleLowerCase('tr-TR');
  const mapped = FOLDED[lower] ?? LEET[lower] ?? lower;
  return /^[a-z]$/.test(mapped) ? mapped : null;
}

function tokenize(text: string) {
  const tokens: { chunk: number; letters: SourceLetter[] }[] = [];
  let current: SourceLetter[] | null = null;
  let chunk = 0;
  let offset = 0;

  for (const character of text) {
    const letter = toLetter(character);
    if (letter) {
      if (!current) {
        current = [];
        tokens.push({ chunk, letters: current });
      }
      current.push({ letter, start: offset, end: offset + character.length });
    } else {
      current = null;
      if (/\s/.test(character)) chunk += 1;
    }
    offset += character.length;
  }
  return tokens;
}

/** Joins runs of single letters, so "a p t a l" and "a.p.t.a.l" read as one word. */
function mergeSingleLetters(tokens: ReturnType<typeof tokenize>) {
  const merged: ReturnType<typeof tokenize> = [];
  let inRun = false;
  for (const token of tokens) {
    const single = token.letters.length === 1;
    const previous = merged.at(-1);
    if (single && inRun && previous) previous.letters.push(...token.letters);
    else merged.push({ chunk: token.chunk, letters: [...token.letters] });
    inRun = single;
  }
  return merged;
}

function normalizeDetailed(text: string): Normalized {
  let value = '';
  const words: Word[] = [];
  const wordAt: number[] = [];

  for (const { chunk, letters } of mergeSingleLetters(tokenize(text))) {
    const first = value.length;
    let previous = '';
    for (const { letter } of letters) {
      if (letter === previous) continue;
      value += letter;
      wordAt.push(words.length);
      previous = letter;
    }
    words.push({
      chunk,
      first,
      last: value.length - 1,
      start: letters[0]!.start,
      end: letters.at(-1)!.end,
    });
  }
  return { value, words, wordAt };
}

export function normalizeText(text: string): string {
  return normalizeDetailed(text).value;
}

export interface MaskResult {
  text: string;
  masked: boolean;
}

export interface WordFilter {
  mask(text: string): MaskResult;
}

export function createWordFilter(roots: readonly string[]): WordFilter {
  const normalizedRoots = [...new Set(roots.map(normalizeText).filter(Boolean))];
  const matcher = normalizedRoots.length > 0 ? new AhoCorasick(normalizedRoots) : null;

  return {
    mask(text) {
      if (!matcher) return { text, masked: false };
      const { value, words, wordAt } = normalizeDetailed(text);
      const ranges: [number, number][] = [];

      for (const [endIndex, found] of matcher.search(value)) {
        for (const root of found) {
          const startIndex = endIndex - root.length + 1;
          const firstWord = words[wordAt[startIndex]!]!;
          const lastWord = words[wordAt[endIndex]!]!;
          if (firstWord.chunk !== lastWord.chunk) continue;
          // Short roots match whole words only, which avoids false positives.
          if (
            root.length <= SHORT_ROOT_LENGTH &&
            (firstWord !== lastWord ||
              firstWord.first !== startIndex ||
              firstWord.last !== endIndex)
          ) {
            continue;
          }
          ranges.push([firstWord.start, lastWord.end]);
        }
      }
      if (ranges.length === 0) return { text, masked: false };

      ranges.sort((a, b) => a[0] - b[0]);
      let output = '';
      let cursor = 0;
      for (const [start, end] of ranges) {
        if (end <= cursor) continue;
        if (start >= cursor) {
          output += text.slice(cursor, start) + MASK;
        }
        cursor = end;
      }
      return { text: output + text.slice(cursor), masked: true };
    },
  };
}

const CONTACT_PATTERNS = [
  /https?:\/\//iu,
  /\bwww\./iu,
  /[\p{L}\d]\.(?:com|net|org|tr|io|me|gg)(?![\p{L}\d])/iu,
  /[\p{L}\d._%+-]+@[\p{L}\d-]+\.[\p{L}]{2,}/iu,
  /(?<!\d)(?:\+90|0)?\s?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/u,
  /(?:^|\s)@[\p{L}\d_.]{2,}/iu,
];

/** True when text holds a link, e-mail, phone number or @username (blocked in random chat). */
export function containsContactInfo(text: string): boolean {
  return CONTACT_PATTERNS.some((pattern) => pattern.test(text));
}

/** Parses a word list file: one root per line, `#` starts a comment. */
export function parseWordList(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}
