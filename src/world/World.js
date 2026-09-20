import { Creature, CreatureState } from '../entities/Creature.js';
import { DNA } from '../entities/DNA.js';
import { Threshold } from './Threshold.js';
import { ParticleSystem } from '../fx/ParticleSystem.js';
import { AudioEngine } from '../fx/AudioEngine.js';
import { PhysicsSystem } from '../systems/PhysicsSystem.js';
import { EvolutionSystem } from '../systems/EvolutionSystem.js';
import { InteractionSystem } from '../systems/InteractionSystem.js';
import { SpawnSystem } from '../systems/SpawnSystem.js';
import { DecisionSystem } from '../systems/DecisionSystem.js';
import { Diary } from '../ui/Diary.js';
import { Bestiary } from '../ui/Bestiary.js';
import { Config } from '../core/Config.js';
import { Color } from '../utils/Color.js';
import { Vector2 } from '../utils/Vector2.js';
import { globalBus, Events } from '../core/EventEmitter.js';

const SPORE_COLOR_LIGHT  = Object.freeze(new Color(55, 90, 85));
const SPORE_COLOR_SHADOW = Object.freeze(new Color(265, 80, 80));

/**
 * World — The scene graph and systems orchestrator.
 *
 * Owns all entities and coordinates system execution order:
 *   Spawn → Threshold → Evolution → Decision (AI) → Physics → Interactions → Particles → Cleanup
 *
 * Does NOT render — that is the Renderer's job.
 * Does NOT handle raw input — that is the Game's job.
 */
export class World {
  static _SEASON_LIST = Object.freeze([
    Config.SEASONS?.TYPES?.CRYSTAL_TIDE || 'crystal_tide',
    Config.SEASONS?.TYPES?.BOREAL_NIGHT || 'boreal_night',
    Config.SEASONS?.TYPES?.GOLDEN_ECLIPSE || 'golden_eclipse',
  ]);

