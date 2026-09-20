import { Config } from '../core/Config.js';

/**
 * AudioEngine — Generative ambient sound using the Web Audio API.
 *
 * Each zone has a droning ambient layer. Each creature contributes
 * a soft oscillator tuned to a pentatonic note based on its DNA.
 * The threshold line modulates a filter cutoff.
 */
export class AudioEngine {
  constructor() {
    this._ctx          = null;
    this._masterGain   = null;
    this._lightLayer   = null;
    this._shadowLayer  = null;
    this._reverb       = null;
    this._initialized  = false;
    /** Map<creatureId, { osc, gain, filter, panner, baseFreq, currentRatio, targetFreq, lastYRatio }> */
    this._creatureNodes = new Map();

    this.isMuted      = false;
    this._targetVolume = 0.55;

    // Default pentatonic scale frequencies (Hz)
    this._lightNotes  = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3]; // C major pent
    this._shadowNotes = [138.6, 155.6, 185.0, 207.7, 233.1, 277.2, 311.1]; // C minor pent (lower)

    /** Pre-allocated scratch object for zero-allocation depth acoustics. */
    this._depthAcousticsScratch = { freq: 2400, q: 0.70 };

    /** Throttling and state caching for update() (BUG-83) */
    this._lastEcologyScanTime = -1000;
    this._cachedSleepRatio    = 0;
    this._cachedDancingCount  = 0;
    this._lastFilterCutoff    = -1;
    this._lastFilterQ         = -1;

    // ── Phase 3: Cosmic Seasons, Swarm Choir & Lofi Cosmic Bath ─────────────
    this._currentSeasonType   = 'crystal_tide';
    this._lastSeasonCheckTime = -1000;
    this._lastSwarmScanTime   = -1000;

