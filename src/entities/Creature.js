import { Vector2 } from '../utils/Vector2.js';
import { Color } from '../utils/Color.js';
import { Random } from '../utils/Random.js';
import { DNA } from './DNA.js';
import { Config } from '../core/Config.js';

let _nextId = 0;

/** All possible creature lifecycle states. */
export const CreatureState = Object.freeze({
  NATIVE:       'native',
  CROSSING:     'crossing',
  TRANSFORMED:  'transformed',
  HYBRID:       'hybrid',
  TRANSCENDENT: 'transcendent',
  DISSOLVING:   'dissolving',
  SYMBIOTIC:    'symbiotic',
  WITNESS:      'witness',
});

/**
 * Creature — The central entity of LIMIAR.
 *
 * Stores biology (DNA), position, velocity, state, visual history (trail),
 * and blob shape data. Systems mutate it; Renderer reads it.
 */
export class Creature {
  constructor({ position, zone, dna, name }) {
    this.id           = `c${_nextId++}`;
    this.position     = position.clone();
    this.velocity     = Vector2.fromAngle(Random.float(0, Math.PI * 2), 0.5);
    this.zone         = zone;
    this.originZone   = zone;
    this.dna          = dna ?? DNA.random();
    this.name         = name ?? Creature._generateName();
    this.state        = CreatureState.NATIVE;
    this.previousState = CreatureState.NATIVE;

    // ── Size ──────────────────────────────────────────────────────────────
    this.baseRadius   = Config.CREATURE.BASE_RADIUS * this.dna.sizeModifier;
    this.radius       = this.baseRadius;

    // ── Transformation ─────────────────────────────────────────────────────
    this.transformProgress  = 0;
    this.crossingStartTime  = 0;
    this.crossingCount      = 0;

    // ── Steering ───────────────────────────────────────────────────────────
    this.wanderTarget = Vector2.fromAngle(Random.float(0, Math.PI * 2));

    // ── Blob shape ──────────────────────────────────────────────────────────
    /**
     * blobStyle: 'smooth' = light (rounded, gentle waves)
     *            'spiky'  = shadow (irregular, concave pockets + sharp tips)
     */
    this.blobStyle   = zone === Config.ZONE.LIGHT ? 'smooth' : 'spiky';
    this.blobAngles  = Creature._makeBlobAngles();
    this.blobPhases  = Array.from({ length: Config.CREATURE.BLOB_POINTS }, () => Random.float(0, Math.PI * 2));
    this.blobNoise   = new Array(Config.CREATURE.BLOB_POINTS).fill(0);
    /** Secondary harmonic phases for shadow creatures' irregular spikes. */
    this.blobPhases2 = Array.from({ length: Config.CREATURE.BLOB_POINTS }, () => Random.float(0, Math.PI * 2));
    /** Pre-allocated cached blob points to eliminate 18,000+ Vector2 allocations/sec. */
    this._cachedBlobPoints = Array.from({ length: Config.CREATURE.BLOB_POINTS }, () => ({ x: 0, y: 0 }));

    // ── Visuals ─────────────────────────────────────────────────────────────
    this.color       = Creature._baseColorForZone(zone);
    this.targetColor = this.color.clone();

    // ── Motion trail ─────────────────────────────────────────────────────────
    /** Array of { x, y } — most recent last. Capped at TRAIL_LENGTH. */
    this._trail          = [];
    this._trailFrameCount = 0;
    /** Pixels of displacement before a new trail point is recorded. */
    this._trailMinDist   = 4;

    // ── Interaction ────────────────────────────────────────────────────────
    this.bondedWith           = null;
    this.interactionCooldowns = new Map();

    // ── State flags ─────────────────────────────────────────────────────────
    this.isAlive          = true;
    this.witnessTimer     = 0;
    this.singularityGrow  = false;

    // ── Natural lifecycle ─────────────────────────────────────────────────
    /** Time alive in ms. */
    this.age    = 0;
    /** Time in ms until natural decline begins (randomized 3–7 minutes). */
    this.maxAge = Random.float(180_000, 420_000);
    /** True when the creature has entered its natural decline phase. */
    this.isAging = false;

    // ── Metabolism ──────────────────────────────────────────────────────────
    /** Visual pulse [0..1] triggered when consuming ambient motes. */
    this.metabolicFlash = 0;

    // ── Sleep & Dreams ──────────────────────────────────────────────────────
    this.isSleeping   = false;
    this.peacefulTime = 0; // ms without disturbance/crossing
    this.sleepBreath  = 0;
    this.dreamTimer   = 0;

    // ── Border Courtship Dance (Dança dos Opostos) ──────────────────────────
    this.isDancing     = false;
    /** @type {Creature|null} */
    this.dancePartner  = null;
    this.danceTimeLeft = 0;
    this.danceAngle    = 0;

    // ── Discovery ──────────────────────────────────────────────────────────
    this.discovered = false;
  }

