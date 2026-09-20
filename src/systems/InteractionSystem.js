import { Creature, CreatureState } from '../entities/Creature.js';
import { DNA } from '../entities/DNA.js';
import { Vector2 } from '../utils/Vector2.js';
import { Color } from '../utils/Color.js';
import { Config } from '../core/Config.js';
import { Random } from '../utils/Random.js';
import { globalBus, Events } from '../core/EventEmitter.js';

/**
 * InteractionSystem — Resolves creature-to-creature encounters.
 *
 * Uses a simple spatial grid for O(n) proximity detection instead of
 * O(n²) brute-force comparison.
 *
 * Possible outcomes when two creatures meet:
 *   - Absorption:  Larger creature grows, smaller vanishes.
 *   - Explosion:   Both shatter into offspring (smaller variants).
 *   - Symbiosis:   Rare — they bond and move as one.
 */
const EMPTY_OFFSPRING = Object.freeze([]);

export class InteractionSystem {
  static EMPTY_OFFSPRING = EMPTY_OFFSPRING;

  constructor() {
    this._cellSize = Config.INTERACTION.RADIUS * 2;
    this._interactRadiusSq = Config.INTERACTION.RADIUS * Config.INTERACTION.RADIUS;
    /** @type {Map<number, Creature[]>} */
    this._grid = new Map();
    this._cellPool = [];
    this._neighborScratch = [];
    this._offspringScratch = [];
    this._processed = new Set();
    this._lastPruneTime = 0;
  }

  // ── Main update ───────────────────────────────────────────────────────────

  /**
   * @param {Creature[]} creatures
   * @param {import('../fx/ParticleSystem.js').ParticleSystem} particles
   * @param {import('../fx/AudioEngine.js').AudioEngine} audio
   * @param {number} now - Performance.now() timestamp.
   * @returns {Creature[]} Newly spawned offspring.
   */
  update(creatures, particles, audio, now) {
    this._buildGrid(creatures);

    // Periodic sweep to prune dead/expired interaction cooldowns on living creatures
    if (now - this._lastPruneTime > 2000) {
      this._lastPruneTime = now;
      for (let i = 0; i < creatures.length; i++) {
        creatures[i].pruneInteractionCooldowns?.(now);
      }
    }

    const offspring = this._offspringScratch;
    offspring.length = 0;
    this._processed.clear();

    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i];
      if (!creature.isAlive || this._processed.has(creature.id)) continue;
      if (creature.state === CreatureState.DISSOLVING) continue;

      const neighbors = this._getNeighbors(creature);