    // Sopro do Éter (Pink Noise Buffer) & Micro-Estalos Estelares
    this._pinkNoiseSource     = null;
    this._pinkNoiseFilter     = null;
    this._pinkNoiseGain       = null;
    this._lastNoiseFilterUpdate = -1000;
    this._nextStarCrackleTime = 3000 + Math.random() * 4000;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Must be called after a user gesture (touch/click) due to browser policy.
   */
  async init() {
    if (this._initialized) return;

    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      await this._ctx.resume();

      this._masterGain = this._makeGain(0.0);
      this._breathFilter = this._ctx.createBiquadFilter();
      this._breathFilter.type = 'lowpass';
      this._breathFilter.frequency.value = 900;
      this._breathFilter.Q.value = 0.8;

      this._masterGain.connect(this._breathFilter);
      this._breathFilter.connect(this._ctx.destination);

      this._reverb = await this._makeReverb(3.5);
      this._reverb.connect(this._masterGain);

      this._lightLayer  = this._makeAmbientLayer(174.6, 'sine', 0.06);
      this._shadowLayer = this._makeAmbientLayer(82.4,  'sawtooth', 0.04);

      this._initialized = true;

      // Sopro do Éter: pink noise cosmic bed
      this._initPinkNoiseLayer();

      // Fade in gently if unmuted
      if (!this.isMuted) {
        this._masterGain.gain.linearRampToValueAtTime(this._targetVolume, this._ctx.currentTime + 3);
      }
    } catch (e) {
      console.warn('[AudioEngine] Web Audio not available:', e);
    }
  }

  /**
   * Toggle audio mute state with smooth exponential ramp.
   * @returns {boolean} New mute state.
   */
  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this._initialized && this._masterGain) {
      const now = this._ctx.currentTime;
      const target = this.isMuted ? 0.0001 : this._targetVolume;
      this._masterGain.gain.cancelScheduledValues(now);
      this._masterGain.gain.linearRampToValueAtTime(target, now + 0.3);

      if (this._pinkNoiseGain) {
        const noiseTarget = this.isMuted ? 0.0001 : (Config.AUDIO_EXPANDED?.LOFI?.PINK_NOISE_GAIN || 0.009);
        this._pinkNoiseGain.gain.cancelScheduledValues(now);
        this._pinkNoiseGain.gain.linearRampToValueAtTime(noiseTarget, now + 0.3);
      }
    }
    return this.isMuted;
  }

  /**
   * Per-frame audio update — modulates filter with world breath, diurnal tide, seasons and ecology.
   * @param {number} now
   * @param {number} [diurnalFactor=0.5] - 1 = zenith, 0 = nadir
   * @param {Array<import('../entities/Creature.js').Creature>} [creatures=[]]
   * @param {object|null} [season=null] - Cosmic seasons state
   */
  update(now, diurnalFactor = 0.5, creatures = [], season = null) {
    if (!this._initialized || !this._breathFilter) return;
    const breath = 0.5 + 0.5 * Math.sin(now * 0.00074);
    let cutoff = 400 + breath * 350 + diurnalFactor * 350;
    let targetQ = 0.8;

    // Seasonal acoustic atmosphere
    if (season?.current === 'crystal_tide') {
      cutoff += 120; // airy crystal clarity
      targetQ = 0.95;
    } else if (season?.current === 'boreal_night') {
      cutoff += 160; // broad harmonic aurora resonance
      targetQ = 1.05;
    } else if (season?.current === 'golden_eclipse') {
      cutoff = Math.max(220, cutoff - 100); // warm low-mid cozy dusk
      targetQ = 0.70;
    }

    // Adaptive ambient modulation based on ecology:
    // Throttle ecology creature scans to ~10Hz (every 100ms) to avoid looping every frame (BUG-83)
    if (creatures && creatures.length > 0) {
      if (now - this._lastEcologyScanTime >= 100) {
        this._lastEcologyScanTime = now;
        let sleepingCount = 0;
        let dancingCount = 0;
        let aliveCount = 0;

        for (let i = 0; i < creatures.length; i++) {
          const c = creatures[i];
          if (c.isAlive) {
            aliveCount++;
            if (c.isSleeping) sleepingCount++;
            if (c.isDancing) dancingCount++;
          }
        }

        this._cachedSleepRatio = aliveCount > 0 ? (sleepingCount / aliveCount) : 0;
        this._cachedDancingCount = dancingCount;
      }

      if (this._cachedSleepRatio > 0) {
        // Soften and warm filter when world is asleep (lullaby effect)
        cutoff = cutoff * (1.0 - this._cachedSleepRatio * 0.32);
      }

      // Warm drone swell if sacred dance is occurring
      if (this._cachedDancingCount > 0) {
        cutoff += 180;
      }
    }

    const clampedCutoff = Math.max(220, cutoff);
    const audioTime = this._ctx.currentTime;

    // Throttle Web Audio AudioParam ramps: avoid redundant scheduling at 60-120 FPS (BUG-83)
    if (Math.abs(clampedCutoff - this._lastFilterCutoff) > 2.0) {
      this._breathFilter.frequency.setTargetAtTime(clampedCutoff, audioTime, 0.1);
      this._lastFilterCutoff = clampedCutoff;
    }
    if (Math.abs(targetQ - this._lastFilterQ) > 0.02) {
      this._breathFilter.Q.setTargetAtTime(targetQ, audioTime, 0.2);
      this._lastFilterQ = targetQ;
    }

    // ── Phase 3: Seasonal Scale Portamento ──────────────────────────────────
    const seasonType = season?.current || 'crystal_tide';
    const seasonChanged = seasonType !== this._currentSeasonType;
    if (seasonChanged || now - this._lastSeasonCheckTime >= 1000) {
      this._lastSeasonCheckTime = now;
      this._currentSeasonType = seasonType;
      if (seasonChanged && this._creatureNodes.size > 0 && creatures && creatures.length > 0) {
        for (let i = 0; i < creatures.length; i++) {
          const c = creatures[i];
          const node = this._creatureNodes.get(c.id);
          if (node && c.isAlive) {
            node.baseFreq = this.getCreatureBaseFreq(c, seasonType);
            const target = node.baseFreq * (node.currentRatio || 1.0);
            node.targetFreq = target;
            node.osc.frequency.setTargetAtTime(target, audioTime, 1.2);
          }
        }
      }
    }

    // ── Phase 3: Coro Polifônico em Cardume (Swarm Choir) ───────────────────
    if (now - this._lastSwarmScanTime >= 250) {
      this._lastSwarmScanTime = now;
      this._updateSwarmChoir(creatures, audioTime);
    }

    // ── Phase 3: Sopro do Éter (Pink Noise Breathing) ───────────────────────
    if (this._pinkNoiseFilter && now - this._lastNoiseFilterUpdate >= 200) {
      this._lastNoiseFilterUpdate = now;
      const baseNoise = Config.AUDIO_EXPANDED?.LOFI?.PINK_NOISE_FILTER_BASE || 480;
      const modNoise = Config.AUDIO_EXPANDED?.LOFI?.PINK_NOISE_FILTER_MOD || 180;
      const noiseFreq = baseNoise + Math.sin(now * 0.00032) * modNoise;
      this._pinkNoiseFilter.frequency.setTargetAtTime(noiseFreq, audioTime, 0.2);
    }

    // ── Phase 3: Micro-Estalos Estelares (Star Crackles) ───────────────────
    if (now >= this._nextStarCrackleTime) {
      const minInterval = Config.AUDIO_EXPANDED?.LOFI?.CRACKLE_INTERVAL_MIN_MS || 3000;
      const maxInterval = Config.AUDIO_EXPANDED?.LOFI?.CRACKLE_INTERVAL_MAX_MS || 7000;
      this._nextStarCrackleTime = now + minInterval + Math.random() * (maxInterval - minInterval);
      this._playStarCrackle();
    }
  }

  /**
   * Pluck a celestial harmonic harp tone when the threshold is moved.
   * @param {number} ratio - Y ratio (0 = top, 1 = bottom).
   */
  pluckThreshold(ratio) {
    if (!this._initialized || this.isMuted) return;
    const now = this._ctx.currentTime;
    if (this._lastPluckTime && now - this._lastPluckTime < 0.14) return;
    this._lastPluckTime = now;

    const baseFreq = 220;
    const semitones = Math.round((1 - ratio) * 16);
    const freq = baseFreq * Math.pow(2, semitones / 12);

    const osc = this._ctx.createOscillator();
    const gain = this._makeGain(0.028);
    const filter = this._makeDepthFilter(ratio);
    const panner = this._makePanner(0.5);
    osc.type = 'sine';
    osc.frequency.value = freq;

    osc.connect(gain);
    gain.connect(filter);
    filter.connect(panner);
    panner.connect(this._reverb);

    osc.start(now);
    gain.gain.setValueAtTime(0.028, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    osc.stop(now + 1.25);
    this._cleanupOnEnded(osc, gain, filter, panner);
  }

  /**
   * Pluck a specific note along the threshold horizontal liquid harp.
   * Modulated with 3D binaural stereo pan and abyssal hydroacoustic filter.
   * @param {number} xRatio - 0 (left) to 1 (right).
   * @param {number} [yRatio=0.5] - 0 (light) to 1 (shadow).
   */
  pluckHarp(xRatio, yRatio = 0.5) {
    if (!this._initialized || this.isMuted) return;
    const now = this._ctx.currentTime;
    if (this._lastHarpTime && now - this._lastHarpTime < 0.07) return;
    this._lastHarpTime = now;

    const notes = [
      146.83, 164.81, 196.00, 220.00, 246.94,
      293.66, 329.63, 392.00, 440.00, 493.88, 587.33,
    ];
    const clampedRatio = Math.max(0, Math.min(1, xRatio > 1.0 ? xRatio / 1200 : xRatio));
    const idx = Math.min(notes.length - 1, Math.floor(clampedRatio * notes.length));
    const freq = notes[idx];

    const osc = this._ctx.createOscillator();
    const osc2 = this._ctx.createOscillator();
    const gain = this._makeGain(0.038);
    const filter = this._makeDepthFilter(yRatio);
    const panner = this._makePanner(clampedRatio);

    osc.type = 'sine';
    osc.frequency.value = freq;
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2;

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(filter);
    filter.connect(panner);
    panner.connect(this._reverb);

    osc.start(now);
    osc2.start(now);

    gain.gain.setValueAtTime(0.038, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);

    osc.stop(now + 1.65);
    osc2.stop(now + 1.65);
    this._cleanupOnEnded(osc, osc2, gain, filter, panner);
  }

  /**
   * Crystalline arpeggio chime when a creature feeds on celestial nectar.
   * Modulated with 3D binaural stereo pan and abyssal hydroacoustic filter.
   * @param {number} [xRatio=0.5]
   * @param {number} [yRatio=0.5]
   */
  playNectarChime(xRatio = 0.5, yRatio = 0.5) {
    if (!this._initialized || this.isMuted) return;
    const now = this._ctx.currentTime;
    const baseFreq = 523.25;
    const freqs = [baseFreq, baseFreq * 1.5, baseFreq * 2];
    for (let i = 0; i < freqs.length; i++) {
      const freq = freqs[i];
      const t = now + i * 0.08;
      const osc = this._ctx.createOscillator();
      const gain = this._makeGain(0.022);
      const filter = this._makeDepthFilter(yRatio);
      const panner = this._makePanner(xRatio);

      osc.type = 'sine';
      osc.frequency.value = freq;

      osc.connect(gain);
      gain.connect(filter);
      filter.connect(panner);
      panner.connect(this._reverb);

      osc.start(t);
      gain.gain.setValueAtTime(0.022, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      osc.stop(t + 1.05);
      this._cleanupOnEnded(osc, gain, filter, panner);
    }
  }

  /**
   * Harmonious chime when two opposite creatures perform the Courtship Dance.
   * Modulated with 3D binaural stereo pan and abyssal hydroacoustic filter.
   * @param {number} [xPos=0.5]
   * @param {number} [yPos=0.5]
   */
  playCourtship(xPos = 0.5, yPos = 0.5) {
    if (!this._initialized || this.isMuted) return;
    const now = this._ctx.currentTime;
    const root = 220;
    const panner = this._makePanner(xPos);
    const filter = this._makeDepthFilter(yPos);
    const freqs = [root, root * 1.5, root * 2.25];

    for (let i = 0; i < freqs.length; i++) {
      const freq = freqs[i];
      const osc = this._ctx.createOscillator();
      const gain = this._makeGain(0.016);
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(filter);
      filter.connect(panner);
      panner.connect(this._reverb);
      const t = now + i * 0.06;
      osc.start(t);
      gain.gain.setValueAtTime(0.016, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      osc.stop(t + 2.65);
      this._cleanupOnEnded(osc, gain, i === freqs.length - 1 ? filter : null, i === freqs.length - 1 ? panner : null);
    }
  }

  /**
   * Resonant 432 Hz tuned Tibetan Singing Bowl for Abyssal Hydrothermal Vents.
   * Produces warm, soothing binaural beating and deep subaquatic lowpass resonance.
   * @param {number} [xRatio=0.5]
   * @param {number} [yRatio=0.95]
   */
  playTibetanBowl(xRatio = 0.5, yRatio = 0.95) {
    if (!this._initialized || this.isMuted) return;
    const now = this._ctx.currentTime;
    if (this._lastBowlTime && now - this._lastBowlTime < 4.0) return;
    this._lastBowlTime = now;

    // 432 Hz Pythagorean sub-octaves & beating frequencies
    const f0 = 108.0;      // Low warm drone (A2 / 432 / 4)
    const f1 = 216.0;      // Octave
    const f2 = 216.6;      // +0.6 Hz beating frequency for theta-wave brain entrainment
    const f3 = 432.0;      // 432 Hz sacred third harmonic

    const partials = [
      { freq: f0, gain: 0.032, decay: 4.8 },
      { freq: f1, gain: 0.024, decay: 4.2 },
      { freq: f2, gain: 0.020, decay: 4.0 },
      { freq: f3, gain: 0.014, decay: 3.2 },
    ];

    const filter = this._makeDepthFilter(yRatio);
    const panner = this._makePanner(xRatio);

    for (let i = 0; i < partials.length; i++) {
      const p = partials[i];
      const osc = this._ctx.createOscillator();
      const gain = this._makeGain(0.0001);

      osc.type = 'sine';
      osc.frequency.value = p.freq;

      osc.connect(gain);
      gain.connect(filter);
      filter.connect(panner);
      panner.connect(this._reverb);

      osc.start(now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(p.gain, now + 0.35); // warm slow gong/bowl strike
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);

      osc.stop(now + p.decay + 0.05);
      this._cleanupOnEnded(osc, gain, i === partials.length - 1 ? filter : null, i === partials.length - 1 ? panner : null);
    }
  }

  /**
   * Ultra-high crystalline wind chimes in the upper stratum (Aurora Nursery).
   * Pentatonic glass bells ringing airy celestial reverberation.
   * @param {number} [xRatio=0.5]
   */
  playAuroraChimes(xRatio = 0.5) {
    if (!this._initialized || this.isMuted) return;
    const now = this._ctx.currentTime;
    if (this._lastChimeTime && now - this._lastChimeTime < 2.5) return;
    this._lastChimeTime = now;

    // High crystalline frequencies (C6, E6, G6, B6, C7)
    const chimeNotes = [1046.50, 1318.51, 1567.98, 1975.53, 2093.00];
    const panner = this._makePanner(xRatio);
    const filter = this._makeDepthFilter(0.12); // crystal airy filter

    // Play a gentle cascade of 3 crystal droplets
    const count = 3;
    for (let i = 0; i < count; i++) {
      const noteIdx = Math.floor(Math.random() * chimeNotes.length);
      const freq = chimeNotes[noteIdx];
      const t = now + i * 0.12;

      const osc = this._ctx.createOscillator();
      const osc2 = this._ctx.createOscillator();
      const gain = this._makeGain(0.0001);

      osc.type = 'sine';
      osc.frequency.value = freq;
      osc2.type = 'sine';
      osc2.frequency.value = freq * 2.76; // high glass harmonic overtone

      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(filter);
      filter.connect(panner);
      panner.connect(this._reverb);

      osc.start(t);
      osc2.start(t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.015, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);

      osc.stop(t + 1.65);
      osc2.stop(t + 1.65);
      this._cleanupOnEnded(osc, osc2, gain, i === count - 1 ? filter : null, i === count - 1 ? panner : null);
    }
  }

  /**
   * Harmonious polyphonic celestial chord sounding when stellar weaving
   * connects two creatures with an ephemeral constellation.
   * @param {number} [freqA=329.63] - Primary frequency from creature A's genome
   * @param {number} [freqB=493.88] - Secondary frequency from creature B's genome
   * @param {number} [xRatio=0.5]
   * @param {number} [yRatio=0.5]
   */
  playConstellationChord(freqA = 329.63, freqB = 493.88, xRatio = 0.5, yRatio = 0.5) {
    if (!this._initialized || this.isMuted) return;
    const now = this._ctx.currentTime;
    const panner = this._makePanner(xRatio);
    const filter = this._makeDepthFilter(yRatio);

    const f1 = (freqA && freqA > 50 && freqA < 3000) ? freqA : 329.63;
    let f2 = (freqB && freqB > 50 && freqB < 3000) ? freqB : (f1 * 1.5);
    // Ensure pleasing musical interval (prevent harsh beating if too close)
    if (Math.abs(f1 - f2) < 20) {
      f2 = f1 * 1.5; // perfect fifth
    }

    const osc1 = this._ctx.createOscillator();
    const osc2 = this._ctx.createOscillator();
    const gain = this._makeGain(0.0001);

    osc1.type = 'sine';
    osc1.frequency.value = f1;
    osc2.type = 'sine';
    osc2.frequency.value = f2;

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(filter);
    filter.connect(panner);
    panner.connect(this._reverb);

    const dur = 2.8;
    osc1.start(now);
    osc2.start(now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.024, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc1.stop(now + dur + 0.05);
    osc2.stop(now + dur + 0.05);
    this._cleanupOnEnded(osc1, osc2, gain, filter, panner);
  }

  /**
   * Resonant crystalline harmonic chime cascade sounding when a player-built
   * sanctuary reef blossoms in the world.
   * @param {number} [xRatio=0.5]
   * @param {number} [yRatio=0.5]
   */
  playSanctuaryBloom(xRatio = 0.5, yRatio = 0.5) {
    if (!this._initialized || this.isMuted) return;
    const now = this._ctx.currentTime;
    const panner = this._makePanner(xRatio);
    const filter = this._makeDepthFilter(yRatio);

    // Golden Solfeggio triad: 432 Hz, 540 Hz (major third), 648 Hz (fifth)
    const notes = [432.00, 540.00, 648.00];
    const dur = 3.2;

    for (let i = 0; i < notes.length; i++) {
      const freq = notes[i];
      const t = now + i * 0.08;

      const osc = this._ctx.createOscillator();
      const oscOvertone = this._ctx.createOscillator();
      const gain = this._makeGain(0.0001);

      osc.type = 'sine';
      osc.frequency.value = freq;
      oscOvertone.type = 'sine';
      oscOvertone.frequency.value = freq * 2.0; // octave sparkle

      osc.connect(gain);
      oscOvertone.connect(gain);
      gain.connect(filter);
      filter.connect(panner);
      panner.connect(this._reverb);

      osc.start(t);
      oscOvertone.start(t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.022, t + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.stop(t + dur + 0.05);
      oscOvertone.stop(t + dur + 0.05);
      this._cleanupOnEnded(osc, oscOvertone, gain, i === notes.length - 1 ? filter : null, i === notes.length - 1 ? panner : null);
    }
  }

  /**
   * Resonant abyssal whale-like deep ocean frequency call when 'Canto das Profundezas' is cast.
   * @param {number} [xRatio=0.5]
   * @param {number} [yRatio=0.8]
   */
  playDeepSong(xRatio = 0.5, yRatio = 0.8) {
    if (!this._initialized || this.isMuted) return;
    const now = this._ctx.currentTime;
    const panner = this._makePanner(xRatio);
    const filter = this._ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    filter.Q.value = 3.0;

    const oscSub = this._ctx.createOscillator();
    const oscFund = this._ctx.createOscillator();
    const gain = this._makeGain(0.0001);

    oscSub.type = 'sine';
    oscSub.frequency.setValueAtTime(36.7, now); // D1
    oscSub.frequency.exponentialRampToValueAtTime(55.0, now + 1.2);
    oscSub.frequency.exponentialRampToValueAtTime(41.2, now + 3.8);

    oscFund.type = 'triangle';
    oscFund.frequency.setValueAtTime(73.4, now); // D2
    oscFund.frequency.exponentialRampToValueAtTime(110.0, now + 1.2);
    oscFund.frequency.exponentialRampToValueAtTime(82.4, now + 3.8);

    oscSub.connect(gain);
    oscFund.connect(gain);
    gain.connect(filter);
    filter.connect(panner);
    panner.connect(this._reverb);

    const dur = 4.4;
    oscSub.start(now);
    oscFund.start(now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.038, now + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    oscSub.stop(now + dur + 0.05);
    oscFund.stop(now + dur + 0.05);
    this._cleanupOnEnded(oscSub, oscFund, gain, filter, panner);
  }

  /**
   * Crystalline cascading chime cascade when 'Sopro de Cristal' blessing is activated.
   * @param {number} [xRatio=0.5]
   * @param {number} [yRatio=0.4]
   */
  playCrystalBreath(xRatio = 0.5, yRatio = 0.4) {
    if (!this._initialized || this.isMuted) return;
    const now = this._ctx.currentTime;
    const panner = this._makePanner(xRatio);
    const filter = this._makeDepthFilter(yRatio);

    const notes = [523.25, 659.25, 783.99, 1046.50]; // C-E-G-C pure chime
    const dur = 3.6;

    for (let i = 0; i < notes.length; i++) {
      const freq = notes[i];
      const t = now + i * 0.07;
      const osc = this._ctx.createOscillator();
      const gain = this._makeGain(0.0001);

      osc.type = 'sine';
      osc.frequency.value = freq;

      osc.connect(gain);
      gain.connect(filter);
      filter.connect(panner);
      panner.connect(this._reverb);

      osc.start(t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.024, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.stop(t + dur + 0.05);
      this._cleanupOnEnded(osc, gain, i === notes.length - 1 ? filter : null, i === notes.length - 1 ? panner : null);
    }
  }

  /**
   * Radiant golden restorative celestial chord when 'Lágrima Solar' is poured.
   * @param {number} [xRatio=0.5]
   * @param {number} [yRatio=0.3]
   */
  playSolarTear(xRatio = 0.5, yRatio = 0.3) {
    if (!this._initialized || this.isMuted) return;
    const now = this._ctx.currentTime;
    const panner = this._makePanner(xRatio);
    const filter = this._makeDepthFilter(yRatio);

    const notes = [220.00, 277.18, 329.63, 440.00, 554.37]; // A major 9th warm solar chord
    const dur = 4.2;

    for (let i = 0; i < notes.length; i++) {
      const freq = notes[i];
      const t = now + i * 0.06;
      const osc = this._ctx.createOscillator();
      const gain = this._makeGain(0.0001);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * 0.98, t);
      osc.frequency.exponentialRampToValueAtTime(freq, t + 0.3); // microtonal upward portamento

      osc.connect(gain);
      gain.connect(filter);
      filter.connect(panner);
      panner.connect(this._reverb);

      osc.start(t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.022, t + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.stop(t + dur + 0.05);
      this._cleanupOnEnded(osc, gain, i === notes.length - 1 ? filter : null, i === notes.length - 1 ? panner : null);
    }
  }

  dispose() {
    if (!this._initialized) return;
    if (this._pinkNoiseSource) {
      try {
        this._pinkNoiseSource.stop();
        this._pinkNoiseSource.disconnect();
      } catch (_) {}
      this._pinkNoiseSource = null;
    }
    if (this._pinkNoiseFilter) {
      try { this._pinkNoiseFilter.disconnect(); } catch (_) {}
      this._pinkNoiseFilter = null;
    }
    if (this._pinkNoiseGain) {
      try { this._pinkNoiseGain.disconnect(); } catch (_) {}
      this._pinkNoiseGain = null;
    }
    for (const [, node] of this._creatureNodes) {
      try {
        node.osc?.stop?.();
        node.osc?.disconnect?.();
        node.gain?.disconnect?.();
        node.filter?.disconnect?.();
        node.panner?.disconnect?.();
      } catch (_) {}
    }
    this._creatureNodes.clear();
    try {
      this._ctx.close();
    } catch (_) {}
    this._initialized = false;
  }

  // ── Creature tones ────────────────────────────────────────────────────────

  /**
   * Calculate base frequency for a creature based on seasonal scale and DNA luminosity.
   * @param {import('../entities/Creature.js').Creature} creature
   * @param {string} [seasonType=this._currentSeasonType]
   * @returns {number}
   */
  getCreatureBaseFreq(creature, seasonType = this._currentSeasonType) {
    const scales = Config.AUDIO_EXPANDED?.SEASONAL_SCALES?.[seasonType]
      || Config.AUDIO_EXPANDED?.SEASONAL_SCALES?.crystal_tide;
    const isLight = creature.originZone === 'light';
    const notes = isLight
      ? (scales?.LIGHT || this._lightNotes)
      : (scales?.SHADOW || this._shadowNotes);
    const index = Math.min(notes.length - 1, Math.floor(creature.dna.luminosity * notes.length));
    return notes[index] + (creature.dna.rhythm || 0) * 4;
  }

  /**
   * Add a soft, DNA-tuned oscillator for a creature with dedicated 3D binaural
   * pan and depth filter.
   * @param {import('../entities/Creature.js').Creature} creature
   */
  addCreature(creature) {
    if (!this._initialized) return;

    const baseFreq = this.getCreatureBaseFreq(creature, this._currentSeasonType);

    const osc  = this._ctx.createOscillator();
    const gain = this._makeGain(0);
    const filter = this._makeDepthFilter(creature.position.y / 800);
    const panner = this._makePanner(creature.position.x / 1200);

    osc.type = creature.originZone === 'light' ? 'sine' : 'triangle';
    osc.frequency.value = baseFreq;
    osc.connect(gain);
    gain.connect(filter);
    filter.connect(panner);
    panner.connect(this._reverb);

    osc.start();
    gain.gain.linearRampToValueAtTime(0.018, this._ctx.currentTime + 2);

    this._creatureNodes.set(creature.id, {
      osc,
      gain,
      filter,
      panner,
      baseFreq,
      currentRatio: 1.0,
      targetFreq: baseFreq,
      lastYRatio: undefined,
    });
  }

  /**
   * Remove and silence a creature's oscillator gracefully.
   * @param {string} creatureId
   */
  removeCreature(creatureId) {
    if (!this._initialized) return;
    const node = this._creatureNodes.get(creatureId);
    if (!node) return;

    const { osc, gain, filter, panner } = node;
    const stopTime = this._ctx.currentTime + 1.5;
    gain.gain.linearRampToValueAtTime(0, stopTime);
    this._cleanupOnEnded(osc, gain, filter, panner);
    try {
      osc.stop(stopTime);
    } catch (_) {}

    this._creatureNodes.delete(creatureId);
  }

  /**
   * Update a creature's 3D binaural stereo pan and abyssal depth filter.
   * When swimming to the Light, the tone turns crystalline and airy.
   * When diving to the Shadow, the tone submerges into an oceanic resonant bass.
   * @param {import('../entities/Creature.js').Creature} creature
   * @param {number} canvasWidth
   * @param {number} [canvasHeight=800]
   * @param {number} [thresholdY]
   */
  updateCreaturePosition(creature, canvasWidth, canvasHeight = 800, thresholdY = null) {
    if (!this._initialized) return;
    const node = this._creatureNodes.get(creature.id);
    if (!node) return;

    const xRatio = creature.position.x / (canvasWidth || 1200);
    const yRatio = creature.position.y / (canvasHeight || 800);

    // 1. Binaural Stereo Pan with natural crossfeed
    if (node.panner && node.panner.pan) {
      const panVal = Math.max(-0.88, Math.min(0.88, (xRatio - 0.5) * 1.76));
      node.panner.pan.value = panVal;
    }

    // 2. Abyssal Hydroacoustic Depth Filter
    if (node.filter && this._ctx) {
      if (node.lastYRatio === undefined || Math.abs(yRatio - node.lastYRatio) > 0.005) {
        node.lastYRatio = yRatio;
        const ac = this._computeDepthAcoustics(yRatio);
        const now = this._ctx.currentTime;
        node.filter.frequency.setTargetAtTime(ac.freq, now, 0.12);
        node.filter.Q.setTargetAtTime(ac.q, now, 0.12);
      }
    }
  }

  // ── Threshold modulation ──────────────────────────────────────────────────

  /**
   * Adjust ambient layers based on the threshold Y ratio.
   * Moving threshold up → more shadow, less light, and vice-versa.
   * @param {number} ratio - 0 (top) to 1 (bottom).
   */
  updateThresholdRatio(ratio) {
    if (!this._initialized) return;
    // ratio: 0 = threshold at top (all shadow), 1 = at bottom (all light)
    const lightVol  = (1 - ratio) * 0.06;
    const shadowVol = ratio * 0.04;
    this._setGain(this._lightLayer.gain,  lightVol,  0.3);
    this._setGain(this._shadowLayer.gain, shadowVol, 0.3);
  }

  // ── Event sounds ──────────────────────────────────────────────────────────

  playTranscendence(xRatio = 0.5, yRatio = 0.3) { this._playTone(880, 'sine', 0.15, 3.0, xRatio, yRatio); }
  playTransformation(xRatio = 0.5, yRatio = 0.5) { this._playTone(440, 'triangle', 0.08, 0.8, xRatio, yRatio); }
  playDissolution(xRatio = 0.5, yRatio = 0.8)  { this._playTone(110, 'sawtooth', 0.06, 1.2, xRatio, yRatio); }
  playSymbiosis(xRatio = 0.5, yRatio = 0.5)    { this._playTone(660, 'sine', 0.1, 1.0, xRatio, yRatio); }

  /**
   * Organic reed rustle when brushing flora.
   * Modulated with 3D binaural stereo pan and abyssal hydroacoustic filter.
   * @param {number} [xRatio=0.5]
   * @param {number} [yRatio=0.5]
   */
  playFloraRustle(xRatio = 0.5, yRatio = 0.5) {
    if (!this._initialized || this.isMuted) return;
    const now = this._ctx.currentTime;
    if (this._lastRustle && now - this._lastRustle < 0.12) return;
    this._lastRustle = now;

    const osc = this._ctx.createOscillator();
    const gain = this._makeGain(0.012);
    const filter = this._makeDepthFilter(yRatio);
    const panner = this._makePanner(xRatio);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(620 + Math.random() * 240, now);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.25);

    osc.connect(gain);
    gain.connect(filter);
    filter.connect(panner);
    panner.connect(this._reverb);

    osc.start(now);
    gain.gain.setValueAtTime(0.012, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.stop(now + 0.28);
    this._cleanupOnEnded(osc, gain, filter, panner);
  }

  /**
   * Cosmic Player Call — Deep crystal bowl singing bell.
   * Modulated with 3D binaural stereo pan and abyssal hydroacoustic filter.
   * @param {number} [xRatio=0.5]
   * @param {number} [yRatio=0.5]
   */
  playPlayerCall(xRatio = 0.5, yRatio = 0.5) {
    if (!this._initialized || this.isMuted) return;
    const now = this._ctx.currentTime;
    const freqs = [293.66, 440.0, 587.33]; // D4, A4, D5 celestial triad
    const panner = this._makePanner(xRatio);
    const filter = this._makeDepthFilter(yRatio);

    for (let idx = 0; idx < freqs.length; idx++) {
      const freq = freqs[idx];
      const osc = this._ctx.createOscillator();
      const gain = this._makeGain(0.0001);

      osc.type = 'sine';
      osc.frequency.value = freq;

      osc.connect(gain);
      gain.connect(filter);
      filter.connect(panner);
      panner.connect(this._reverb);

      const delay = idx * 0.08;
      const startT = now + delay;
      osc.start(startT);

      gain.gain.setValueAtTime(0.0001, startT);
      gain.gain.linearRampToValueAtTime(0.024 / (idx + 1), startT + 0.4);
      gain.gain.exponentialRampToValueAtTime(0.0001, startT + 2.8);

      osc.stop(startT + 2.85);
      this._cleanupOnEnded(osc, gain, idx === freqs.length - 1 ? filter : null, idx === freqs.length - 1 ? panner : null);
    }
  }

  /**
   * Creature sings back to the player in harmonic resonance.
   * Modulated with 3D binaural stereo pan and abyssal hydroacoustic filter.
   * @param {import('../entities/Creature.js').Creature} creature
   * @param {number} [canvasWidth=1200]
   * @param {number} [canvasHeight=800]
   */
  playCreatureChirp(creature, canvasWidth = 1200, canvasHeight = 800) {
    if (!this._initialized || this.isMuted) return;
    const now = this._ctx.currentTime;
    const notes = creature.originZone === 'light' ? this._lightNotes : this._shadowNotes;
    const baseFreq = notes[Math.floor(creature.dna.luminosity * (notes.length - 1))];

    const osc = this._ctx.createOscillator();
    const gain = this._makeGain(0.0001);
    const panner = this._makePanner(creature.position.x / canvasWidth);
    const filter = this._makeDepthFilter(creature.position.y / canvasHeight);

    osc.type = creature.legendaryTrait ? 'sine' : (creature.originZone === 'light' ? 'triangle' : 'sine');
    osc.frequency.setValueAtTime(baseFreq * 1.5, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 2.0, now + 0.16);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.35);

    osc.connect(gain);
    gain.connect(filter);
    filter.connect(panner);
    panner.connect(this._reverb);

    osc.start(now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.022, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);

    osc.stop(now + 0.72);
    this._cleanupOnEnded(osc, gain, filter, panner);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Automatically disconnect audio nodes when the primary oscillator ends,
   * preventing graph accumulation leaks.
   */
  _cleanupOnEnded(mainOsc, ...nodes) {
    if (!mainOsc) return;
    mainOsc.onended = () => {
      try {
        mainOsc.disconnect();
        for (let i = 0; i < nodes.length; i++) {
          nodes[i]?.disconnect?.();
        }
      } catch (_) {}
    };
  }

  /**
   * Helper to construct a safe StereoPannerNode with crossfeed clamp.
   * Clamps pan to [-0.88, +0.88] to avoid hard channel separation on headphones.
   * @param {number} xRatio - 0 (left) to 1 (right). Can also handle pixel X if > 1.
   * @returns {StereoPannerNode|GainNode}
   */
  /**
   * Pure calculation of stereo pan value clamped to [-0.88, +0.88].
   * @param {number} xRatio - 0 (left) to 1 (right). Can also handle pixel X if > 1.
   * @returns {number}
   */
  _computePan(xRatio = 0.5) {
    const ratio = xRatio > 1.0 ? Math.min(1, Math.max(0, xRatio / 1200)) : Math.min(1, Math.max(0, xRatio));
    return Math.max(-0.88, Math.min(0.88, (ratio - 0.5) * 1.76));
  }

  /**
   * Helper to construct a safe StereoPannerNode with crossfeed clamp.
   * Clamps pan to [-0.88, +0.88] to avoid hard channel separation on headphones.
   * @param {number} xRatio - 0 (left) to 1 (right). Can also handle pixel X if > 1.
   * @returns {StereoPannerNode|GainNode|null}
   */
  _makePanner(xRatio = 0.5) {
    if (!this._ctx) return null;
    const panVal = this._computePan(xRatio);

    if (typeof this._ctx.createStereoPanner === 'function') {
      const panner = this._ctx.createStereoPanner();
      panner.pan.value = panVal;
      return panner;
    }
    // Transparent pass-through fallback
    return this._makeGain(1.0);
  }

  /**
   * Helper to calculate depth hydroacoustic lowpass cutoff and resonance Q.
   * In Light (yRatio < 0.45): 2400Hz - 4800Hz, airy and crystalline (Q = 0.70).
   * In Threshold (0.45 <= yRatio <= 0.55): 1800Hz - 2200Hz, balanced (Q = 0.85).
   * In Shadow (yRatio > 0.55): 1600Hz down to 320Hz, deep subaquatic resonance (Q = 0.90 to 1.65).
   * @param {number} yRatio - 0 (top/light) to 1 (bottom/abyss). Can also handle pixel Y if > 1.
   * @returns {{ freq: number, q: number }}
   */
  _computeDepthAcoustics(yRatio = 0.5) {
    const y = yRatio > 1.0 ? Math.min(1, Math.max(0, yRatio / 800)) : Math.min(1, Math.max(0, yRatio));
    const s = this._depthAcousticsScratch;

    if (y < 0.45) {
      // Light Realm: Open, crystalline, high harmonic air
      const normY = y / 0.45;
      s.freq = 2400 + (1.0 - normY) * 2400; // 2400 to 4800 Hz
      s.q = 0.70;
    } else if (y <= 0.55) {
      // Threshold Transition Membrane
      const normY = (y - 0.45) / 0.10;
      s.freq = 2200 - normY * 400; // 2200 to 1800 Hz
      s.q = 0.85;
    } else {
      // Shadow Realm: Dense abyssal waters, heavy high-frequency absorption & resonant depth
      const depth = (y - 0.55) / 0.45; // 0.0 to 1.0
      s.freq = Math.max(280, 1600 - depth * 1280); // 1600 down to 320 Hz
      s.q = 0.90 + depth * 0.75; // 0.90 to 1.65
    }
    return s;
  }

  /**
   * Constructs a BiquadFilterNode tuned to the depth (Y ratio).
   * @param {number} yRatio
   * @returns {BiquadFilterNode|GainNode|null}
   */
  _makeDepthFilter(yRatio = 0.5) {
    if (!this._ctx) return null;
    const { freq, q } = this._computeDepthAcoustics(yRatio);
    if (typeof this._ctx.createBiquadFilter === 'function') {
      const filter = this._ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = freq;
      filter.Q.value = q;
      return filter;
    }
    return this._makeGain(1.0);
  }

  _makeGain(value) {
    const g = this._ctx.createGain();
    g.gain.value = value;
    return g;
  }

  _setGain(gainParam, value, rampTime) {
    gainParam.linearRampToValueAtTime(value, this._ctx.currentTime + rampTime);
  }

  _makeAmbientLayer(freq, type, volume) {
    const osc  = this._ctx.createOscillator();
    const gain = this._makeGain(volume);
    const filter = this._ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;

    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this._reverb);
    osc.start();
    return { osc, gain, filter };
  }

  async _makeReverb(durationSeconds) {
    const convolver = this._ctx.createConvolver();
    const sampleRate = this._ctx.sampleRate;
    const length = sampleRate * durationSeconds;
    const impulse = this._ctx.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
      }
    }

    convolver.buffer = impulse;
    return convolver;
  }

  _playTone(freq, type, volume, duration, xRatio = 0.5, yRatio = 0.5) {
    if (!this._initialized || this.isMuted) return;
    const osc  = this._ctx.createOscillator();
    const gain = this._makeGain(volume);
    const filter = this._makeDepthFilter(yRatio);
    const panner = this._makePanner(xRatio);

    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(filter);
    filter.connect(panner);
    panner.connect(this._masterGain);
    osc.start();
    gain.gain.linearRampToValueAtTime(0, this._ctx.currentTime + duration);
    osc.stop(this._ctx.currentTime + duration + 0.05);
    this._cleanupOnEnded(osc, gain, filter, panner);
  }

  // ── Phase 3: Swarm Choir & Lofi Cosmic Bath ───────────────────────────────

  /**
   * Updates swarm choir harmonies when 3 or more creatures flock together within proximity.
   * Assigns harmonic chord ratios to create rich choral polyphony instead of unison beating.
   * @param {Array<import('../entities/Creature.js').Creature>} creatures
   * @param {number} audioTime
   */
  _updateSwarmChoir(creatures, audioTime) {
    if (!this._initialized || this.isMuted || !creatures) return;
    const swarmRadiusSq = (Config.AUDIO_EXPANDED?.SWARM_CHOIR?.RADIUS || 130) ** 2;
    const minCount = Config.AUDIO_EXPANDED?.SWARM_CHOIR?.MIN_COUNT || 3;
    const ratios = Config.AUDIO_EXPANDED?.SWARM_CHOIR?.RATIOS || [1.0, 1.25, 1.5, 1.75, 2.0];
    const rampSec = Config.AUDIO_EXPANDED?.SWARM_CHOIR?.HARMONIC_RAMP_SEC || 0.8;
    const gainBoost = Config.AUDIO_EXPANDED?.SWARM_CHOIR?.CHOIR_GAIN_BOOST || 1.25;

    const alive = [];
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (c && c.isAlive && this._creatureNodes.has(c.id)) {
        alive.push(c);
      }
    }

    if (alive.length < minCount) {
      // Reset any active swarm ratios to 1.0 (fundamental)
      for (let i = 0; i < alive.length; i++) {
        const node = this._creatureNodes.get(alive[i].id);
        if (node && node.currentRatio !== 1.0) {
          node.currentRatio = 1.0;
          node.targetFreq = node.baseFreq;
          node.osc.frequency.setTargetAtTime(node.baseFreq, audioTime, rampSec);
          node.gain.gain.setTargetAtTime(0.018, audioTime, 0.4);
        }
      }
      return;
    }

    const visited = new Set();

    for (let i = 0; i < alive.length; i++) {
      const root = alive[i];
      if (visited.has(root.id)) continue;

      // BFS to find connected flock/cluster
      const cluster = [root];
      visited.add(root.id);
      let queueIdx = 0;

      while (queueIdx < cluster.length) {
        const curr = cluster[queueIdx++];
        for (let j = 0; j < alive.length; j++) {
          const candidate = alive[j];
          if (!visited.has(candidate.id)) {
            const dx = candidate.position.x - curr.position.x;
            const dy = candidate.position.y - curr.position.y;
            if (dx * dx + dy * dy <= swarmRadiusSq) {
              visited.add(candidate.id);
              cluster.push(candidate);
            }
          }
        }
      }

      if (cluster.length >= minCount) {
        // Deterministic sort by X position to avoid voice hopping
        cluster.sort((a, b) => a.position.x - b.position.x);
        for (let k = 0; k < cluster.length; k++) {
          const c = cluster[k];
          const node = this._creatureNodes.get(c.id);
          if (!node) continue;
          const assignedRatio = ratios[k % ratios.length];
          if (Math.abs(node.currentRatio - assignedRatio) > 0.001) {
            node.currentRatio = assignedRatio;
            const target = node.baseFreq * assignedRatio;
            node.targetFreq = target;
            node.osc.frequency.setTargetAtTime(target, audioTime, rampSec);
            node.gain.gain.setTargetAtTime(0.018 * gainBoost, audioTime, 0.4);
          }
        }
      } else {
        // Cluster is smaller than minCount, restore fundamental (1.0)
        for (let k = 0; k < cluster.length; k++) {
          const c = cluster[k];
          const node = this._creatureNodes.get(c.id);
          if (node && node.currentRatio !== 1.0) {
            node.currentRatio = 1.0;
            node.targetFreq = node.baseFreq;
            node.osc.frequency.setTargetAtTime(node.baseFreq, audioTime, rampSec);
            node.gain.gain.setTargetAtTime(0.018, audioTime, 0.4);
          }
        }
      }
    }
  }

  /**
   * Generate an ultra-pure, zero-click stereo pink noise buffer using Paul Kellet's filter.
   * @param {number} [durationSeconds=4.0]
   * @returns {AudioBuffer}
   */
  _makePinkNoiseBuffer(durationSeconds = 4.0) {
    const sampleRate = this._ctx?.sampleRate || 44100;
    const length = Math.floor(sampleRate * durationSeconds);
    const buffer = this._ctx.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.08;
        b6 = white * 0.115926;
      }
    }
    return buffer;
  }

  /**
   * Initializes looping Sopro do Éter (Pink Noise) atmospheric bed.
   */
  _initPinkNoiseLayer() {
    if (!this._ctx || typeof this._ctx.createBufferSource !== 'function' || typeof this._ctx.createBuffer !== 'function') return;
    try {
      const buffer = this._makePinkNoiseBuffer(4.0);
      const source = this._ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const filter = this._ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = Config.AUDIO_EXPANDED?.LOFI?.PINK_NOISE_FILTER_BASE || 480;
      filter.Q.value = 1.4;

      const gain = this._makeGain(this.isMuted ? 0.0001 : (Config.AUDIO_EXPANDED?.LOFI?.PINK_NOISE_GAIN || 0.009));

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this._masterGain);

      source.start();
      this._pinkNoiseSource = source;
      this._pinkNoiseFilter = filter;
      this._pinkNoiseGain   = gain;
    } catch (e) {
      console.warn('[AudioEngine] Pink noise initialization skipped:', e);
    }
  }

  /**
   * Public / internal method to trigger a subtle analog cosmic dust crackle.
   * @param {number} [xRatio=Math.random()]
   */
  playStarCrackle(xRatio = Math.random()) {
    this._playStarCrackle(xRatio);
  }

  /**
   * Synthesize a microscopic vintage star crackle (1-2 ms highpass click).
   * @param {number} [xRatio=Math.random()]
   */
  _playStarCrackle(xRatio = Math.random()) {
    if (!this._initialized || this.isMuted || !this._ctx) return;
    const audioTime = this._ctx.currentTime;
    const osc = this._ctx.createOscillator();
    const gain = this._makeGain(0.0001);
    const filter = this._ctx.createBiquadFilter();
    const panner = this._makePanner(xRatio);

    filter.type = 'bandpass';
    filter.frequency.value = 3200 + Math.random() * 1600;
    filter.Q.value = 3.5;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(3600 + Math.random() * 800, audioTime);
    osc.frequency.exponentialRampToValueAtTime(1200, audioTime + 0.009);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this._masterGain);

    const crackleGain = Config.AUDIO_EXPANDED?.LOFI?.CRACKLE_GAIN || 0.004;
    osc.start(audioTime);
    gain.gain.setValueAtTime(0.0001, audioTime);
    gain.gain.linearRampToValueAtTime(crackleGain, audioTime + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.00001, audioTime + 0.012);
    osc.stop(audioTime + 0.014);

    this._cleanupOnEnded(osc, gain, filter, panner);
  }
}
