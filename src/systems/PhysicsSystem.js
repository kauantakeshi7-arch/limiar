import { Vector2 } from '../utils/Vector2.js';
import { Random } from '../utils/Random.js';
import { Config } from '../core/Config.js';
import { CreatureState } from '../entities/Creature.js';
import { globalBus, Events } from '../core/EventEmitter.js';

/** Boids steering weights */
const BOIDS = Object.freeze({
  WANDER:           1.0,
  SEPARATION:       1.8,
  COHESION:         0.45,   // gentle pull toward flock center
  ALIGNMENT:        0.60,   // moderate velocity matching
  ZONE_ATTRACTION:  0.15,
  BOUNDARY:         1.5,
  THRESHOLD_AVOID:  0.5,
  WIND:             0.28,
  COHESION_RADIUS:  130,
  ALIGNMENT_RADIUS: 95,
});

/**
 * PhysicsSystem — Full Craig Reynolds boids + wind.
 *
 * Steering behaviors per creature:
 *   Wander · Separation · Cohesion · Alignment · Zone Attraction ·
 *   Boundary Repulsion · Threshold Avoidance · Wind
 *
 * Cohesion and Alignment only apply within the SAME origin zone,
 * so flocks of light and shadow creatures move independently.
 * This creates the characteristic swirling flock motion.
 */
export class PhysicsSystem {
  constructor(width, height) {
    this.width  = width;
    this.height = height;
  }

  onResize(width, height) {
    this.width  = width;
    this.height = height;
  }

  // ── Main update ───────────────────────────────────────────────────────────

  /**
   * @param {import('../entities/Creature.js').Creature[]} creatures
   * @param {import('../world/Threshold.js').Threshold} threshold
   * @param {number} dt - Delta time in ms.
   * @param {{ x: number, y: number }} wind - Current wind vector.
   * @param {Array<{x: number, y: number}>} [touchPoints] - Active player touch points / ripples.
   * @param {{x: number, y: number, life: number}|null} [activeNectar] - Active celestial nectar droplet.
   * @param {number} [now] - Current simulation timestamp.
   * @param {object|null} [tide] - Periodic cosmic tide state.
   * @param {Array<object>} [reefs] - Sanctuary reefs in the world.
   */
  update(creatures, threshold, dt, wind, touchPoints = [], activeNectar = null, now = 0, tide = null, reefs = []) {
    const dtC  = Math.min(dt, 50);
    const time = now || performance.now();

    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i];
      if (!creature.isAlive) continue;
      if (creature.state === CreatureState.SYMBIOTIC && creature.bondedWith) continue;
      if (creature.state === CreatureState.WITNESS) continue;
      if (creature.isDancing) continue;