  // ── Sleep & Dance Methods ──────────────────────────────────────────────────

  sleep() {
    if (this.isSleeping || this.state === CreatureState.CROSSING || this.state === CreatureState.DISSOLVING) return;
    this.isSleeping = true;
    this.peacefulTime = 0;
    this.sleepBreath = 0;
  }

  wake() {
    if (!this.isSleeping) return;
    this.isSleeping = false;
    this.peacefulTime = 0;
    this.metabolicFlash = 0.8; // spark of joyful waking
  }

  startDance(partner, durationMs) {
    if (this.isDancing || partner.isDancing) return;
    this.isDancing = true;
    this.dancePartner = partner;
    this.danceTimeLeft = durationMs;
    this.danceAngle = Math.random() * Math.PI * 2;
    this.wake();
  }

  endDance() {
    this.isDancing = false;
    this.dancePartner = null;
    this.danceTimeLeft = 0;
  }

  // ── Trail ──────────────────────────────────────────────────────────────────

  /** Record current position into the trail history. Call once per frame. */
  pushTrail() {
    const maxLen = 14;
    const last   = this._trail[this._trail.length - 1];
    if (last) {
      const dx = this.position.x - last.x;
      const dy = this.position.y - last.y;
      if (dx * dx + dy * dy < this._trailMinDist * this._trailMinDist) return;
    }
    this._trail.push({ x: this.position.x, y: this.position.y });
    if (this._trail.length > maxLen) this._trail.shift();
  }

  /** Read-only trail positions (oldest first). */
  get trail() { return this._trail; }

  // ── Zone helpers ──────────────────────────────────────────────────────────

  get isInHomeZone() { return this.zone === this.originZone; }
  get isInForeignZone() {
    return this.zone !== this.originZone && this.zone !== Config.ZONE.THRESHOLD;
  }

  // ── Blob shape ────────────────────────────────────────────────────────────

  /**
   * Recompute blob noise values for the current timestamp.
   * Light creatures: smooth sine — organic & soft.
   * Shadow creatures: layered irregular spikes with concave pockets.
   */
  updateBlob(time) {
    const amp = Config.CREATURE.BLOB_NOISE_AMPLITUDE;

    for (let i = 0; i < Config.CREATURE.BLOB_POINTS; i++) {
      if (this.blobStyle === 'smooth') {
        // Gentle layered sine for a pillowy feel
        const primary   = Math.sin(time * this.dna.breatheSpeed + this.blobPhases[i]);
        const secondary = Math.sin(time * this.dna.breatheSpeed * 2.1 + this.blobPhases[i] * 1.3) * 0.3;
        this.blobNoise[i] = (primary + secondary) * amp;
      } else {
        // Shadow: irregular — some points spike outward, others dip concave
        const spike = (i % 3 === 0) ? 1.6 : (i % 3 === 1) ? -0.4 : 0.9;
        const primary   = Math.sin(time * this.dna.breatheSpeed * 1.8 + this.blobPhases[i]) * spike;
        const secondary = Math.sin(time * this.dna.breatheSpeed * 3.2 + this.blobPhases2[i]) * 0.5;
        this.blobNoise[i] = (primary + secondary) * amp;
      }

      // During transformation: blend toward opposite style
      if (this.transformProgress > 0) {
        const targetNoise = this.blobNoise[i] * (1 - this.transformProgress);
        this.blobNoise[i] = this.blobNoise[i] * this.transformProgress + targetNoise;
      }
    }
  }