  static _ROMAN_GENS = Object.freeze(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']);

  static _SPORE_COLOR_LIGHT  = SPORE_COLOR_LIGHT;
  static _SPORE_COLOR_SHADOW = SPORE_COLOR_SHADOW;

  /**
   * @param {number} width  - Canvas CSS width.
   * @param {number} height - Canvas CSS height.
   */
  constructor(width, height) {
    /** @type {Creature[]} */
    this.creatures  = [];
    this.threshold  = new Threshold(height);
    this.particles  = new ParticleSystem();
    this.audio      = new AudioEngine();
    this.diary      = new Diary();
    this.bestiary   = new Bestiary();

    this._decision    = new DecisionSystem();
    this._physics     = new PhysicsSystem(width, height);
    this._evolution   = new EvolutionSystem();
    this._interaction = new InteractionSystem();
    this._spawn       = new SpawnSystem(width, height);

    this._width  = width;
    this._height = height;

    // ── Wind simulation ───────────────────────────────────────────────────
    // A global wind that slowly rotates direction. Creates environmental unity —
    // ambient particles, creature drift, and threshold wave all lean the same way.
    this._windAngle       = Math.random() * Math.PI * 2;
    this._windTargetAngle = this._windAngle;
    this._windSpeed       = 0.15;
    this._windChangeTimer = 0;
    /** Public: current wind vector read by systems. @type {{ x: number, y: number }} */
    this.wind = { x: 0, y: 0 };

    /** Global Diurnal Breathing Tide [0..1]. */
    this.diurnalCycle  = 0;
    this.diurnalFactor = 0.5;

    /** Active celestial nectar droplet { x, y, radius, life, charges }. */
    this.activeNectar  = null;

    /** Living glowing flora spores floating in ether { x, y, vx, vy, life, maxLife, radius, color, nutrition }. */
    this.activeSpores  = [];

    /** Cosmic player call ripple waves { x, y, radius, maxRadius, life, decay, createdAt }. */
    this.playerCalls   = [];

    /** Pending creature chirps queued by player calls, synchronized with simulation dt */
    this._pendingChirps = [];

    /** Currently selected creature for inspection / empathy. @type {Creature|null} */
    this.inspectedCreature = null;

    // ── Sanctuaries & Micro-Climates (Jardins de Pólipos) ─────────────────
    this.reefs = [
      {
        id: 'reef_abyss_left',
        zone: Config.ZONE.SHADOW,
        u: 0.22,
        v: 0.88,
        baseX: width * 0.22,
        baseY: height * 0.88,
        polyps: [
          { offsetX: -16, height: 44, phase: 0.2, bulbRadius: 6.5, color: new Color(265, 80, 75) },
          { offsetX: -5,  height: 58, phase: 1.5, bulbRadius: 8.0, color: new Color(285, 85, 80) },
          { offsetX: 8,   height: 48, phase: 3.1, bulbRadius: 7.0, color: new Color(250, 75, 70) },
          { offsetX: 20,  height: 36, phase: 4.8, bulbRadius: 5.5, color: new Color(295, 90, 85) },
        ],
        sporeTimer: 1000,
        pulsePhase: 0,
      },
      {
        id: 'reef_solar_right',
        zone: Config.ZONE.LIGHT,
        u: 0.78,
        v: 0.12,
        baseX: width * 0.78,
        baseY: height * 0.12,
        polyps: [
          { offsetX: -18, height: 38, phase: 0.5, bulbRadius: 6.0, color: new Color(48, 90, 80) },
          { offsetX: -4,  height: 52, phase: 2.1, bulbRadius: 7.5, color: new Color(55, 95, 85) },
          { offsetX: 12,  height: 42, phase: 3.7, bulbRadius: 6.5, color: new Color(42, 85, 75) },
        ],
        sporeTimer: 2500,
        pulsePhase: 1.2,
      },
      {
        id: 'reef_abyss_right',
        zone: Config.ZONE.SHADOW,
        u: 0.68,
        v: 0.91,
        baseX: width * 0.68,
        baseY: height * 0.91,
        polyps: [
          { offsetX: -14, height: 46, phase: 1.0, bulbRadius: 6.5, color: new Color(210, 80, 75) },
          { offsetX: 2,   height: 62, phase: 2.8, bulbRadius: 8.5, color: new Color(230, 85, 80) },
          { offsetX: 18,  height: 40, phase: 4.2, bulbRadius: 5.5, color: new Color(195, 75, 70) },
        ],
        sporeTimer: 3200,
        pulsePhase: 2.5,
      },
    ];

    // ── Periodic Cosmic Tides (Marés Cósmicas) ────────────────────────────
    this.tide = {
      active: false,
      factor: 0,
      direction: 1,
      vector: { x: 0, y: 0 },
      startTime: 0,
      duration: Config.TIDES?.DURATION_MS || 12_000,
      nextTideTime: 45_000,
      endTime: 0,
    };

    // ── Cosmic Seasons (Biomas Temporais) ─────────────────────────────────
    this.season = {
      index: 0,
      current: Config.SEASONS?.TYPES?.CRYSTAL_TIDE || 'crystal_tide',
      next: Config.SEASONS?.TYPES?.BOREAL_NIGHT || 'boreal_night',
      blend: 0,
      progress: 0,
      name: Config.SEASONS?.NAMES?.crystal_tide || 'Maré de Cristal',
      lastAnnounced: Config.SEASONS?.TYPES?.CRYSTAL_TIDE || 'crystal_tide',
      lastBorealWave: 0,
    };

    // ── Hydrothermal Fissures & Abyssal Vents (Fossa das Fumarolas) ───────
    this.vents = [
      {
        id: 'vent_abyss_1',
        u: 0.22,
        v: 0.96,
        baseX: width * 0.22,
        baseY: height * 0.96,
        width: 38,
        height: 22,
        pulsePhase: 0.0,
        bubbleTimer: 800,
        bubbles: [],
        lastSingingBowlTime: 0,
      },
      {
        id: 'vent_abyss_2',
        u: 0.50,
        v: 0.97,
        baseX: width * 0.50,
        baseY: height * 0.97,
        width: 44,
        height: 25,
        pulsePhase: 1.8,
        bubbleTimer: 2400,
        bubbles: [],
        lastSingingBowlTime: 0,
      },
      {
        id: 'vent_abyss_3',
        u: 0.78,
        v: 0.96,
        baseX: width * 0.78,
        baseY: height * 0.96,
        width: 36,
        height: 20,
        pulsePhase: 3.5,
        bubbleTimer: 1600,
        bubbles: [],
        lastSingingBowlTime: 0,
      },
    ];

    // ── Aurora Nursery (Estrato Celeste Supremo) ──────────────────────────
    this.aurora = {
      lastChimeTime: 0,
      shimmerDust: [],
    };

    this._subscribeToEvents();
  }

  /** @param {import('../rendering/Renderer.js').Renderer} renderer */
  setRenderer(renderer) {
    this._renderer = renderer;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Populate the world with an initial set of creatures. */
  init() {
    const initial = this._spawn.spawnInitial(this.threshold);
    for (const c of initial) this._addCreature(c);
  }

  /**
   * Advance the world by one frame.
   * @param {number} now - Performance.now() in ms.
   * @param {number} dt  - Delta time in ms.
   * @param {Array<{x: number, y: number}>} [touchPoints]
   */
  update(now, dt, touchPoints = []) {
    // Diurnal breathing tide
    const diurnalPeriod = Config.ECOSYSTEM?.DIURNAL_PERIOD_MS || 100_000;
    this.diurnalCycle = (now % diurnalPeriod) / diurnalPeriod;
    this.diurnalFactor = 0.5 + 0.5 * Math.sin(this.diurnalCycle * Math.PI * 2);

    // 0. Update wind simulation & seasonal macro-climate
    this._updateWind(dt);
    this._updateSeasons(now, dt);

    // 1. Spawn new creatures if needed
    const newCreatures = this._spawn.update(this.creatures, this.threshold, now);
    for (const c of newCreatures) this._addCreature(c);

    // 2. Advance threshold physics & flora kinematics
    this.threshold.update(dt, this.wind, this.creatures, this._width);

    // 3. Evolve: state transitions, zone detection, rare events
    this._evolution.update(this.creatures, this.threshold, now, dt, this.particles, this.audio);

    // 4. Check TRANSFORMED → DISSOLVING timeout
    this._checkDissolutionTimeout(now);

    // 4.5. Update sleep & dreams
    this._updateSleepAndDreams(now, dt);

    // 4.8. Autonomous Cognitive AI: update drives, sensory perception, and conscious decisions
    this._decision.update(this.creatures, this.threshold, touchPoints, this.activeNectar, dt, now);

    // 4.9. Update environmental sanctuaries, periodic cosmic tides, vents & aurora nursery
    this._updateTide(now, dt);
    this._updateReefs(now, dt);
    this._updateVents(now, dt);
    this._updateAuroraNursery(now, dt);

    // 5. Physics: steering, movement, sleep damping, dance, nectar pull, thermocline convection, tide, reefs, vents & aurora
    this._physics.update(this.creatures, this.threshold, dt, this.wind, touchPoints, this.activeNectar, now, this.tide, this.reefs, this.vents, this.season);

    // 5.5. Update active nectar consumption
    this._updateNectar(now, dt);

    // 6. Interactions: collisions, bonding, courtship dance, offspring
    const offspring = this._interaction.update(this.creatures, this.particles, this.audio, now);
    for (const c of offspring) {
      c.isOffspring = true;
      c.growthProgress = 0.0;
      c.lifeStage = Config.LIFE_STAGE?.JUVENILE || 'juvenile';
      this._addCreature(c);
      c.emitLightWave(this.creatures, 1.0);
    }

    // 7. Particles & flora spores
    this.particles.update(dt);
    this.particles.emitThresholdAmbient(this.threshold.y, this._width);
    this._emitFloraSporeChance();
    this._updateSpores(now, dt);
    this._updatePlayerCalls(now, dt);
    this._updatePendingChirps(dt);

    // 8. Sync audio to creature positions, seasons & adaptive atmosphere
    this.audio.update(now, this.diurnalFactor, this.creatures, this.season);
    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      if (c.isAlive) this.audio.updateCreaturePosition(c, this._width, this._height, this.threshold.y);
    }

    // 9. Cleanup dead creatures
    this._removeDeadCreatures();
  }

  onResize(width, height) {
    this._width  = width;
    this._height = height;
    this.threshold.onResize(height);
    this._physics.onResize(width, height);
    this._spawn.onResize(width, height);
    this._layoutReefs(width, height);
    this._layoutVents(width, height);
  }

  _layoutReefs(width, height) {
    if (!this.reefs) return;
    for (const reef of this.reefs) {
      reef.baseX = reef.u * width;
      reef.baseY = reef.v * height;
    }
  }

  _layoutVents(width, height) {
    if (!this.vents) return;
    for (const vent of this.vents) {
      vent.baseX = vent.u * width;
      vent.baseY = vent.v * height;
    }
  }

  // ── Player interactions ───────────────────────────────────────────────────

  /**
   * "Whisper" — nudge the closest creature toward a canvas position.
   * @param {number} x - Canvas-space X.
   * @param {number} y - Canvas-space Y.
   */
  whisper(x, y) {
    const target = this._closestCreatureTo(x, y, 80);
    if (!target) return;

    const dx  = x - target.position.x;
    const dy  = y - target.position.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return;

    const nudge = new Vector2(dx / len * 0.5, dy / len * 0.5);
    target.velocity = target.velocity.add(nudge);
    globalBus.emit(Events.WHISPER, target);
  }

  /**
   * "Bubble" — emit particles at a position (visual feedback for two-finger tap).
   * @param {number} x
   * @param {number} y
   */
  bubble(x, y) {
    this.particles.emitTransformBurst(x, y, new Color(280, 50, 70));
    globalBus.emit(Events.BUBBLE, { x, y });
  }

  /**
   * "Nectar" — condense a drop of celestial nectar to feed nearby creatures.
   * @param {number} x
   * @param {number} y
   */
  spawnNectar(x, y) {
    this.activeNectar = {
      x, y,
      radius: 9,
      life: 1.0,
      charges: 3,
      createdAt: performance.now(),
    };
    this.audio.playNectarChime(x / this._width, y / this._height);
    this.particles.emitNectarFeedBurst(x, y);
    const close = this._closestCreatureTo(x, y, 160);
    if (close) close.emitLightWave?.(this.creatures, 0.85);
    globalBus.emit(Events.NECTAR_SPAWNED, this.activeNectar);
  }

  /**
   * Pluck a note along the threshold liquid harp.
   * @param {number} xRatio - 0..1
   */
  pluckHarp(xRatio) {
    this.threshold.addHarpImpulse(xRatio);
    this.audio.pluckHarp(xRatio, this.threshold.y / this._height);
  }

  /**
   * Brush the membrane flora with touch/mouse, causing deflection and releasing spores.
   * @param {number} px
   * @param {number} py
   */
  brushFlora(px, py) {
    const released = this.threshold.brushFlora(px, py, this._width);
    if (released && released.length > 0) {
      for (const r of released) {
        if (this.activeSpores.length >= 32) {
          for (let sIdx = 0; sIdx < this.activeSpores.length - 1; sIdx++) {
            this.activeSpores[sIdx] = this.activeSpores[sIdx + 1];
          }
          this.activeSpores.length = 31;
        }
        this.activeSpores.push({
          x: r.x,
          y: r.y,
          vx: (Math.random() - 0.5) * 0.5,
          vy: r.side * (0.35 + Math.random() * 0.4),
          life: 1.0,
          maxLife: 10_000 + Math.random() * 5_000,
          radius: 3.5 + Math.random() * 2,
          color: r.side < 0 ? SPORE_COLOR_LIGHT : SPORE_COLOR_SHADOW,
          nutrition: Config.INTERACTION_EXPANDED?.SPORE_NUTRITION || 0.22,
        });
        this.particles.emitFloraSpore(r.x, r.y, r.side);
      }
      this.audio.playFloraRustle?.(px / this._width, py / this._height);
      globalBus.emit(Events.FLORA_SPORES, { count: released.length, x: px, y: py });
    }
  }

  /**
   * Cosmic Player Call — Emit an acoustic ripple that creatures perceive and answer.
   * @param {number} px
   * @param {number} py
   */
  emitPlayerCall(px, py) {
    const call = {
      x: px,
      y: py,
      radius: 6,
      maxRadius: Config.INTERACTION_EXPANDED?.CALL_RADIUS || 280,
      life: 1.0,
      decay: 0.0008,
      createdAt: performance.now(),
    };
    if (this.playerCalls.length >= 8) {
      for (let cIdx = 0; cIdx < this.playerCalls.length - 1; cIdx++) {
        this.playerCalls[cIdx] = this.playerCalls[cIdx + 1];
      }
      this.playerCalls.length = 7;
    }
    this.playerCalls.push(call);
    this.audio.playPlayerCall(px / this._width, py / this._height);
    globalBus.emit(Events.PLAYER_CALL, { x: px, y: py });

    // Nearby conscious creatures notice and answer back in song
    let responderCount = 0;
    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      if (!c.isAlive) continue;
      const dx = px - c.position.x;
      const dy = py - c.position.y;
      const d = Math.hypot(dx, dy);
      if (d < call.maxRadius) {
        if (c.isSleeping) c.wake();
        c.curiosity = Math.min(1.0, c.curiosity + 0.35);
        c.expressThought(`${c.name} ouviu seu chamado cósmico`);

        const mass = Math.pow(Math.max(0.6, c.radius / 14), 1.4);
        const impulse = 0.35 / Math.sqrt(mass);
        const invD = d > 0.001 ? 1 / d : 0;
        c.velocity.x += dx * invD * impulse;
        c.velocity.y += dy * invD * impulse;

        if (responderCount < 3 && Math.random() < 0.7) {
          const delay = (320 + responderCount * 280) / 1000;
          responderCount++;
          this._pendingChirps.push({
            creature: c,
            timeRemaining: delay,
          });
        }
      }
    }
  }

