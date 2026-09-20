import { Config } from '../core/Config.js';
import { globalBus, Events } from '../core/EventEmitter.js';

/**
 * Threshold — The living boundary between the two worlds.
 *
 * The line has spring-physics: it follows the player's drag with resistance,
 * then gently springs back toward center when released.
 * Y positions are in absolute canvas coordinates.
 */
export class Threshold {
  /**
   * @param {number} canvasHeight - Current canvas height in CSS pixels.
   */
  constructor(canvasHeight) {
    this._canvasHeight   = canvasHeight;
    this._targetY        = canvasHeight * Config.WORLD.THRESHOLD_INITIAL_RATIO;
    this._currentY       = this._targetY;
    this._velocity       = 0;

    this._isDragging     = false;
    this._dragPointerY   = 0;
    this._dragStartY     = 0;

    /** Eclipse state: when active, threshold is invisible and zones merge. */
    this.eclipseActive   = false;
    this.eclipseAlpha    = 1; // 1 = visible, 0 = eclipsed

    /** Active harp wave impulses propagating across the membrane. */
    this.harpWaves       = [];

    /** Living bioluminescent flora anchored along the membrane. */
    const count = Config.ECOSYSTEM?.FLORA_COUNT || 24;
    this.flora = Array.from({ length: count }, (_, i) => {
      const u = (i + 0.5) / count;
      const side = i % 2 === 0 ? -1 : 1; // -1 = grows up (light), 1 = grows down (shadow)
      return {
        u,
        side,
        height: 36 + (i % 3) * 8 + Math.random() * 10,
        baseAngle: (Math.random() - 0.5) * 0.18,
        angle: 0,
        swayPhase: Math.random() * Math.PI * 2,
        swaySpeed: 0.0014 + Math.random() * 0.0008,
        sporeTimer: Math.random() * 4000,
      };
    });
    this._releasedFloraScratch = [];
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  /** Current Y position of the threshold line in canvas pixels. */
  get y() { return this._currentY; }

  /** The band around the threshold where creatures can be HYBRID. */
  get band() { return Config.WORLD.THRESHOLD_BAND; }

  get topBound() { return this._currentY - this.band; }
  get bottomBound() { return this._currentY + this.band; }

  /** Current displacement velocity (pixels/frame). */
  get velocity() { return this._velocity; }

  /** Whether the player is currently holding/dragging the threshold. */
  get isDragging() { return this._isDragging; }

  /** Resize — recalculate absolute Y when the canvas is resized. */
  onResize(newHeight) {
    const ratio = this._currentY / this._canvasHeight;
    this._canvasHeight = newHeight;
    this._currentY = ratio * newHeight;
    this._targetY  = ratio * newHeight;
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  /**
   * Begin dragging the threshold.
   * @param {number} pointerY - Canvas-space Y of the pointer.
   */
  startDrag(pointerY) {
    // Allow drag if pointer is near the threshold line (68px radius for ergonomic touch targets on mobile)
    if (Math.abs(pointerY - this._currentY) > 68) return;
    this._isDragging   = true;
    this._dragPointerY = pointerY;
    this._dragStartY   = this._currentY;
    this._velocity     = 0;
  }

  /** Update the drag — call on every pointer-move event. */
  moveDrag(pointerY) {
    if (!this._isDragging) return;
    const delta = pointerY - this._dragPointerY;
    this._targetY = this._dragStartY + delta;
    this._clampTarget();
  }

  /** Release the threshold — spring-back begins. */
  endDrag() {
    this._isDragging = false;
  }

  /**
   * Add a harp pluck impulse at a specific horizontal ratio.
   * @param {number} xRatio - 0..1
   * @param {number} [intensity=1.0]
   */
  addHarpImpulse(xRatio, intensity = 1.0) {
    if (this.harpWaves.length >= 8) {
      for (let i = 0; i < this.harpWaves.length - 1; i++) {
        this.harpWaves[i] = this.harpWaves[i + 1];
      }
      this.harpWaves.length = 7;
    }
    this.harpWaves.push({
      xRatio,
      intensity,
      radius: 0,
      life: 1.0,
      speed: 0.75, // px per ms
    });
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  /**
   * Advance the threshold physics, harp waves, and flora kinematics.
   * @param {number} [dt=16]
   * @param {{ x:number, y:number }} [wind]
   * @param {Array<import('../entities/Creature.js').Creature>} [creatures]
   * @param {number} [canvasWidth=1200]
   */
  update(dt = 16, wind = { x: 0, y: 0 }, creatures = [], canvasWidth = 1200) {
    if (!this._isDragging) {
      // Spring gently back toward vertical center.
      const center = this._canvasHeight * Config.WORLD.THRESHOLD_INITIAL_RATIO;
      this._targetY += (center - this._targetY) * Config.WORLD.THRESHOLD_SPRING * 0.15;
    }

    // Apply resistance — smooth interpolation toward target.
    const prev = this._currentY;
    this._currentY += (this._targetY - this._currentY) * Config.WORLD.THRESHOLD_RESISTANCE;
    this._velocity = this._currentY - prev;

    const moved = Math.abs(this._velocity);
    if (moved > 0.3) {
      globalBus.emit(Events.THRESHOLD_MOVED, this._currentY);
    }

    // Eclipse alpha fade
    if (this.eclipseActive) {
      this.eclipseAlpha = Math.max(0, this.eclipseAlpha - 0.015);
    } else {
      this.eclipseAlpha = Math.min(1, this.eclipseAlpha + 0.005);
    }

    // Advance harp wave impulses and prune in-place without array reallocation
    let hwWriteIdx = 0;
    for (let i = 0; i < this.harpWaves.length; i++) {
      const hw = this.harpWaves[i];
      hw.radius += hw.speed * dt;
      hw.life   -= dt * 0.0009;
      if (hw.life > 0) {
        this.harpWaves[hwWriteIdx++] = hw;
      }
    }
    this.harpWaves.length = hwWriteIdx;

    // Advance flora reeds
    const windPush = (wind.x || 0) * 0.35;
    const velocityPush = this._velocity * 0.035;

    for (let r = 0; r < this.flora.length; r++) {
      const reed = this.flora[r];
      reed.swayPhase += reed.swaySpeed * dt;
      const naturalSway = Math.sin(reed.swayPhase) * 0.18;
      let targetAngle = reed.baseAngle + naturalSway + windPush - velocityPush;

      // Deflection by nearby swimming creatures (zero allocation indexed loop)
      const rx = reed.u * canvasWidth;
      const ry = this._currentY;
      for (let c = 0; c < creatures.length; c++) {
        const cr = creatures[c];
        if (!cr.isAlive) continue;
        const dx = rx - cr.position.x;
        const dy = ry - cr.position.y;
        if (dx * dx + dy * dy < 3600) {
          targetAngle += dx > 0 ? 0.38 : -0.38;
        }
      }

      reed.angle += (targetAngle - reed.angle) * 0.09;
      if (reed.sporeCooldown > 0) {
        reed.sporeCooldown -= dt;
      }
    }
  }

  /**
   * Brush across flora reeds with finger/pointer, causing deflection and releasing nutritious spores.
   * @param {number} px - Pointer X in canvas space.
   * @param {number} py - Pointer Y in canvas space.
   * @param {number} canvasWidth
   * @returns {Array<{x:number, y:number, side:number}>}
   */
  brushFlora(px, py, canvasWidth) {
    const released = this._releasedFloraScratch;
    released.length = 0;
    if (Math.abs(py - this._currentY) > 52) return released;

    for (let i = 0; i < this.flora.length; i++) {
      const reed = this.flora[i];
      const rx = reed.u * canvasWidth;
      const dx = px - rx;
      if (Math.abs(dx) < (Config.INTERACTION_EXPANDED?.FLORA_BRUSH_RADIUS || 42)) {
        // Deflect reed in direction of stroke
        reed.angle += dx > 0 ? 0.45 : -0.45;

        // Release glowing living spore if cooldown expired
        if (!reed.sporeCooldown || reed.sporeCooldown <= 0) {
          reed.sporeCooldown = 2800; // ms cooldown per reed
          released.push({
            x: rx + (Math.random() - 0.5) * 8,
            y: this._currentY + reed.side * 18,
            side: reed.side,
          });
        }
      }
    }
    return released;
  }

  // ── Zone helpers ──────────────────────────────────────────────────────────

  /**
   * Determine which zone a Y coordinate falls into.
   * @param {number} y - Canvas-space Y.
   * @returns {'light'|'shadow'|'threshold'}
   */
  getZoneAtY(y) {
    if (y < this.topBound)    return Config.ZONE.LIGHT;
    if (y > this.bottomBound) return Config.ZONE.SHADOW;
    return Config.ZONE.THRESHOLD;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _clampTarget() {
    const margin = 80; // prevent pushing too far toward edges
    this._targetY = Math.max(margin, Math.min(this._canvasHeight - margin, this._targetY));
  }
}
