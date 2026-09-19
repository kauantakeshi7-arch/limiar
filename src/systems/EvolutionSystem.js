import { CreatureState } from '../entities/Creature.js';
import { Config } from '../core/Config.js';
import { Random } from '../utils/Random.js';
import { globalBus, Events } from '../core/EventEmitter.js';

/**
 * EvolutionSystem — Manages creature lifecycle state transitions.
 *
 * Responsibilities:
 *   - Detect zone changes and initiate crossings.
 *   - Advance transformation progress over time.
 *   - Resolve transformation outcomes (TRANSFORMED, HYBRID, TRANSCENDENT, DISSOLVING).
 *   - Trigger and resolve rare events (Eclipse, Singularity, Witness, Chain).
 */
export class EvolutionSystem {
  constructor() {
    /** Active rare event states */
    this._eclipseActive     = false;
    this._eclipseEndTime    = 0;
    this._singularityTarget = null;
    this._singularityEnd    = 0;
    this._chainCooldown     = 0;
  }

  // ── Main update ───────────────────────────────────────────────────────────

  /**
   * @param {import('../entities/Creature.js').Creature[]} creatures
   * @param {import('../world/Threshold.js').Threshold} threshold
   * @param {number} now - Performance.now() timestamp.
   * @param {number} dt  - Delta in ms.
   * @param {import('../fx/ParticleSystem.js').ParticleSystem} particles
   * @param {import('../fx/AudioEngine.js').AudioEngine} audio
   */
  update(creatures, threshold, now, dt, particles, audio) {
    this._updateZoneDetection(creatures, threshold, now);
    this._updateTransformations(creatures, now, dt, particles, audio);
    this._updateColorInterpolation(creatures, dt);
    this._updateRareEvents(creatures, threshold, now, dt, particles, audio);
    this._updateAging(creatures, dt, particles);
  }

  // ── Zone detection ────────────────────────────────────────────────────────

  _updateZoneDetection(creatures, threshold, now) {
    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i];
      if (!creature.isAlive) continue;

      const currentZone = threshold.getZoneAtY(creature.position.y);
      const zoneChanged = currentZone !== creature.zone;
      creature.zone = currentZone;

      if (!zoneChanged) continue;

      // Entered home zone → return to NATIVE
      if (currentZone === creature.originZone) {
        this._returnToNative(creature);
        continue;
      }

      // Entered threshold band → become HYBRID (if NATIVE or already crossing)
      if (currentZone === Config.ZONE.THRESHOLD) {
        if (creature.state === CreatureState.NATIVE && Random.chance(Config.EVOLUTION.HYBRID_CHANCE)) {
          creature.transitionTo(CreatureState.HYBRID);
          globalBus.emit(Events.CREATURE_HYBRID, creature);
        }
        continue;
      }