  /**
   * Find creature at pointer location and toggle/set inspection.
   * @param {number} px
   * @param {number} py
   * @returns {Creature|null}
   */
  inspectAt(px, py) {
    const target = this._closestCreatureTo(px, py, 48);
    this.inspectedCreature = target;
    return target;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  // ── Wind simulation ───────────────────────────────────────────────────────

  /**
   * Slowly rotate the wind to a new direction every 15–45 seconds.
   * Uses easing for smooth transitions — no sudden direction snaps.
   */
  _updateWind(dt) {
    this._windChangeTimer -= dt;
    if (this._windChangeTimer <= 0) {
      // Drift to a new direction — prefer small changes for organicness
      const drift = (Math.random() - 0.5) * Math.PI * 1.2;
      this._windTargetAngle = this._windAngle + drift;
      this._windChangeTimer = 15_000 + Math.random() * 30_000;
    }

    // Smooth angular interpolation toward target
    let delta = this._windTargetAngle - this._windAngle;
    // Normalize to [-π, π]
    while (delta >  Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;

    this._windAngle += delta * 0.00015 * dt;

    this.wind.x = Math.cos(this._windAngle) * this._windSpeed;
    this.wind.y = Math.sin(this._windAngle) * this._windSpeed * 0.4; // less vertical push
  }

  _addCreature(creature) {
    let zoneCount = 0;
    let totalCount = 0;
    const maxPerZone = Config.WORLD.MAX_CREATURES_PER_ZONE || 14;

    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      if (c.isAlive) {
        totalCount++;
        if (c.originZone === creature.originZone) zoneCount++;
      }
    }

    if (totalCount >= Config.WORLD.MAX_CREATURES) return;
    if (zoneCount >= maxPerZone) return; // Guaranteed fair quota per zone!

    // Hard boundary guard on entry
    const pad = Math.max(8, creature.radius * 0.8);
    const cx = Math.max(pad, Math.min(this._width - pad, creature.position.x));
    const cy = Math.max(pad, Math.min(this._height - pad, creature.position.y));
    creature.position.set(cx, cy);

    this.creatures.push(creature);
    this.audio.addCreature(creature);
    this.bestiary.registerCreature(creature);
  }

  _removeDeadCreatures() {
    if (this.inspectedCreature && !this.inspectedCreature.isAlive) {
      this.inspectedCreature = null;
    }

    let hasDead = false;
    for (let i = 0; i < this.creatures.length; i++) {
      if (!this.creatures[i].isAlive) {
        hasDead = true;
        break;
      }
    }
    if (!hasDead) return;

    let writeIdx = 0;
    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      if (c.isAlive) {
        this.creatures[writeIdx++] = c;
      } else {
        this.audio.removeCreature(c.id);
        // Leave a ghost echo where the creature died
        this._renderer?.registerEcho(c);

        // Break symbiotic bond and clean up partner references
        if (c.bondedWith) {
          const partner = c.bondedWith;
          partner.bondedWith = null;
          partner.isChimera = false;
          partner.chimericPlan = null;
          if (partner.state === CreatureState.SYMBIOTIC) {
            partner.transitionTo(partner.zone === partner.originZone ? CreatureState.NATIVE : CreatureState.TRANSFORMED);
          }
          c.bondedWith = null;
          c.chimericPlan = null;
        }
        if (c.dancePartner) {
          c.dancePartner.endDance();
          c.dancePartner = null;
        }
        c.interactionCooldowns.clear();
      }
    }
    this.creatures.length = writeIdx;
  }