      const steering = this._computeSteering(creature, creatures, threshold, wind, touchPoints, activeNectar, time, tide, reefs);
      this._integrate(creature, steering, dtC);
    }

    this._updateSymbioticPairs(creatures, threshold, wind, dtC, time);
    this._updateDancingPairs(creatures, dtC);

    // Final boundary clamp and kinematics update guarantee for all alive entities
    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i];
      if (!creature.isAlive) continue;
      this._clampToBounds(creature);
      creature.updateKinematics(dtC, time, creatures);
    }
  }

  // ── Steering composition ──────────────────────────────────────────────────

  _computeSteering(creature, allCreatures, threshold, wind, touchPoints = [], activeNectar = null, now = 0, tide = null, reefs = []) {
    const wander   = this._wander(creature);
    const flock    = this._flocking(creature, allCreatures);
    const zoneAttr = this._zoneAttraction(creature, threshold);
    const boundary = this._boundary(creature);
    const threshAv = this._thresholdAvoidance(creature, threshold);

    // Dynamic reaction to player touch & expanding ripple surf (gentle, poetic reaction)
    let touchX = 0, touchY = 0;
    const px = creature.position.x;
    const py = creature.position.y;
    const maxTouchDist = this.width <= 600 ? 95 : 120;

    for (let i = 0; i < Math.min(touchPoints.length, 4); i++) {
      const pt = touchPoints[i];
      const dx = pt.x - px;
      const dy = pt.y - py;
      const distSq = dx * dx + dy * dy;
      if (distSq < maxTouchDist * maxTouchDist && distSq > 4) {
        const dist = Math.sqrt(distSq);
        const factor = (1 - dist / maxTouchDist);
        const invD = 1 / dist;
        if (creature.dna.adaptation > 0.52) {
          touchX += dx * invD * (factor * 0.72);
          touchY += dy * invD * (factor * 0.72);
        } else {
          touchX -= dx * invD * (factor * 0.88);
          touchY -= dy * invD * (factor * 0.88);
        }
        if (creature.isSleeping && factor > 0.35) {
          creature.wake();
        }
      }
    }

    // Threshold Thermocline Convection & Micro-Eddies
    let thermoX = 0, thermoY = 0;
    const distToThreshold = creature.position.y - threshold.y;
    const absDist = Math.abs(distToThreshold);
    const thermoclineZone = this.width <= 600 ? 80 : 120;

    if (absDist < thermoclineZone) {
      const proximity = (1 - absDist / thermoclineZone);
      // Gentle solar thermal updraft (-Y) above, gentle abyssal sinking downwelling (+Y) below
      const updraft = creature.position.y < threshold.y ? -0.16 : 0.16;
      thermoY = updraft * proximity;
      // Lateral micro-eddy current along membrane ripples
      const tSec = now * 0.001;
      thermoX = Math.cos(px * 0.015 + tSec * 0.9) * 0.18 * proximity;
    }

    // Attraction to celestial nectar droplet (gentle homing drift)
    let nectarX = 0, nectarY = 0;
    if (activeNectar && activeNectar.life > 0) {
      const attractRadius = Config.ECOSYSTEM?.NECTAR_ATTRACT_DIST || 200;
      const dx = activeNectar.x - px;
      const dy = activeNectar.y - py;
      const distSq = dx * dx + dy * dy;
      if (distSq < attractRadius * attractRadius && distSq > 16) {
        const dist = Math.sqrt(distSq);
        const factor = 1 - dist / attractRadius;
        const invD = 1 / dist;
        nectarX = dx * invD * (factor * 1.25);
        nectarY = dy * invD * (factor * 1.25);
        if (creature.isSleeping && factor > 0.4) {
          creature.wake();
        }
      }
    }

    // Conscious AI Decision steering (calm, organic impulses)
    let decisionX = 0, decisionY = 0;
    if (creature.decisionTarget && creature.decision !== 'cruise') {
      const tx = creature.decisionTarget.x ?? creature.decisionTarget.position?.x ?? px;
      const ty = creature.decisionTarget.y ?? creature.decisionTarget.position?.y ?? py;
      const tdx = tx - px;
      const tdy = ty - py;
      const tDist = Math.hypot(tdx, tdy) || 1;
      const invT = 1 / tDist;

      if (creature.decision === 'flee') {
        // Calm retreat from threat or dangerous threshold
        decisionX -= tdx * invT * 1.15;
        decisionY -= tdy * invT * 1.15;
      } else if (creature.decision === 'forage') {
        // Purposeful yet gentle swim toward food / nectar
        decisionX += tdx * invT * 0.95;
        decisionY += tdy * invT * 0.95;
      } else if (creature.decision === 'court') {
        // Serene approach toward opposite dance partner
        decisionX += tdx * invT * 0.80;
        decisionY += tdy * invT * 0.80;
      } else if (creature.decision === 'play') {
        // Inquisitive circling around player's touch
        const tangentX = -tdy * invT;
        const tangentY = tdx * invT;
        decisionX += (tdx * invT * 0.60) + (tangentX * 0.40);
        decisionY += (tdy * invT * 0.60) + (tangentY * 0.40);
      }
    }

    // Periodic Cosmic Tide force (gentle laminar environmental drift)
    let tideX = 0, tideY = 0;
    if (tide && tide.active && tide.factor > 0) {
      tideX = (tide.vector?.x || 0);
      tideY = (tide.vector?.y || 0);
    }

    // Sanctuary Reef Rest Attraction (for tired, hungry, resting, or juvenile creatures)
    let reefX = 0, reefY = 0;
    if (reefs && reefs.length > 0 && (creature.fatigue > 0.35 || creature.energy < 0.65 || creature.growthProgress < 1.0 || creature.decision === 'rest')) {
      const attractDist = Config.SANCTUARIES?.REST_ATTRACT_RADIUS || 140;
      let closestReef = null;
      let closestDistSq = Infinity;
      for (let r = 0; r < reefs.length; r++) {
        const reef = reefs[r];
        if (reef.zone === creature.zone || creature.state === CreatureState.TRANSCENDENT) {
          const rdx = reef.baseX - px;
          const rdy = reef.baseY - py;
          const dsq = rdx * rdx + rdy * rdy;
          if (dsq < closestDistSq) {
            closestDistSq = dsq;
            closestReef = reef;
          }
        }
      }
      if (closestReef && closestDistSq < attractDist * attractDist && closestDistSq > 16) {
        const dist = Math.sqrt(closestDistSq);
        const factor = (1 - dist / attractDist) * 0.45;
        const invD = 1 / dist;
        reefX = (closestReef.baseX - px) * invD * factor;
        reefY = (closestReef.baseY - py) * invD * factor;
      }
    }

    // Combine all steering forces into scalar accumulators (only 1 Vector2 allocated)
    const steerX = wander.x * BOIDS.WANDER
                 + flock.sepX * BOIDS.SEPARATION
                 + flock.cohX * BOIDS.COHESION
                 + flock.alignX * BOIDS.ALIGNMENT
                 + zoneAttr.x * BOIDS.ZONE_ATTRACTION
                 + boundary.x * BOIDS.BOUNDARY
                 + threshAv.x * BOIDS.THRESHOLD_AVOID
                 + (wind?.x || 0) * BOIDS.WIND
                 + touchX
                 + thermoX
                 + nectarX
                 + decisionX
                 + tideX
                 + reefX;

    const steerY = wander.y * BOIDS.WANDER
                 + flock.sepY * BOIDS.SEPARATION
                 + flock.cohY * BOIDS.COHESION
                 + flock.alignY * BOIDS.ALIGNMENT
                 + zoneAttr.y * BOIDS.ZONE_ATTRACTION
                 + boundary.y * BOIDS.BOUNDARY
                 + threshAv.y * BOIDS.THRESHOLD_AVOID
                 + (wind?.y || 0) * BOIDS.WIND
                 + touchY
                 + thermoY
                 + nectarY
                 + decisionY
                 + tideY
                 + reefY;

    return new Vector2(steerX, steerY);
  }

  // ── Individual behaviors ──────────────────────────────────────────────────

  /** Wander: steer toward a jittered point on a projected circle (optimized scalar math). */
  _wander(creature) {
    const { WANDER_RADIUS, WANDER_DISTANCE, WANDER_JITTER } = Config.STEERING;
    const a = Random.float(0, Math.PI * 2);
    const jx = Math.cos(a) * WANDER_JITTER;
    const jy = Math.sin(a) * WANDER_JITTER;

    let tx = creature.wanderTarget.x + jx;
    let ty = creature.wanderTarget.y + jy;
    const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
    tx = (tx / tLen) * WANDER_RADIUS;
    ty = (ty / tLen) * WANDER_RADIUS;
    creature.wanderTarget.x = tx;
    creature.wanderTarget.y = ty;

    let cx = 0, cy = 0;
    const speed = creature.velocity.magnitude;
    if (speed > 0.01) {
      cx = (creature.velocity.x / speed) * WANDER_DISTANCE;
      cy = (creature.velocity.y / speed) * WANDER_DISTANCE;
    } else {
      const a2 = Random.float(0, Math.PI * 2);
      cx = Math.cos(a2) * WANDER_DISTANCE;
      cy = Math.sin(a2) * WANDER_DISTANCE;
    }

    const fx = cx + tx;
    const fy = cy + ty;
    const fLen = Math.sqrt(fx * fx + fy * fy) || 1;
    return { x: fx / fLen, y: fy / fLen };
  }

  /**
   * Unified Flocking: Computes Separation, Cohesion, and Alignment in a SINGLE pass.
   * Eliminates redundant distance calculations, intermediate vector allocations, and reduces loops by 66%.
   */
  _flocking(creature, allCreatures) {
    const isMobile = this.width <= 600;
    const sepRadius = isMobile ? 32 : Config.STEERING.SEPARATION_RADIUS;
    const cohRadius = BOIDS.COHESION_RADIUS;
    const alignRadius = BOIDS.ALIGNMENT_RADIUS;

    const maxDist = Math.max(sepRadius, cohRadius, alignRadius);
    const maxDistSq = maxDist * maxDist;

    let sepX = 0, sepY = 0, sepCount = 0;
    let cohSumX = 0, cohSumY = 0, cohWeightSum = 0;
    let alignSumVx = 0, alignSumVy = 0, alignWeightSum = 0;

    const px = creature.position.x;
    const py = creature.position.y;
    const zone = creature.originZone;

    for (let i = 0; i < allCreatures.length; i++) {
      const other = allCreatures[i];
      if (other === creature) continue;

      const dx = other.position.x - px;
      const dy = other.position.y - py;
      const distSq = dx * dx + dy * dy;

      if (distSq > maxDistSq || distSq < 0.001) continue;
      const dist = Math.sqrt(distSq);

      // 1. Separation (all creatures regardless of zone)
      if (dist < sepRadius) {
        const factor = (1 - dist / sepRadius) / dist;
        sepX -= dx * factor;
        sepY -= dy * factor;
        sepCount++;
      }

      // 2. Cohesion & Alignment (same zone only)
      if (other.originZone === zone) {
        if (dist < cohRadius) {
          const w = 1 - dist / cohRadius;
          cohSumX += other.position.x * w;
          cohSumY += other.position.y * w;
          cohWeightSum += w;
        }
        if (dist < alignRadius) {
          const w = 1 - dist / alignRadius;
          alignSumVx += other.velocity.x * w;
          alignSumVy += other.velocity.y * w;
          alignWeightSum += w;
        }
      }
    }

    // Process Separation force
    let sepForceX = 0, sepForceY = 0;
    if (sepCount > 0) {
      sepForceX = sepX / sepCount;
      sepForceY = sepY / sepCount;
    }

    // Process Cohesion force
    let cohForceX = 0, cohForceY = 0;
    if (cohWeightSum > 0.01) {
      const toCenterX = (cohSumX / cohWeightSum) - px;
      const toCenterY = (cohSumY / cohWeightSum) - py;
      const cDist = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY);
      if (cDist >= 15) {
        cohForceX = toCenterX / cDist;
        cohForceY = toCenterY / cDist;
      }
    }

    // Process Alignment force
    let alignForceX = 0, alignForceY = 0;
    if (alignWeightSum > 0.01) {
      const avgVx = alignSumVx / alignWeightSum;
      const avgVy = alignSumVy / alignWeightSum;
      const vMag = Math.sqrt(avgVx * avgVx + avgVy * avgVy);
      if (vMag >= 0.001) {
        alignForceX = avgVx / vMag;
        alignForceY = avgVy / vMag;
      }
    }

    return {
      sepX: sepForceX, sepY: sepForceY,
      cohX: cohForceX, cohY: cohForceY,
      alignX: alignForceX, alignY: alignForceY
    };
  }

  /** Zone attraction: gentle pull toward home zone center (zero-allocation scalar math). */
  _zoneAttraction(creature, threshold) {
    if (creature.state !== CreatureState.NATIVE) return { x: 0, y: 0 };

    const homeY = creature.originZone === Config.ZONE.LIGHT
      ? threshold.y * 0.45
      : threshold.y + (this.height - threshold.y) * 0.5;

    const dx = (this.width * 0.5) - creature.position.x;
    const dy = homeY - creature.position.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 70) return { x: 0, y: 0 };
    const scale = Math.min(dist / 300, 1) / dist;
    return { x: dx * scale, y: dy * scale };
  }

  /** Boundary: soft repulsion from canvas edges (zero-allocation scalar math). */
  _boundary(creature) {
    const { x, y } = creature.position;
    const margin = 40;
    let fx = 0, fy = 0;

    if (x < margin)               fx += (margin - x) / margin;
    if (x > this.width - margin)  fx -= (x - (this.width - margin)) / margin;
    if (y < margin)               fy += (margin - y) / margin;
    if (y > this.height - margin) fy -= (y - (this.height - margin)) / margin;

    return { x: fx, y: fy };
  }

  /** Threshold avoidance: native creatures shy away from the line gently (zero-allocation scalar math). */
  _thresholdAvoidance(creature, threshold) {
    if (creature.state !== CreatureState.NATIVE) return { x: 0, y: 0 };

    const distToThreshold = creature.position.y - threshold.y;
    const absD = Math.abs(distToThreshold);
    const avoidDist = this.width <= 600 ? 60 : 95;
    if (absD > avoidDist) return { x: 0, y: 0 };

    const direction = distToThreshold > 0 ? 1 : -1;
    const strength  = (1 - absD / avoidDist) * 0.50;
    return { x: 0, y: direction * strength };
  }

  // ── Integration ───────────────────────────────────────────────────────────

  _clampToBounds(creature) {
    const pad = Math.max(8, creature.radius * 0.8);
    let vx = creature.velocity.x;
    let vy = creature.velocity.y;

    if (creature.position.x < pad) {
      creature.position.x = pad;
      vx = Math.abs(vx) * 0.6;
    } else if (creature.position.x > this.width - pad) {
      creature.position.x = this.width - pad;
      vx = -Math.abs(vx) * 0.6;
    }

    if (creature.position.y < pad) {
      creature.position.y = pad;
      vy = Math.abs(vy) * 0.6;
    } else if (creature.position.y > this.height - pad) {
      creature.position.y = this.height - pad;
      vy = -Math.abs(vy) * 0.6;
    }

    creature.velocity.set(vx, vy);
  }

  _integrate(creature, steering, dt) {
    const isMobile = this.width <= 600;
    let baseSpeed = Config.CREATURE.BASE_SPEED * (0.7 + creature.dna.adaptation * 0.5);
    if (isMobile) baseSpeed *= 0.85; // Extra serene pace on mobile

    // 1. Inércia por Massa: criaturas maiores possuem mais momento e aceleração mais ponderada
    // creature.radius varia tipicamente de 8 a 24 (média ~14)
    const mass = Math.pow(Math.max(0.6, creature.radius / 14), 1.4);

    // 2. Propulsão Rítmica Biológica: Medusas avançam em jatos pulsantes; Arraias batem as asas
    let pulseThrust = 1.0;
    if (!creature.isSleeping) {
      if (creature.bodyPlan === Config.BODY_PLAN.JELLYFISH) {
        const bellSine = Math.sin(creature.pulsePhase);
        if (bellSine > 0.2) {
          // Fase de contração do sino: impulso a jato vigoroso
          pulseThrust = 1.0 + Math.pow((bellSine - 0.2) / 0.8, 2) * 0.75;
        } else {
          // Fase de relaxamento do sino: desaceleração suave por arrasto
          pulseThrust = 0.58;
        }
      } else if (creature.bodyPlan === Config.BODY_PLAN.MANTA) {
        const wingSine = Math.sin(creature.wingPhase);
        // Batimento descendente de asas gera micro-impulso de sustentação
        pulseThrust = 0.85 + Math.max(0, wingSine) * 0.40;
      }
    } else {
      baseSpeed *= 0.22; // serene sleeping drift
    }

    const currentSpeed = baseSpeed * pulseThrust;

    // Viscous hydrodynamic damping (drag):
    // Mass conserves momentum longer in the celestial ether
    const baseDrag = creature.isSleeping ? 0.94 : Math.min(0.98, 0.955 + (mass - 1) * 0.012);
    const dtFactor = Math.min(dt / 16, 2.0);

    // Newton's Second Law: a = (F / m) * pulseThrust
    const accelScale = ((creature.isSleeping ? 0.015 : 0.040) / Math.sqrt(mass)) * dtFactor * pulseThrust;

    creature.velocity.scaleMut(baseDrag);
    creature.velocity.x += steering.x * accelScale;
    creature.velocity.y += steering.y * accelScale;
    creature.velocity.clampMagnitudeMut(Config.CREATURE.MAX_SPEED * currentSpeed);

    // Calm, organic displacement scaled with frame delta (zero allocation)
    creature.position.x += creature.velocity.x * (dt * 0.038);
    creature.position.y += creature.velocity.y * (dt * 0.038);

    // Hard boundary guard: creatures can NEVER escape the visible world
    this._clampToBounds(creature);
    creature.pushTrail();
  }

  // ── Symbiotic pairs ───────────────────────────────────────────────────────

  _updateSymbioticPairs(creatures, threshold, wind, dt) {
    const processed = new Set();

    for (const creature of creatures) {
      if (creature.state !== CreatureState.SYMBIOTIC) continue;
      if (!creature.bondedWith || processed.has(creature.id)) continue;

      const partner = creature.bondedWith;
      processed.add(creature.id);
      processed.add(partner.id);

      const steer = this._computeSteering(creature, creatures, threshold, wind);
      this._integrate(creature, steer.scale(0.5), dt);

      const offset = Vector2.fromAngle(Date.now() * 0.001, creature.radius * 2.2);
      partner.position = creature.position.add(offset);
      partner.velocity = creature.velocity.clone();
      this._clampToBounds(partner);
      partner.pushTrail();
    }
  }

  // ── Courtship dancing pairs ───────────────────────────────────────────────

  _updateDancingPairs(creatures, dt) {
    const processed = new Set();

    for (const creature of creatures) {
      if (!creature.isDancing || !creature.dancePartner || processed.has(creature.id)) continue;
      const partner = creature.dancePartner;
      if (!partner.isAlive) {
        creature.endDance();
        continue;
      }
      processed.add(creature.id);
      processed.add(partner.id);

      creature.danceTimeLeft -= dt;
      partner.danceTimeLeft -= dt;

      if (creature.danceTimeLeft <= 0) {
        const mid = creature.position.add(partner.position).scale(0.5);
        creature.endDance();
        partner.endDance();
        // Disperse with a gentle energy flash & boost
        creature.metabolicFlash = 1.0;
        partner.metabolicFlash = 1.0;
        // Birth of a new generation offspring from the sacred dance
        globalBus.emit(Events.CREATURE_BORN, {
          parentA: creature,
          parentB: partner,
          position: mid,
        });
        continue;
      }

      // Mutual orbit around common center
      const mid = creature.position.add(partner.position).scale(0.5);
      const orbitR = Math.max(20, (creature.radius + partner.radius) * 1.35);

      creature.danceAngle = (creature.danceAngle || 0) + dt * 0.0032;
      partner.danceAngle = creature.danceAngle + Math.PI;

      const offsetC = Vector2.fromAngle(creature.danceAngle, orbitR);
      const offsetP = Vector2.fromAngle(partner.danceAngle, orbitR);

      creature.position = mid.add(offsetC);
      partner.position = mid.add(offsetP);

      creature.velocity = offsetC.perpendicular().normalize().scale(Config.CREATURE.BASE_SPEED * 0.65);
      partner.velocity = offsetP.perpendicular().normalize().scale(Config.CREATURE.BASE_SPEED * 0.65);

      this._clampToBounds(creature);
      this._clampToBounds(partner);

      creature.pushTrail();
      partner.pushTrail();
    }
  }
}
