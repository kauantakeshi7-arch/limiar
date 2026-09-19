import { Config } from '../core/Config.js';
import { CreatureState } from '../entities/Creature.js';
import { Vector2 } from '../utils/Vector2.js';
import { globalBus, Events } from '../core/EventEmitter.js';

/**
 * DecisionSystem — Autonomous Utility AI for conscious decision making.
 *
 * Each creature continuously perceives its surroundings, manages internal
 * emotional/vital drives (energy, fear, sociability, curiosity, fatigue),
 * and selects the highest-utility action:
 *   - 'flee':    Evade threat or retreat from hazardous threshold
 *   - 'forage':  Seek celestial nectar or favorite nourishing waters
 *   - 'court':   Approach opposite-zone creature at the membrane to dance
 *   - 'play':    Follow player's touch and ripples with inquisitive wonder
 *   - 'rest':    Enter serene dormancy and dream
 *   - 'cruise':  Glide peacefully along ambient currents
 */
export class DecisionSystem {
  constructor() {
    this._diaryCooldowns = new Map();
  }

  /**
   * Update decisions and drives for all living creatures.
   * @param {import('../entities/Creature.js').Creature[]} creatures
   * @param {import('../world/Threshold.js').Threshold} threshold
   * @param {Array<{x:number, y:number}>} [disturbances] - Player touches and ripples
   * @param {{x:number, y:number, charges:number}|null} [activeNectar]
   * @param {number} dt - Frame delta in ms
   * @param {number} now - Timestamp
   */
  update(creatures, threshold, disturbances = [], activeNectar = null, dt = 16, now = 0) {
    const visionRange = Config.AI.VISION_RANGE || 190;

    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (!c.isAlive) continue;

      // ── 1. Advance drives ─────────────────────────────────────────────────
      this._updateDrives(c, threshold, dt);

      // Decrement decision timers
      c.decisionTimer -= dt;
      if (c.decisionLockMs > 0) {
        c.decisionLockMs -= dt;
      }

      // Staggered AI thinking: evaluate every ~160ms unless locked or urgent
      if (c.decisionTimer > 0 && c.decisionLockMs > 0) continue;
      c.decisionTimer = Config.AI.DECISION_INTERVAL_MS * (0.8 + Math.random() * 0.4);

      // In special fixed states, skip normal utility evaluation
      if (c.isDancing || c.state === CreatureState.TRANSCENDENT || c.state === CreatureState.WITNESS) {
        continue;
      }

      // ── 2. Sensory Perception Sweep ───────────────────────────────────────
      const senses = this._perceive(c, creatures, threshold, disturbances, activeNectar, visionRange);

      // ── 3. Utility Evaluation ─────────────────────────────────────────────
      const prevDecision = c.decision;
      this._evaluateUtility(c, senses, now);

      // Notify player and diary on meaningful conscious decisions
      if (c.decision !== prevDecision && c.decision !== 'cruise') {
        this._recordConsciousEvent(c, senses, now);
      }
    }
  }

  // ── Drive Dynamics ────────────────────────────────────────────────────────

  _updateDrives(creature, threshold, dt) {
    const ai = Config.AI;

    // Passive energy depletion (hunger)
    creature.energy = Math.max(0, creature.energy - ai.HUNGER_RATE * dt);

    // Natural fatigue accumulation
    if (!creature.isSleeping) {
      creature.fatigue = Math.min(1, creature.fatigue + ai.FATIGUE_RATE * dt);
      creature.sociability = Math.min(1, creature.sociability + 0.00006 * dt);
    } else {
      creature.fatigue = Math.max(0, creature.fatigue - 0.0003 * dt);
      if (creature.fatigue <= 0.05) {
        creature.wake();
      }
    }

    // Decay fear and emotional caution over time
    creature.fear = Math.max(0, creature.fear - 0.0004 * dt);
    creature.membraneCaution = Math.max(0, creature.membraneCaution * Math.pow(ai.MEMORY_RETENTION, dt / 16));

    // Zone tension increases fear if creature is crossing and fragile
    if (creature.state === CreatureState.CROSSING) {
      const danger = 1 - creature.dna.resistance;
      creature.fear = Math.min(1, creature.fear + danger * 0.0003 * dt);
    }
  }

  // ── Sensory Perception ────────────────────────────────────────────────────

  _perceive(creature, creatures, threshold, disturbances, activeNectar, visionRange) {
    const px = creature.position.x;
    const py = creature.position.y;
    const facing = creature.facingAngle;
    const fov = Config.AI.VISION_CONE_RAD || Math.PI * 0.75;

    let closestOpposite = null;
    let closestOppositeDist = Infinity;
    let closestThreat = null;
    let closestThreatDist = Infinity;

    // Perceive other creatures
    for (let i = 0; i < creatures.length; i++) {
      const other = creatures[i];
      if (other === creature || !other.isAlive) continue;

      const dx = other.position.x - px;
      const dy = other.position.y - py;
      const dist = Math.hypot(dx, dy);
      if (dist > visionRange) continue;

      // Check field of view cone (creatures see primarily forward)
      const angleTo = Math.atan2(dy, dx);
      let angleDiff = Math.abs(angleTo - facing);
      if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
      if (angleDiff > fov && dist > 70) continue; // peripheral blindspot beyond 70px

      // Predator / Threat detection (much larger opposite creature)
      const isOpposite = other.originZone !== creature.originZone;
      const sizeRatio = other.radius / (creature.radius || 1);
      if (isOpposite && sizeRatio > 1.4 && dist < closestThreatDist) {
        closestThreat = other;
        closestThreatDist = dist;
      }

      // Potential courtship dance partner (near threshold)
      if (isOpposite && !other.isDancing && !other.isSleeping && dist < closestOppositeDist) {
        closestOpposite = other;
        closestOppositeDist = dist;
      }
    }

    // Perceive closest disturbance / player touch
    let closestDisturbance = null;
    let closestDisturbanceDist = Infinity;
    for (const d of disturbances) {
      const dist = Math.hypot(d.x - px, d.y - py);
      if (dist < visionRange * 1.3 && dist < closestDisturbanceDist) {
        closestDisturbance = d;
        closestDisturbanceDist = dist;
      }
    }

    // Perceive celestial nectar
    let nectarTarget = null;
    if (activeNectar && activeNectar.charges > 0) {
      const nDist = Math.hypot(activeNectar.x - px, activeNectar.y - py);
      if (nDist < visionRange * 1.8) {
        nectarTarget = activeNectar;
      }
    }

    // Threshold membrane proximity
    const distToThreshold = Math.abs(py - threshold.y);

    return {
      closestOpposite,
      closestOppositeDist,
      closestThreat,
      closestThreatDist,
      closestDisturbance,
      closestDisturbanceDist,
      nectarTarget,
      distToThreshold,
    };
  }

  // ── Utility AI Evaluation ─────────────────────────────────────────────────

  _evaluateUtility(creature, senses, now) {
    const scores = {
      flee:   0,
      forage: 0,
      court:  0,
      play:   0,
      rest:   0,
      cruise: 0.22, // baseline contentment
    };

    // 1. Flee Utility: fear + threat proximity + membrane caution
    if (senses.closestThreat) {
      const proximity = 1 - (senses.closestThreatDist / 190);
      scores.flee += proximity * 0.9 + creature.fear * 0.6;
    }
    // If creature has membrane caution and is getting close to the boundary
    if (creature.membraneCaution > 0.2 && senses.distToThreshold < 75) {
      scores.flee += creature.membraneCaution * 0.85;
    }

    // 2. Forage Utility: hunger drive + visible nectar or memory of favorite water
    const hunger = 1 - creature.energy;
    if (senses.nectarTarget) {
      scores.forage = hunger * 1.4 + 0.55;
    } else if (creature.favoriteCoord && hunger > 0.45) {
      const d = Math.hypot(creature.favoriteCoord.x - creature.position.x, creature.favoriteCoord.y - creature.position.y);
      if (d < 30) {
        creature.favoriteCoord = null; // Arrived at past memory, nothing remains
      } else {
        scores.forage = hunger * 0.65;
      }
    }

    // 3. Court Utility: sociability + partner proximity near threshold
    if (senses.closestOpposite && senses.distToThreshold < 95 && !creature.isDancing) {
      const partnerProximity = 1 - (senses.closestOppositeDist / 190);
      scores.court = creature.sociability * 0.8 + partnerProximity * 0.7;
    }

    // 4. Play with Player: curiosity drive + nearby touch ripple
    if (senses.closestDisturbance && creature.curiosity > 0.35 && creature.fear < 0.3) {
      const touchProximity = 1 - (senses.closestDisturbanceDist / 250);
      scores.play = creature.curiosity * 0.9 + touchProximity * 0.6;
    }

    // 5. Rest Utility: fatigue + calm environment
    if (creature.fatigue > 0.65 && scores.flee < 0.2 && !creature.isDancing) {
      scores.rest = creature.fatigue * 1.1;
    }

    // Find highest utility decision (zero allocation scalar comparison)
    let bestDecision = 'cruise';
    let highestScore = scores.cruise;
    if (scores.flee > highestScore)   { highestScore = scores.flee;   bestDecision = 'flee';   }
    if (scores.forage > highestScore) { highestScore = scores.forage; bestDecision = 'forage'; }
    if (scores.court > highestScore)  { highestScore = scores.court;  bestDecision = 'court';  }
    if (scores.play > highestScore)   { highestScore = scores.play;   bestDecision = 'play';   }
    if (scores.rest > highestScore)   { highestScore = scores.rest;   bestDecision = 'rest';   }

    // Assign decision and target
    creature.decision = bestDecision;
    switch (bestDecision) {
      case 'flee':
        creature.decisionTarget = senses.closestThreat
          ? { x: senses.closestThreat.position.x, y: senses.closestThreat.position.y }
          : { x: creature.position.x, y: creature.originZone === Config.ZONE.LIGHT ? threshold.y * 0.35 : threshold.y + 120 };
        creature.decisionLockMs = 1600; // calm commitment to retreat
        if (creature.isSleeping) creature.wake();
        break;

      case 'forage':
        creature.decisionTarget = senses.nectarTarget
          ? { x: senses.nectarTarget.x, y: senses.nectarTarget.y }
          : creature.favoriteCoord;
        creature.decisionLockMs = 1800; // committed forage drift
        if (creature.isSleeping) creature.wake();
        break;

      case 'court':
        creature.decisionTarget = senses.closestOpposite;
        creature.decisionLockMs = 2000; // harmonious approach
        if (creature.isSleeping) creature.wake();
        break;

      case 'play':
        creature.decisionTarget = senses.closestDisturbance;
        creature.decisionLockMs = 1400; // gentle playfulness
        if (creature.isSleeping) creature.wake();
        break;

      case 'rest':
        creature.decisionTarget = null;
        if (!creature.isSleeping) creature.sleep();
        break;

      case 'cruise':
      default:
        creature.decisionTarget = null;
        break;
    }
  }

  // ── Poetic Consciousness Events ───────────────────────────────────────────

  _recordConsciousEvent(creature, senses, now) {
    if (this._diaryCooldowns.size > 60) {
      for (const [k, time] of this._diaryCooldowns) {
        if (now - time > 60_000) this._diaryCooldowns.delete(k);
      }
    }
    const key = `${creature.id}:${creature.decision}`;
    const lastTime = this._diaryCooldowns.get(key) || 0;
    if (now - lastTime < 40_000) return; // serene diary pacing (40s cooldown per conscious act)
    this._diaryCooldowns.set(key, now);

    const name = creature.name;
    const bodyName = this._bodyPlanName(creature.bodyPlan);

    switch (creature.decision) {
      case 'play':
        globalBus.emit(Events.CREATURE_INQUISITIVE, {
          creature,
          text: `✨ ${name} (${bodyName}) sentiu sua presença e aproximou-se com curiosidade.`
        });
        break;

      case 'flee':
        if (creature.membraneCaution > 0.4) {
          globalBus.emit(Events.CREATURE_CAUTIOUS, {
            creature,
            text: `⚠️ ${name} recuou do limiar, lembrando-se da dor da quase dissolução.`
          });
        }
        break;

      case 'forage':
        if (senses.nectarTarget) {
          globalBus.emit(Events.CREATURE_FORAGING, {
            creature,
            text: `🍯 O aroma do néctar atraiu ${name} em nado acelerado.`
          });
        }
        break;

      case 'court':
        if (senses.closestOpposite) {
          globalBus.emit(Events.CREATURE_YEARNING, {
            creature,
            text: `💫 ${name} avistou ${senses.closestOpposite.name} na margem e nadou para cortejá-lo.`
          });
        }
        break;
    }
  }

  _bodyPlanName(bodyPlan) {
    switch (bodyPlan) {
      case Config.BODY_PLAN.MANTA:      return 'Manta Cósmica';
      case Config.BODY_PLAN.JELLYFISH:  return 'Medusa Abissal';
      case Config.BODY_PLAN.SERPENTINE: return 'Serpente do Limiar';
      case Config.BODY_PLAN.CRYSTAL:    return 'Radiolário Sagrado';
      default:                          return 'Blob';
    }
  }
}
