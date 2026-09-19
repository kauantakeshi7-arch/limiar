/**
 * Random — Deterministic and non-deterministic random utilities.
 * Uses the Mulberry32 algorithm for seedable sequences.
 */
export class Random {
  /**
   * @param {number} [seed] - Optional seed. If omitted, uses Math.random().
   */
  constructor(seed) {
    this._seeded = seed !== undefined;
    if (this._seeded) {
      this._state = seed >>> 0;
    }
  }

  // ── Core RNG ──────────────────────────────────────────────────────────────

  /** Returns a float in [0, 1). */
  next() {
    if (!this._seeded) return Math.random();

    // Mulberry32
    this._state = (this._state + 0x6d2b79f5) >>> 0;
    let z = this._state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }

  // ── Derived utilities ─────────────────────────────────────────────────────

  /** Float in [min, max). */
  float(min, max) { return min + this.next() * (max - min); }

  /** Integer in [min, max] (inclusive). */
  int(min, max) { return Math.floor(this.float(min, max + 1)); }

  /** Boolean with a given probability of being true. */
  chance(probability) { return this.next() < probability; }

  /** Pick a random element from an array. */
  choice(array) { return array[this.int(0, array.length - 1)]; }

  /** Gaussian (normal) distribution using Box-Muller. */
  gaussian(mean = 0, std = 1) {
    const u1 = this.next() || 1e-10; // avoid log(0)
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * std;
  }

  /** Shuffle an array in-place (Fisher-Yates). Returns the same array. */
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /** Weighted random choice. weights and items must have the same length. */
  weighted(items, weights) {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  // ── Global convenience instance ───────────────────────────────────────────

  static _global = new Random();

  static float(min, max) { return Random._global.float(min, max); }
  static int(min, max) { return Random._global.int(min, max); }
  static chance(p) { return Random._global.chance(p); }
  static choice(arr) { return Random._global.choice(arr); }
  static gaussian(mean, std) { return Random._global.gaussian(mean, std); }
  static next() { return Random._global.next(); }
}
