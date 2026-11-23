declare module 'ahocorasick' {
  export default class AhoCorasick {
    constructor(keywords: string[]);
    /** Returns one `[endIndex, keywords]` entry per position where keywords end. */
    search(text: string): [number, string[]][];
  }
}
