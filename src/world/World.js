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

    // 0. Update wind simulation
    this._updateWind(dt);

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

    // 5. Physics: steering, movement, sleep damping, dance, nectar pull
    this._physics.update(this.creatures, this.threshold, dt, this.wind, touchPoints, this.activeNectar);

    // 5.5. Update active nectar consumption
    this._updateNectar(now, dt);

    // 6. Interactions: collisions, bonding, courtship dance, offspring
    const offspring = this._interaction.update(this.creatures, this.particles, this.audio, now);
    for (const c of offspring) this._addCreature(c);

    // 7. Particles & flora spores
    this.particles.update(dt);
    this.particles.emitThresholdAmbient(this.threshold.y, this._width);
    this._emitFloraSporeChance();

    // 8. Sync audio to creature positions & breathing/diurnal filter
    this.audio.update(now, this.diurnalFactor);
    for (const c of this.creatures) {
      if (c.isAlive) this.audio.updateCreaturePosition(c, this._width);
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
    this.audio.playNectarChime(x / this._width);
    this.particles.emitNectarFeedBurst(x, y);
    globalBus.emit(Events.NECTAR_SPAWNED, this.activeNectar);
  }

  /**
   * Pluck a note along the threshold liquid harp.
   * @param {number} xRatio - 0..1
   */
  pluckHarp(xRatio) {
    this.threshold.addHarpImpulse(xRatio);
    this.audio.pluckHarp(xRatio);
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
    creature.position = new Vector2(cx, cy);

    this.creatures.push(creature);
    this.audio.addCreature(creature);
    this.bestiary.registerCreature(creature);
  }

  _removeDeadCreatures() {
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
      }
    }
    this.creatures.length = writeIdx;
  }

  _checkDissolutionTimeout(now) {
    for (const c of this.creatures) {
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
    for (const c of this.creatures) {
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
    for (const c of this.creatures) {
      if (!c.isAlive) continue;
      const dx = c.position.x - this.activeNectar.x;
      const dy = c.position.y - this.activeNectar.y;
      const dist = Math.hypot(dx, dy);
      if (dist < c.radius + 18) {
        c.consumeNectar(0.45);
        this.activeNectar.charges--;
        this.particles.emitNectarFeedBurst(this.activeNectar.x, this.activeNectar.y);
        this.audio.playNectarChime(this.activeNectar.x / this._width);
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

    for (const c of this.creatures) {
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

      const genRomans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
      const roman = genRomans[Math.min(9, child.generation - 1)] || child.generation;
      this.diary.add(`🌱 Da dança sagrada de ${parentA.name} e ${parentB.name}, nasceu ${child.name} (Geração ${roman}).`);
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