  _checkDissolutionTimeout(now) {
    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      if (!c.isAlive) continue;
      if (c.state !== CreatureState.TRANSFORMED) continue;
      const dissolveDelay = c.dna.resistance * 8000 + Config.EVOLUTION.DISSOLVE_DELAY_MS;
      if (now - c.crossingStartTime > dissolveDelay) {
        c.experienceTrauma(0.5);
        this._evolution.beginDissolution(c);
      }
    }
  }

  _closestCreatureTo(x, y, maxRadius) {
    let closest = null;
    let minDist  = maxRadius;
    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      if (!c.isAlive) continue;
      const dist = Math.hypot(c.position.x - x, c.position.y - y);
      if (dist < minDist) {
        minDist  = dist;
        closest  = c;
      }
    }
    return closest;
  }

  _updateNectar(now, dt) {
    if (!this.activeNectar) return;
    this.activeNectar.life -= dt / (Config.ECOSYSTEM?.NECTAR_DURATION_MS || 10000);
    if (this.activeNectar.life <= 0) {
      this.activeNectar = null;
      return;
    }

    // Creature feeding check
    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      if (!c.isAlive) continue;
      const dx = c.position.x - this.activeNectar.x;
      const dy = c.position.y - this.activeNectar.y;
      const dist = Math.hypot(dx, dy);
      if (dist < c.radius + 18) {
        c.consumeNectar(0.45);
        c.emitLightWave?.(this.creatures, 0.90);
        this.activeNectar.charges--;
        this.particles.emitNectarFeedBurst(this.activeNectar.x, this.activeNectar.y);
        this.audio.playNectarChime(this.activeNectar.x / this._width, this.activeNectar.y / this._height);
        if (this.activeNectar.charges <= 0) {
          this.activeNectar = null;
          break;
        }
      }
    }
  }

  _updateSleepAndDreams(now, dt) {
    const idleReq = Config.ECOSYSTEM?.SLEEP_IDLE_MS || 24000;
    const dreamInterval = Config.ECOSYSTEM?.DREAM_INTERVAL_MS || 900;

    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      if (!c.isAlive) continue;

      if (c.isSleeping) {
        c.dreamTimer = (c.dreamTimer || 0) + dt;
        if (c.dreamTimer > dreamInterval) {
          c.dreamTimer = 0;
          this.particles.emitDreamMote(c.position.x, c.position.y, c.color);
        }
      } else {
        if (c.state === CreatureState.NATIVE || c.state === CreatureState.TRANSFORMED) {
          c.peacefulTime = (c.peacefulTime || 0) + dt;
          if (c.peacefulTime > idleReq && Math.random() < 0.003) {
            c.sleep();
          }
        }
      }
    }
  }

  _emitFloraSporeChance() {
    if (Math.random() < (Config.ECOSYSTEM?.FLORA_SPORE_CHANCE || 0.012) && this.threshold.flora.length > 0) {
      const idx = Math.floor(Math.random() * this.threshold.flora.length);
      const reed = this.threshold.flora[idx];
      const rx = reed.u * this._width;
      const ry = this.threshold.y;
      this.particles.emitFloraSpore(rx, ry, reed.side);
    }
  }

  _updateTide(now, dt) {
    if (!this.tide) return;

    if (!this.tide.active) {
      if (now >= this.tide.nextTideTime) {
        this.tide.active = true;
        this.tide.startTime = now;
        this.tide.duration = Config.TIDES?.DURATION_MS || 12_000;
        this.tide.endTime = now + this.tide.duration;
        this.tide.direction = Math.random() < 0.5 ? 1 : -1;
        this.tide.nextTideTime = now + (Config.TIDES?.INTERVAL_MS || 50_000) + Math.random() * 15_000;
        this.diary.add('🌊 Uma maré cósmica transversal percorre o éter, alinhando os seres.');
        globalBus.emit(Events.COSMIC_TIDE_START, this.tide);
        this.audio?.playFloraRustle?.(0.5, 0.5);
      }
    }

    if (this.tide.active) {
      const elapsed = now - this.tide.startTime;
      if (now >= this.tide.endTime) {
        this.tide.active = false;
        this.tide.factor = 0;
        this.tide.vector.x = 0;
        this.tide.vector.y = 0;
        globalBus.emit(Events.COSMIC_TIDE_END);
      } else {
        const progress = Math.max(0, Math.min(1, elapsed / this.tide.duration));
        // Smooth sine bell envelope [0 -> 1 -> 0]
        this.tide.factor = Math.sin(progress * Math.PI);
        const baseForce = Config.TIDES?.FORCE || 0.42;
        this.tide.vector.x = this.tide.direction * baseForce * this.tide.factor;
        this.tide.vector.y = Math.sin(now * 0.0012) * 0.08 * this.tide.factor;
      }
    }
  }

  _updateReefs(now, dt) {
    if (!this.reefs || this.reefs.length === 0) return;
    const sporeInterval = Config.SANCTUARIES?.SPORE_INTERVAL_MS || 3800;
    const regenAmount = Config.SANCTUARIES?.REST_ENERGY_REGEN || 0.00018;

    for (const reef of this.reefs) {
      reef.pulsePhase += dt * 0.002;
      reef.sporeTimer = (reef.sporeTimer || 0) + dt;

      // Periodically emit a peaceful micro-spore from a polyp
      if (reef.sporeTimer >= sporeInterval) {
        reef.sporeTimer = 0;
        if (this.activeSpores.length < 32 && reef.polyps.length > 0) {
          const polyp = reef.polyps[Math.floor(Math.random() * reef.polyps.length)];
          const sx = reef.baseX + polyp.offsetX;
          const sy = reef.zone === Config.ZONE.LIGHT
            ? reef.baseY + polyp.height
            : reef.baseY - polyp.height;

          this.activeSpores.push({
            x: sx,
            y: sy,
            vx: (Math.random() - 0.5) * 0.35 + (this.wind.x * 0.3),
            vy: (reef.zone === Config.ZONE.LIGHT ? 0.30 : -0.30) + (Math.random() - 0.5) * 0.2,
            life: 1.0,
            maxLife: 14_000,
            radius: polyp.bulbRadius * 0.55,
            color: polyp.color.clone(),
            nutrition: Config.INTERACTION_EXPANDED?.SPORE_NUTRITION || 0.24,
          });
        }
      }

      // Rest & Sanctuary regeneration for nearby creatures
      for (let cIdx = 0; cIdx < this.creatures.length; cIdx++) {
        const c = this.creatures[cIdx];
        if (!c.isAlive) continue;
        const d = Math.hypot(c.position.x - reef.baseX, c.position.y - reef.baseY);
        if (d < (Config.SANCTUARIES?.REST_ATTRACT_RADIUS || 140)) {
          c.experiencePeace(0.02);
          if (c.energy < 0.95) c.energy = Math.min(1.0, c.energy + regenAmount * dt);
          if (c.fatigue > 0.05) c.fatigue = Math.max(0.0, c.fatigue - regenAmount * dt);

          if (c.growthProgress < 1.0) {
            c.nutrientBonus += 0.00025 * dt; // nursery accelerated growth
          }

          if (Math.random() < 0.0005 && !c.isSleeping) {
            c.expressThought(`${c.name} repousa no santuário dos pólipos cósmicos.`);
          }
        }
      }
    }
  }

  _updateSeasons(now, dt) {
    const seasonList = World._SEASON_LIST;
    const dur = Config.SEASONS?.SEASON_DURATION_MS || 240_000;
    const transDur = Config.SEASONS?.TRANSITION_DURATION_MS || 32_000;
    const totalCycle = dur * seasonList.length;

    const cyclePos = (now % totalCycle) / dur;
    const currentIndex = Math.floor(cyclePos) % seasonList.length;
    const nextIndex = (currentIndex + 1) % seasonList.length;
    const progress = cyclePos - Math.floor(cyclePos);

    const timeRemaining = (1 - progress) * dur;
    let blend = 0;
    if (timeRemaining < transDur) {
      const tLinear = 1 - (timeRemaining / transDur);
      blend = 0.5 - 0.5 * Math.cos(tLinear * Math.PI);
    }

    this.season.index = currentIndex;
    this.season.current = seasonList[currentIndex];
    this.season.next = seasonList[nextIndex];
    this.season.blend = blend;
    this.season.progress = progress;
    this.season.name = Config.SEASONS?.NAMES?.[this.season.current] || 'Maré Cósmica';

    // Diary announcement on season transition
    if (this.season.current !== this.season.lastAnnounced) {
      this.season.lastAnnounced = this.season.current;
      switch (this.season.current) {
        case 'crystal_tide':
          this.diary.add('💎 O cosmos adormece sob a Maré de Cristal — o éter torna-se translúcido e sereno.');
          break;
        case 'boreal_night':
          this.diary.add('🌌 A Noite Boreal ergue-se no horizonte, despertando ondas de luz harmônica.');
          break;
        case 'golden_eclipse':
          this.diary.add('☀️ O calor do Eclipse Dourado abraça o oceano cósmico com serenidade eterna.');
          break;
      }
    }

    // Boreal Night Quorum Sensing: spontaneous calm gentle light wave
    if (this.season.current === 'boreal_night') {
      if (!this.season.lastBorealWave) this.season.lastBorealWave = now;
      if (now - this.season.lastBorealWave > 32_000 && this.creatures.length > 0) {
        this.season.lastBorealWave = now;
        let livingCount = 0;
        for (let i = 0; i < this.creatures.length; i++) {
          const c = this.creatures[i];
          if (c.isAlive && !c.isSleeping) livingCount++;
        }
        if (livingCount > 0) {
          let pick = Math.floor(Math.random() * livingCount);
          for (let i = 0; i < this.creatures.length; i++) {
            const c = this.creatures[i];
            if (c.isAlive && !c.isSleeping) {
              if (pick === 0) {
                c.emitLightWave(this.creatures, 0.65);
                break;
              }
              pick--;
            }
          }
        }
      }
    }
  }

  _updateVents(now, dt) {
    if (!this.vents || this.vents.length === 0) return;
    const bubbleInterval = Config.HYDROTHERMAL_VENTS?.BUBBLE_INTERVAL_MS || 3400;
    const updraftRadius = Config.HYDROTHERMAL_VENTS?.UPDRAFT_RADIUS || 95;
    const energyRegen = Config.HYDROTHERMAL_VENTS?.REST_ENERGY_REGEN || 0.00022;

    for (let i = 0; i < this.vents.length; i++) {
      const vent = this.vents[i];
      vent.pulsePhase += dt * 0.0016;
      vent.bubbleTimer += dt;

      // Emit new rising bubble ring
      if (vent.bubbleTimer > bubbleInterval) {
        vent.bubbleTimer = 0;
        if (vent.bubbles.length < 12) {
          vent.bubbles.push({
            x: vent.baseX + (Math.random() - 0.5) * 16,
            y: vent.baseY - 10,
            vx: (Math.random() - 0.5) * 0.12,
            vy: 0.16 + Math.random() * 0.08,
            radius: 3.5,
            maxRadius: 18 + Math.random() * 10,
            alpha: 0.70,
            life: 1.0,
            wobblePhase: Math.random() * Math.PI * 2,
          });
        }
      }

      // Update active bubble rings
      for (let b = vent.bubbles.length - 1; b >= 0; b--) {
        const bubble = vent.bubbles[b];
        bubble.life -= dt * 0.00014;
        if (bubble.life <= 0 || bubble.y < this._height * 0.60) {
          const last = vent.bubbles.pop();
          if (b < vent.bubbles.length) vent.bubbles[b] = last;
          continue;
        }
        bubble.y -= bubble.vy * (dt / 16.67);
        bubble.x += (bubble.vx + this.wind.x * 0.15) * (dt / 16.67) + Math.sin(bubble.wobblePhase + now * 0.0025) * 0.22;
        bubble.radius = Math.min(bubble.maxRadius, bubble.radius + dt * 0.006);
      }

      // Creature basking & Tibetan bowl resonance
      for (let c = 0; c < this.creatures.length; c++) {
        const cr = this.creatures[c];
        if (!cr.isAlive) continue;
        const dx = Math.abs(cr.position.x - vent.baseX);
        const dy = vent.baseY - cr.position.y;
        if (dx < updraftRadius && dy > 0 && dy < 180) {
          cr.ventBasking = Math.min(1.0, cr.ventBasking + dt * 0.0015);
          cr.energy = Math.min(1.0, cr.energy + dt * energyRegen);
          cr.fatigue = Math.max(0.0, cr.fatigue - dt * 0.0001);

          if ((cr.isAncestral || cr.radius > 18) && (now - vent.lastSingingBowlTime > 16_000)) {
            vent.lastSingingBowlTime = now;
            this.audio.playTibetanBowl(vent.baseX / this._width, vent.baseY / this._height);
            cr.experiencePeace(0.18);
          }
        }
      }
    }
  }

  _updateAuroraNursery(now, dt) {
    const auroraH = this._height * (Config.AURORA_NURSERY?.HEIGHT_RATIO || 0.20);
    const growthBoost = Config.AURORA_NURSERY?.GROWTH_BOOST || 0.00015;
    const trailRate = Config.AURORA_NURSERY?.SHIMMER_TRAIL_RATE || 120;

    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      if (!c.isAlive) continue;

      if (c.position.y < auroraH) {
        c.auroraShimmer = 1.0;
        if (c.growthProgress < 1.0) {
          c.growthProgress = Math.min(1.0, c.growthProgress + dt * growthBoost);
        }
        if (now - this.aurora.lastChimeTime > 14_000) {
          this.aurora.lastChimeTime = now;
          this.audio.playAuroraChimes(c.position.x / this._width);
        }
      }

      // Generate silver stardust particles behind shimmered creatures
      if (c.auroraShimmer > 0.15 && c.auroraTrailTimer > trailRate) {
        c.auroraTrailTimer = 0;
        if (this.aurora.shimmerDust.length < 50) {
          this.aurora.shimmerDust.push({
            x: c.position.x + (Math.random() - 0.5) * c.radius * 0.8,
            y: c.position.y + (Math.random() - 0.5) * c.radius * 0.8,
            vx: (Math.random() - 0.5) * 0.06,
            vy: -0.04 - Math.random() * 0.04,
            alpha: 0.85 * c.auroraShimmer,
            life: 1.0,
            size: 1.2 + Math.random() * 1.6,
          });
        }
      }
    }

    // Advance silver stardust
    for (let d = this.aurora.shimmerDust.length - 1; d >= 0; d--) {
      const dust = this.aurora.shimmerDust[d];
      dust.life -= dt * 0.0012;
      if (dust.life <= 0) {
        const last = this.aurora.shimmerDust.pop();
        if (d < this.aurora.shimmerDust.length) this.aurora.shimmerDust[d] = last;
        continue;
      }
      dust.x += dust.vx * (dt / 16.67);
      dust.y += dust.vy * (dt / 16.67);
    }
  }

  _updateSpores(now, dt) {
    if (this.activeSpores.length === 0) return;
    for (let i = this.activeSpores.length - 1; i >= 0; i--) {
      const spore = this.activeSpores[i];
      spore.life -= dt / spore.maxLife;
      if (spore.life <= 0) {
        const last = this.activeSpores.pop();
        if (i < this.activeSpores.length) this.activeSpores[i] = last;
        continue;
      }
      spore.x += (spore.vx + this.wind.x * 0.5) * (dt / 16.67);
      spore.y += (spore.vy + this.wind.y * 0.2) * (dt / 16.67);

      // Boundaries clamp
      if (spore.x < 0 || spore.x > this._width || spore.y < 0 || spore.y > this._height) {
        const last = this.activeSpores.pop();
        if (i < this.activeSpores.length) this.activeSpores[i] = last;
        continue;
      }

      // Creatures can consume spores
      for (let j = 0; j < this.creatures.length; j++) {
        const c = this.creatures[j];
        if (!c.isAlive) continue;
        const d = Math.hypot(c.position.x - spore.x, c.position.y - spore.y);
        if (d < c.radius + spore.radius + 6) {
          c.energy = Math.min(1.0, c.energy + spore.nutrition);
          c.experiencePeace(0.12);
          this.particles.emitDreamMote(spore.x, spore.y, spore.color);
          const last = this.activeSpores.pop();
          if (i < this.activeSpores.length) this.activeSpores[i] = last;
          break;
        }
      }
    }
  }

  _updatePlayerCalls(now, dt) {
    if (this.playerCalls.length === 0) return;
    for (let i = this.playerCalls.length - 1; i >= 0; i--) {
      const call = this.playerCalls[i];
      call.life -= call.decay * dt;
      call.radius += ((call.maxRadius - call.radius) * 0.045) * (dt / 16.67);
      if (call.life <= 0) {
        const last = this.playerCalls.pop();
        if (i < this.playerCalls.length) this.playerCalls[i] = last;
      }
    }
  }

  _updatePendingChirps(dt) {
    if (this._pendingChirps.length === 0) return;
    for (let i = this._pendingChirps.length - 1; i >= 0; i--) {
      const pc = this._pendingChirps[i];
      pc.timeRemaining -= dt;
      if (pc.timeRemaining <= 0) {
        if (pc.creature.isAlive) {
          this.audio.playCreatureChirp(pc.creature, this._width, this._height);
          this.particles.emitDreamMote(pc.creature.position.x, pc.creature.position.y, pc.creature.color);
        }
        const last = this._pendingChirps.pop();
        if (i < this._pendingChirps.length) this._pendingChirps[i] = last;
      }
    }
  }

  // ── Event subscriptions ───────────────────────────────────────────────────

  _subscribeToEvents() {
    // Diary entries
    globalBus.on(Events.CREATURE_TRANSFORMED,  c       => this.diary.add(`${c.name} atravessou e se transformou.`));
    globalBus.on(Events.CREATURE_TRANSCENDED,  c       => this.diary.add(`✨ ${c.name} transcendeu — uma forma jamais vista.`));
    globalBus.on(Events.CREATURE_DISSOLVED,    c       => this.diary.add(`${c.name} desfez-se no mundo oposto.`));
    globalBus.on(Events.CREATURE_HYBRID,       c       => this.diary.add(`${c.name} existe agora em ambos os mundos.`));
    globalBus.on(Events.INTERACTION_SYMBIOSIS, (a, b)  => this.diary.add(`${a.name} e ${b.name} tornaram-se um.`));
    globalBus.on(Events.INTERACTION_EXPLOSION, (a, b)  => this.diary.add(`${a.name} e ${b.name} explodiram — novos seres surgiram.`));
    globalBus.on(Events.CREATURE_DANCE,        (a, b)  => this.diary.add(`💫 ${a.name} e ${b.name} uniram-se na dança dos opostos.`));
    globalBus.on(Events.NECTAR_SPAWNED,        ()      => this.diary.add(`🍯 Uma gota de néctar celeste condensou-se no mundo.`));
    globalBus.on(Events.RARE_ECLIPSE,          ()      => this.diary.add(`🌑 O limiar desapareceu. Os mundos se fundiram.`));
    globalBus.on(Events.RARE_ECLIPSE_END,      ()      => this.diary.add(`O limiar retornou. A ordem foi restaurada.`));
    globalBus.on(Events.RARE_SINGULARITY,      c       => this.diary.add(`${c.name} cresceu infinitamente e desapareceu.`));
    globalBus.on(Events.RARE_WITNESS,          c       => this.diary.add(`👁️ ${c.name} parou. Por um momento, olhou para você.`));
    globalBus.on(Events.RARE_CHAIN,            cs      => this.diary.add(`Uma cadeia de ${cs.length} criaturas cruzou o limiar juntas.`));

    // Autonomous Consciousness & Decisions
    globalBus.on(Events.CREATURE_INQUISITIVE,  e       => this.diary.add(e.text));
    globalBus.on(Events.CREATURE_CAUTIOUS,     e       => this.diary.add(e.text));
    globalBus.on(Events.CREATURE_FORAGING,     e       => this.diary.add(e.text));
    globalBus.on(Events.CREATURE_YEARNING,     e       => this.diary.add(e.text));

    // Legendary Mythic Awakening
    globalBus.on(Events.CREATURE_LEGENDARY, ({ creature, traitName }) => {
      this.diary.add(`🌟 DESPERTAR MÍTICO: ${creature.name} manifestou a mutação lendária «${traitName}»!`);
      this.bestiary.unlock('transcendent', creature);
    });

    // Birth of new generation offspring from the sacred dance
    globalBus.on(Events.CREATURE_BORN, ({ parentA, parentB, position }) => {
      const childDna = DNA.crossover(parentA.dna, parentB.dna, 0.14, 0.22);
      const childZone = Math.random() < 0.5 ? parentA.originZone : parentB.originZone;
      const child = new Creature({
        position: position.clone(),
        zone: childZone,
        dna: childDna,
      });
      child.generation = Math.max(parentA.generation || 1, parentB.generation || 1) + 1;
      child.radius = Config.CREATURE.MIN_RADIUS * 1.15; // starts as a small juvenile
      child.baseRadius = child.radius;
      child.energy = 0.95;

      this._addCreature(child);
      this.particles.emitTransformBurst(position.x, position.y, child.color);
      this.bestiary.registerCreature(child);

      const roman = World._ROMAN_GENS[Math.min(9, child.generation - 1)] || child.generation;
      this.diary.add(`🌱 Da dança sagrada de ${parentA.name} e ${parentB.name}, nasceu ${child.name} (Geração ${roman}).`);

      if (child.legendaryTrait) {
        globalBus.emit(Events.CREATURE_LEGENDARY, {
          creature: child,
          trait: child.legendaryTrait,
          traitName: child.legendaryName,
        });
      }
    });

    // Bestiary unlocks
    globalBus.on(Events.CREATURE_TRANSFORMED,  c       => this.bestiary.unlock('transformed', c));
    globalBus.on(Events.CREATURE_CROSSING,     c       => this.bestiary.unlock('crossing', c));
    globalBus.on(Events.CREATURE_TRANSCENDED,  c       => this.bestiary.unlock('transcendent', c));
    globalBus.on(Events.CREATURE_HYBRID,       c       => this.bestiary.unlock('hybrid', c));
    globalBus.on(Events.INTERACTION_SYMBIOSIS, (a)     => this.bestiary.unlock('symbiosis', a));
    globalBus.on(Events.RARE_ECLIPSE,          ()      => this.bestiary.unlock('eclipse'));
    globalBus.on(Events.RARE_WITNESS,          ()      => this.bestiary.unlock('witness'));
    globalBus.on(Events.RARE_CHAIN,            ()      => this.bestiary.unlock('chain'));

    // Audio harp plucking when threshold moves
    globalBus.on(Events.THRESHOLD_MOVED,       y       => this.audio.pluckThreshold(y / this._height));
  }
}
