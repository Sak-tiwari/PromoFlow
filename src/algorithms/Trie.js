// Trie (prefix tree) for promo codes. O(L) insert/search/prefix where L = code length.
// Each node also keeps try/success counters, so a brand-new code such as WELCOME15 can inherit a
// success prior from known WELCOME* codes. The Trie only validates and scores KNOWN codes. It never generates guesses.

class Node {
  constructor() {
    this.children = new Map();
    this.end = false;
    this.tries = 0;
    this.successes = 0;
  }
}

export const normalizeCode = (code) => String(code ?? '').trim().toUpperCase();

export class Trie {
  constructor() {
    this.root = new Node();
    this.size = 0;
  }

  insert(code) {
    const w = normalizeCode(code);
    if (!w) return false;
    let n = this.root;
    for (const ch of w) {
      if (!n.children.has(ch)) n.children.set(ch, new Node());
      n = n.children.get(ch);
    }
    if (!n.end) {
      n.end = true;
      this.size++;
    }
    return true;
  }

  #walk(w) {
    let n = this.root;
    for (const ch of w) {
      n = n.children.get(ch);
      if (!n) return null;
    }
    return n;
  }

  search(code) {
    const n = this.#walk(normalizeCode(code));
    return !!n && n.end;
  }

  startsWith(prefix) {
    return this.#walk(normalizeCode(prefix)) !== null;
  }

  /** Add historical counts for a code; counts are added to every node on the path. */
  recordCounts(code, tries, successes) {
    const w = normalizeCode(code);
    if (!w || tries < 0 || successes < 0 || successes > tries) return false;
    this.insert(w);
    let n = this.root;
    for (const ch of w) {
      n = n.children.get(ch);
      n.tries += tries;
      n.successes += successes;
    }
    return true;
  }

  record(code, success) {
    return this.recordCounts(code, 1, success ? 1 : 0);
  }

  /**
   * Smoothed success probability for a code: uses the deepest node on the code's path that has at
   * least `minTries` observations, with Laplace smoothing. Falls back to `fallback` when nothing is known.
   */
  prior(code, { alpha = 1, beta = 1, minTries = 3, fallback = 0.2 } = {}) {
    const w = normalizeCode(code);
    let n = this.root;
    let best = null;
    for (const ch of w) {
      n = n.children.get(ch);
      if (!n) break;
      if (n.tries >= minTries) best = n;
    }
    if (!best) return fallback;
    return (best.successes + alpha) / (best.tries + alpha + beta);
  }
}
