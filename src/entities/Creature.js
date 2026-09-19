import { Vector2 } from '../utils/Vector2.js';
import { Color } from '../utils/Color.js';
import { Random } from '../utils/Random.js';
import { DNA } from './DNA.js';
import { Config } from '../core/Config.js';
import { globalBus, Events } from '../core/EventEmitter.js';

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

    // ── Natural lifecycle & Ontogeny ──────────────────────────────────────
    /** Time alive in ms. */
    this.age    = 0;
    /** Time in ms until natural decline begins (randomized 3–7 minutes). */
    this.maxAge = Random.float(180_000, 420_000);
    /** True when the creature has entered its natural decline phase. */
    this.isAging = false;

    /** Ontogeny growth progress [0..1]. 0 = newborn juvenile, 1 = fully grown adult. */
    this.isOffspring    = false;
    this.growthProgress = 1.0;
    this.nutrientBonus  = 0;
    this.lifeStage      = Config.LIFE_STAGE?.ADULT || 'adult';
    this.isAncestral    = false;
    this.ancestralAnnounced = false;

    // ── Zen Bioluminescence & Quorum Sensing ──────────────────────────────
    /** Smooth glow pulse envelope [0..1] for calming quorum communication. */
    this.glowIntensity     = 0;
    /** Cooldown timer (ms) before this creature can echo another light wave. */
    this.lightEchoCooldown = 0;

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

    // ── Generation & Lineage ────────────────────────────────────────────────
    this.generation = 1;

    // ── Artificial Intelligence & Internal Drives ───────────────────────────
    this.energy     = 0.8;                     // [0..1] Hunger/vitality drive
    this.fear       = 0.0;                     // [0..1] Self-preservation urge
    this.sociability = 0.2 + Random.float(0, 0.4); // [0..1] Desire for communion
    this.curiosity  = this.dna.curiosity;       // [0..1] Urge to investigate ripples/touch
    this.fatigue    = 0.05;                    // [0..1] Urge to sleep

    /** Current conscious behavioral decision */
    /** @type {'cruise'|'forage'|'flee'|'court'|'play'|'rest'} */
    this.decision        = 'cruise';
    this.decisionTarget  = null;
    this.decisionTimer   = Random.float(0, 160); // staggered AI evaluation
    this.decisionLockMs  = 0;

    // ── Emotional Memory ────────────────────────────────────────────────────
    this.membraneCaution = 0.0;                // Trauma/fear memory associated with crossing
    /** @type {{x: number, y: number}|null} */
    this.favoriteCoord   = null;               // Beloved coordinate with rich nutrients

    // ── Morphological Skeleton & Articulation (Zero-allocation) ─────────────
    this.facingAngle = this.velocity.heading();
    this.wingPhase   = Random.float(0, Math.PI * 2);
    this.pulsePhase  = Random.float(0, Math.PI * 2);

    /** Pre-allocated chained vertebrae for Serpentine & tail of Manta */
    const maxSegs = 8;
    this.segments = Array.from({ length: maxSegs }, (_, i) => ({
      x: position.x - i * 8,
      y: position.y,
      angle: this.facingAngle,
      radius: this.radius * Math.max(0.25, 1 - (i / maxSegs) * 0.75),
    }));

    /** Pre-allocated tentacles for Jellyfish (up to 5 tentacles, each 5 joints) */
    const maxTentacles = 5;
    const jointsPerTentacle = 5;
    this.tentacles = Array.from({ length: maxTentacles }, () =>
      Array.from({ length: jointsPerTentacle }, () => ({
        x: position.x,
        y: position.y,
        phase: Random.float(0, Math.PI * 2),
      }))
    );

    // ── Legendary Mutation & Traits ─────────────────────────────────────────
    this.legendaryTrait = this.dna.legendaryTrait;
    this.isChimera      = false;

    // ── Live Expressive Thoughts ────────────────────────────────────────────
    this.customThought = null;
    this.customThoughtExpiry = 0;

    // ── Discovery ──────────────────────────────────────────────────────────
    this.discovered = false;
  }

  // ── Morphological & Behavioral Getters ────────────────────────────────────

  get bodyPlan() {
    return this.dna.bodyPlanType;
  }

  get legendaryName() {
    switch (this.legendaryTrait) {
      case 'twin_wings':    return 'Asas de Seda Dupla';
      case 'stellar_halo':  return 'Auréola Estelar';
      case 'abyssal_veins': return 'Veias Abissais Noturnas';
      case 'prism_tail':    return 'Cauda Prisma de Cristal';
      default:              return null;
    }
  }

  get bodyPlanLabel() {
    switch (this.bodyPlan) {
      case Config.BODY_PLAN.MANTA:      return 'Pipa Cósmica';
      case Config.BODY_PLAN.JELLYFISH:  return 'Medusa Abissal';
      case Config.BODY_PLAN.SERPENTINE: return 'Serpente do Limiar';
      case Config.BODY_PLAN.CRYSTAL:    return 'Radiolário Sagrado';
      default:                          return 'Ameba Ancestral';
    }
  }

  get lifeStageLabel() {
    if (this.isAncestral) return 'Ancestral';
    if (this.growthProgress < 0.98) return 'Filhote';
    return 'Adulto';
  }

  /** Temporarily express a conscious thought in the empathy card. */
  expressThought(text, duration = 3500) {
    this.customThought = text;
    this.customThoughtExpiry = performance.now() + duration;
  }

  /** Return poetic, real-time thoughts of the conscious creature. */
  getStatusText() {
    if (this.customThought && performance.now() < this.customThoughtExpiry) {
      return this.customThought;
    }
    if (this.isSleeping) {
      return this.originZone === 'light'
        ? 'Dormindo serenamente, sonhando com o zênite solar...'
        : 'Adormecida no abismo, sonhando com as profundezas estelares...';
    }
    if (this.isDancing) {
      return `Em ressonância harmônica na Dança dos Opostos com ${this.dancePartner?.name || 'um parceiro'}!`;
    }
    if (this.state === CreatureState.SYMBIOTIC) {
      return `Em comunhão de simbiose cósmica com ${this.bondedWith?.name || 'seu par'}.`;
    }
    if (this.state === CreatureState.TRANSCENDENT) {
      return 'Transcendeu a divisão dos mundos e brilha em harmonia absoluta.';
    }

    switch (this.decision) {
      case 'flee':
        return this.membraneCaution > 0.3
          ? 'Recuando cautelosamente do limiar para proteger sua essência.'
          : 'Esquivando-se com agilidade de uma presença imponente.';
      case 'forage':
        return this.energy < 0.35
          ? 'Faminta, farejando o éter em busca de néctar celeste.'
          : 'Navegando graciosamente em direção a nutrientes na água.';
      case 'court':
        return 'Encantada pela presença do mundo oposto, buscando aproximar-se.';
      case 'play':
        return 'Fascinada com sua presença, brincando ao redor do seu toque.';
      case 'rest':
        return 'Fatigada, flutuando calma para recuperar o alento vital.';
      case 'cruise':
      default:
        if (this.isAncestral) {
          return 'Venerável ancião cósmico, coroado por estrelas, guardando a harmonia dos mundos.';
        }
        if (this.lifeStage === (Config.LIFE_STAGE?.JUVENILE || 'juvenile')) {
          return 'Jovem filhote explorando o cosmos com passos ligeiros e olhar curioso.';
        }
        return 'Planando em paz pelas correntes térmicas do seu reino.';
    }
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
    const maxLen = this.isAncestral ? (Config.ONTOGENY?.ANCESTRAL_TRAIL_LENGTH || 24) : 14;
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
   * Consume an ambient energy particle or nectar — micro-growth and vitality replenishment.
   */
  feed() {
    this.energy = Math.min(1.0, this.energy + 0.08);
    this.metabolicFlash = 1.0;
    if (this.growthProgress < 1.0) {
      this.nutrientBonus += Config.SANCTUARIES?.GROWTH_BONUS_SPORE || 0.08;
    }
    if (this.radius < Config.CREATURE.MAX_RADIUS) {
      this.radius = Math.min(Config.CREATURE.MAX_RADIUS, this.radius + 0.12);
      this.baseRadius = this.radius;
    }
  }

  /**
   * Feed on celestial nectar — rich energy, emotional attachment, and growth.
   */
  consumeNectar(amount = 0.45) {
    this.energy = Math.min(1.0, this.energy + amount);
    this.metabolicFlash = 1.0;
    if (this.growthProgress < 1.0) {
      this.nutrientBonus += 0.25;
    }
    this.favoriteCoord = { x: this.position.x, y: this.position.y };
    if (this.radius < Config.CREATURE.MAX_RADIUS) {
      this.radius = Math.min(Config.CREATURE.MAX_RADIUS, this.radius + 0.4);
      this.baseRadius = this.radius;
    }
  }

  /**
   * Emit a gentle bioluminescent wave that travels through nearby creatures.
   * Designed to be soothing, calm and hypnotic with quick exponential decay.
   * @param {Creature[]} [allCreatures]
   * @param {number} [intensity=1.0]
   * @param {number} [generation=0]
   */
  emitLightWave(allCreatures = [], intensity = 1.0, generation = 0) {
    if (this.glowIntensity < intensity) {
      this.glowIntensity = intensity;
    }
    this.lightEchoCooldown = Config.BIOLUMINESCENCE?.COOLDOWN_MS || 4500;

    const maxGen = Config.BIOLUMINESCENCE?.MAX_GENERATIONS || 2;
    if (generation >= maxGen || !allCreatures || allCreatures.length === 0) return;

    const nextIntensity = intensity * (Config.BIOLUMINESCENCE?.PROPAGATION_FACTOR || 0.44);
    if (nextIntensity < (Config.BIOLUMINESCENCE?.MIN_INTENSITY_TRIGGER || 0.20)) return;

    const radius = Config.BIOLUMINESCENCE?.WAVE_RADIUS || 120;
    const px = this.position.x;
    const py = this.position.y;

    for (let i = 0; i < allCreatures.length; i++) {
      const other = allCreatures[i];
      if (!other.isAlive || other === this) continue;
      if (other.lightEchoCooldown > 0) continue;

      const d = Math.hypot(other.position.x - px, other.position.y - py);
      if (d < radius && d > 4) {
        // Organic biological delay: 120ms to 240ms proportional to distance
        const delay = 120 + (d / radius) * 120;
        setTimeout(() => {
          if (other.isAlive && other.lightEchoCooldown <= 0) {
            other.emitLightWave(allCreatures, nextIntensity, generation + 1);
          }
        }, delay);
      }
    }
  }

  /**
   * Record a harrowing near-dissolution or danger event into emotional memory.
   */
  experienceTrauma(amount = 0.35) {
    this.membraneCaution = Math.min(1.0, this.membraneCaution + amount * (0.5 + this.dna.caution * 0.5));
    this.fear = Math.min(1.0, this.fear + 0.65);
  }

  /**
   * Experience soothing harmony, calming fears and easing membrane caution.
   */
  experiencePeace(amount = 0.12) {
    this.fear = Math.max(0.0, this.fear - amount);
    this.membraneCaution = Math.max(0.0, this.membraneCaution - amount * 0.4);
  }

  /**
   * Advance continuous morphological kinematics (smooth orientation, wing flutter,
   * jellyfish bell pulsing, and articulated Verlet chain segments).
   * @param {number} dt
   * @param {number} time
   * @param {Creature[]} [allCreatures]
   */
  updateKinematics(dt, time, allCreatures = []) {
    // 0. Advance age, ontogeny & zen bioluminescence
    this.age += dt;
    if (this.lightEchoCooldown > 0) this.lightEchoCooldown = Math.max(0, this.lightEchoCooldown - dt);
    if (this.glowIntensity > 0) this.glowIntensity = Math.max(0, this.glowIntensity - dt * 0.00085);

    if (this.growthProgress < 1.0) {
      const dur = Config.ONTOGENY?.JUVENILE_DURATION_MS || 35_000;
      this.growthProgress = Math.min(1.0, this.growthProgress + (dt / dur) + this.nutrientBonus);
      this.nutrientBonus = 0;
      this.lifeStage = this.growthProgress < 0.98 ? (Config.LIFE_STAGE?.JUVENILE || 'juvenile') : (Config.LIFE_STAGE?.ADULT || 'adult');
    } else if (this.age >= (Config.ONTOGENY?.ANCESTRAL_AGE_MS || 120_000)) {
      if (!this.isAncestral) {
        this.isAncestral = true;
        this.lifeStage = Config.LIFE_STAGE?.ANCESTRAL || 'ancestral';
        if (!this.ancestralAnnounced) {
          this.ancestralAnnounced = true;
          this.emitLightWave(allCreatures, 0.9);
          globalBus.emit(Events.CREATURE_LEGENDARY, { creature: this, traitName: 'Ancestralidade Cósmica' });
        }
      }
    }

    // Scale radius by juvenile growth
    const minScale = Config.ONTOGENY?.JUVENILE_SCALE_MIN || 0.50;
    const currentScale = this.isOffspring ? (minScale + (1 - minScale) * this.growthProgress) : 1.0;
    this.radius = this.baseRadius * currentScale;

    // 1. Smooth orientation facing (mass-weighted turning inertia)
    const mass = Math.pow(Math.max(0.6, this.radius / 14), 1.4);
    const speed = this.velocity.magnitude;
    if (speed > 0.05) {
      const targetAngle = this.velocity.heading();
      let diff = targetAngle - this.facingAngle;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI)  diff -= Math.PI * 2;
      const turnRate = (0.055 / Math.sqrt(mass)) * Math.min(dt / 16, 2.0);
      this.facingAngle += diff * Math.min(0.25, turnRate);
    }

    // 2. Wing & bell oscillations
    this.wingPhase += dt * this.dna.flutterRate;
    this.pulsePhase += dt * (0.0022 + speed * 0.002);

    // 3. Articulated segments (Verlet chain) for Serpentine & Manta tail
    const numSegs = Math.min(this.segments.length, this.dna.segmentCount + 2);
    this.segments[0].x = this.position.x;
    this.segments[0].y = this.position.y;
    this.segments[0].angle = this.facingAngle;
    this.segments[0].radius = this.radius;

    const segSpacing = this.radius * 0.68;
    for (let i = 1; i < numSegs; i++) {
      const prev = this.segments[i - 1];
      const curr = this.segments[i];
      const dx   = curr.x - prev.x;
      const dy   = curr.y - prev.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const angle = Math.atan2(dy, dx);
      curr.x = prev.x + (dx / dist) * segSpacing;
      curr.y = prev.y + (dy / dist) * segSpacing;
      curr.angle = angle;
      curr.radius = this.radius * Math.max(0.2, 1 - (i / numSegs) * 0.7);
    }

    // 4. Trailing tentacles for Jellyfish
    const numTentacles = this.dna.tentacleCount;
    for (let t = 0; t < numTentacles; t++) {
      const spread = (t / (numTentacles - 1 || 1) - 0.5) * 1.3;
      const baseAngle = this.facingAngle + Math.PI + spread;
      let prevX = this.position.x + Math.cos(baseAngle) * this.radius * 0.65;
      let prevY = this.position.y + Math.sin(baseAngle) * this.radius * 0.65;
      const tent = this.tentacles[t];

      const jointSpacing = this.radius * 0.52;
      for (let j = 0; j < tent.length; j++) {
        const joint = tent[j];
        const wave = Math.sin(time * 0.0032 + j * 0.7 + joint.phase) * (2.0 + j * 0.8);
        const dx = joint.x - prevX;
        const dy = joint.y - prevY;
        const dist = Math.hypot(dx, dy) || 0.001;
        const ang = Math.atan2(dy, dx);

        joint.x = prevX + (dx / dist) * jointSpacing + Math.cos(ang + Math.PI / 2) * wave * 0.12;
        joint.y = prevY + (dy / dist) * jointSpacing + Math.sin(ang + Math.PI / 2) * wave * 0.12;
        prevX = joint.x;
        prevY = joint.y;
      }
    }
  }

  getBlobPoints(time) {
    this.updateBlob(time);

    // Soft-body jellyfish squash & stretch based on movement velocity and jet pulse
    const speed = this.velocity.magnitude;
    const hasMotion = speed > 0.06;
    const moveAngle = hasMotion ? Math.atan2(this.velocity.y, this.velocity.x) : 0;
    
    // Contraction during jellyfish jet propulsion pulse
    let jetStretch = 0;
    if (this.bodyPlan === Config.BODY_PLAN.JELLYFISH) {
      const bellSine = Math.sin(this.pulsePhase);
      if (bellSine > 0.2) {
        jetStretch = (bellSine - 0.2) * 0.22; // Bell narrows and elongates forward
      }
    }

    const stretch = hasMotion ? Math.min(speed * 0.32 + jetStretch, 0.46) : jetStretch;
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
