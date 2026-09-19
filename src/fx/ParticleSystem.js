import { Vector2 } from '../utils/Vector2.js';
import { Color } from '../utils/Color.js';
import { Random } from '../utils/Random.js';
import { Config } from '../core/Config.js';

/**
 * Particle — A single pooled visual effect particle.
 * Kept as a plain data class for cache efficiency.
 */
export class Particle {
  constructor() {
    this.active    = false;
    this.x         = 0;
    this.y         = 0;
    this.vx        = 0;
    this.vy        = 0;
    this.radius    = 2;
    this.color     = new Color(0, 0, 100);
    this.alpha     = 1;
    this.life      = 0;  // [0, 1] — 1 = just spawned, 0 = dead
    this.lifespan  = Config.PARTICLES.LIFESPAN_MS;
    this.fadeStart = 0.4; // alpha starts fading when life < fadeStart
    this.gravity   = 0;
    this.drag      = 0.97;
  }

  /** Reset and activate this particle for reuse from the pool. */
  init({ x, y, vx, vy, radius, color, lifespan, fadeStart, gravity }) {
    this.active    = true;
    this.x         = x;
    this.y         = y;
    this.vx        = vx   ?? 0;
    this.vy        = vy   ?? 0;
    this.radius    = radius ?? 2;
    this.color     = color ?? new Color(0, 0, 100);
    this.hsla      = this.color.toHSLA();
    this.alpha     = 1;
    this.life      = 1;
    this.lifespan  = lifespan  ?? Config.PARTICLES.LIFESPAN_MS;
    this.fadeStart = fadeStart ?? 0.4;
    this.gravity   = gravity   ?? 0;
    this.drag      = 0.97;
    return this;
  }

