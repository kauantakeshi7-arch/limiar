import { Vector2 } from '../utils/Vector2.js';
import { Random } from '../utils/Random.js';
import { Config } from '../core/Config.js';
import { CreatureState } from '../entities/Creature.js';

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
    */
  update(creatures, threshold, dt, wind, touchPoints = [], activeNectar = null) {
    const dtC  = Math.min(dt, 50);
    const alive = creatures.filter(c => c.isAlive);

    for (const creature of alive) {
      if (creature.state === CreatureState.SYMBIOTIC && creature.bondedWith) continue;
      if (creature.state === CreatureState.WITNESS) continue;
      if (creature.isDancing) continue;

      const steering = this._computeSteering(creature, alive, threshold, wind, touchPoints, activeNectar);
      this._integrate(creature, steering, dtC);
    }

    this._updateSymbioticPairs(alive, threshold, wind, dtC);
    this._updateDancingPairs(alive, dtC);

    // Final boundary clamp guarantee for all alive entities
    for (const creature of alive) {
      this._clampToBounds(creature);
    }
  }

  // ── Steering composition ──────────────────────────────────────────────────

  _computeSteering(creature, allCreatures, threshold, wind, touchPoints = [], activeNectar = null) {
    const wander   = this._wander(creature);
    const flock    = this._flocking(creature, allCreatures);
    const zoneAttr = this._zoneAttraction(creature, threshold);
    const boundary = this._boundary(creature);
    const threshAv = this._thresholdAvoidance(creature, threshold);

    // Dynamic reaction to player touch (inlined scalar math)
    let touchX = 0, touchY = 0;
    const px = creature.position.x;
    const py = creature.position.y;

    for (let i = 0; i < touchPoints.length; i++) {
      const pt = touchPoints[i];
      const dx = pt.x - px;
      const dy = pt.y - py;
      const distSq = dx * dx + dy * dy;
      if (distSq < 16900 && distSq > 1) { // 130px radius
        const dist = Math.sqrt(distSq);
        const factor = (1 - dist / 130) * (1 - dist / 130);
        const invD = 1 / dist;
        if (creature.dna.adaptation > 0.52) {
          touchX += dx * invD * (factor * 1.3);
          touchY += dy * invD * (factor * 1.3);
        } else {
          touchX -= dx * invD * (factor * 2.4);
          touchY -= dy * invD * (factor * 2.4);
        }
        if (creature.isSleeping && factor > 0.2) {
          creature.wake();
        }
      }
    }

    // Attraction to celestial nectar droplet (inlined scalar math)
    let nectarX = 0, nectarY = 0;
    if (activeNectar && activeNectar.life > 0) {
      const attractRadius = Config.ECOSYSTEM?.NECTAR_ATTRACT_DIST || 240;
      const dx = activeNectar.x - px;
      const dy = activeNectar.y - py;
      const distSq = dx * dx + dy * dy;
      if (distSq < attractRadius * attractRadius && distSq > 16) {
        const dist = Math.sqrt(distSq);
        const factor = 1 - dist / attractRadius;
        const invD = 1 / dist;
        nectarX = dx * invD * (factor * 3.2);
        nectarY = dy * invD * (factor * 3.2);
        if (creature.isSleeping && factor > 0.3) {
          creature.wake();
        }
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
                 + nectarX;

    const steerY = wander.y * BOIDS.WANDER
                 + flock.sepY * BOIDS.SEPARATION
                 + flock.cohY * BOIDS.COHESION
                 + flock.alignY * BOIDS.ALIGNMENT
                 + zoneAttr.y * BOIDS.ZONE_ATTRACTION
                 + boundary.y * BOIDS.BOUNDARY
                 + threshAv.y * BOIDS.THRESHOLD_AVOID
                 + (wind?.y || 0) * BOIDS.WIND
                 + touchY
                 + nectarY;

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
    const sepRadius = Config.STEERING.SEPARATION_RADIUS;
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

  /** Zone attraction: gentle pull toward home zone center. */
  _zoneAttraction(creature, threshold) {
    if (creature.state !== CreatureState.NATIVE) return Vector2.zero();

    const homeY = creature.originZone === Config.ZONE.LIGHT
      ? threshold.y * 0.45
      : threshold.y + (this.height - threshold.y) * 0.5;

    const homeCenter = new Vector2(this.width / 2, homeY);
    const toHome = homeCenter.sub(creature.position);
    const dist = toHome.magnitude;

    if (dist < 70) return Vector2.zero();
    return toHome.normalize().scale(Math.min(dist / 300, 1));
  }

  /** Boundary: soft repulsion from canvas edges. */
  _boundary(creature) {
    const { x, y } = creature.position;
    const margin = 40;
    let force = Vector2.zero();

    if (x < margin)               force = force.add(new Vector2((margin - x) / margin, 0));
    if (x > this.width - margin)  force = force.add(new Vector2(-(x - (this.width - margin)) / margin, 0));
    if (y < margin)               force = force.add(new Vector2(0, (margin - y) / margin));
    if (y > this.height - margin) force = force.add(new Vector2(0, -(y - (this.height - margin)) / margin));

    return force;
  }

  /** Threshold avoidance: native creatures shy away from the line. */
  _thresholdAvoidance(creature, threshold) {
    if (creature.state !== CreatureState.NATIVE) return Vector2.zero();

    const distToThreshold = creature.position.y - threshold.y;
    const absD = Math.abs(distToThreshold);
    if (absD > 120) return Vector2.zero();

    const direction = distToThreshold > 0 ? 1 : -1;
    const strength  = 1 - absD / 120;
    return new Vector2(0, direction * strength);
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

    creature.velocity = new Vector2(vx, vy);
  }

  _integrate(creature, steering, dt) {
    let speed = Config.CREATURE.BASE_SPEED * (0.7 + creature.dna.adaptation * 0.6);
    if (creature.isSleeping) {
      speed *= 0.22; // serene sleeping drift
    }
    creature.velocity = creature.velocity
      .add(steering.scale(creature.isSleeping ? 0.03 : 0.1))
      .clampMagnitude(Config.CREATURE.MAX_SPEED * speed);

    creature.position = creature.position.add(creature.velocity.scale(dt * 0.05));

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
        creature.endDance();
        partner.endDance();
        // Disperse with a gentle energy flash & boost
        creature.metabolicFlash = 1.0;
        partner.metabolicFlash = 1.0;
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
