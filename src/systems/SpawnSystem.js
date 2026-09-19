import { Creature } from '../entities/Creature.js';
import { DNA } from '../entities/DNA.js';
import { Vector2 } from '../utils/Vector2.js';
import { Random } from '../utils/Random.js';
import { Config } from '../core/Config.js';
import { globalBus, Events } from '../core/EventEmitter.js';

/**
 * SpawnSystem — Manages the controlled introduction of new creatures.
 *
 * Ensures the world never feels empty or overpopulated.
 * Spawns happen off-screen (edge zones) so creatures seem to "arrive."
 */
export class SpawnSystem {
  /**
   * @param {number} width  - Canvas width.
   * @param {number} height - Canvas height.
   */
  constructor(width, height) {
    this._width  = width;
    this._height = height;
    this._lastSpawnTime = 0;
  }

  onResize(width, height) {
    this._width  = width;
    this._height = height;
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  /**
   * Possibly spawn new creatures this frame.
   * @param {import('../entities/Creature.js').Creature[]} creatures - Existing creatures.
   * @param {import('../world/Threshold.js').Threshold} threshold
   * @param {number} now - Performance.now()
   * @returns {Creature[]} Newly created creatures (may be empty).
   */
  update(creatures, threshold, now) {
    let lightCount = 0;
    let shadowCount = 0;
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (!c.isAlive) continue;
      if (c.originZone === Config.ZONE.LIGHT) lightCount++;
      else if (c.originZone === Config.ZONE.SHADOW) shadowCount++;
    }

    const isMobile = this._width <= 600;
    const maxPerZone = isMobile ? 4 : (Config.WORLD.MAX_CREATURES_PER_ZONE || 8);
    const minPerZone = isMobile ? 2 : 3;

    // Check if either zone is critically under-represented
    const lightUnder  = lightCount < minPerZone;
    const shadowUnder = shadowCount < minPerZone;

    // Gentle replenishing without rushing
    const interval = (lightUnder || shadowUnder) ? 4000 : (isMobile ? 12000 : Config.SPAWN.INTERVAL_MS);
    const elapsed  = now - this._lastSpawnTime;
    if (elapsed < interval) return [];

    const toSpawn = [];

    // Prioritize and equalize zones:
    // If one zone has fewer organisms, spawn for that zone to restore 50/50 harmony
    if (shadowCount < lightCount && shadowCount < maxPerZone) {
      toSpawn.push(Config.ZONE.SHADOW);
      if (shadowCount + 1 < lightCount && shadowCount + 1 < maxPerZone) {
        toSpawn.push(Config.ZONE.SHADOW); // Catch-up spawn
      } else if (lightCount < maxPerZone) {
        toSpawn.push(Config.ZONE.LIGHT);
      }
    } else if (lightCount < shadowCount && lightCount < maxPerZone) {
      toSpawn.push(Config.ZONE.LIGHT);
      if (lightCount + 1 < shadowCount && lightCount + 1 < maxPerZone) {
        toSpawn.push(Config.ZONE.LIGHT); // Catch-up spawn
      } else if (shadowCount < maxPerZone) {
        toSpawn.push(Config.ZONE.SHADOW);
      }
    } else {
      // Balanced: spawn one of each if under maxPerZone
      if (lightCount < maxPerZone) toSpawn.push(Config.ZONE.LIGHT);
      if (shadowCount < maxPerZone) toSpawn.push(Config.ZONE.SHADOW);
    }

    if (toSpawn.length === 0) return [];

    this._lastSpawnTime = now;
    const spawned = [];
    for (let i = 0; i < toSpawn.length; i++) {
      const creature = this._createCreature(toSpawn[i], threshold);
      spawned.push(creature);
      globalBus.emit(Events.CREATURE_SPAWNED, creature);
    }
    return spawned;
  }

  // ── Initial world population ───────────────────────────────────────────────

  /**
   * Fill the world with an initial set of creatures.
   * @param {import('../world/Threshold.js').Threshold} threshold
   * @returns {Creature[]}
   */
  spawnInitial(threshold) {
    const creatures = [];
    const isMobile = this._width <= 600;
    const n = isMobile ? 2 : (Config.WORLD.INITIAL_CREATURES_PER_ZONE || 4);

    for (let i = 0; i < n; i++) {
      creatures.push(this._createCreature(Config.ZONE.LIGHT, threshold));
      creatures.push(this._createCreature(Config.ZONE.SHADOW, threshold));
    }

    return creatures;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /** Spawn one creature per zone (a pair per interval). */
  _spawnPair(threshold) {
    const spawned = [];
    for (const zone of [Config.ZONE.LIGHT, Config.ZONE.SHADOW]) {
      const creature = this._createCreature(zone, threshold);
      spawned.push(creature);
      globalBus.emit(Events.CREATURE_SPAWNED, creature);
    }
    return spawned;
  }

  /**
   * Create a creature in the given zone, placed at a random edge position
   * within that zone.
   */
  _createCreature(zone, threshold) {
    const position = this._randomPositionInZone(zone, threshold);
    const dna      = DNA.random();

    return new Creature({ position, zone, dna });
  }

  /**
   * Return a random position inside the specified zone, biased toward the edges
   * so creatures appear to "enter" from off-screen margins.
   */
  _randomPositionInZone(zone, threshold) {
    const margin  = 30;
    const x = Random.float(margin, Math.max(margin + 10, this._width - margin));

    let y;
    if (zone === Config.ZONE.LIGHT) {
      const zoneTop    = margin;
      const zoneBottom = Math.max(margin + 10, threshold.y - Config.WORLD.THRESHOLD_BAND - margin);
      const minY = Math.min(zoneTop, zoneBottom);
      const maxY = Math.max(zoneTop, zoneBottom);
      y = Random.float(minY, Math.max(minY + 1, maxY));
    } else {
      const zoneTop    = Math.min(this._height - margin - 10, threshold.y + Config.WORLD.THRESHOLD_BAND + margin);
      const zoneBottom = this._height - margin;
      const minY = Math.min(zoneTop, zoneBottom);
      const maxY = Math.max(zoneTop, zoneBottom);
      y = Random.float(minY, Math.max(minY + 1, maxY));
    }

    return new Vector2(x, y);
  }
}
