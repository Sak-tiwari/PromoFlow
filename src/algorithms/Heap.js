// Binary heaps. push/pop O(log N), peek O(1), build from array O(N) (heapify).
// Ties are broken by insertion order, so results are deterministic.

export class Heap {
  /** @param before (a, b) => number; negative when `a` must be closer to the top than `b`. */
  constructor(before, items = []) {
    this.before = before;
    this.seq = 0;
    this.a = items.map((item) => ({ item, seq: this.seq++ }));
    for (let i = (this.a.length >> 1) - 1; i >= 0; i--) this.#down(i);
  }

  get size() {
    return this.a.length;
  }

  #less(i, j) {
    const c = this.before(this.a[i].item, this.a[j].item);
    return c < 0 || (c === 0 && this.a[i].seq < this.a[j].seq);
  }

  #swap(i, j) {
    [this.a[i], this.a[j]] = [this.a[j], this.a[i]];
  }

  #up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.#less(i, p)) break;
      this.#swap(i, p);
      i = p;
    }
  }

  #down(i) {
    const n = this.a.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.#less(l, m)) m = l;
      if (r < n && this.#less(r, m)) m = r;
      if (m === i) break;
      this.#swap(i, m);
      i = m;
    }
  }

  push(item) {
    this.a.push({ item, seq: this.seq++ });
    this.#up(this.a.length - 1);
  }

  peek() {
    return this.a.length ? this.a[0].item : undefined;
  }

  pop() {
    if (!this.a.length) return undefined;
    const top = this.a[0].item;
    const last = this.a.pop();
    if (this.a.length) {
      this.a[0] = last;
      this.#down(0);
    }
    return top;
  }

  /** Non-destructive snapshot of all items in heap order (best first). */
  toSortedArray() {
    return [...this.a]
      .sort((x, y) => this.before(x.item, y.item) || x.seq - y.seq)
      .map((e) => e.item);
  }
}

/** Largest key first. Used to test the highest-probability codes first. */
export class MaxHeap extends Heap {
  constructor(key = (x) => x, items = []) {
    super((a, b) => key(b) - key(a), items);
  }
}

/** Smallest key first. Used for TTL expiry (earliest expiry on top). */
export class MinHeap extends Heap {
  constructor(key = (x) => x, items = []) {
    super((a, b) => key(a) - key(b), items);
  }
}
