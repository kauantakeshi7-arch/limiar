/**
 * Color — HSL/RGB color utilities with alpha support.
 * Colors are represented as plain objects: { h, s, l, a } (HSL) or strings.
 */
export class Color {
  /**
   * @param {number} h - Hue (0–360)
   * @param {number} s - Saturation (0–100)
   * @param {number} l - Lightness (0–100)
   * @param {number} a - Alpha (0–1)
   */
  constructor(h, s, l, a = 1) {
    this.h = h;
    this.s = s;
    this.l = l;
    this.a = a;
  }

  // ── Output formats ────────────────────────────────────────────────────────

  toHSLA() {
    return `hsla(${Math.round(this.h)}, ${Math.round(this.s)}%, ${Math.round(this.l)}%, ${this.a < 1 ? (this.a <= 0 ? 0 : this.a.toFixed(3)) : 1})`;
  }

  toHSLAWithAlpha(a) {
    return `hsla(${Math.round(this.h)}, ${Math.round(this.s)}%, ${Math.round(this.l)}%, ${a < 1 ? (a <= 0 ? 0 : a.toFixed(3)) : 1})`;
  }

  toGlowHSLA(intensity = 0.5) {
    const s = Math.min(100, Math.round(this.s + 20));
    const l = Math.min(95, Math.round(this.l + 30 * intensity));
    return `hsla(${Math.round(this.h)}, ${s}%, ${l}%, ${this.a < 1 ? (this.a <= 0 ? 0 : this.a.toFixed(3)) : 1})`;
  }

  toGlowHSLAWithAlpha(intensity = 0.5, a = 1) {
    const s = Math.min(100, Math.round(this.s + 20));
    const l = Math.min(95, Math.round(this.l + 30 * intensity));
    return `hsla(${Math.round(this.h)}, ${s}%, ${l}%, ${a < 1 ? (a <= 0 ? 0 : a.toFixed(3)) : 1})`;
  }

  toOuterHSLA() {
    const l = Math.max(5, Math.round(this.l - 16));
    return `hsla(${Math.round(this.h)}, ${Math.round(this.s)}%, ${l}%, ${this.a < 1 ? (this.a <= 0 ? 0 : this.a.toFixed(3)) : 1})`;
  }

  set(h, s, l, a = 1) {
    this.h = h;
    this.s = s;
    this.l = l;
    this.a = a;
    return this;
  }

  copy(other) {
    this.h = other.h;
    this.s = other.s;
    this.l = other.l;
    this.a = other.a;
    return this;
  }

  withAlpha(a) { return new Color(this.h, this.s, this.l, a); }
  withLightness(l) { return new Color(this.h, this.s, l, this.a); }
  withSaturation(s) { return new Color(this.h, s, this.l, this.a); }

  // ── Blending ──────────────────────────────────────────────────────────────

  /**
   * Linearly interpolate toward another Color (creates a new Color).
   * @param {Color} to
   * @param {number} t - 0 = this, 1 = to
   */
  lerp(to, t) {
    // Shortest-path hue interpolation
    let dh = to.h - this.h;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;

    const newH = ((this.h + dh * t) % 360 + 360) % 360;
    return new Color(
      newH,
      Math.max(0, Math.min(100, this.s + (to.s - this.s) * t)),
      Math.max(0, Math.min(100, this.l + (to.l - this.l) * t)),
      Math.max(0, Math.min(1, this.a + (to.a - this.a) * t)),
    );
  }

  /**
   * In-place linear interpolation toward another Color (zero-allocation).
   * @param {Color} to
   * @param {number} t - 0 = this, 1 = to
   */
  lerpMut(to, t) {
    let dh = to.h - this.h;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;

    this.h = ((this.h + dh * t) % 360 + 360) % 360;
    this.s = Math.max(0, Math.min(100, this.s + (to.s - this.s) * t));
    this.l = Math.max(0, Math.min(100, this.l + (to.l - this.l) * t));
    this.a = Math.max(0, Math.min(1, this.a + (to.a - this.a) * t));
    return this;
  }

  /**
   * Mix this color with a target by ratio, then adjust lightness and saturation.
   * Used for glow / emission effects.
   */
  glow(intensity = 0.5) {
    return new Color(this.h, Math.min(100, this.s + 20), Math.min(95, this.l + 30 * intensity), this.a);
  }

  clone() { return new Color(this.h, this.s, this.l, this.a); }
  toString() { return this.toHSLA(); }

  // ── Shared Immutable Color Instances (Zero-allocation) ────────────────────
  static LIGHT = Object.freeze(new Color(45, 85, 72));
  static SHADOW = Object.freeze(new Color(275, 88, 62));
  static HYBRID = Object.freeze(new Color(290, 75, 60));
  static TRANSCENDENT_LIGHT = Object.freeze(new Color(48, 100, 85));
  static TRANSCENDENT_SHADOW = Object.freeze(new Color(282, 95, 80));

  // ── Factories ─────────────────────────────────────────────────────────────

  /** Light-zone creature color: warm radiant golden */
  static light() { return Color.LIGHT.clone(); }

  /** Shadow-zone creature color: vibrant bioluminescent royal amethyst */
  static shadow() { return Color.SHADOW.clone(); }

  /** Hybrid creature: luminous violet-gold midpoint */
  static hybrid() { return Color.HYBRID.clone(); }

  /** Transcendent: brilliant aura respecting origin heritage */
  static transcendent(zone = 'light') {
    return zone === 'shadow'
      ? Color.TRANSCENDENT_SHADOW.clone()
      : Color.TRANSCENDENT_LIGHT.clone();
  }

  /** Particle colors */
  static particleLight() { return new Color(45, 90, 80, 0.8); }
  static particleShadow() { return new Color(275, 90, 68, 0.85); }
  static particleTransform() { return new Color(300, 70, 65, 0.9); }
  static particleDust() { return new Color(0, 0, 90, 0.4); }
}