  /**
   * Consume an ambient energy particle — micro-growth and luminosity flash.
   */
  feed() {
    this.metabolicFlash = 1.0;
    if (this.radius < Config.CREATURE.MAX_RADIUS) {
      this.radius = Math.min(Config.CREATURE.MAX_RADIUS, this.radius + 0.12);
      this.baseRadius = this.radius;
    }
  }

  getBlobPoints(time) {
    this.updateBlob(time);

    // Soft-body jellyfish squash & stretch based on movement velocity
    const speed = this.velocity.magnitude;
    const hasMotion = speed > 0.06;
    const moveAngle = hasMotion ? Math.atan2(this.velocity.y, this.velocity.x) : 0;
    const stretch = hasMotion ? Math.min(speed * 0.32, 0.42) : 0;
    const sx = 1 + stretch;
    const sy = 1 / Math.sqrt(sx); // preserve apparent volume

    const cosM = Math.cos(moveAngle);
    const sinM = Math.sin(moveAngle);

    const sleepBreathe = this.isSleeping ? 1 + Math.sin(time * 0.0018) * 0.12 : 1;
    const px = this.position.x;
    const py = this.position.y;
    const pts = this._cachedBlobPoints;

    for (let i = 0; i < Config.CREATURE.BLOB_POINTS; i++) {
      const angle = this.blobAngles[i];
      const r = Math.max(1, this.radius * (1 + this.blobNoise[i]) * sleepBreathe);
      const pt = pts[i];

      if (!hasMotion) {
        pt.x = px + Math.cos(angle) * r;
        pt.y = py + Math.sin(angle) * r;
      } else {
        const relAngle = angle - moveAngle;
        const lx = Math.cos(relAngle) * r * sx;
        const ly = Math.sin(relAngle) * r * sy;
        pt.x = px + (lx * cosM - ly * sinM);
        pt.y = py + (lx * sinM + ly * cosM);
      }
    }

    return pts;
  }

  // ── Color ──────────────────────────────────────────────────────────────────

  refreshTargetColor() {
    switch (this.state) {
      case CreatureState.NATIVE:
        this.targetColor = Creature._baseColorForZone(this.originZone);
        break;
      case CreatureState.CROSSING:
        this.targetColor = Creature._baseColorForZone(this.originZone)
          .lerp(Creature._baseColorForZone(this._foreignZone), this.transformProgress);
        break;
      case CreatureState.TRANSFORMED:
        this.targetColor = Creature._baseColorForZone(this._foreignZone);
        break;
      case CreatureState.HYBRID:
        this.targetColor = Color.hybrid();
        break;
      case CreatureState.TRANSCENDENT:
        this.targetColor = Color.transcendent(this.originZone);
        break;
      case CreatureState.DISSOLVING:
        this.targetColor = this.color.withAlpha(Math.max(0, this.color.a - 0.008));
        break;
    }
  }

  get _foreignZone() {
    return this.originZone === Config.ZONE.LIGHT ? Config.ZONE.SHADOW : Config.ZONE.LIGHT;
  }

  // ── State ──────────────────────────────────────────────────────────────────

  transitionTo(newState) {
    this.previousState = this.state;
    this.state         = newState;
    this.refreshTargetColor();
  }

  // ── Statics ────────────────────────────────────────────────────────────────

  static _makeBlobAngles() {
    const n = Config.CREATURE.BLOB_POINTS;
    // Shadow creatures get slightly randomized angle offsets for irregular silhouette
    return Array.from({ length: n }, (_, i) => (i / n) * Math.PI * 2);
  }

  static _baseColorForZone(zone) {
    return zone === Config.ZONE.LIGHT ? Color.light() : Color.shadow();
  }

  static _generateName() {
    const p = Random.choice(Config.CREATURE.NAME_PREFIXES);
    const s = Random.choice(Config.CREATURE.NAME_SUFFIXES);
    return `${p}${s}`;
  }
}
