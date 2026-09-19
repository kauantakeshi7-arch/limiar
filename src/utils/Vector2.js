/**
 * Vector2 — Immutable-friendly 2D vector math.
 * All operations return new instances; originals are never mutated.
 */
export class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  // ── Arithmetic ────────────────────────────────────────────────────────────

  add(v) { return new Vector2(this.x + v.x, this.y + v.y); }
  sub(v) { return new Vector2(this.x - v.x, this.y - v.y); }
  scale(s) { return new Vector2(this.x * s, this.y * s); }
  div(s) { return s !== 0 ? new Vector2(this.x / s, this.y / s) : Vector2.zero(); }

  // ── Measurement ──────────────────────────────────────────────────────────

  get magnitude() { return Math.hypot(this.x, this.y); }
  get magnitudeSq() { return this.x * this.x + this.y * this.y; }

  distanceTo(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  distanceSqTo(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return dx * dx + dy * dy;
  }
  dot(v) { return this.x * v.x + this.y * v.y; }

  // ── Transformation ────────────────────────────────────────────────────────

  normalize() {
    const m = this.magnitude;
    return m > 0 ? this.div(m) : Vector2.zero();
  }

  /** Clamp magnitude to maxLen without allocating if already within bounds. */
  clampMagnitude(maxLen) {
    const m = this.magnitude;
    return m > maxLen ? this.scale(maxLen / m) : this;
  }

  lerp(v, t) {
    return new Vector2(
      this.x + (v.x - this.x) * t,
      this.y + (v.y - this.y) * t,
    );
  }

  rotate(angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return new Vector2(this.x * cos - this.y * sin, this.x * sin + this.y * cos);
  }

  /** Angle in radians this vector points toward. */
  get angle() { return Math.atan2(this.y, this.x); }
  heading() { return Math.atan2(this.y, this.x); }

  /** Return a perpendicular vector (rotated 90°). */
  perpendicular() { return new Vector2(-this.y, this.x); }

  // ── Factories ─────────────────────────────────────────────────────────────

  static zero() { return new Vector2(0, 0); }
  static one() { return new Vector2(1, 1); }

  static fromAngle(angle, magnitude = 1) {
    return new Vector2(Math.cos(angle) * magnitude, Math.sin(angle) * magnitude);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  clone() { return new Vector2(this.x, this.y); }
  toString() { return `Vector2(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`; }
}