  /** Update particle state. @param {number} dt - Delta time in ms. */
  update(dt) {
    if (!this.active) return;

    this.life -= dt / this.lifespan;
    if (this.life <= 0) {
      this.active = false;
      return;
    }

    // Velocity integration
    this.vy += this.gravity * dt;
    this.vx *= this.drag;
    this.vy *= this.drag;
    this.x  += this.vx * dt * 0.06;
    this.y  += this.vy * dt * 0.06;

    // Fade alpha in the tail portion of life
    if (this.life < this.fadeStart) {
      this.alpha = this.life / this.fadeStart;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * ParticleSystem — Object-pooled particle manager.
 * Pre-allocates all particles to avoid GC pressure during gameplay.
 */
export class ParticleSystem {
  constructor() {
    /** @type {Particle[]} */
    this._pool = Array.from({ length: Config.PARTICLES.POOL_SIZE }, () => new Particle());
    this._poolIndex = 0;
    /** @type {Particle[]} Reusable active particles array to eliminate GC allocation on every frame. */
    this._activeList = [];
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Update all active particles and maintain reusable active list. @param {number} dt - Delta in ms. */
  update(dt) {
    this._activeList.length = 0;
    for (let i = 0; i < this._pool.length; i++) {
      const p = this._pool[i];
      if (p.active) {
        p.update(dt);
        if (p.active) {
          this._activeList.push(p);
        }
      }
    }
  }

  /** Get all currently active particles (reusable array, zero allocation). */
  get active() {
    return this._activeList;
  }

  // ── Emitters ──────────────────────────────────────────────────────────────

  /** Burst emitted when a creature begins transforming. */
  emitTransformBurst(x, y, color) {
    const count = Config.PARTICLES.TRANSFORM_BURST;
    for (let i = 0; i < count; i++) {
      const angle = Random.float(0, Math.PI * 2);
      const speed = Random.float(0.5, 2.5);
      this._spawn({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Random.float(1.5, 4),
        color: color.withAlpha(0.85),
        lifespan: Random.float(800, 2000),
        fadeStart: 0.5,
        gravity: -0.003,
      });
    }
  }

  /** Burst emitted when a creature dissolves. */
  emitDissolveBurst(x, y, color) {
    const count = Config.PARTICLES.DISSOLVE_BURST;
    for (let i = 0; i < count; i++) {
      const angle = Random.float(0, Math.PI * 2);
      const speed = Random.float(0.2, 1.8);
      this._spawn({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.5,
        radius: Random.float(1, 3.5),
        color: color.withAlpha(0.6),
        lifespan: Random.float(1200, 2800),
        fadeStart: 0.7,
        gravity: 0.001,
      });
    }
  }

  /** Spectacular burst for transcendence. */
  emitTranscendBurst(x, y) {
    const count = Config.PARTICLES.TRANSCEND_BURST;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Random.float(-0.3, 0.3);
      const speed = Random.float(1, 4);
      this._spawn({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Random.float(2, 6),
        color: Color.transcendent().withAlpha(0.9),
        lifespan: Random.float(1500, 3500),
        fadeStart: 0.6,
        gravity: -0.004,
      });
    }
  }

  /** Ambient fog along the threshold line. Call each frame. */
  emitThresholdAmbient(thresholdY, canvasWidth) {
    const count = Config.PARTICLES.THRESHOLD_AMBIENT;
    for (let i = 0; i < count; i++) {
      const x = Random.float(0, canvasWidth);
      const side = Random.chance(0.5) ? -1 : 1;
      this._spawn({
        x,
        y: thresholdY + Random.float(-8, 8),
        vx: Random.float(-0.2, 0.2),
        vy: side * Random.float(0.1, 0.5),
        radius: Random.float(1, 3),
        color: new Color(280, 50, 70, 0.5),
        lifespan: Random.float(1000, 2500),
        fadeStart: 0.5,
      });
    }
  }

  /** Explosion when two creatures collide. */
  emitExplosion(x, y, colorA, colorB) {
    const count = 20;
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const angle = Random.float(0, Math.PI * 2);
      const speed = Random.float(0.8, 3);
      this._spawn({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Random.float(2, 5),
        color: colorA.lerp(colorB, t).withAlpha(0.9),
        lifespan: Random.float(600, 1600),
        fadeStart: 0.6,
        gravity: 0.002,
      });
    }
  }

  /** Dream mote emitted by a peacefully sleeping creature. */
  emitDreamMote(x, y, color) {
    this._spawn({
      x: x + Random.float(-6, 6),
      y: y + Random.float(-6, 6),
      vx: Random.float(-0.15, 0.15),
      vy: -Random.float(0.18, 0.45),
      radius: Random.float(1.5, 3.2),
      color: color.withAlpha(0.65).withLightness(85),
      lifespan: Random.float(1600, 2800),
      fadeStart: 0.6,
      gravity: -0.001,
    });
  }

  /** Inward swirl particle when player holds to condense celestial nectar. */
  emitNectarSwirl(x, y) {
    const angle = Random.float(0, Math.PI * 2);
    const dist = Random.float(25, 45);
    const sx = x + Math.cos(angle) * dist;
    const sy = y + Math.sin(angle) * dist;
    const tangent = angle + Math.PI / 2 + 0.3;
    this._spawn({
      x: sx, y: sy,
      vx: -Math.cos(angle) * 0.8 + Math.cos(tangent) * 0.4,
      vy: -Math.sin(angle) * 0.8 + Math.sin(tangent) * 0.4,
      radius: Random.float(1.2, 2.5),
      color: new Color(Random.float(40, 55), 90, 80, 0.8),
      lifespan: Random.float(400, 800),
      fadeStart: 0.5,
    });
  }

  /** Joyous burst of light when a creature feeds on celestial nectar. */
  emitNectarFeedBurst(x, y) {
    const count = 10;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Random.float(-0.2, 0.2);
      const speed = Random.float(0.6, 1.8);
      this._spawn({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Random.float(1.8, 3.5),
        color: new Color(Random.float(45, 60), 95, 75, 0.9),
        lifespan: Random.float(600, 1200),
        fadeStart: 0.6,
      });
    }
  }

  /** Glowing spore released by flora reeds along the threshold membrane. */
  emitFloraSpore(x, y, dirY = -1) {
    this._spawn({
      x: x + Random.float(-3, 3),
      y: y + dirY * 4,
      vx: Random.float(-0.2, 0.2),
      vy: dirY * Random.float(0.2, 0.55),
      radius: Random.float(1.0, 2.2),
      color: new Color(dirY < 0 ? Random.float(50, 75) : Random.float(260, 290), 80, 80, 0.7),
      lifespan: Random.float(1500, 3000),
      fadeStart: 0.5,
      gravity: dirY * -0.0008,
    });
  }

  // ── Pool management ───────────────────────────────────────────────────────

  _spawn(options) {
    // Walk pool until we find an inactive slot (wrap-around).
    const size = this._pool.length;
    for (let tries = 0; tries < size; tries++) {
      const p = this._pool[this._poolIndex];
      this._poolIndex = (this._poolIndex + 1) % size;
      if (!p.active) {
        p.init(options);
        return p;
      }
    }
    // Pool exhausted — evict the oldest (current index) and reuse.
    const p = this._pool[this._poolIndex];
    this._poolIndex = (this._poolIndex + 1) % size;
    p.init(options);
    return p;
  }
}
