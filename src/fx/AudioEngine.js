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
    /** Map<creatureId, { osc, gain }> */
    this._creatureNodes = new Map();

    // Pentatonic scale frequencies (Hz) in two octaves
    this._lightNotes  = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3]; // C major pent
    this._shadowNotes = [138.6, 155.6, 185.0, 207.7, 233.1, 277.2, 311.1]; // C minor pent (lower)
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

      // Fade in gently
      this._masterGain.gain.linearRampToValueAtTime(0.55, this._ctx.currentTime + 3);
    } catch (e) {
      console.warn('[AudioEngine] Web Audio not available:', e);
    }
  }

  /**
   * Per-frame audio update — modulates filter with world breath and diurnal tide.
   * @param {number} now
   * @param {number} [diurnalFactor=0.5] - 1 = zenith, 0 = nadir
   */
  update(now, diurnalFactor = 0.5) {
    if (!this._initialized || !this._breathFilter) return;
    const breath = 0.5 + 0.5 * Math.sin(now * 0.00074);
    const cutoff = 400 + breath * 350 + diurnalFactor * 350;
    this._breathFilter.frequency.setTargetAtTime(cutoff, this._ctx.currentTime, 0.08);
  }

  /**
   * Pluck a celestial harmonic harp tone when the threshold is moved.
   * @param {number} ratio - Y ratio (0 = top, 1 = bottom).
   */
  pluckThreshold(ratio) {
    if (!this._initialized) return;
    const now = this._ctx.currentTime;
    if (this._lastPluckTime && now - this._lastPluckTime < 0.14) return;
    this._lastPluckTime = now;

    const baseFreq = 220;
    const semitones = Math.round((1 - ratio) * 16);
    const freq = baseFreq * Math.pow(2, semitones / 12);

    const osc = this._ctx.createOscillator();
    const gain = this._makeGain(0.028);
    osc.type = 'sine';
    osc.frequency.value = freq;

    osc.connect(gain);
    gain.connect(this._reverb);

    osc.start(now);
    gain.gain.setValueAtTime(0.028, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    setTimeout(() => { try { osc.stop(); } catch (_) {} }, 1300);
  }

  /**
   * Pluck a specific note along the threshold horizontal harp.
   * @param {number} xRatio - 0 (left) to 1 (right).
   */
  pluckHarp(xRatio) {
    if (!this._initialized) return;
    const now = this._ctx.currentTime;
    if (this._lastHarpTime && now - this._lastHarpTime < 0.07) return;
    this._lastHarpTime = now;

    const notes = [
      146.83, 164.81, 196.00, 220.00, 246.94,
      293.66, 329.63, 392.00, 440.00, 493.88, 587.33,
    ];
    const clampedRatio = Math.max(0, Math.min(1, xRatio));
    const idx = Math.min(notes.length - 1, Math.floor(clampedRatio * notes.length));
    const freq = notes[idx];

    const osc = this._ctx.createOscillator();
    const osc2 = this._ctx.createOscillator();
    const gain = this._makeGain(0.038);
    const panner = this._ctx.createStereoPanner();

    osc.type = 'sine';
    osc.frequency.value = freq;
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2;

    panner.pan.value = clampedRatio * 1.8 - 0.9;

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(panner);
    panner.connect(this._reverb);

    osc.start(now);
    osc2.start(now);

    gain.gain.setValueAtTime(0.038, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);

    setTimeout(() => {
      try { osc.stop(); osc2.stop(); } catch (_) {}
    }, 1700);
  }

  /**
   * Crystalline arpeggio chime when a creature feeds on celestial nectar.
   * @param {number} [xRatio=0.5]
   */
  playNectarChime(xRatio = 0.5) {
    if (!this._initialized) return;
    const now = this._ctx.currentTime;
    const baseFreq = 523.25;
    [baseFreq, baseFreq * 1.5, baseFreq * 2].forEach((freq, i) => {
      const t = now + i * 0.08;
      const osc = this._ctx.createOscillator();
      const gain = this._makeGain(0.022);
      const panner = this._ctx.createStereoPanner();

      osc.type = 'sine';
      osc.frequency.value = freq;
      panner.pan.value = Math.max(-0.9, Math.min(0.9, (xRatio - 0.5) * 1.8));

      osc.connect(gain);
      gain.connect(panner);
      panner.connect(this._reverb);

      osc.start(t);
      gain.gain.setValueAtTime(0.022, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      setTimeout(() => { try { osc.stop(); } catch (_) {} }, (t - now + 1.1) * 1000);
    });
  }

  /**
   * Harmonious chime when two opposite creatures perform the Courtship Dance.
   */
  playCourtship(xPos = 600, width = 1200) {
    if (!this._initialized) return;
    const now = this._ctx.currentTime;
    const root = 220;
    [root, root * 1.5, root * 2.25].forEach((freq, i) => {
      const osc = this._ctx.createOscillator();
      const gain = this._makeGain(0.016);
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(this._reverb);
      osc.start(now + i * 0.06);
      gain.gain.setValueAtTime(0.016, now + i * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
      setTimeout(() => { try { osc.stop(); } catch (_) {} }, 2800);
    });
  }

  dispose() {
    if (!this._initialized) return;
    this._ctx.close();
    this._initialized = false;
  }

  // ── Creature tones ────────────────────────────────────────────────────────

  /**
   * Add a soft, DNA-tuned oscillator for a creature.
   * @param {import('../entities/Creature.js').Creature} creature
   */
  addCreature(creature) {
    if (!this._initialized) return;

    const notes  = creature.originZone === 'light' ? this._lightNotes : this._shadowNotes;
    const index  = Math.floor(creature.dna.luminosity * (notes.length - 1));
    const freq   = notes[index];

    const osc  = this._ctx.createOscillator();
    const gain = this._makeGain(0);
    const panner = this._ctx.createStereoPanner();

    osc.type = creature.originZone === 'light' ? 'sine' : 'triangle';
    osc.frequency.value = freq + creature.dna.rhythm * 4; // slight detune by rhythm
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this._reverb);

    osc.start();
    gain.gain.linearRampToValueAtTime(0.018, this._ctx.currentTime + 2);

    this._creatureNodes.set(creature.id, { osc, gain, panner });
  }

  /**
   * Remove and silence a creature's oscillator gracefully.
   * @param {string} creatureId
   */
  removeCreature(creatureId) {
    if (!this._initialized) return;
    const node = this._creatureNodes.get(creatureId);
    if (!node) return;

    const { osc, gain } = node;
    gain.gain.linearRampToValueAtTime(0, this._ctx.currentTime + 1.5);
    setTimeout(() => {
      try { osc.stop(); } catch (_) {}
    }, 1600);

    this._creatureNodes.delete(creatureId);
  }

  /**
   * Update a creature's oscillator pan based on its X position.
   * @param {import('../entities/Creature.js').Creature} creature
   * @param {number} canvasWidth
   */
  updateCreaturePosition(creature, canvasWidth) {
    if (!this._initialized) return;
    const node = this._creatureNodes.get(creature.id);
    if (!node) return;
    node.panner.pan.value = (creature.position.x / canvasWidth) * 2 - 1;
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

  playTranscendence() { this._playTone(880, 'sine', 0.15, 3.0); }
  playTransformation() { this._playTone(440, 'triangle', 0.08, 0.8); }
  playDissolution()  { this._playTone(110, 'sawtooth', 0.06, 1.2); }
  playSymbiosis()    { this._playTone(660, 'sine', 0.1, 1.0); }

  // ── Private helpers ───────────────────────────────────────────────────────

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

  _playTone(freq, type, volume, duration) {
    if (!this._initialized) return;
    const osc  = this._ctx.createOscillator();
    const gain = this._makeGain(volume);
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start();
    gain.gain.linearRampToValueAtTime(0, this._ctx.currentTime + duration);
    setTimeout(() => { try { osc.stop(); } catch (_) {} }, duration * 1000 + 100);
  }
}
