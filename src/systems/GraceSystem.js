import { Config } from '../core/Config.js';

/**
 * GraceSystem — Contemplative Meta-Progression & Celestial Blessings.
 * Tracks Cosmic Grace accumulated through player harmony (weaving constellations,
 * planting sanctuaries, guiding creatures, observing seasons) and allows channeling
 * of active and passive divine blessings into the ecosystem.
 */
export class GraceSystem {
  /**
   * @param {import('../world/World.js').World} world
   */
  constructor(world) {
    this._world = world;
    this._points = Config.GRACE?.INITIAL_GRACE || 25;
    this._crystalBreathTimer = 0;
    this._stellarVeilTimer = 0;
    this._saveTimer = null;
    this._listeners = new Set();

    this._loadFromStorage();
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  /** Current integer Grace points. */
  get points() {
    return Math.floor(this._points);
  }

  /** Maximum capacity of Grace. */
  get maxPoints() {
    return Config.GRACE?.MAX_GRACE || 999;
  }

  /** Whether the Crystal Breath fertility blessing is currently active. */
  get hasCrystalBreath() {
    return this._crystalBreathTimer > 0;
  }

  /** Remaining duration of Crystal Breath in seconds. */
  get crystalBreathRemainingSec() {
    return Math.ceil(this._crystalBreathTimer / 1000);
  }

  /** Whether the Stellar Veil constellation shielding blessing is active. */
  get hasStellarVeil() {
    return this._stellarVeilTimer > 0;
  }

  /** Remaining duration of Stellar Veil in seconds. */
  get stellarVeilRemainingSec() {
    return Math.ceil(this._stellarVeilTimer / 1000);
  }

  // ── Grace Accrual & Events ────────────────────────────────────────────────

  /**
   * Award Grace points to the player with a poetic reason.
   * @param {number} amount
   * @param {string} [reason='']
   */
  addPoints(amount, reason = '') {
    if (!amount || amount <= 0 || !Number.isFinite(amount)) return;
    const oldInt = Math.floor(this._points);
    this._points = Math.min(this.maxPoints, this._points + amount);
    const newInt = Math.floor(this._points);

    if (newInt > oldInt && reason) {
      const earned = newInt - oldInt;
      this._notifyEarned(earned, newInt, reason);
      this._scheduleSave();
    }
  }

  /**
   * Subscribe a listener for Grace earning events (for UI toasts / animations).
   * @param {(earned: number, total: number, reason: string) => void} listener
   * @returns {() => void} Unsubscribe function
   */
  onEarned(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  // ── Blessings Channeling ──────────────────────────────────────────────────

  /**
   * Check if a blessing can be cast.
   * @param {string} blessingId
   * @returns {boolean}
   */
  canCast(blessingId) {
    const blessing = this._getBlessingConfig(blessingId);
    if (!blessing) return false;
    return this.points >= blessing.cost;
  }

  /**
   * Cast a divine blessing into the living ecosystem.
   * @param {string} blessingId
   * @returns {boolean} True if successfully channeled
   */
  cast(blessingId) {
    const blessing = this._getBlessingConfig(blessingId);
    if (!blessing || !this.canCast(blessingId)) return false;

    // Deduct cost
    this._points = Math.max(0, this._points - blessing.cost);
    this._scheduleSave();

    // Channel specific blessing manifestation
    switch (blessing.id) {
      case 'deep_song':
        this._channelDeepSong();
        break;
      case 'crystal_breath':
        this._channelCrystalBreath(blessing.durationMs);
        break;
      case 'stellar_veil':
        this._channelStellarVeil(blessing.durationMs);
        break;
      case 'solar_tear':
        this._channelSolarTear();
        break;
      default:
        console.warn(`[GraceSystem] Unknown blessing id: ${blessingId}`);
        return false;
    }

    this._notifyEarned(0, this.points, `Bênção: ${blessing.name}`);
    return true;
  }

  // ── Simulation Update Loop ────────────────────────────────────────────────

  /**
   * Advance blessing timers and accrue passive contemplative Grace.
   * @param {number} now
   * @param {number} dt
   */
  update(now, dt) {
    // 1. Tick active blessing timers
    if (this._crystalBreathTimer > 0) {
      this._crystalBreathTimer = Math.max(0, this._crystalBreathTimer - dt);
    }
    if (this._stellarVeilTimer > 0) {
      this._stellarVeilTimer = Math.max(0, this._stellarVeilTimer - dt);
    }

    // 2. Passive contemplation Grace (rewarding continuous peaceful observation)
    const passiveRate = Config.GRACE?.RATES?.CONTEMPLATION_PASSIVE || 0.25;
    this.addPoints(passiveRate * (dt / 1000));

    // 3. Swarm Choir harmony Grace bonus
    if (this._world.audio?.isChoirActive) {
      const choirRate = Config.GRACE?.RATES?.SWARM_HARMONY_PER_SEC || 1.5;
      this.addPoints(choirRate * (dt / 1000));
    }
  }

  // ── Private Blessings Manifestation ───────────────────────────────────────

  _channelDeepSong() {
    // 1. Oceanic acoustic frequency
    this._world.audio?.playDeepSong?.(0.5, 0.8);

    // 2. Call shadow realm creatures upward in calm harmony
    const shadowCreatures = this._world.creatures.filter(c => c.isAlive && c.originZone === 'shadow');
    const thresholdY = this._world.threshold?.y || 400;

    for (let i = 0; i < shadowCreatures.length; i++) {
      const c = shadowCreatures[i];
      c.calm = Math.min(1.0, (c.calm || 0.5) + 0.45);
      c.fear = 0;
      // Gentle buoyant upward impulse toward the threshold
      if (c.position.y > thresholdY + 40) {
        c.velocity.y = Math.min(c.velocity.y, -0.32);
      }
      this._world.particles?.emitBiolumBurst?.(c.position.x, c.position.y, c.color?.hsl || '#8b5cf6');
    }

    // 3. Diary chronicle entry
    this._world.diary?.add('🌊 O Canto das Profundezas ecoou pelo abismo: seres da Sombra sentiram o chamado e aproximaram-se em serenidade.');
  }

  _channelCrystalBreath(durationMs = 35000) {
    this._crystalBreathTimer = durationMs;

    // 1. Crystalline chime soundscape
    this._world.audio?.playCrystalBreath?.(0.5, 0.4);

    // 2. Bloom and energize all reefs and sanctuaries
    for (let i = 0; i < this._world.reefs.length; i++) {
      const reef = this._world.reefs[i];
      reef.energy = 1.0;
      this._world.particles?.emitSanctuaryBloom?.(reef.x, reef.y);
    }

    // 3. Diary chronicle entry
    this._world.diary?.add('💎 Sopro de Cristal concedido: recifes e santuários pulsam com energia radiante dobrada.');
  }

  _channelStellarVeil(durationMs = 45000) {
    this._stellarVeilTimer = durationMs;

    // 1. Harmonic celestial chord
    this._world.audio?.playConstellationChord?.(432, 648, 0.5, 0.5);

    // 2. Extend and harmonize all active constellations
    for (let i = 0; i < this._world.constellations.length; i++) {
      const c = this._world.constellations[i];
      c.lifespan = Math.max(c.lifespan, 15000);
      c.duration = c.lifespan;
    }

    // 3. Diary chronicle entry
    this._world.diary?.add('✨ O Véu Estelar envolveu o cosmos: laços constelares protegem todas as almas conectadas.');
  }

  _channelSolarTear() {
    // 1. Radiant solar harp chord
    this._world.audio?.playSolarTear?.(0.5, 0.3);

    // 2. Prioritize reviving creatures in distress / dissolution
    let revivedCount = 0;
    for (let i = 0; i < this._world.creatures.length; i++) {
      const c = this._world.creatures[i];
      if (!c.isAlive) continue;

      if (c.state === 'dissolving' || (c.energy !== undefined && c.energy < 0.25)) {
        c.energy = 1.0;
        c.state = 'wandering';
        c.dissolveTimer = 0;
        c.calm = 1.0;
        this._world.particles?.emitSolarTearMotes?.(c.position.x, c.position.y);
        revivedCount++;
      }
    }

    // If no creatures were dying, confer vital solar nourishment to all living creatures
    if (revivedCount === 0) {
      for (let i = 0; i < this._world.creatures.length; i++) {
        const c = this._world.creatures[i];
        if (!c.isAlive) continue;
        c.energy = Math.min(1.0, (c.energy || 0.5) + 0.35);
        c.calm = Math.min(1.0, (c.calm || 0.5) + 0.35);
      }
    }

    // 3. Diary chronicle entry
    this._world.diary?.add('☀️ Lágrima Solar derramada: as almas que desvaneciam foram revigoradas e renasceram na luz.');
  }

  _getBlessingConfig(blessingId) {
    const blessings = Config.GRACE?.BLESSINGS;
    if (!blessings) return null;
    for (const key of Object.keys(blessings)) {
      if (blessings[key].id === blessingId) return blessings[key];
    }
    return null;
  }

  _notifyEarned(earned, total, reason) {
    for (const listener of this._listeners) {
      try {
        listener(earned, total, reason);
      } catch (err) {
        console.warn('[GraceSystem] Error in listener callback:', err);
      }
    }
  }

  // ── Storage Persistence ───────────────────────────────────────────────────

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveToStorage();
    }, 500);
  }

  _saveToStorage() {
    try {
      const key = Config.GRACE?.STORAGE_KEY || 'limiar_grace_v1';
      const data = JSON.stringify({
        points: Math.floor(this._points),
        savedAt: Date.now(),
      });
      localStorage.setItem(key, data);
    } catch (_) {}
  }

  _loadFromStorage() {
    try {
      const key = Config.GRACE?.STORAGE_KEY || 'limiar_grace_v1';
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Number.isFinite(parsed.points)) {
          this._points = Math.max(0, Math.min(this.maxPoints, parsed.points));
        }
      }
    } catch (_) {}
  }
}
