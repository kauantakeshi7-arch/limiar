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
    this._processedSymbiotic = new Set();
    this._processedDancing   = new Set();
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
   * @param {Array<object>} [vents] - Hydrothermal vents in the world.
   * @param {object|null} [season] - Cosmic season state.
   */
  update(creatures, threshold, dt, wind, touchPoints = [], activeNectar = null, now = 0, tide = null, reefs = [], vents = [], season = null) {
    const dtC  = Math.min(dt, 50);
    const time = now || performance.now();

    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i];
      if (!creature.isAlive) continue;
      if (creature.state === CreatureState.SYMBIOTIC && creature.bondedWith) continue;
      if (creature.state === CreatureState.WITNESS) continue;
      if (creature.isDancing) continue;

      const steering = this._computeSteering(creature, creatures, threshold, wind, touchPoints, activeNectar, time, tide, reefs, vents, season);
      this._integrate(creature, steering, dtC, season);
    }

    // ── Elastic non-penetration relaxation pass ────────────────────────────
    // Guarantees no two creatures overlap after integration.
    // Pure scalar math — zero allocations, runs O(n²) but n ≤ 16 (≈128 ops/frame).
    for (let i = 0; i < creatures.length; i++) {
      const a = creatures[i];
      if (!a.isAlive || a.isDancing) continue;
      for (let j = i + 1; j < creatures.length; j++) {
        const b = creatures[j];
        if (!b.isAlive || b.isDancing) continue;

        const dx      = b.position.x - a.position.x;
        const dy      = b.position.y - a.position.y;
        const distSq  = dx * dx + dy * dy;
        const minDist = a.radius + b.radius;

        if (distSq < minDist * minDist && distSq > 0.001) {
          const dist    = Math.sqrt(distSq);
          const overlap = (minDist - dist) * 0.5;
          const nx      = dx / dist;
          const ny      = dy / dist;
          // Push apart along collision normal — equal share for equal mass
          a.position.x -= nx * overlap;
          a.position.y -= ny * overlap;
          b.position.x += nx * overlap;
          b.position.y += ny * overlap;
        }
      }
    }

    this._updateSymbioticPairs(creatures, threshold, wind, dtC, touchPoints, activeNectar, time, tide, reefs, vents, season);
    this._updateDancingPairs(creatures, dtC);

    // Final boundary clamp, trail push, and kinematics update guarantee for all alive entities
    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i];
      if (!creature.isAlive) continue;
      this._clampToBounds(creature);
      creature.pushTrail();
      creature.updateKinematics(dtC, time, creatures);
    }
  }

  // ── Steering composition ──────────────────────────────────────────────────

  _computeSteering(creature, allCreatures, threshold, wind, touchPoints = [], activeNectar = null, now = 0, tide = null, reefs = [], vents = [], season = null) {
    const wander   = this._wander(creature);
    const flock    = this._flocking(creature, allCreatures);
    const zoneAttr = this._zoneAttraction(creature, threshold);
    // Pass creature's native zone homeY so corner deflection aims at the right territory
    const homeY    = creature.originZone === Config.ZONE.LIGHT
      ? threshold.y * 0.40
      : threshold.y + (this.height - threshold.y) * 0.55;
    const boundary = this._boundary(creature, homeY);
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
    // Within 45px: transitions to tangential soft-orbit so creatures cruise around
    // the reef instead of piling up at its centre point.
    let reefX = 0, reefY = 0;
    if (reefs && reefs.length > 0 && (creature.fatigue > 0.35 || creature.energy < 0.65 || creature.growthProgress < 1.0 || creature.decision === 'rest')) {
      const attractDist = Config.SANCTUARIES?.REST_ATTRACT_RADIUS || 140;
      const orbitBlendDist = 45; // below this: blend radial→tangential
      let closestReef = null;
      let closestDistSq = Infinity;
      for (let r = 0; r < reefs.length; r++) {
        const reef = reefs[r];
        if (reef.zone === creature.originZone || reef.zone === creature.zone || creature.state === CreatureState.TRANSCENDENT) {
          const rdx = reef.baseX - px;
          const rdy = reef.baseY - py;
          const dsq = rdx * rdx + rdy * rdy;
          if (dsq < closestDistSq) {
            closestDistSq = dsq;
            closestReef = reef;
          }
        }
      }
      if (closestReef && closestDistSq < attractDist * attractDist && closestDistSq > 4) {
        const dist    = Math.sqrt(closestDistSq);
        const factor  = (1 - dist / attractDist) * 0.40;
        const invD    = 1 / dist;
        const radX    = (closestReef.baseX - px) * invD;
        const radY    = (closestReef.baseY - py) * invD;

        if (dist < orbitBlendDist) {
          // Blend radial pull into tangential clockwise orbit
          const t    = 1 - dist / orbitBlendDist; // 0 at edge, 1 at centre
          const tanX = -radY; // left-perpendicular = clockwise
          const tanY =  radX;
          reefX = (radX * (1 - t) + tanX * t) * factor;
          reefY = (radY * (1 - t) + tanY * t) * factor;
        } else {
          reefX = radX * factor;
          reefY = radY * factor;
        }
      }
    }


    // Hydrothermal Vents Updraft Convection & Ancestral Basking Attraction
    let ventX = 0, ventY = 0;
    if (vents && vents.length > 0 && py > this.height * 0.72) {
      const updraftRadius = Config.HYDROTHERMAL_VENTS?.UPDRAFT_RADIUS || 95;
      const updraftForce = Config.HYDROTHERMAL_VENTS?.UPDRAFT_FORCE || 0.24;
      const attractRadius = Config.HYDROTHERMAL_VENTS?.ATTRACT_ANCESTRAL_RADIUS || 180;

      for (let v = 0; v < vents.length; v++) {
        const vent = vents[v];
        const dx = px - vent.baseX;
        const dy = vent.baseY - py;

        // Updraft thermal plume
        if (Math.abs(dx) < updraftRadius && dy > 0 && dy < 220) {
          const horizFactor = 1 - Math.abs(dx) / updraftRadius;
          const vertFactor = 1 - dy / 220;
          ventY -= updraftForce * horizFactor * vertFactor;
          ventX += (dx > 0 ? 0.04 : -0.04) * horizFactor;
        }

        // Ancestral & large creatures love basking near warm vents
        if ((creature.isAncestral || creature.radius > 18) && Math.abs(dx) < attractRadius && dy > 0 && dy < 250) {
          const dist = Math.hypot(dx, dy) || 1;
          const factor = (1 - dist / attractRadius) * 0.22;
          ventX -= (dx / dist) * factor;
          ventY += ((vent.baseY - 70 - py) / dist) * factor;
        }
      }
    }

    // Aurora Nursery: featherweight floating & juvenile buoyancy
    let auroraX = 0, auroraY = 0;
    const auroraH = this.height * (Config.AURORA_NURSERY?.HEIGHT_RATIO || 0.20);
    if (py < auroraH * 1.5) {
      const isJuvenile = creature.growthProgress < 0.98 || creature.lifeStage === 'juvenile';
      if (isJuvenile) {
        const ascendFactor = Math.max(0, 1 - (py / (auroraH * 1.5)));
        auroraY -= (Config.AURORA_NURSERY?.JUVENILE_BUOYANCY || 0.18) * ascendFactor;
      }
      if (py < auroraH) {
        if (creature.velocity.y > 0) {
          auroraY -= creature.velocity.y * 0.15;
        }
        auroraX += Math.sin(now * 0.0012 + px * 0.01) * 0.04;
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
                 + reefX
                 + ventX
                 + auroraX;

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
                 + reefY
                 + ventY
                 + auroraY;

    return { x: steerX, y: steerY };
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
   * Unified Flocking: Separation · Cohesion · Alignment in a single O(n) pass.
   *
   * Anti-clumping design:
   *  - Separation radius is DYNAMIC: max(fixedBase, (rA+rB)×1.75) — larger creatures
   *    keep proportionally larger personal space automatically.
   *  - Repulsion uses inverse-quadratic (1-t)² and is NOT averaged by count, so a
   *    crowd of neighbours compounds the push instead of diluting it.
   *  - Cohesion is SUPPRESSED when dist < (rA+rB)×2.5 — it only attracts genuinely
   *    distant solitary members; it never tightens an already-close cluster.
   */
  _flocking(creature, allCreatures) {
    const isMobile   = this.width <= 600;
    const baseSepR   = isMobile ? 32 : Config.STEERING.SEPARATION_RADIUS; // 40 desktop
    const cohRadius  = BOIDS.COHESION_RADIUS;   // 130
    const alignRadius = BOIDS.ALIGNMENT_RADIUS; // 95
    const rA         = creature.radius;

    const maxDist   = Math.max(baseSepR * 2.5, cohRadius, alignRadius);
    const maxDistSq = maxDist * maxDist;

    let sepX = 0, sepY = 0;
    let cohSumX = 0, cohSumY = 0, cohWeightSum = 0;
    let alignSumVx = 0, alignSumVy = 0, alignWeightSum = 0;

    const px   = creature.position.x;
    const py   = creature.position.y;
    const zone = creature.originZone;

    for (let i = 0; i < allCreatures.length; i++) {
      const other = allCreatures[i];
      if (other === creature) continue;

      const dx = other.position.x - px;
      const dy = other.position.y - py;
      const distSq = dx * dx + dy * dy;
      if (distSq > maxDistSq || distSq < 0.001) continue;

      const dist = Math.sqrt(distSq);
      const rB   = other.radius;

      // ── 1. Separation (all creatures, radius-aware) ──────────────────────
      const minComfort = Math.max(baseSepR, (rA + rB) * 1.75);
      if (dist < minComfort) {
        const t      = dist / minComfort;
        const repStr = Math.pow(1 - t, 2) * 2.2; // inverse-quadratic, strong near-field
        const invD   = 1 / dist;
        sepX -= dx * invD * repStr;               // compounded per neighbour, not averaged
        sepY -= dy * invD * repStr;
      }

      // ── 2. Cohesion & Alignment (same zone only) ─────────────────────────
      if (other.originZone === zone) {
        // Cohesion: only when genuinely distant — never tighten a close cluster
        const cohInhibitDist = (rA + rB) * 2.5;
        if (dist > cohInhibitDist && dist < cohRadius) {
          const w      = 1 - dist / cohRadius;
          cohSumX      += other.position.x * w;
          cohSumY      += other.position.y * w;
          cohWeightSum += w;
        }

        if (dist < alignRadius) {
          const w       = 1 - dist / alignRadius;
          alignSumVx   += other.velocity.x * w;
          alignSumVy   += other.velocity.y * w;
          alignWeightSum += w;
        }
      }
    }

    // ── Normalise cohesion ────────────────────────────────────────────────────
    let cohForceX = 0, cohForceY = 0;
    if (cohWeightSum > 0.01) {
      const toCenterX = (cohSumX / cohWeightSum) - px;
      const toCenterY = (cohSumY / cohWeightSum) - py;
      const cDist     = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY);
      if (cDist >= 15) {
        cohForceX = toCenterX / cDist;
        cohForceY = toCenterY / cDist;
      }
    }

    // ── Normalise alignment ───────────────────────────────────────────────────
    let alignForceX = 0, alignForceY = 0;
    if (alignWeightSum > 0.01) {
      const avgVx = alignSumVx / alignWeightSum;
      const avgVy = alignSumVy / alignWeightSum;
      const vMag  = Math.sqrt(avgVx * avgVx + avgVy * avgVy);
      if (vMag >= 0.001) {
        alignForceX = avgVx / vMag;
        alignForceY = avgVy / vMag;
      }
    }

    return {
      sepX, sepY,
      cohX: cohForceX, cohY: cohForceY,
      alignX: alignForceX, alignY: alignForceY,
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

  /**
   * Boundary: soft quadratic repulsion from canvas edges.
   * Margin of 85px ensures creatures feel the wall early and turn decisively,
   * never drifting to the edge before reacting.
   * Corner deflection adds an extra push toward open space when two edges
   * are simultaneously close, preventing corner-stall traps.
   */
  _boundary(creature, homeY = null) {
    const { x, y } = creature.position;
    const margin = 85;
    let fx = 0, fy = 0;

    const distL = x;
    const distR = this.width - x;
    const distT = y;
    const distB = this.height - y;

    // Quadratic repulsion — power 1.6 gives steep near-wall gradient
    if (distL < margin) {
      fx += Math.pow((margin - distL) / margin, 1.6) * 2.2;
    }
    if (distR < margin) {
      fx -= Math.pow((margin - distR) / margin, 1.6) * 2.2;
    }
    if (distT < margin) {
      fy += Math.pow((margin - distT) / margin, 1.6) * 2.2;
    }
    if (distB < margin) {
      fy -= Math.pow((margin - distB) / margin, 1.6) * 2.2;
    }

    // Corner trap deflection: if near two walls, push strongly to open centre
    const cornerZone = margin * 0.65;
    if ((distL < cornerZone || distR < cornerZone) && (distT < cornerZone || distB < cornerZone)) {
      const cy = homeY ?? (this.height * 0.5);
      const toCX = (this.width * 0.5) - x;
      const toCY = cy - y;
      const d    = Math.sqrt(toCX * toCX + toCY * toCY) || 1;
      fx += (toCX / d) * 1.8;
      fy += (toCY / d) * 1.8;
    }

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

  /**
   * Hard boundary: prevents creatures from escaping the visible canvas.
   * Uses elastic reflection (not 0.6× speed kill) so creatures always bounce
   * away from walls with enough momentum to escape — no more corner stalls.
   * Minimum exit speed of 0.45 guarantees even sleeping creatures drift free.
   */
  _clampToBounds(creature) {
    const pad  = Math.max(8, creature.radius * 0.8);
    let vx = creature.velocity.x;
    let vy = creature.velocity.y;
    const minExit = 0.45; // minimum healthy escape speed away from wall

    if (creature.position.x < pad) {
      creature.position.x = pad;
      vx = Math.max(Math.abs(vx), minExit) * 0.85; // reflect towards right, soft membrane damping
    } else if (creature.position.x > this.width - pad) {
      creature.position.x = this.width - pad;
      vx = -Math.max(Math.abs(vx), minExit) * 0.85; // reflect towards left
    }

    if (creature.position.y < pad) {
      creature.position.y = pad;
      vy = Math.max(Math.abs(vy), minExit) * 0.85; // reflect downward
    } else if (creature.position.y > this.height - pad) {
      creature.position.y = this.height - pad;
      vy = -Math.max(Math.abs(vy), minExit) * 0.85; // reflect upward
    }

    creature.velocity.set(vx, vy);
  }

  _integrate(creature, steering, dt, season = null) {
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
    let baseDrag = creature.isSleeping ? 0.94 : Math.min(0.98, 0.955 + (mass - 1) * 0.012);
    if (season?.current === 'crystal_tide') {
      baseDrag = Math.min(0.985, baseDrag + 0.005); // slightly longer, frictionless glide
    }
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

  }

  // ── Symbiotic pairs ───────────────────────────────────────────────────────

  _updateSymbioticPairs(creatures, threshold, wind, dt, touchPoints = [], activeNectar = null, now = 0, tide = null, reefs = [], vents = [], season = null) {
    const processed = this._processedSymbiotic;
    processed.clear();

    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i];
      if (creature.state !== CreatureState.SYMBIOTIC) continue;
      if (!creature.bondedWith || processed.has(creature.id)) continue;

      const partner = creature.bondedWith;
      processed.add(creature.id);
      processed.add(partner.id);

      const steer = this._computeSteering(creature, creatures, threshold, wind, touchPoints, activeNectar, now, tide, reefs, vents, season);
      this._integrate(creature, { x: steer.x * 0.5, y: steer.y * 0.5 }, dt, season);

      const offset = Vector2.fromAngle((now || Date.now()) * 0.001, creature.radius * 2.2);
      partner.position.x = creature.position.x + offset.x;
      partner.position.y = creature.position.y + offset.y;
      partner.velocity.x = creature.velocity.x;
      partner.velocity.y = creature.velocity.y;
    }
  }

  // ── Courtship dancing pairs ───────────────────────────────────────────────

  _updateDancingPairs(creatures, dt) {
    const processed = this._processedDancing;
    processed.clear();

    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i];
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
        const midX = (creature.position.x + partner.position.x) * 0.5;
        const midY = (creature.position.y + partner.position.y) * 0.5;
        creature.endDance();
        partner.endDance();
        // Disperse with a gentle energy flash & boost
        creature.metabolicFlash = 1.0;
        partner.metabolicFlash = 1.0;
        // Birth of a new generation offspring from the sacred dance
        globalBus.emit(Events.CREATURE_BORN, {
          parentA: creature,
          parentB: partner,
          position: new Vector2(midX, midY),
        });
        continue;
      }

      // Mutual orbit around common center
      const midX = (creature.position.x + partner.position.x) * 0.5;
      const midY = (creature.position.y + partner.position.y) * 0.5;
      const orbitR = Math.max(20, (creature.radius + partner.radius) * 1.35);

      creature.danceAngle = (creature.danceAngle || 0) + dt * 0.0032;
      partner.danceAngle = creature.danceAngle + Math.PI;

      const cosC = Math.cos(creature.danceAngle);
      const sinC = Math.sin(creature.danceAngle);
      const cosP = Math.cos(partner.danceAngle);
      const sinP = Math.sin(partner.danceAngle);

      creature.position.x = midX + cosC * orbitR;
      creature.position.y = midY + sinC * orbitR;
      partner.position.x = midX + cosP * orbitR;
      partner.position.y = midY + sinP * orbitR;

      const speed = Config.CREATURE.BASE_SPEED * 0.65;
      creature.velocity.x = -sinC * speed;
      creature.velocity.y = cosC * speed;
      partner.velocity.x = -sinP * speed;
      partner.velocity.y = cosP * speed;
    }
  }
}