      for (let j = 0; j < neighbors.length; j++) {
        const other = neighbors[j];
        if (!other.isAlive || this._processed.has(other.id)) continue;
        if (creature === other) continue;
        if (!this._canInteract(creature, other, now)) continue;

        const distSq = creature.position.distanceSqTo(other.position);
        if (distSq > this._interactRadiusSq) continue;

        const newCreatures = this._resolveInteraction(creature, other, particles, audio, now);
        for (let k = 0; k < newCreatures.length; k++) {
          offspring.push(newCreatures[k]);
        }

        this._processed.add(creature.id);
        this._processed.add(other.id);
        break; // one interaction per creature per frame
      }
    }

    return offspring.length === 0 ? EMPTY_OFFSPRING : offspring;
  }

  // ── Interaction resolution ────────────────────────────────────────────────

  _resolveInteraction(a, b, particles, audio, now) {
    // Both creatures gently awaken if either was sleeping
    if (a.isSleeping) a.wake();
    if (b.isSleeping) b.wake();

    // Stamp cooldown on both creatures
    a.interactionCooldowns.set(b.id, now + Config.INTERACTION.COOLDOWN_MS);
    b.interactionCooldowns.set(a.id, now + Config.INTERACTION.COOLDOWN_MS);

    if (a.originZone === b.originZone) {
      return this._resolveSameZone(a, b, particles, audio);
    }
    return this._resolveOppositeZone(a, b, particles, audio);
  }

  _resolveSameZone(a, b, particles, audio) {
    if (Random.chance(Config.INTERACTION.SYMBIOSIS_CHANCE)) {
      a.bondedWith = b;
      b.bondedWith = a;
      a.transitionTo(CreatureState.SYMBIOTIC);
      b.transitionTo(CreatureState.SYMBIOTIC);
      if (a.bodyPlan !== b.bodyPlan) {
        a.isChimera = true;
        b.isChimera = true;
      }
      const midX = (a.position.x + b.position.x) / 2;
      const midY = (a.position.y + b.position.y) / 2;
      particles.emitTransformBurst(midX, midY, a.color);
      audio.playSymbiosis(midX, midY);
      globalBus.emit(Events.INTERACTION_SYMBIOSIS, a, b);
    }
    return EMPTY_OFFSPRING;
  }

  _resolveOppositeZone(a, b, particles, audio) {
    const sizeA = a.radius;
    const sizeB = b.radius;
    const ratio = Math.max(sizeA, sizeB) / Math.min(sizeA, sizeB);
    const midX  = (a.position.x + b.position.x) / 2;
    const midY  = (a.position.y + b.position.y) / 2;

    // 1. Courtship Dance: gentle harmonic communion between opposite worlds takes precedence if sizes are compatible
    if (!a.isDancing && !b.isDancing && !a.bondedWith && !b.bondedWith && ratio < 1.65) {
      if (Random.chance(0.52)) {
        const duration = Config.ECOSYSTEM?.DANCE_DURATION_MS || 5500;
        a.startDance(b, duration);
        b.startDance(a, duration);
        audio.playCourtship?.(midX, midY);
        globalBus.emit(Events.CREATURE_DANCE, a, b);
        return EMPTY_OFFSPRING;
      }
    }

    // 2. Absorption: one significantly larger than the other
    if (ratio >= Config.INTERACTION.ABSORPTION_RATIO) {
      const [larger, smaller] = sizeA >= sizeB ? [a, b] : [b, a];
      larger.radius = Math.min(Config.CREATURE.MAX_RADIUS, larger.radius + smaller.radius * 0.15);
      smaller.isAlive = false;
      particles.emitDissolveBurst(midX, midY, smaller.color);
      globalBus.emit(Events.INTERACTION_ABSORBED, larger, smaller);
      return EMPTY_OFFSPRING;
    }

    // Explosion: roughly same size
    if (Random.chance(Config.INTERACTION.EXPLOSION_CHANCE)) {
      particles.emitExplosion(midX, midY, a.color, b.color);
      a.isAlive = false;
      b.isAlive = false;
      globalBus.emit(Events.INTERACTION_EXPLOSION, a, b);
      return this._spawnOffspring(a, b, midX, midY);
    }

    return EMPTY_OFFSPRING;
  }

  /** Generate offspring from two exploding creatures. */
  _spawnOffspring(parentA, parentB, x, y) {
    const count  = Config.INTERACTION.EXPLOSION_SPAWN_COUNT;
    const babies = [];

    for (let i = 0; i < count; i++) {
      const parent = i % 2 === 0 ? parentA : parentB;
      const dna    = parent.dna.mutate(0.2);
      const zone   = parent.originZone;
      const angle  = (i / count) * Math.PI * 2 + Random.float(-0.5, 0.5);
      const dist   = parent.radius * 2;
      const babyX  = x + Math.cos(angle) * dist;
      const babyY  = y + Math.sin(angle) * dist;

      const baby = new Creature({
        position: new Vector2(babyX, babyY),
        zone,
        dna,
      });
      baby.radius     = Math.max(Config.CREATURE.MIN_RADIUS, parent.radius * 0.55);
      baby.baseRadius = baby.radius;
      babies.push(baby);
    }

    return babies;
  }

  // ── Spatial grid ──────────────────────────────────────────────────────────

  _buildGrid(creatures) {
    for (const cell of this._grid.values()) {
      cell.length = 0;
      this._cellPool.push(cell);
    }
    this._grid.clear();

    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (!c.isAlive) continue;
      const key = this._cellKey(c.position.x, c.position.y);
      let cell = this._grid.get(key);
      if (!cell) {
        cell = this._cellPool.length > 0 ? this._cellPool.pop() : [];
        this._grid.set(key, cell);
      }
      cell.push(c);
    }
  }

  _getNeighbors(creature) {
    const cx = (Math.floor(creature.position.x / this._cellSize) + 1000) & 0xFFFF;
    const cy = (Math.floor(creature.position.y / this._cellSize) + 1000) & 0xFFFF;
    const neighbors = this._neighborScratch;
    neighbors.length = 0;

    for (let dx = -1; dx <= 1; dx++) {
      const nx = (cx + dx) & 0xFFFF;
      for (let dy = -1; dy <= 1; dy++) {
        const key = (nx << 16) | ((cy + dy) & 0xFFFF);
        const cell = this._grid.get(key);
        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            neighbors.push(cell[i]);
          }
        }
      }
    }
    return neighbors;
  }

  _cellKey(x, y) {
    const cx = (Math.floor(x / this._cellSize) + 1000) & 0xFFFF;
    const cy = (Math.floor(y / this._cellSize) + 1000) & 0xFFFF;
    return (cx << 16) | cy;
  }

  _canInteract(a, b, now) {
    if (!a.isAlive || !b.isAlive) return false;
    if (a.bondedWith || b.bondedWith || a.isDancing || b.isDancing) return false;
    const aCooldown = a.interactionCooldowns.get(b.id) ?? 0;
    const bCooldown = b.interactionCooldowns.get(a.id) ?? 0;
    if (aCooldown > 0 && now > aCooldown) a.interactionCooldowns.delete(b.id);
    if (bCooldown > 0 && now > bCooldown) b.interactionCooldowns.delete(a.id);
    return now > aCooldown && now > bCooldown;
  }
}