      // Entered foreign zone
      if (currentZone !== creature.originZone && currentZone !== Config.ZONE.THRESHOLD) {
        if (creature.state === CreatureState.NATIVE || creature.state === CreatureState.HYBRID) {
          this._startCrossing(creature, now);
        }
      }
    }
  }

  _startCrossing(creature, now) {
    creature.crossingStartTime = now;
    creature.crossingCount++;
    creature.transformProgress = 0;
    creature.transitionTo(CreatureState.CROSSING);
    globalBus.emit(Events.CREATURE_CROSSING, creature);
  }

  _returnToNative(creature) {
    creature.transformProgress = 0;
    creature.transitionTo(CreatureState.NATIVE);
  }

  // ── Transformation progress ───────────────────────────────────────────────

  _updateTransformations(creatures, now, dt, particles, audio) {
    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i];
      if (!creature.isAlive) continue;

      if (creature.state === CreatureState.CROSSING) {
        this._advanceCrossing(creature, now, particles, audio);
      }

      if (creature.state === CreatureState.DISSOLVING) {
        this._advanceDissolution(creature, now, particles, audio);
      }

      if (creature.state === CreatureState.WITNESS) {
        creature.witnessTimer -= dt;
        if (creature.witnessTimer <= 0) {
          creature.transitionTo(CreatureState.NATIVE);
        }
      }

      if (creature.singularityGrow) {
        creature.radius = Math.min(Config.CREATURE.MAX_RADIUS * 1.5, creature.radius * 1.003);
      }
    }
  }

  _advanceCrossing(creature, now, particles, audio) {
    const elapsed  = now - creature.crossingStartTime;
    const duration = creature.dna.transformDurationMs;

    // Apply memory bonus if this creature has crossed before
    const speedMult = creature.crossingCount > Config.EVOLUTION.MEMORY_THRESHOLD
      ? Config.EVOLUTION.MEMORY_SPEED_BONUS
      : 1;

    creature.transformProgress = Math.min(1, (elapsed * speedMult) / duration);

    // Emit occasional transform particles
    if (Random.chance(0.08)) {
      particles.emitTransformBurst(creature.position.x, creature.position.y, creature.color);
    }

    // Transformation complete
    if (creature.transformProgress >= 1) {
      this._resolveTransformation(creature, now, particles, audio);
    }
  }

  _resolveTransformation(creature, now, particles, audio) {
    // Rare: TRANSCENDENCE — only on first crossing to opposite zone
    if (Random.chance(Config.EVOLUTION.TRANSCENDENCE_CHANCE)) {
      creature.transitionTo(CreatureState.TRANSCENDENT);
      creature.radius = creature.baseRadius * 1.6;
      particles.emitTranscendBurst(creature.position.x, creature.position.y);
      audio.playTranscendence(creature.position.x, creature.position.y);
      globalBus.emit(Events.CREATURE_TRANSCENDED, creature);
      return;
    }

    // TRANSFORMED — survives in foreign zone for a time before dissolving
    creature.transitionTo(CreatureState.TRANSFORMED);
    creature.crossingStartTime = now; // reuse timer for dissolve delay
    audio.playTransformation(creature.position.x, creature.position.y);
    globalBus.emit(Events.CREATURE_TRANSFORMED, creature);
  }

  _advanceDissolution(creature, now, particles, audio) {
    if (Random.chance(0.05)) {
      particles.emitDissolveBurst(creature.position.x, creature.position.y, creature.color);
    }

    creature.radius = Math.max(0, creature.radius - 0.04);
    creature.color.a = Math.max(0, creature.color.a - 0.003);

    if (creature.radius <= 1 || creature.color.a <= 0) {
      creature.isAlive = false;
      audio.playDissolution(creature.position.x, creature.position.y);
      globalBus.emit(Events.CREATURE_DISSOLVED, creature);
    }
  }

  // ── Color interpolation ───────────────────────────────────────────────────

  _updateColorInterpolation(creatures, dt) {
    const lerpSpeed = 0.03;
    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i];
      if (!creature.isAlive) continue;
      creature.refreshTargetColor();
      const cur = creature.color;
      const tgt = creature.targetColor;
      const dh = Math.abs(tgt.h - cur.h);
      const ds = Math.abs(tgt.s - cur.s);
      const dl = Math.abs(tgt.l - cur.l);
      const da = Math.abs(tgt.a - cur.a);
      if (dh > 0.15 || ds > 0.15 || dl > 0.15 || da > 0.003) {
        cur.lerpMut(tgt, lerpSpeed);
      }
    }
  }

  // ── TRANSFORMED → DISSOLVING transition ──────────────────────────────────

  /**
   * Called by World after the dissolve delay has elapsed for a TRANSFORMED creature.
   */
  beginDissolution(creature) {
    if (creature.state !== CreatureState.TRANSFORMED) return;
    if (Random.chance(Config.EVOLUTION.TRANSCENDENCE_CHANCE)) {
      creature.transitionTo(CreatureState.TRANSCENDENT);
      return;
    }
    creature.transitionTo(CreatureState.DISSOLVING);
  }

  // ── Rare events ───────────────────────────────────────────────────────────

  _updateRareEvents(creatures, threshold, now, dt, particles, audio) {
    this._checkEclipse(threshold, now, audio);
    this._checkSingularity(creatures, now, audio, particles);
    this._checkWitness(creatures, now);
    this._checkChain(creatures, threshold, now, dt);
  }

  _checkEclipse(threshold, now, audio) {
    if (!threshold.eclipseActive && Random.chance(Config.RARE.ECLIPSE_CHANCE)) {
      threshold.eclipseActive = true;
      this._eclipseEndTime    = now + Config.RARE.ECLIPSE_DURATION_MS;
      globalBus.emit(Events.RARE_ECLIPSE);
      audio.playTranscendence();
    }

    if (threshold.eclipseActive && now >= this._eclipseEndTime) {
      threshold.eclipseActive = false;
      globalBus.emit(Events.RARE_ECLIPSE_END);
    }
  }

  _checkSingularity(creatures, now, audio, particles) {
    if (this._singularityTarget) {
      if (!this._singularityTarget.isAlive) {
        this._singularityTarget = null;
        return;
      }
      if (now >= this._singularityEnd) {
        this._singularityTarget.singularityGrow = false;
        this._singularityTarget.isAlive = false;
        particles.emitTranscendBurst(
          this._singularityTarget.position.x,
          this._singularityTarget.position.y,
        );
        globalBus.emit(Events.RARE_SINGULARITY, this._singularityTarget);
        this._singularityTarget = null;
      }
      return;
    }

    if (creatures.length < 3) return;
    if (!Random.chance(Config.RARE.SINGULARITY_CHANCE)) return;

    let nativeCount = 0;
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (c.isAlive && c.state === CreatureState.NATIVE) nativeCount++;
    }
    if (!nativeCount) return;

    let pick = Math.floor(Math.random() * nativeCount);
    let target = null;
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (c.isAlive && c.state === CreatureState.NATIVE) {
        if (pick === 0) { target = c; break; }
        pick--;
      }
    }
    if (!target) return;

    target.singularityGrow = true;
    this._singularityTarget = target;
    this._singularityEnd    = now + Config.RARE.SINGULARITY_DURATION_MS;
    globalBus.emit(Events.RARE_SINGULARITY, target);
    audio.playTranscendence(target.position.x, target.position.y);
  }

  _checkWitness(creatures, now) {
    if (!Random.chance(Config.RARE.WITNESS_CHANCE)) return;

    let nativeCount = 0;
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (c.isAlive && c.state === CreatureState.NATIVE) nativeCount++;
    }
    if (!nativeCount) return;

    let pick = Math.floor(Math.random() * nativeCount);
    let witness = null;
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (c.isAlive && c.state === CreatureState.NATIVE) {
        if (pick === 0) { witness = c; break; }
        pick--;
      }
    }
    if (!witness) return;

    witness.transitionTo(CreatureState.WITNESS);
    witness.witnessTimer = Config.RARE.WITNESS_DURATION_MS;
    globalBus.emit(Events.RARE_WITNESS, witness);
  }

  _checkChain(creatures, threshold, now, dt) {
    this._chainCooldown -= dt;
    if (this._chainCooldown > 0) return;

    // Fast indexed count of native creatures near the threshold
    let nearCount = 0;
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (!c.isAlive || c.state !== CreatureState.NATIVE) continue;
      if (Math.abs(c.position.y - threshold.y) < 60) nearCount++;
    }

    if (nearCount >= Config.RARE.CHAIN_MIN_COUNT) {
      this._chainCooldown = 30000; // 30s cooldown
      const nearThreshold = [];
      for (let i = 0; i < creatures.length; i++) {
        const c = creatures[i];
        if (c.isAlive && c.state === CreatureState.NATIVE && Math.abs(c.position.y - threshold.y) < 60) {
          nearThreshold.push(c);
        }
      }
      globalBus.emit(Events.RARE_CHAIN, nearThreshold);
    }
  }

  // ── Natural aging ─────────────────────────────────────────────────────────

  /**
   * Age all living creatures. When a creature reaches ~85% of its maxAge,
   * it enters a graceful decline: radius shrinks, color fades, eventually dies.
   * This creates natural turnover and prevents the world from feeling static.
   *
   * @param {import('../entities/Creature.js').Creature[]} creatures
   * @param {number} dt
   * @param {import('../fx/ParticleSystem.js').ParticleSystem} particles
   */
  _updateAging(creatures, dt, particles) {
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (!c.isAlive) continue;
      // Transcendent and symbiotic creatures are exempt from aging
      if (c.state === CreatureState.TRANSCENDENT ||
          c.state === CreatureState.SYMBIOTIC    ||
          c.state === CreatureState.DISSOLVING) continue;

      c.age += dt;

      // Enter decline at 85% of lifespan
      if (!c.isAging && c.age > c.maxAge * 0.85) {
        c.isAging = true;
        // Emit a soft signal — a few slow particles drifting upward
        particles.emitTransformBurst(c.position.x, c.position.y, c.color.withAlpha(0.3));
        c.expressThought(`${c.name} contempla serenamente seus últimos ciclos vitais.`);
      }

      if (c.isAging) {
        // Very gradual decline over the final 15% of lifespan
        const declineRate = 1 / (c.maxAge * 0.15);
        c.radius    = Math.max(2, c.radius - c.baseRadius * declineRate * dt);
        c.baseRadius = c.radius;
        // Fade alpha gently
        if (c.color.a > 0.05) {
          c.color.a = Math.max(0.05, c.color.a - 0.0002 * dt);
        }
        // Natural death when too small
        if (c.radius <= 2.5) {
          c.isAlive = false;
          particles.emitDissolveBurst(c.position.x, c.position.y, c.color);
        }
      }
    }
  }
}

