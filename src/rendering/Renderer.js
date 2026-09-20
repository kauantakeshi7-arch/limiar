import { Config } from '../core/Config.js';
import { CreatureState } from '../entities/Creature.js';
import { Random } from '../utils/Random.js';

/**
 * Renderer — All canvas drawing happens here.
 *
 * Visual pipeline per frame:
 *   1.  Background zones (gradient)
 *   2.  Stars (shadow zone)
 *   3.  Light rays (light zone)
 *   4.  Ambient floating particles (internal pool)
 *   5.  Wavy threshold + chromatic aberration
 *   6.  Connection threads between nearby cross-zone creatures
 *   7.  Dissolution echoes (ghost imprints of dead creatures)
 *   8.  Motion trails
 *   9.  Particles (from ParticleSystem)
 *   10. Creatures (blob + orbital motes + state FX)
 *   11. Touch ripple waves
 *   12. Eclipse overlay + moon
 *   13. Post-process: bloom pass + vignette
 */

// Pre-allocated static aurora layer definitions (zero allocations in hot render loop)
const AURORA_LAYERS = Object.freeze([
  // 1. Mint emerald
  { r: 16, g: 185, b: 129, color2: 'rgba(52, 211, 153, 0)', speed: 0.0006, freq: 0.0045, ampRatio: 0.4, phase: 0.0 },
  // 2. Turquoise
  { r: 45, g: 212, b: 191, color2: 'rgba(20, 184, 166, 0)', speed: 0.0008, freq: 0.0060, ampRatio: 0.35, phase: 1.8 },
  // 3. Electric cyan
  { r: 56, g: 189, b: 248, color2: 'rgba(14, 165, 233, 0)', speed: 0.0005, freq: 0.0035, ampRatio: 0.45, phase: 3.5 },
]);

// Pre-allocated numeric RGB diurnal palettes (zero regex, zero parsing per frame)
const DIURNAL_PALETTES = Object.freeze([
  // 0: Alvorada (Dawn)
  {
    lightTop:  [255, 248, 240],
    lightMid:  [248, 227, 203],
    lightBot:  [235, 193, 159],
    shadowTop: [25, 10, 48],
    shadowMid: [15, 5, 32],
    shadowBot: [7, 2, 20],
    fogColor:  [215, 150, 255],
    coreColor: [240, 195, 255],
    bloomTint: [255, 225, 195],
  },
  // 1: Zênite (Solar Noon)
  {
    lightTop:  [255, 255, 242],
    lightMid:  [255, 241, 196],
    lightBot:  [250, 212, 133],
    shadowTop: [30, 10, 56],
    shadowMid: [18, 4, 38],
    shadowBot: [9, 1, 25],
    fogColor:  [200, 145, 255],
    coreColor: [255, 230, 205],
    bloomTint: [255, 240, 175],
  },
  // 2: Crepúsculo (Dusk)
  {
    lightTop:  [247, 222, 212],
    lightMid:  [236, 180, 190],
    lightBot:  [199, 131, 173],
    shadowTop: [38, 8, 61],
    shadowMid: [21, 3, 38],
    shadowBot: [10, 1, 22],
    fogColor:  [225, 130, 215],
    coreColor: [255, 185, 225],
    bloomTint: [250, 175, 220],
  },
  // 3: Nadir (Cosmic Midnight)
  {
    lightTop:  [214, 203, 232],
    lightMid:  [191, 176, 220],
    lightBot:  [162, 142, 198],
    shadowTop: [16, 3, 34],
    shadowMid: [7, 1, 20],
    shadowBot: [3, 0, 10],
    fogColor:  [150, 105, 245],
    coreColor: [200, 170, 255],
    bloomTint: [185, 145, 255],
  },
]);

// Pre-allocated seasonal macro-climate palettes
const SEASON_PALETTES = Object.freeze({
  boreal_night: {
    lt: [230, 255, 250], lm: [187, 247, 208], lb: [153, 246, 228],
    st: [4, 47, 46],     sm: [2, 44, 34],     sb: [1, 28, 22],
  },
  golden_eclipse: {
    lt: [255, 251, 235], lm: [254, 243, 199], lb: [253, 230, 138],
    st: [41, 17, 4],     sm: [28, 11, 2],     sb: [13, 4, 1],
  },
  crystal_tide: {
    lt: [240, 253, 250], lm: [224, 242, 254], lb: [186, 230, 253],
    st: [12, 18, 34],    sm: [8, 13, 25],     sb: [3, 7, 18],
  },
});

const CONST_ECLIPSE_LIGHT_TOP  = [15, 5, 32];
const CONST_ECLIPSE_LIGHT_MID  = [26, 8, 53];
const CONST_ECLIPSE_LIGHT_BOT  = [34, 10, 66];
const CONST_SUNBURST_TOP       = [255, 245, 214];
const CONST_SUNBURST_MID       = [253, 226, 147];
const CONST_SUNBURST_BOT       = [251, 192, 92];

const CONST_VOID_TOP           = [45, 5, 90];
const CONST_VOID_MID           = [26, 2, 54];
const CONST_VOID_BOT           = [6, 0, 18];
const CONST_ECLIPSE_SHADOW_TOP = [8, 2, 21];
const CONST_ECLIPSE_SHADOW_MID = [5, 1, 20];
const CONST_ECLIPSE_SHADOW_BOT = [2, 0, 8];

const SCRATCH_RGB_A = [0, 0, 0];
const SCRATCH_RGB_B = [0, 0, 0];
const SCRATCH_RGB_C = [0, 0, 0];
const SCRATCH_RGB_D = [0, 0, 0];
const SCRATCH_RGB_E = [0, 0, 0];
const SCRATCH_RGB_F = [0, 0, 0];

const SCRATCH_SEASON_LT = [0, 0, 0];
const SCRATCH_SEASON_LM = [0, 0, 0];
const SCRATCH_SEASON_LB = [0, 0, 0];
const SCRATCH_SEASON_ST = [0, 0, 0];
const SCRATCH_SEASON_SM = [0, 0, 0];
const SCRATCH_SEASON_SB = [0, 0, 0];

function blendRGB(a, b, t, out) {
  if (t <= 0) {
    out[0] = a[0]; out[1] = a[1]; out[2] = a[2];
    return out;
  }
  if (t >= 1) {
    out[0] = b[0]; out[1] = b[1]; out[2] = b[2];
    return out;
  }
  const invT = 1 - t;
  out[0] = Math.round(Math.sqrt(invT * a[0] * a[0] + t * b[0] * b[0]));
  out[1] = Math.round(Math.sqrt(invT * a[1] * a[1] + t * b[1] * b[1]));
  out[2] = Math.round(Math.sqrt(invT * a[2] * a[2] + t * b[2] * b[2]));
  return out;
}

function copyRGB(from, to) {
  to[0] = from[0]; to[1] = from[1]; to[2] = from[2];
  return to;
}

function rgbString(c) {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    // Mobile DPR optimized at 1.5 (Retina crisp, 0% stutter, saves >44% GPU fill rate)
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 600;
    this._isMobile = isMobile;
    this._dpr   = isMobile ? Math.min(window.devicePixelRatio || 1, 1.5) : Math.min(window.devicePixelRatio || 1, 2.0);
    this._time  = 0;

    // ── Seeded static scene elements ──────────────────────────────────────
    const rng       = new Random(0xABCDEF);
    this._stars     = this._genStars(rng, 180);
    this._lightRays = this._genLightRays(rng, 5);

    // ── Internal ambient particle pool ────────────────────────────────────
    /** @type {AmbientParticle[]} */
    this._ambient = [];
    this._ambientTimer = 0;

    // ── Dissolution echoes (ghost impressions of dead creatures) ──────────
    /** @type {DissolutionEcho[]} */
    this._echoes = [];

    // ── Pre-allocated pair tracking sets (zero-allocation render passes) ──
    this._visitedDancingPairs = new Set();
    this._bondedPairs        = new Set();

    // ── Pre-allocated wave points cache ───────────────────────────────────
    this._wavePointsCache = Array.from({ length: 91 }, () => [0, 0]);

    // ── Pre-allocated scratch buffers (zero allocations in hot loops) ─────
    this._finPointsScratch = [];
    this._currentDiurnal = {
      lightTop:  [0, 0, 0],
      lightMid:  [0, 0, 0],
      lightBot:  [0, 0, 0],
      shadowTop: [0, 0, 0],
      shadowMid: [0, 0, 0],
      shadowBot: [0, 0, 0],
      fogColor:  [0, 0, 0],
      coreColor: [0, 0, 0],
      bloomTint: [0, 0, 0],
      sunIntensity: 0,
      nightIntensity: 0,
      tPhase: 0,
    };
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  resize() {
    const isMobile = window.innerWidth <= 600;
    this._isMobile = isMobile;
    this._dpr = isMobile ? Math.min(window.devicePixelRatio || 1, 1.5) : Math.min(window.devicePixelRatio || 1, 2.0);
    const w   = window.innerWidth;
    const h   = window.innerHeight;
    this.canvas.width  = Math.floor(w * this._dpr);
    this.canvas.height = Math.floor(h * this._dpr);
    this.canvas.style.width  = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    return { width: w, height: h };
  }

  get width()  { return this.canvas.width  / this._dpr; }
  get height() { return this.canvas.height / this._dpr; }

  // ── Echo registration ─────────────────────────────────────────────────────

  /**
   * Register a dissolved creature as a ghost echo.
   * Called by World when a creature's isAlive transitions to false.
   * @param {import('../entities/Creature.js').Creature} creature
   */
  registerEcho(creature) {
    if (this._echoes.length >= 32) {
      // Overwrite oldest without array re-indexing
      for (let i = 0; i < this._echoes.length - 1; i++) {
        this._echoes[i] = this._echoes[i + 1];
      }
      this._echoes.length = 31;
    }
    this._echoes.push({
      x:      creature.position.x,
      y:      creature.position.y,
      radius: creature.radius,
      color:  creature.color.clone(),
      hsla:   creature.color.toHSLA(),
      alpha:  0.45,
      life:   1.0,           // fades out over ECHO_DURATION_MS
      decay:  0.00008,       // per ms
    });
  }

  /**
   * Capture a clean high-resolution snapshot wallpaper of the current world.
   * @returns {boolean} Success status.
   */
  captureSnapshot() {
    try {
      const dataUrl = this.canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `limiar-cosmos-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    } catch (err) {
      console.error('[Renderer] Snapshot capture failed:', err);
      return false;
    }
  }

  // ── Main render ───────────────────────────────────────────────────────────

  /**
   * @param {object} state
   * @param {import('../entities/Creature.js').Creature[]} state.creatures
   * @param {import('../world/Threshold.js').Threshold}    state.threshold
   * @param {import('../fx/ParticleSystem.js').ParticleSystem} state.particles
   * @param {Array<{x:number, y:number, startTime:number}>} state.ripples
   * @param {{x:number, y:number}} [state.wind]
   * @param {number} state.now
   * @param {number} state.dt
   */
  render({
    creatures,
    threshold,
    particles,
    ripples = [],
    wind = { x: 0, y: 0 },
    activeNectar = null,
    activeSpores = [],
    playerCalls = [],
    inspectedCreature = null,
    diurnalFactor = 0.5,
    diurnalCycle = 0,
    reefs = [],
    tide = null,
    vents = [],
    aurora = null,
    season = null,
    now,
    dt = 16
  }) {
    try {
      this._time = now;
      const ctx  = this.ctx;
      const w    = this.width;
      const h    = this.height;
      if (w <= 0 || h <= 0) return;

      const ty   = threshold.y;
      const ea   = threshold.eclipseAlpha;

      // ── Respiration of the World ──────────────────────────────────────────
      // Continuous 8.5s sinusoidal breathing cycle
      const breath = 0.5 + 0.5 * Math.sin(now * 0.00074);

      // ── Micro-Weather Cycles ──────────────────────────────────────────────
      // Sunburst: golden atmospheric surge every ~42 seconds (lasts ~6.5s)
      const sunburstCycle = (now % 42000) / 42000;
      let sunburst = 0;
      if (sunburstCycle > 0.82 && sunburstCycle < 0.98) {
        const st = (sunburstCycle - 0.82) / 0.16;
        sunburst = Math.sin(st * Math.PI);
      }

      // Void Pulse: abyssal wave in the shadow realm every ~48 seconds (lasts ~7.5s)
      const voidCycle = ((now + 21000) % 48000) / 48000;
      let voidPulse = 0;
      if (voidCycle > 0.82 && voidCycle < 0.98) {
        const vt = (voidCycle - 0.82) / 0.16;
        voidPulse = Math.sin(vt * Math.PI);
      }

      // ── Threshold Tension ─────────────────────────────────────────────────
      let tension = 0;
      for (let i = 0; i < creatures.length; i++) {
        const c = creatures[i];
        if (!c.isAlive) continue;
        const distY = Math.abs(c.position.y - ty);
        if (distY < 95) {
          const prox = 1 - distY / 95;
          tension += prox * (c.state === CreatureState.CROSSING ? 2.8 : 1.2);
        }
      }
      tension += Math.abs(threshold.velocity || 0) * 1.6;
      if (threshold.isDragging) tension += 1.4;

      ctx.clearRect(0, 0, w, h);

      // Sample diurnal cycle once per frame (zero-allocation)
      this._sampleDiurnal(diurnalCycle);

      // 1. Background (breathes + diurnal tide + micro-weather + cosmic seasons)
      this._drawBackground(ctx, w, h, ty, ea, breath, sunburst, voidPulse, diurnalCycle, diurnalFactor, season);

      // 2. Stars (twinkle + nadir shooting stars)
      this._drawStars(ctx, w, h, ty, ea, voidPulse, diurnalCycle, diurnalFactor);

      // 3. Light rays (light zone + sunburst flares + zenith warmth)
      this._drawLightAtmosphere(ctx, w, ty, now, ea, breath, sunburst, diurnalFactor, diurnalCycle);

      // 3.2. Aurora Nursery Curtains (Estrato Celeste Supremo)
      this._drawAuroraCurtains(ctx, w, h, now, wind, season);

      // 3.5. Cosmic Tide Streamlines (Zen horizontal ether current)
      if (tide && tide.factor > 0.005) {
        this._drawCosmicTide(ctx, w, h, tide, now);
      }

      // 5. Ambient floating particles (nudged by wind + weather spawns + creature grazing)
      this._updateAmbient(dt, w, h, ty, wind, sunburst, voidPulse, creatures);
      this._drawAmbient(ctx);

      // 4. Sanctuaries (Luminous polyp reefs)
      if (reefs && reefs.length > 0) {
        this._drawSanctuaries(ctx, reefs, now, w, h, wind, tide);
      }

      // 6. Threshold line + chromatic aberration + harp waves
      this._drawThreshold(ctx, w, h, ty, ea, now, creatures, tension, breath, threshold, diurnalCycle);

      // 7. Courtship ribbons (Dança dos Opostos)
      this._drawCourtshipRibbons(ctx, creatures, now);

      // 6.5. Cross-zone harmonic threads & symbiotic links
      this._drawConnectionThreads(ctx, creatures);

      // 8. Dissolution echoes
      this._updateEchoes(dt);
      this._drawEchoes(ctx);

      // 9. Motion trails
      this._drawTrails(ctx, creatures);

      // 10. Particles
      this._drawParticles(ctx, particles);

      // 10.5. Living flora spores & shimmering stardust
      this._drawSpores(ctx, activeSpores, now);
      if (aurora && aurora.shimmerDust && aurora.shimmerDust.length > 0) {
        this._drawShimmerDust(ctx, aurora.shimmerDust, now);
      }

      // 10.8. Acoustic Player Calls & Echoes
      this._drawPlayerCalls(ctx, playerCalls, now);

      // 10.9. Celestial Nectar
      this._drawNectar(ctx, activeNectar, now);

      // 11. Creatures
      this._drawCreatures(ctx, creatures, now, breath, dt);

      // 11.5. Inspected creature indicator
      if (inspectedCreature && inspectedCreature.isAlive) {
        this._drawInspectedIndicator(ctx, inspectedCreature, now);
      }

      // 12. Ripples
      this._drawRipples(ctx, ripples, now);

      // 13. Eclipse full overlay
      this._drawEclipseOverlay(ctx, w, h, ty, ea, now);

      // 14. Bloom pass (creature glow + threshold haze)
      this._drawBloomPass(ctx, w, h, creatures, ty, ea, now, sunburst, voidPulse, diurnalCycle, season);

      // 15. Vignette (ambient occluding frame)
      this._drawVignette(ctx, w, h, diurnalFactor);
    } catch (err) {
      console.error('[Renderer] Error during frame render:', err);
    }
  }

  // ── 1. Background ─────────────────────────────────────────────────────────

  _drawBackground(ctx, w, h, ty, ea, breath = 0.5, sunburst = 0, voidPulse = 0, diurnalCycle = 0, diurnalFactor = 0.5, season = null) {
    const eclipse = 1 - ea;
    const diurnal = this._currentDiurnal;

    // 1. Light zone background (breathes & shifts with diurnal tide)
    const lightStop = 0.55 + breath * 0.08;
    const lg = ctx.createLinearGradient(0, 0, 0, ty);

    // Copy base diurnal colors into scratch arrays
    const lt = copyRGB(diurnal.lightTop, SCRATCH_RGB_A);
    const lm = copyRGB(diurnal.lightMid, SCRATCH_RGB_B);
    const lb = copyRGB(diurnal.lightBot, SCRATCH_RGB_C);
    const st = copyRGB(diurnal.shadowTop, SCRATCH_RGB_D);
    const sm = copyRGB(diurnal.shadowMid, SCRATCH_RGB_E);
    const sb = copyRGB(diurnal.shadowBot, SCRATCH_RGB_F);

    // Seasonal macro-climate color infusion (smooth C1 blending)
    if (season) {
      const c1 = SEASON_PALETTES[season.current] || SEASON_PALETTES.crystal_tide;
      let sLightTop = c1.lt;
      let sLightMid = c1.lm;
      let sLightBot = c1.lb;
      let sShadowTop = c1.st;
      let sShadowMid = c1.sm;
      let sShadowBot = c1.sb;

      if (season.blend > 0 && season.next) {
        const c2 = SEASON_PALETTES[season.next] || SEASON_PALETTES.crystal_tide;
        sLightTop  = blendRGB(sLightTop,  c2.lt, season.blend, SCRATCH_SEASON_LT);
        sLightMid  = blendRGB(sLightMid,  c2.lm, season.blend, SCRATCH_SEASON_LM);
        sLightBot  = blendRGB(sLightBot,  c2.lb, season.blend, SCRATCH_SEASON_LB);
        sShadowTop = blendRGB(sShadowTop, c2.st, season.blend, SCRATCH_SEASON_ST);
        sShadowMid = blendRGB(sShadowMid, c2.sm, season.blend, SCRATCH_SEASON_SM);
        sShadowBot = blendRGB(sShadowBot, c2.sb, season.blend, SCRATCH_SEASON_SB);
      }

      // Infuse seasonal colors into diurnal palette smoothly
      blendRGB(lt, sLightTop,  0.28, lt);
      blendRGB(lm, sLightMid,  0.30, lm);
      blendRGB(lb, sLightBot,  0.28, lb);
      blendRGB(st, sShadowTop, 0.34, st);
      blendRGB(sm, sShadowMid, 0.36, sm);
      blendRGB(sb, sShadowBot, 0.38, sb);
    }

    // Sunburst golden infusion (smoothly blended without hard threshold)
    if (sunburst > 0) {
      blendRGB(lt, CONST_SUNBURST_TOP, sunburst * 0.65, lt);
      blendRGB(lm, CONST_SUNBURST_MID, sunburst * 0.75, lm);
      blendRGB(lb, CONST_SUNBURST_BOT, sunburst * 0.75, lb);
    }

    if (eclipse > 0) {
      blendRGB(lt, CONST_ECLIPSE_LIGHT_TOP, eclipse, lt);
      blendRGB(lm, CONST_ECLIPSE_LIGHT_MID, eclipse, lm);
      blendRGB(lb, CONST_ECLIPSE_LIGHT_BOT, eclipse, lb);
    }

    lg.addColorStop(0,         rgbString(lt));
    lg.addColorStop(lightStop, rgbString(lm));
    lg.addColorStop(1,         rgbString(lb));
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, w, ty);

    // 2. Shadow zone background (breathes & shifts with diurnal tide)
    const shadowStop = 0.5 - breath * 0.06;
    const sg = ctx.createLinearGradient(0, ty, 0, h);

    if (voidPulse > 0) {
      blendRGB(st, CONST_VOID_TOP, voidPulse * 0.70, st);
      blendRGB(sm, CONST_VOID_MID, voidPulse * 0.75, sm);
      blendRGB(sb, CONST_VOID_BOT, voidPulse * 0.80, sb);
    }

    if (eclipse > 0) {
      blendRGB(st, CONST_ECLIPSE_SHADOW_TOP, eclipse, st);
      blendRGB(sm, CONST_ECLIPSE_SHADOW_MID, eclipse, sm);
      blendRGB(sb, CONST_ECLIPSE_SHADOW_BOT, eclipse, sb);
    }

    sg.addColorStop(0,          rgbString(st));
    sg.addColorStop(shadowStop, rgbString(sm));
    sg.addColorStop(1,          rgbString(sb));
    ctx.fillStyle = sg;
    ctx.fillRect(0, ty, w, h - ty);
  }

  // ── 2. Stars ──────────────────────────────────────────────────────────────

  _drawStars(ctx, w, h, ty, ea, voidPulse = 0, diurnalCycle = 0, diurnalFactor = 0.5) {
    const shadowH = h - ty;
    if (shadowH < 5) return;
    ctx.save();

    // Night intensity is highest at Nadir (diurnalCycle = 0.75), lowest at Zenith (0.25)
    // Pure smooth sinusoidal modulation
    const nightIntensity = 0.5 - 0.5 * Math.sin(diurnalCycle * Math.PI * 2);
    // Stars brighten continuously during night, eclipse, or void pulses
    const base = (ea < 1 ? 1 : ea * 0.45) + voidPulse * 0.35 + nightIntensity * 0.65;

    for (let i = 0; i < this._stars.length; i++) {
      const s       = this._stars[i];
      const sx      = s.x * w;
      const sy      = ty + s.y * shadowH;
      const twinkle = 0.5 + 0.5 * Math.sin(this._time * s.twinkleSpeed + s.twinkle);
      const alpha   = Math.min(1, s.alpha * twinkle * base);
      if (alpha < 0.01) continue;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = s.rgbString;
      ctx.beginPath();
      ctx.arc(sx, sy, s.size, 0, Math.PI * 2);
      ctx.fill();

      if (s.size > 1.4 && alpha > 0.25) {
        ctx.globalAlpha = alpha * 0.4;
        ctx.strokeStyle = s.rgbString;
        ctx.lineWidth = 0.5;
        const len = s.size * (2 + nightIntensity);
        ctx.beginPath();
        ctx.moveTo(sx - len, sy); ctx.lineTo(sx + len, sy);
        ctx.moveTo(sx, sy - len); ctx.lineTo(sx, sy + len);
        ctx.stroke();
      }
    }

    // Shooting stars glide across the sky during the dark quadrant of the night
    // nightIntensity rises smoothly to 1.0 around Nadir. We scale alpha by nightIntensity^1.6
    if (shadowH > 90 && nightIntensity > 0.2) {
      const shootCycle = (this._time % 14000) / 14000;
      if (shootCycle < 0.09) {
        const st = shootCycle / 0.09;
        const seed = Math.sin(Math.floor(this._time / 14000) * 17.1);
        const startX = w * (0.15 + (seed * 0.5 + 0.5) * 0.65);
        const startY = ty + 15 + Math.abs(seed) * (shadowH * 0.35);
        const len = 130 * st;
        const headX = startX + len * 1.1;
        const headY = startY + len * 0.6;
        const tailX = headX - Math.min(len, 65) * 1.1;
        const tailY = headY - Math.min(len, 65) * 0.6;
        const shootAlpha = Math.sin(st * Math.PI) * 0.75 * Math.pow(nightIntensity, 1.6);

        if (shootAlpha > 0.01) {
          const grad = ctx.createLinearGradient(tailX, tailY, headX, headY);
          grad.addColorStop(0, 'rgba(200, 160, 255, 0)');
          grad.addColorStop(1, `rgba(255, 255, 245, ${shootAlpha})`);

          ctx.beginPath();
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(headX, headY);
          ctx.strokeStyle = grad;
          ctx.lineWidth   = 1.5;
          ctx.shadowColor = 'rgba(230, 190, 255, 0.9)';
          ctx.shadowBlur  = this._isMobile ? 0 : 8;
          ctx.stroke();
          ctx.shadowBlur  = 0;
        }
      }
    }

    ctx.restore();
  }

  // ── 3. Light rays ─────────────────────────────────────────────────────────

  _drawLightAtmosphere(ctx, w, ty, now, ea, breath = 0.5, sunburst = 0, diurnalFactor = 0.5, diurnalCycle = 0) {
    if (ty < 10 || ea < 0.05) return;
    ctx.save();
    ctx.globalAlpha = ea;

    // Sun intensity peaks at Zenith (diurnalCycle = 0.25), drops at Nadir (0.75)
    const sunIntensity = 0.5 + 0.5 * Math.sin(diurnalCycle * Math.PI * 2);

    // Solar flare crown at top of screen during sunbursts or high sun intensity
    const crownStrength = (sunburst * 0.20 + Math.pow(sunIntensity, 2) * 0.12) * ea;
    if (crownStrength > 0.005 && ty > 15) {
      const crownR = Math.max(15, Math.min(w, ty) * (0.75 + sunIntensity * 0.25));
      const crownG = ctx.createRadialGradient(w * 0.5, 0, 10, w * 0.5, 0, crownR);
      crownG.addColorStop(0,   `rgba(255, 240, 180, ${crownStrength})`);
      crownG.addColorStop(0.5, `rgba(255, 215, 120, ${crownStrength * 0.45})`);
      crownG.addColorStop(1,   'rgba(255, 200, 100, 0)');
      ctx.fillStyle = crownG;
      ctx.fillRect(0, 0, w, ty);
    }

    for (let i = 0; i < this._lightRays.length; i++) {
      const ray = this._lightRays[i];
      const pulse  = 0.5 + 0.5 * Math.sin(now * ray.pulseSpeed + ray.phase);
      const combinedPulse = pulse * 0.45 + breath * 0.20 + sunburst * 0.45 + sunIntensity * 0.35;
      const rayX   = w * ray.xRatio;
      const rayLen = ty * (0.45 + ray.lenRatio * 0.35 + combinedPulse * 0.20);
      const endX   = rayX + Math.cos(ray.angle) * rayLen;
      const endY   = Math.sin(ray.angle) * rayLen;

      // Opacity scales continuously with sunIntensity
      const rayAlpha = (0.015 + sunIntensity * 0.045 + combinedPulse * 0.03) * (0.3 + 0.7 * sunIntensity);
      const grad = ctx.createLinearGradient(rayX, 0, endX, endY);
      grad.addColorStop(0,   `rgba(255, 238, 150, ${rayAlpha})`);
      grad.addColorStop(0.6, `rgba(255, 222, 110, ${rayAlpha * 0.35})`);
      grad.addColorStop(1,   'rgba(255, 222, 110, 0)');

      const spread = ray.spread * w * (0.06 + sunburst * 0.04 + sunIntensity * 0.03);
      ctx.beginPath();
      ctx.moveTo(rayX, 0);
      ctx.lineTo(endX - spread, endY);
      ctx.lineTo(endX + spread, endY);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Warm haze at the base of the light zone
    const hazeAlpha = (0.03 + breath * 0.015 + sunburst * 0.04 + sunIntensity * 0.045) * ea;
    const haze = ctx.createLinearGradient(0, ty * 0.65, 0, ty);
    haze.addColorStop(0, 'rgba(255, 215, 120, 0)');
    haze.addColorStop(1, `rgba(255, 205, 90, ${hazeAlpha})`);
    ctx.fillStyle = haze;
    ctx.fillRect(0, ty * 0.65, w, ty * 0.35);

    ctx.restore();
  }

  // ── 5. Ambient floating particles ─────────────────────────────────────────

  _updateAmbient(dt, w, h, ty, wind = { x: 0, y: 0 }, sunburst = 0, voidPulse = 0, creatures = []) {
    this._ambientTimer += dt;
    const interval = (sunburst > 0.2 || voidPulse > 0.2) ? 35 : 60;

    if (this._ambientTimer > interval) {
      this._ambientTimer = 0;
      // Light motes — rise upward in light zone
      if (ty > 60) {
        const count = sunburst > 0.2 ? 4 : 2;
        for (let i = 0; i < count; i++) {
          const hue = sunburst > 0.2 ? 45 + Math.random() * 15 : 40 + Math.random() * 20;
          const sat = 80 + Math.random() * 20;
          const lit = 75 + Math.random() * 15;
          this._ambient.push({
            x:     Math.random() * w,
            y:     Math.random() * ty,
            vx:    (Math.random() - 0.5) * 0.08,
            vy:    -Math.random() * 0.18 - 0.04,
            size:  Math.random() * (sunburst > 0.2 ? 3.5 : 2.5) + 0.5,
            alpha: Math.random() * (sunburst > 0.2 ? 0.6 : 0.35) + 0.1,
            hsl:   `hsl(${Math.round(hue)}, ${Math.round(sat)}%, ${Math.round(lit)}%)`,
            life:  1,
            decay: 0.0004 + Math.random() * 0.0003,
            zone:  'light',
          });
        }
      }
      // Shadow dust — drift downward in shadow zone
      if (h - ty > 60) {
        const count = voidPulse > 0.2 ? 4 : 2;
        for (let i = 0; i < count; i++) {
          const hue = voidPulse > 0.2 ? 280 + Math.random() * 25 : 275 + Math.random() * 20;
          const sat = 80 + Math.random() * 20;
          const lit = 65 + Math.random() * 15;
          this._ambient.push({
            x:     Math.random() * w,
            y:     ty + Math.random() * (h - ty),
            vx:    (Math.random() - 0.5) * 0.06,
            vy:    Math.random() * 0.12 + 0.02,
            size:  Math.random() * (voidPulse > 0.2 ? 3 : 2) + 0.5,
            alpha: Math.random() * (voidPulse > 0.2 ? 0.55 : 0.35) + 0.1,
            hsl:   `hsl(${Math.round(hue)}, ${Math.round(sat)}%, ${Math.round(lit)}%)`,
            life:  1,
            decay: 0.0005 + Math.random() * 0.0004,
            zone:  'shadow',
          });
        }
      }
    }

    // Update + wind influence + creature feeding / grazing
    const wx = (wind.x || 0) * 0.25;
    const wy = (wind.y || 0) * 0.25;

    for (let i = 0; i < this._ambient.length; i++) {
      const p = this._ambient[i];
      p.x    += (p.vx + wx) * dt;
      p.y    += (p.vy + wy) * dt;
      p.life -= p.decay * dt;

      // Creature grazing check
      for (let j = 0; j < creatures.length; j++) {
        const c = creatures[j];
        if (!c.isAlive) continue;
        if (p.zone === c.originZone || c.state === CreatureState.HYBRID || c.state === CreatureState.CROSSING) {
          const dx = p.x - c.position.x;
          const dy = p.y - c.position.y;
          const feedDist = c.radius * 1.35;
          if (dx * dx + dy * dy < feedDist * feedDist) {
            c.feed();
            p.life = 0; // consumed!
            break;
          }
        }
      }
    }

    let writeIdx = 0;
    for (let i = 0; i < this._ambient.length; i++) {
      const p = this._ambient[i];
      if (p.life > 0) {
        this._ambient[writeIdx++] = p;
      }
    }
    this._ambient.length = writeIdx;
    if (this._ambient.length > 320) {
      const drop = 60;
      const newLen = this._ambient.length - drop;
      for (let i = 0; i < newLen; i++) {
        this._ambient[i] = this._ambient[i + drop];
      }
      this._ambient.length = newLen;
    }
  }

  _drawAmbient(ctx) {
    ctx.save();
    const canGlow = !this._isMobile;
    // 1. Light motes (warm golden aura batch)
    ctx.shadowColor = 'rgba(255, 220, 140, 0.45)';
    ctx.shadowBlur  = canGlow ? 6 : 0;
    for (let i = 0; i < this._ambient.length; i++) {
      const p = this._ambient[i];
      if (p.zone !== 'light') continue;
      const alpha = p.alpha * p.life * p.life;
      if (alpha < 0.005) continue;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.hsl;
      ctx.fill();
    }

    // 2. Shadow dust (cool amethyst aura batch)
    ctx.shadowColor = 'rgba(180, 120, 255, 0.45)';
    ctx.shadowBlur  = canGlow ? 6 : 0;
    for (let i = 0; i < this._ambient.length; i++) {
      const p = this._ambient[i];
      if (p.zone !== 'shadow') continue;
      const alpha = p.alpha * p.life * p.life;
      if (alpha < 0.005) continue;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.hsl;
      ctx.fill();
    }
    ctx.restore();
  }

  // ── 3.5. Cosmic Tide Streamlines ──────────────────────────────────────────

  _drawCosmicTide(ctx, w, h, tide, now) {
    if (!tide || tide.factor < 0.005) return;

    const tf = tide.factor;
    const dir = tide.direction || 1;
    const speed = 0.045 * dir;
    const offset = (now * speed) % 80;

    ctx.save();
    // Subtle ether streamlines flowing horizontally across the screen
    const lineCount = 5;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([24, 48]);
    ctx.lineDashOffset = -offset;

    for (let i = 1; i <= lineCount; i++) {
      const yBase = (h / (lineCount + 1)) * i;
      const alpha = (0.05 + 0.04 * Math.sin(now * 0.001 + i)) * tf;

      ctx.beginPath();
      for (let x = 0; x <= w; x += 40) {
        const y = yBase + Math.sin(x * 0.008 + now * 0.0012 + i) * 12;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.strokeStyle = `rgba(185, 215, 255, ${alpha})`;
      ctx.shadowColor = 'rgba(160, 200, 255, 0.25)';
      ctx.shadowBlur = this._isMobile ? 0 : 4;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── 5.5. Ecological Sanctuaries & Spore Reefs ──────────────────────────────

  _drawSanctuaries(ctx, reefs, now, w, h, wind = { x: 0, y: 0 }, tide = null) {
    if (!reefs || reefs.length === 0) return;

    const tideForceX = tide ? (tide.vector?.x || 0) * 18 : 0;
    const windForceX = (wind?.x || 0) * 8;

    ctx.save();
    for (let rIdx = 0; rIdx < reefs.length; rIdx++) {
      const reef = reefs[rIdx];
      const bx = reef.baseX;
      const by = reef.baseY;
      const isLight = reef.zone === Config.ZONE.LIGHT;

      // 1. Soft restorative aura (gentle nursery rest field)
      const restR = Config.SANCTUARIES?.REST_ATTRACT_RADIUS || 140;
      const restPulse = 0.5 + 0.5 * Math.sin(now * 0.0015 + (reef.pulsePhase || 0));
      const restGrad = ctx.createRadialGradient(bx, by, 10, bx, by, restR);
      const auraColor = isLight ? '255, 235, 170' : '170, 130, 240';
      restGrad.addColorStop(0, `rgba(${auraColor}, ${0.08 + restPulse * 0.04})`);
      restGrad.addColorStop(0.65, `rgba(${auraColor}, ${0.02 + restPulse * 0.02})`);
      restGrad.addColorStop(1, `rgba(${auraColor}, 0)`);
      ctx.fillStyle = restGrad;
      ctx.beginPath();
      ctx.arc(bx, by, restR, 0, Math.PI * 2);
      ctx.fill();

      // 2. Reef base mound / ethereal coral shelf
      ctx.beginPath();
      ctx.ellipse(bx, by, 34, 11, 0, 0, Math.PI * 2);
      ctx.fillStyle = isLight ? 'rgba(235, 215, 155, 0.22)' : 'rgba(120, 85, 180, 0.22)';
      ctx.fill();

      // 3. Swaying stalks and glowing bioluminescent bulbs
      const polyps = reef.polyps || [];
      for (let pIdx = 0; pIdx < polyps.length; pIdx++) {
        const polyp = polyps[pIdx];
        const px = bx + polyp.offsetX;
        const py = by;
        const hStalk = polyp.height;
        const dirY = isLight ? 1 : -1; // Light hangs downwards, shadow spires upward

        const stalkSway = Math.sin(now * 0.0012 + polyp.phase) * 14 + windForceX + tideForceX;
        const tipX = px + stalkSway;
        const tipY = py + dirY * hStalk;
        const midX = px + stalkSway * 0.45;
        const midY = py + dirY * (hStalk * 0.55);

        // Stalk stem
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(midX, midY, tipX, tipY);
        ctx.strokeStyle = polyp.color.toHSLAWithAlpha(0.38);
        ctx.lineWidth = 1.6;
        ctx.stroke();

        // Bioluminescent bulb at tip
        const bulbP = 0.5 + 0.5 * Math.sin(reef.pulsePhase + polyp.phase);
        const bRad = polyp.bulbRadius * (0.88 + 0.22 * bulbP);

        // Bulb soft glow
        ctx.beginPath();
        ctx.arc(tipX, tipY, bRad * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = polyp.color.toHSLAWithAlpha(0.15 + bulbP * 0.12);
        ctx.fill();

        // Bulb solid core
        ctx.beginPath();
        ctx.arc(tipX, tipY, bRad, 0, Math.PI * 2);
        ctx.fillStyle = polyp.color.toHSLAWithAlpha(0.75 + bulbP * 0.25);
        ctx.shadowColor = polyp.color.toGlowHSLA(0.8);
        ctx.shadowBlur = this._isMobile ? 0 : 8 + bulbP * 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
  }

  // ── 3.2. Aurora Nursery Curtains (Estrato Celeste Supremo) ─────────────────

  _drawAuroraCurtains(ctx, w, h, now, wind = { x: 0, y: 0 }, season = null) {
    const auroraH = h * (Config.AURORA_NURSERY?.HEIGHT_RATIO || 0.20);
    if (auroraH <= 5 || w <= 0) return;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    // Base aurora presence, heightened during Boreal Night
    let auroraAlpha = 0.35;
    if (season?.current === 'boreal_night') {
      auroraAlpha = 0.65;
    } else if (season?.next === 'boreal_night' && season?.blend > 0) {
      auroraAlpha = 0.35 + season.blend * 0.30;
    }

    const a0 = (auroraAlpha * 0.65).toFixed(3);
    const a1 = (auroraAlpha * 0.35).toFixed(3);
    const windShift = (wind?.x || 0) * 15;

    for (let l = 0; l < AURORA_LAYERS.length; l++) {
      const layer = AURORA_LAYERS[l];
      const grad = ctx.createLinearGradient(0, 0, 0, auroraH * 1.35);
      grad.addColorStop(0, `rgba(${layer.r}, ${layer.g}, ${layer.b}, ${a0})`);
      grad.addColorStop(0.55, `rgba(${layer.r}, ${layer.g}, ${layer.b}, ${a1})`);
      grad.addColorStop(1, layer.color2);

      ctx.beginPath();
      ctx.moveTo(0, 0);

      // Smooth sine ribbon curtain wave with wind drift
      const waveFreq = layer.freq;
      const waveSpeed = layer.speed;
      const amp = auroraH * layer.ampRatio;

      for (let x = 0; x <= w; x += 30) {
        const y = auroraH * 0.45 + Math.sin(x * waveFreq + now * waveSpeed + layer.phase) * amp;
        ctx.lineTo(x + windShift, y);
      }

      ctx.lineTo(w, 0);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.restore();
  }



  // ── 3.3. Living Flora Spores & Silver Stardust ─────────────────────────────

  _drawShimmerDust(ctx, dustList, now) {
    if (!dustList || dustList.length === 0) return;
    ctx.save();
    for (let i = 0; i < dustList.length; i++) {
      const d = dustList[i];
      if (d.life <= 0) continue;
      const alpha = d.life * 0.75;
      const pulse = 0.6 + 0.4 * Math.sin(now * 0.006 + d.seed);

      ctx.beginPath();
      ctx.arc(d.x, d.y, d.radius * pulse, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(240, 248, 255, ${alpha * pulse})`;
      ctx.shadowColor = 'rgba(226, 232, 240, 0.9)';
      ctx.shadowBlur = this._isMobile ? 0 : 6;
      ctx.fill();
    }
    ctx.restore();
  }

  // ── 6. Threshold ──────────────────────────────────────────────────────────

  _drawThreshold(ctx, w, h, ty, ea, now, creatures = [], tension = 0, breath = 0.5, threshold = null, diurnalCycle = 0) {
    if (ea < 0.02) return;
    const points = this._wavePath(w, ty, now, creatures, tension, breath);
    const pulse  = 0.5 + 0.5 * Math.sin(now * 0.0013);
    const tensionGlow = Math.min(tension * 0.35, 1.2);
    const diurnal = this._currentDiurnal;
    const [fcR, fcG, fcB] = diurnal.fogColor;
    const [ccR, ccG, ccB] = diurnal.coreColor;

    // Fog band widens with tension and harmonizes with diurnal tide
    const fogH = 55 + tension * 8;
    const fogGrad = ctx.createLinearGradient(0, ty - fogH, 0, ty + fogH);
    fogGrad.addColorStop(0,    `rgba(${fcR}, ${fcG}, ${fcB}, 0)`);
    fogGrad.addColorStop(0.38, `rgba(${fcR}, ${fcG}, ${fcB}, ${(0.06 + tensionGlow * 0.05) * ea})`);
    fogGrad.addColorStop(0.5,  `rgba(${ccR}, ${ccG}, ${ccB}, ${(0.13 + pulse * 0.07 + tensionGlow * 0.09) * ea})`);
    fogGrad.addColorStop(0.62, `rgba(${fcR}, ${fcG}, ${fcB}, ${(0.06 + tensionGlow * 0.05) * ea})`);
    fogGrad.addColorStop(1,    `rgba(${fcR}, ${fcG}, ${fcB}, 0)`);
    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, ty - fogH, w, fogH * 2);

    // Chromatic aberration fringe widens and flickers under tension
    const bandH = 18 + tension * 8;
    const cp    = (0.5 + 0.5 * Math.sin(now * (0.002 + tension * 0.003))) * ea;
    const rGrad = ctx.createLinearGradient(0, ty - bandH, 0, ty);
    rGrad.addColorStop(0, 'rgba(255, 70, 110, 0)');
    rGrad.addColorStop(1, `rgba(255, 60, 100, ${(0.045 + tensionGlow * 0.04) * cp})`);
    ctx.fillStyle = rGrad; ctx.fillRect(0, ty - bandH, w, bandH);

    const cGrad = ctx.createLinearGradient(0, ty, 0, ty + bandH);
    cGrad.addColorStop(0, `rgba(50, 185, 255, ${(0.045 + tensionGlow * 0.04) * cp})`);
    cGrad.addColorStop(1, 'rgba(50, 185, 255, 0)');
    ctx.fillStyle = cGrad; ctx.fillRect(0, ty, w, bandH);

    // Harp waves (liquid harp impulses)
    if (threshold && threshold.harpWaves && threshold.harpWaves.length > 0) {
      this._drawHarpWaves(ctx, threshold.harpWaves, w, ty);
    }

    // Flora reeds (bioluminescent living reeds along the membrane)
    if (threshold && threshold.flora && threshold.flora.length > 0) {
      this._drawFloraReeds(ctx, threshold.flora, points, w, ty, ea, now, breath);
    }

    // Wavy line
    ctx.save();
    ctx.globalAlpha = ea;

    // Outer glow pass
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.strokeStyle = `rgba(${fcR}, ${fcG}, ${fcB}, ${0.25 + pulse * 0.1 + tensionGlow * 0.2})`;
    ctx.lineWidth   = 4 + tensionGlow * 1.5;
    ctx.shadowColor = tension > 1.5 ? `rgba(${ccR}, ${ccG}, ${ccB}, 1)` : `rgba(${fcR}, ${fcG}, ${fcB}, 0.9)`;
    ctx.shadowBlur  = this._isMobile ? 0 : 22 + tension * 8;
    ctx.stroke();

    // Core line
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.strokeStyle = `rgba(${ccR}, ${ccG}, ${ccB}, ${0.55 + pulse * 0.2 + tensionGlow * 0.25})`;
    ctx.lineWidth   = 1.2 + tensionGlow * 0.6;
    ctx.shadowBlur  = this._isMobile ? 0 : 6 + tensionGlow * 4;
    ctx.stroke();
    ctx.shadowBlur  = 0;

    // Electric tension micro-sparkles along the line when tension is notable
    if (tension > 0.8) {
      this._drawTensionSparks(ctx, points, tension, now);
    }

    ctx.restore();
  }

  _drawHarpWaves(ctx, harpWaves, w, ty) {
    ctx.save();
    for (let i = 0; i < harpWaves.length; i++) {
      const hw = harpWaves[i];
      const cx = hw.xRatio * w;
      const r = Math.max(1, hw.radius);
      const alpha = Math.max(0, hw.life * (hw.intensity || 1));
      if (alpha < 0.01) continue;

      // Outer ripple
      ctx.beginPath();
      ctx.ellipse(cx, ty, r, Math.max(1, r * 0.42), 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(225, 205, 255, ${alpha * 0.55})`;
      ctx.lineWidth = Math.max(0.5, 2.2 * hw.life);
      if (!this._isMobile) {
        ctx.shadowColor = 'rgba(200, 160, 255, 0.9)';
        ctx.shadowBlur = 10;
      }
      ctx.stroke();
      if (!this._isMobile) ctx.shadowBlur = 0;

      // Inner golden resonance ring
      if (r > 12) {
        ctx.beginPath();
        ctx.ellipse(cx, ty, Math.max(1, r * 0.55), Math.max(1, r * 0.24), 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 235, 180, ${alpha * 0.4})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Pluck core spark
      if (hw.life > 0.7) {
        const coreAlpha = (hw.life - 0.7) / 0.3;
        ctx.beginPath();
        ctx.arc(cx, ty, Math.max(1, 4 * coreAlpha), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 250, 220, ${coreAlpha * 0.9})`;
        if (!this._isMobile) {
          ctx.shadowColor = 'rgba(255, 240, 180, 1)';
          ctx.shadowBlur = 12;
        }
        ctx.fill();
        if (!this._isMobile) ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
  }

  _drawFloraReeds(ctx, flora, points, w, ty, ea, now, breath = 0.5) {
    if (!flora || flora.length === 0 || !points || points.length === 0) return;
    const n = points.length - 1;

    ctx.save();
    for (let rIdx = 0; rIdx < flora.length; rIdx++) {
      const reed = flora[rIdx];
      // Find point along membrane path
      const idxF = Math.max(0, Math.min(n, reed.u * n));
      const i0 = Math.floor(idxF);
      const i1 = Math.min(n, i0 + 1);
      const frac = idxF - i0;

      const rx = points[i0][0] + (points[i1][0] - points[i0][0]) * frac;
      const ry = points[i0][1] + (points[i1][1] - points[i0][1]) * frac;

      const h = reed.height * (1 + breath * 0.08);
      const angle = reed.angle;
      const side = reed.side; // -1 = grows up (light), 1 = grows down (shadow)

      // Tip coordinates
      const endX = rx + Math.sin(angle) * h;
      const endY = ry + side * Math.cos(angle) * h;
      const midX = rx + Math.sin(angle * 0.5) * (h * 0.55);
      const midY = ry + side * (h * 0.5);

      const isLight = side === -1;
      const stemColor = isLight
        ? `rgba(255, 225, 140, ${0.45 * ea})`
        : `rgba(175, 135, 255, ${0.45 * ea})`;
      const tipColor = isLight
        ? `rgba(255, 245, 190, ${0.85 * ea})`
        : `rgba(195, 225, 255, ${0.85 * ea})`;
      const glowColor = isLight
        ? 'rgba(255, 220, 130, 0.8)'
        : 'rgba(180, 150, 255, 0.8)';

      // Stem curve
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.quadraticCurveTo(midX, midY, endX, endY);
      ctx.strokeStyle = stemColor;
      ctx.lineWidth   = 1.4;
      ctx.shadowBlur  = 0;
      ctx.stroke();

      // Bioluminescent blossom / spore bud at tip
      const budPulse = 0.5 + 0.5 * Math.sin(now * 0.003 + reed.swayPhase);
      const budR = Math.max(1, (2.2 + budPulse * 1.2) * ea);

      ctx.beginPath();
      ctx.arc(endX, endY, budR, 0, Math.PI * 2);
      ctx.fillStyle = tipColor;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = this._isMobile ? 0 : 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Delicate halo around bud
      ctx.beginPath();
      ctx.arc(endX, endY, budR * 1.8, 0, Math.PI * 2);
      ctx.strokeStyle = tipColor;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawTensionSparks(ctx, points, tension, now) {
    const sparkCount = Math.min(Math.floor(tension * 3), 12);
    ctx.save();
    for (let s = 0; s < sparkCount; s++) {
      const seed = Math.sin(now * 0.004 + s * 17.3);
      if (seed < 0) continue;
      const idx = Math.floor(Math.abs(Math.sin(s * 9.1 + now * 0.001)) * (points.length - 1));
      const [px, py] = points[idx];
      const sparkR = 1 + Math.sin(now * 0.02 + s) * 0.8;

      ctx.beginPath();
      ctx.arc(px, py + (seed - 0.5) * 6, sparkR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 230, 255, 0.85)';
      ctx.shadowColor = 'rgba(210, 150, 255, 1)';
      ctx.shadowBlur = this._isMobile ? 0 : 10;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  _wavePath(w, ty, now, creatures = [], tension = 0, breath = 0.5) {
    const n = 90;
    const baseAmp = (8 + breath * 3) * (1 + Math.min(tension * 0.35, 1.8));
    const pts = this._wavePointsCache;

    for (let i = 0; i <= n; i++) {
      const x = (i / n) * w;

      // Multi-frequency wave harmonic + breathing modulation
      const naturalWave =
        Math.sin(x * 0.015 + now * 0.0009) * baseAmp
        + Math.sin(x * 0.038 + now * 0.0014) * (4 + breath * 1.5)
        + Math.sin(x * 0.007 - now * 0.0006) * (6 + breath * 2);

      // High-frequency agitation vibration when tension is present
      const agitation = tension > 0.3
        ? Math.sin(x * 0.075 + now * 0.009) * Math.min(tension * 1.6, 7)
        : 0;

      // Surface tension membrane pull: nearby creatures curve the line toward them!
      let localPull = 0;
      for (let j = 0; j < creatures.length; j++) {
        const c = creatures[j];
        if (!c.isAlive) continue;
        const dx = x - c.position.x;
        const dy = c.position.y - ty;
        const distSq = dx * dx + dy * dy;
        if (distSq < 7225) { // 85px radius
          const dist = Math.sqrt(distSq);
          const factor = 1 - dist / 85;
          // Smooth cubic Hermite interpolation
          const smooth = factor * factor * (3 - 2 * factor);
          localPull += dy * smooth * 0.38;
        }
      }

      const y = ty + naturalWave + agitation + localPull;
      pts[i][0] = x;
      pts[i][1] = y;
    }
    return pts;
  }

  // ── 7. Courtship ribbons (Dança dos Opostos) ──────────────────────────────

  _drawCourtshipRibbons(ctx, creatures, now) {
    let hasDancing = false;
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (c.isAlive && c.isDancing && c.dancePartner && c.dancePartner.isAlive) {
        hasDancing = true;
        break;
      }
    }
    if (!hasDancing) return;

    ctx.save();

    for (let i = 0; i < creatures.length; i++) {
      const a = creatures[i];
      if (!a.isAlive || !a.isDancing || !a.dancePartner || !a.dancePartner.isAlive) continue;
      const b = a.dancePartner;
      if (a.id > b.id) continue;

      const ax = a.position.x;
      const ay = a.position.y;
      const bx = b.position.x;
      const by = b.position.y;

      const dx = bx - ax;
      const dy = by - ay;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const nx = -dy / dist;
      const ny =  dx / dist;

      const midX = (ax + bx) * 0.5;
      const midY = (ay + by) * 0.5;

      // Central glowing harmony heart/vesica
      const heartPulse = 0.5 + 0.5 * Math.sin(now * 0.005);
      const hRad = Math.max(2, 12 + heartPulse * 6);
      const hGrad = ctx.createRadialGradient(midX, midY, 0, midX, midY, hRad);
      hGrad.addColorStop(0,   'rgba(255, 240, 200, 0.45)');
      hGrad.addColorStop(0.5, 'rgba(220, 160, 255, 0.25)');
      hGrad.addColorStop(1,   'rgba(220, 160, 255, 0)');
      ctx.fillStyle = hGrad;
      ctx.beginPath();
      ctx.arc(midX, midY, hRad, 0, Math.PI * 2);
      ctx.fill();

      // Intertwining ribbons: Golden ribbon + Amethyst ribbon
      const segments = 24;
      const ribbonAmp = Math.min(22, dist * 0.35);

      // 1. Golden ribbon
      ctx.beginPath();
      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const wave = Math.sin(t * Math.PI * 3 + now * 0.007) * ribbonAmp * Math.sin(t * Math.PI);
        const px = ax + dx * t + nx * wave;
        const py = ay + dy * t + ny * wave;
        s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(255, 225, 140, 0.7)';
      ctx.lineWidth = 1.6;
      ctx.shadowColor = 'rgba(255, 215, 110, 0.9)';
      ctx.shadowBlur = this._isMobile ? 0 : 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 2. Amethyst ribbon
      ctx.beginPath();
      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const wave = -Math.sin(t * Math.PI * 3 + now * 0.007) * ribbonAmp * Math.sin(t * Math.PI);
        const px = ax + dx * t + nx * wave;
        const py = ay + dy * t + ny * wave;
        s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(200, 145, 255, 0.7)';
      ctx.lineWidth = 1.6;
      ctx.shadowColor = 'rgba(180, 115, 255, 0.9)';
      ctx.shadowBlur = this._isMobile ? 0 : 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // ── 8. Connection threads ─────────────────────────────────────────────────

  _drawConnectionThreads(ctx, creatures) {
    const maxDist = 110;
    const maxDistSq = 12100;
    ctx.save();

    for (let i = 0; i < creatures.length; i++) {
      const a = creatures[i];
      if (!a.isAlive || a.state === CreatureState.DISSOLVING) continue;

      for (let j = i + 1; j < creatures.length; j++) {
        const b = creatures[j];
        if (!b.isAlive || b.state === CreatureState.DISSOLVING) continue;
        if (a.originZone === b.originZone) continue;

        const distSq = a.position.distanceSqTo(b.position);
        if (distSq > maxDistSq) continue;

        const dist  = Math.sqrt(distSq);
        const t     = 1 - dist / maxDist;
        const alpha = t * t * 0.22;
        const grad  = ctx.createLinearGradient(a.position.x, a.position.y, b.position.x, b.position.y);
        grad.addColorStop(0, a.color.toHSLAWithAlpha(alpha));
        grad.addColorStop(1, b.color.toHSLAWithAlpha(alpha));

        ctx.beginPath();
        ctx.moveTo(a.position.x, a.position.y);
        ctx.lineTo(b.position.x, b.position.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth   = t * 1.5;
        ctx.stroke();
      }
    }

    // Symbiotic bond — curved glowing cord (symmetrical single pass, zero Set overhead)
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (c.isAlive && c.state === CreatureState.SYMBIOTIC && c.bondedWith?.isAlive && c.id < c.bondedWith.id) {
        this._drawSymbioticBond(ctx, c, c.bondedWith);
      }
    }
    ctx.restore();
  }

  _drawSymbioticBond(ctx, a, b) {
    const pulse = 0.5 + 0.5 * Math.sin(this._time * 0.003);
    const midX  = (a.position.x + b.position.x) / 2;
    const midY  = (a.position.y + b.position.y) / 2 - 22;

    // Double-layered cord
    ctx.beginPath();
    ctx.moveTo(a.position.x, a.position.y);
    ctx.quadraticCurveTo(midX, midY, b.position.x, b.position.y);
    ctx.strokeStyle = `rgba(210, 160, 255, ${0.15 + pulse * 0.1})`;
    ctx.lineWidth   = 4;
    ctx.shadowBlur  = 0;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(a.position.x, a.position.y);
    ctx.quadraticCurveTo(midX, midY, b.position.x, b.position.y);
    ctx.strokeStyle = `rgba(240, 200, 255, ${0.45 + pulse * 0.25})`;
    ctx.lineWidth   = 1;
    ctx.shadowColor = 'rgba(220, 170, 255, 0.7)';
    ctx.shadowBlur  = this._isMobile ? 0 : 8;
    ctx.stroke();
    ctx.shadowBlur  = 0;
  }

  // ── 8. Dissolution echoes ─────────────────────────────────────────────────

  _updateEchoes(dt) {
    let writeIdx = 0;
    for (let i = 0; i < this._echoes.length; i++) {
      const echo = this._echoes[i];
      echo.life -= echo.decay * dt;
      if (echo.life > 0) {
        this._echoes[writeIdx++] = echo;
      }
    }
    this._echoes.length = writeIdx;
  }

  _drawEchoes(ctx) {
    ctx.save();
    for (let i = 0; i < this._echoes.length; i++) {
      const echo = this._echoes[i];
      const alpha = echo.alpha * echo.life * echo.life;
      if (alpha < 0.005) continue;

      ctx.globalAlpha = alpha;
      const r = Math.max(1, (echo.radius || 10) * (1.5 - echo.life * 0.5));
      ctx.beginPath();
      ctx.arc(echo.x, echo.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = echo.hsla;
      ctx.lineWidth   = 1;
      if (!this._isMobile) {
        ctx.shadowColor = echo.hsla;
        ctx.shadowBlur  = 12;
      }
      ctx.stroke();
      if (!this._isMobile) ctx.shadowBlur = 0;

      // Ghost cross
      const size = echo.radius * 0.4 * echo.life;
      ctx.beginPath();
      ctx.moveTo(echo.x - size, echo.y); ctx.lineTo(echo.x + size, echo.y);
      ctx.moveTo(echo.x, echo.y - size); ctx.lineTo(echo.x, echo.y + size);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── 9. Trails ─────────────────────────────────────────────────────────────

  _drawTrails(ctx, creatures) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      const trail = c.trail;
      const n = trail.length;
      if (!c.isAlive || n < 3) continue;

      ctx.beginPath();
      ctx.moveTo(trail[0].x, trail[0].y);
      for (let j = 1; j < n - 1; j++) {
        const xc = (trail[j].x + trail[j + 1].x) * 0.5;
        const yc = (trail[j].y + trail[j + 1].y) * 0.5;
        ctx.quadraticCurveTo(trail[j].x, trail[j].y, xc, yc);
      }
      ctx.lineTo(trail[n - 1].x, trail[n - 1].y);
      ctx.strokeStyle = c.trailHSLA;
      ctx.lineWidth   = Math.max(0.7, c.radius * 0.38);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── 11. External particles ────────────────────────────────────────────────

  _drawParticles(ctx, particles) {
    ctx.save();
    const active = particles.active;
    const canGlow = !this._isMobile;
    for (let i = 0; i < active.length; i++) {
      const p = active[i];
      const alpha = p.alpha * p.life;
      if (alpha < 0.01) continue;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, p.radius * p.life), 0, Math.PI * 2);
      ctx.fillStyle = p.hsla || p.color.toHSLA();
      if (canGlow && p.radius > 2.8) {
        ctx.shadowColor = p.hsla || p.color.toHSLA();
        ctx.shadowBlur  = p.radius * 2.5;
      } else {
        ctx.shadowBlur  = 0;
      }
      ctx.fill();
    }
    ctx.restore();
  }

  // ── 12. Celestial nectar droplet ──────────────────────────────────────────

  _drawNectar(ctx, activeNectar, now) {
    if (!activeNectar || activeNectar.charges <= 0) return;
    const { x, y, radius = 9, charges = 3 } = activeNectar;

    ctx.save();
    // Gentle floating bob
    const bob = Math.sin(now * 0.0035) * 2.5;
    const cy = y + bob;

    // Outer warm nectar aura
    const auraPulse = 0.5 + 0.5 * Math.sin(now * 0.006);
    const auraR = Math.max(1, radius * (2.6 + auraPulse * 0.6));
    const auraG = ctx.createRadialGradient(x, cy, 0, x, cy, auraR);
    auraG.addColorStop(0,   'rgba(255, 235, 150, 0.38)');
    auraG.addColorStop(0.5, 'rgba(255, 190, 80, 0.15)');
    auraG.addColorStop(1,   'rgba(255, 180, 50, 0)');
    ctx.fillStyle = auraG;
    ctx.beginPath();
    ctx.arc(x, cy, auraR, 0, Math.PI * 2);
    ctx.fill();

    // Central honey droplet
    const dropR = Math.max(1, radius * (0.9 + auraPulse * 0.1));
    const dropG = ctx.createRadialGradient(x - 2, cy - 2, 0, x, cy, dropR);
    dropG.addColorStop(0,   '#fffde6');
    dropG.addColorStop(0.4, '#fcd34d');
    dropG.addColorStop(0.85,'#d97706');
    dropG.addColorStop(1,   '#b45309');

    ctx.beginPath();
    ctx.arc(x, cy, dropR, 0, Math.PI * 2);
    ctx.fillStyle = dropG;
    ctx.shadowColor = 'rgba(251, 191, 36, 0.9)';
    ctx.shadowBlur = this._isMobile ? 0 : 14;
    ctx.fill();

    // Specular shine
    ctx.beginPath();
    ctx.arc(x - dropR * 0.32, cy - dropR * 0.32, Math.max(0.5, dropR * 0.3), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.shadowBlur = 0;
    ctx.fill();

    // Orbiting charge beads (1..3)
    const orbDist = radius * 1.8;
    for (let i = 0; i < charges; i++) {
      const angle = (i / charges) * Math.PI * 2 + now * 0.002;
      const ox = x + Math.cos(angle) * orbDist;
      const oy = cy + Math.sin(angle) * (orbDist * 0.7);
      ctx.beginPath();
      ctx.arc(ox, oy, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = '#fffbeb';
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = this._isMobile ? 0 : 6;
      ctx.fill();
    }

    ctx.restore();
  }

  // ── 13. Creatures ─────────────────────────────────────────────────────────

  _drawCreatures(ctx, creatures, now, breath = 0.5, dt = 16) {
    // Two sequential passes: regular creatures first, then transcendent on top.
    // Completely eliminates array cloning [...creatures] and Array.sort() at 60fps!
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (c.isAlive && c.state !== CreatureState.TRANSCENDENT) {
        this._drawCreature(ctx, c, now, breath, dt);
      }
    }
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (c.isAlive && c.state === CreatureState.TRANSCENDENT) {
        this._drawCreature(ctx, c, now, breath, dt);
      }
    }
  }

  _drawCreature(ctx, creature, now, breath = 0.5, dt = 16) {
    ctx.save();
    try {
      const ontogenyAlpha = creature.growthProgress !== undefined
        ? (0.42 + 0.58 * creature.growthProgress)
        : 1.0;
      ctx.globalAlpha = creature.color.a * ontogenyAlpha;

      // Outer glow (harmonized with world breath)
      ctx.shadowColor = creature.color.toGlowHSLA(0.5);
      const rawBlur   = this._glowFor(creature, now, breath);
      ctx.shadowBlur  = this._isMobile ? Math.min(16, rawBlur * 0.5) : rawBlur;

      // Morphological body plan rendering
      switch (creature.bodyPlan) {
        case Config.BODY_PLAN.MANTA:
          this._drawManta(ctx, creature, now, breath);
          break;
        case Config.BODY_PLAN.JELLYFISH:
          this._drawJellyfish(ctx, creature, now, breath);
          break;
        case Config.BODY_PLAN.SERPENTINE:
          this._drawSerpentine(ctx, creature, now, breath);
          break;
        case Config.BODY_PLAN.CRYSTAL:
          this._drawCrystal(ctx, creature, now, breath);
          break;
        case Config.BODY_PLAN.PHOENIX:
          this._drawPhoenix(ctx, creature, now, breath);
          break;
        case Config.BODY_PLAN.NAUTILUS:
          this._drawNautilus(ctx, creature, now, breath);
          break;
        case Config.BODY_PLAN.BLOB:
        default: {
          const pts = creature.getBlobPoints(now);
          if (pts.length >= 3) {
            ctx.beginPath();
            this._blobPath(ctx, pts);
            ctx.fillStyle = this._creatureGrad(ctx, creature);
            ctx.fill();

            ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.3, 0.4);
            ctx.lineWidth   = 0.8;
            ctx.shadowBlur  = 0;
            ctx.stroke();

            this._drawSpecular(ctx, creature);
          }
          break;
        }
      }

      // Chimeric secondary anatomy (Quimeras 2.0)
      if (creature.isChimera && creature.chimericPlan) {
        this._drawChimericFeatures(ctx, creature, now, breath);
      }

      // Conscious Sensory Organelles / Gaze
      this._drawSensoryGaze(ctx, creature, now);

      // Orbital motes (DNA echo gene)
      this._drawOrbitalMotes(ctx, creature, now);

      // Zen Bioluminescence Communication Aura (Quorum Sensing gentle wave)
      if (creature.glowIntensity > 0.01) {
        this._drawBioluminescentEcho(ctx, creature, now);
      }

      // Ancestral Star Crown & Radiant Phosphorescent Halo
      if (creature.isAncestral) {
        this._drawAncestralCrown(ctx, creature, now);
      }

      // Aging aura (subtle fading candle shimmer)
      if (creature.isAging) {
        this._drawAgingAura(ctx, creature, now);
      }

      // Sleeping slumber aura
      if (creature.isSleeping) {
        this._drawSleepingAura(ctx, creature, now);
      }

      // Metabolic absorption flash
      if (creature.metabolicFlash > 0.01) {
        this._drawMetabolicPulse(ctx, creature);
      }

      // Legendary Visual Mutations
      if (creature.legendaryTrait) {
        this._drawLegendaryMutation(ctx, creature, now, breath);
      }

      // Chimera symbiosis dual aura
      if (creature.isChimera) {
        this._drawChimeraAura(ctx, creature, now);
      }

      // State overlays
      if (creature.state === CreatureState.WITNESS)      this._drawWitnessEye(ctx, creature, now);
      if (creature.state === CreatureState.TRANSCENDENT) this._drawTranscendentHalo(ctx, creature, now);
      if (creature.state === CreatureState.TRANSCENDENT) this._drawTranscendentRays(ctx, creature, now);
      if (creature.state === CreatureState.HYBRID)       this._drawHybridShimmer(ctx, creature, now);
      if (creature.state === CreatureState.CROSSING)     this._drawCrossingRipple(ctx, creature, now);
    } finally {
      ctx.restore();
    }
  }

  _drawMetabolicPulse(ctx, creature) {
    const flash = creature.metabolicFlash;
    const r = Math.max(1, creature.radius * (1.1 + (1 - flash) * 0.7));
    ctx.save();
    ctx.beginPath();
    ctx.arc(creature.position.x, creature.position.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = creature.originZone === Config.ZONE.LIGHT
      ? `rgba(255, 235, 140, ${flash * 0.85})`
      : `rgba(215, 160, 255, ${flash * 0.85})`;
    ctx.lineWidth = Math.max(0.5, 1.4 * flash);
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = this._isMobile ? 0 : 10;
    ctx.stroke();
    ctx.restore();
  }

  _drawAgingAura(ctx, creature, now) {
    const flicker = 0.35 + 0.65 * Math.sin(now * 0.009 + (creature.id.charCodeAt(1) || 0));
    const r = Math.max(1, creature.radius * (1.35 + Math.sin(now * 0.004) * 0.15));
    ctx.save();
    ctx.beginPath();
    ctx.arc(creature.position.x, creature.position.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = creature.color.toHSLAWithAlpha(0.25 * flicker);
    ctx.lineWidth   = 0.75;
    ctx.setLineDash([2, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawSleepingAura(ctx, creature, now) {
    const { x, y } = creature.position;
    const r = Math.max(2, creature.radius * 1.45 + Math.sin(now * 0.0025 + (creature.id.charCodeAt(0) || 0)) * 1.5);
    const isLight = creature.originZone === Config.ZONE.LIGHT;

    ctx.save();
    // Translucent slumber cocoon
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = isLight ? 'rgba(255, 235, 170, 0.4)' : 'rgba(200, 165, 255, 0.4)';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([4, 5]);
    ctx.shadowColor = isLight ? 'rgba(255, 220, 130, 0.6)' : 'rgba(180, 135, 255, 0.6)';
    ctx.shadowBlur = this._isMobile ? 0 : 6;
    ctx.stroke();
    ctx.setLineDash([]);

    // Sleeping crescent above
    const crescentY = y - creature.radius - 7 + Math.sin(now * 0.002) * 1.5;
    ctx.beginPath();
    ctx.arc(x, crescentY, 3, 0.5 * Math.PI, 1.5 * Math.PI, true);
    ctx.arc(x - 1, crescentY, 2.5, 1.5 * Math.PI, 0.5 * Math.PI, false);
    ctx.closePath();
    ctx.fillStyle = isLight ? 'rgba(255, 240, 190, 0.75)' : 'rgba(220, 200, 255, 0.75)';
    ctx.fill();

    ctx.restore();
  }

  _drawAncestralCrown(ctx, creature, now) {
    const { x, y } = creature.position;
    const r = Math.max(3, creature.radius * 1.52);
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.0018 + (creature.id.charCodeAt(0) || 0));

    ctx.save();
    // 1. Serene phosphorescent ancestral halo
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = creature.originZone === Config.ZONE.LIGHT
      ? `rgba(255, 235, 175, ${0.28 + pulse * 0.16})`
      : `rgba(215, 185, 255, ${0.28 + pulse * 0.16})`;
    ctx.lineWidth = 1.0;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = this._isMobile ? 0 : 12 + pulse * 6;
    ctx.stroke();

    // 2. Crown of 4 orbiting celestial micro-stars
    const crownCount = 4;
    const starSpeed = 0.00072;
    const starRadius = r + 2.5;

    for (let i = 0; i < crownCount; i++) {
      const angle = (i / crownCount) * Math.PI * 2 + now * starSpeed;
      const sx = x + Math.cos(angle) * starRadius;
      const sy = y + Math.sin(angle) * starRadius;
      const starPulse = 0.6 + 0.4 * Math.sin(now * 0.0035 + i * 1.57);

      ctx.beginPath();
      ctx.arc(sx, sy, 1.4 * starPulse, 0, Math.PI * 2);
      ctx.fillStyle = creature.originZone === Config.ZONE.LIGHT
        ? `rgba(255, 248, 220, ${0.75 * starPulse})`
        : `rgba(235, 220, 255, ${0.75 * starPulse})`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = this._isMobile ? 0 : 6;
      ctx.fill();
    }
    ctx.restore();
  }

  _drawBioluminescentEcho(ctx, creature, now) {
    const intensity = Math.min(1.0, creature.glowIntensity || 0);
    if (intensity < 0.01) return;

    const { x, y } = creature.position;
    const pulseRadius = creature.radius * (1.35 + intensity * 0.85);

    ctx.save();
    const grad = ctx.createRadialGradient(x, y, creature.radius * 0.3, x, y, pulseRadius);
    const alphaPeak = 0.26 * intensity;
    const isLight = creature.originZone === Config.ZONE.LIGHT;

    const rgb = isLight ? '255, 235, 160' : '190, 150, 255';
    grad.addColorStop(0, `rgba(${rgb}, ${alphaPeak})`);
    grad.addColorStop(0.55, `rgba(${rgb}, ${alphaPeak * 0.45})`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, pulseRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── Orbital motes (DNA echo gene → orbit count) ────────────────────────────

  _drawOrbitalMotes(ctx, creature, now) {
    const count = Math.floor(creature.dna.echo * 4.9); // 0–4 motes
    if (count === 0) return;

    const orbitR = Math.max(2, creature.radius * 1.75);
    const speed  = 0.001 + creature.dna.rhythm * 0.0015;

    ctx.save();
    ctx.shadowColor = creature.color.toGlowHSLA();
    ctx.shadowBlur  = this._isMobile ? 0 : 8;
    const moteFill   = creature.color.toGlowHSLA(0.5);
    ctx.fillStyle   = moteFill;

    for (let i = 0; i < count; i++) {
      const angle  = (i / count) * Math.PI * 2 + now * speed;
      const mx     = creature.position.x + Math.cos(angle) * orbitR;
      const my     = creature.position.y + Math.sin(angle) * orbitR;
      const pulse  = 0.55 + 0.45 * Math.sin(now * 0.004 + i * 1.3);
      const moteR  = Math.max(0.5, (1.2 + pulse * 0.8) * (creature.dna.luminosity * 0.5 + 0.5));

      ctx.globalAlpha = (0.5 + pulse * 0.4) * creature.color.a;
      ctx.beginPath();
      ctx.arc(mx, my, moteR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _glowFor(creature, now, breath = 0.5) {
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.003 + creature.blobPhases[0]) + breath * 0.18;
    switch (creature.state) {
      case CreatureState.TRANSCENDENT: return 38 + pulse * 22;
      case CreatureState.HYBRID:       return 22 + pulse * 12;
      case CreatureState.WITNESS:      return 30 + pulse * 14;
      case CreatureState.CROSSING:     return 10 + creature.transformProgress * 20;
      case CreatureState.SYMBIOTIC:    return 16 + pulse * 8;
      default:                         return 7 + pulse * 4;
    }
  }

  _creatureGrad(ctx, creature) {
    const { x, y } = creature.position;
    const r  = Math.max(2, creature.radius);
    const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r * 1.1);
    const intensity = creature.state === CreatureState.TRANSCENDENT ? 1 : 0.4;
    grad.addColorStop(0,   creature.color.toGlowHSLA(intensity));
    grad.addColorStop(0.6, creature.color.toHSLA());
    grad.addColorStop(1,   creature.color.toOuterHSLA());
    return grad;
  }

  _creatureGradLocal(ctx, creature, r) {
    const g = ctx.createRadialGradient(-r * 0.2, -r * 0.2, 0, 0, 0, r * 1.25);
    const intensity = creature.state === CreatureState.TRANSCENDENT ? 1 : 0.5;
    g.addColorStop(0,   creature.color.toGlowHSLAWithAlpha(intensity, 0.95));
    g.addColorStop(0.6, creature.color.toHSLA());
    g.addColorStop(1,   creature.color.toOuterHSLA());
    return g;
  }

  // ── Morphological Plan 1: Manta (Pipa Cósmica) ────────────────────────────
  _drawManta(ctx, creature, now, breath) {
    const px = creature.position.x;
    const py = creature.position.y;
    const r  = creature.radius;
    const angle = creature.facingAngle;
    const flutter = Math.sin(creature.wingPhase) * (r * 0.36);

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);

    // 1. Mantle Wings Path
    ctx.beginPath();
    ctx.moveTo(r * 1.25, 0); // Head rostrum
    ctx.bezierCurveTo(r * 0.6, -r * 0.8, -r * 0.1, -r * 1.5 - flutter, -r * 0.35, -r * 1.65 - flutter); // Left wing tip
    ctx.quadraticCurveTo(-r * 0.25, -r * 0.85, -r * 0.95, 0); // Left trailing edge to tail base
    ctx.quadraticCurveTo(-r * 0.25, r * 0.85, -r * 0.35, r * 1.65 + flutter); // Right trailing edge
    ctx.bezierCurveTo(-r * 0.1, r * 1.5 + flutter, r * 0.6, r * 0.8, r * 1.25, 0); // Right wing tip
    ctx.closePath();

    ctx.fillStyle = this._creatureGradLocal(ctx, creature, r);
    ctx.fill();

    ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.3, 0.45);
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // Wing spine veins
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-r * 0.35, -r * 1.65 - flutter);
    ctx.moveTo(0, 0);
    ctx.lineTo(-r * 0.35, r * 1.65 + flutter);
    ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.4, 0.25);
    ctx.lineWidth = 0.6;
    ctx.stroke();

    ctx.restore();

    // 2. Trailing Filament Tail (in world coords using creature.segments)
    const segs = creature.segments;
    if (segs && segs.length > 2) {
      ctx.beginPath();
      ctx.moveTo(segs[0].x, segs[0].y);
      for (let i = 1; i < segs.length; i++) {
        ctx.lineTo(segs[i].x, segs[i].y);
      }
      ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.4, 0.45);
      ctx.lineWidth = 1.0;
      ctx.stroke();

      // Glowing tip on filament tail
      const tailTip = segs[segs.length - 1];
      ctx.beginPath();
      ctx.arc(tailTip.x, tailTip.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = creature.color.toGlowHSLA(0.85);
      ctx.shadowColor = creature.color.toGlowHSLA(0.9);
      ctx.shadowBlur = this._isMobile ? 0 : 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // ── Morphological Plan 2: Jellyfish (Medusa Abissal) ──────────────────────
  _drawJellyfish(ctx, creature, now, breath) {
    const px = creature.position.x;
    const py = creature.position.y;
    const r  = creature.radius;
    const angle = creature.facingAngle;
    const pulse = 0.5 + 0.5 * Math.sin(creature.pulsePhase);
    const squishX = 1.0 + pulse * 0.22;
    const squishY = 1.0 - pulse * 0.16;

    // 1. Trailing articulated tentacles in world coordinates
    const tentacles = creature.tentacles;
    const numT = creature.dna.tentacleCount;
    for (let t = 0; t < numT && t < tentacles.length; t++) {
      const joints = tentacles[t];
      ctx.beginPath();
      ctx.moveTo(joints[0].x, joints[0].y);
      for (let j = 1; j < joints.length; j++) {
        const prev = joints[j - 1];
        const curr = joints[j];
        ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
      }
      ctx.lineTo(joints[joints.length - 1].x, joints[joints.length - 1].y);
      ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.25, 0.4);
      ctx.lineWidth = 0.85;
      ctx.stroke();

      // Bioluminescent terminal node
      const last = joints[joints.length - 1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = creature.color.toGlowHSLA(0.8);
      ctx.shadowColor = creature.color.toGlowHSLA(0.85);
      ctx.shadowBlur = this._isMobile ? 0 : 6;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // 2. Pulsing Umbrella Bell
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.scale(squishX, squishY);

    ctx.beginPath();
    ctx.moveTo(-r * 0.55, -r * 0.95);
    ctx.bezierCurveTo(r * 0.4, -r * 1.1, r * 1.25, -r * 0.55, r * 1.25, 0);
    ctx.bezierCurveTo(r * 1.25, r * 0.55, r * 0.4, r * 1.1, -r * 0.55, r * 0.95);
    // Scalloped margin at the base
    ctx.quadraticCurveTo(-r * 0.35, r * 0.45, -r * 0.5, 0);
    ctx.quadraticCurveTo(-r * 0.35, -r * 0.45, -r * 0.55, -r * 0.95);
    ctx.closePath();

    ctx.fillStyle = this._creatureGradLocal(ctx, creature, r);
    ctx.fill();

    ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.35, 0.5);
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // Internal gastric cavity / luminous core
    ctx.beginPath();
    ctx.arc(r * 0.25, 0, r * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = creature.color.toGlowHSLAWithAlpha(0.5, 0.35);
    ctx.fill();

    ctx.restore();
  }

  // ── Morphological Plan 3: Serpentine (Serpente do Limiar) ─────────────────
  _drawSerpentine(ctx, creature, now, breath) {
    const segs = creature.segments;
    const numSegs = Math.min(segs.length, creature.dna.segmentCount + 2);

    // 1. Translucent undulating dorsal ribbon/fin (smooth Bézier spline)
    if (numSegs > 2) {
      if (!this._finPointsScratch) this._finPointsScratch = [];
      while (this._finPointsScratch.length < numSegs) {
        this._finPointsScratch.push({ x: 0, y: 0 });
      }
      for (let i = 0; i < numSegs; i++) {
        const s = segs[i];
        const normalAng = s.angle + Math.PI / 2;
        const finWave = Math.sin(now * 0.005 + i * 0.9) * (s.radius * 0.45);
        const fp = this._finPointsScratch[i];
        fp.x = s.x + Math.cos(normalAng) * (s.radius * 0.75 + finWave);
        fp.y = s.y + Math.sin(normalAng) * (s.radius * 0.75 + finWave);
      }

      const finPoints = this._finPointsScratch;
      ctx.beginPath();
      ctx.moveTo(finPoints[0].x, finPoints[0].y);
      for (let i = 1; i < numSegs - 1; i++) {
        const midX = (finPoints[i].x + finPoints[i + 1].x) * 0.5;
        const midY = (finPoints[i].y + finPoints[i + 1].y) * 0.5;
        ctx.quadraticCurveTo(finPoints[i].x, finPoints[i].y, midX, midY);
      }
      ctx.lineTo(finPoints[numSegs - 1].x, finPoints[numSegs - 1].y);

      // Return along the spine with quadratic smoothing through segment midpoints
      for (let i = numSegs - 1; i > 0; i--) {
        const midX = (segs[i].x + segs[i - 1].x) * 0.5;
        const midY = (segs[i].y + segs[i - 1].y) * 0.5;
        ctx.quadraticCurveTo(segs[i].x, segs[i].y, midX, midY);
      }
      ctx.lineTo(segs[0].x, segs[0].y);
      ctx.closePath();
      ctx.fillStyle = creature.color.toGlowHSLAWithAlpha(0.2, 0.18);
      ctx.fill();
    }

    // 2. Chained vertebrae segments (drawn from tail to head)
    for (let i = numSegs - 1; i >= 0; i--) {
      const s = segs[i];
      const r = Math.max(1.5, s.radius);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);

      ctx.beginPath();
      ctx.ellipse(0, 0, r * (i === 0 ? 1.25 : 1.05), r * 0.85, 0, 0, Math.PI * 2);
      ctx.fillStyle = this._creatureGradLocal(ctx, creature, r);
      ctx.fill();

      ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.3, 0.4);
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.restore();
    }
  }

  // ── Morphological Plan 4: Crystal (Radiolário Sagrado) ────────────────────
  _drawCrystal(ctx, creature, now, breath) {
    const px = creature.position.x;
    const py = creature.position.y;
    const r  = creature.radius;
    const spin = now * 0.0014;
    const numPoints = creature.dna.segmentCount >= 4 ? 6 : 4;

    ctx.save();
    ctx.translate(px, py);

    // 1. Faceted Outer Polygon
    ctx.rotate(spin);
    ctx.beginPath();
    for (let i = 0; i < numPoints; i++) {
      const ang = (i / numPoints) * Math.PI * 2;
      const x = Math.cos(ang) * r * 1.15;
      const y = Math.sin(ang) * r * 1.15;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = this._creatureGradLocal(ctx, creature, r);
    ctx.fill();
    ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.5, 0.6);
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // Internal facet refractions
    ctx.beginPath();
    for (let i = 0; i < numPoints; i++) {
      const ang = (i / numPoints) * Math.PI * 2;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(ang) * r * 1.15, Math.sin(ang) * r * 1.15);
    }
    ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.35, 0.35);
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // 2. Counter-rotating inner crystal core
    ctx.rotate(-spin * 2.2);
    ctx.beginPath();
    const innerPoints = 3;
    for (let i = 0; i < innerPoints; i++) {
      const ang = (i / innerPoints) * Math.PI * 2;
      const ix = Math.cos(ang) * r * 0.5;
      const iy = Math.sin(ang) * r * 0.5;
      if (i === 0) ctx.moveTo(ix, iy);
      else ctx.lineTo(ix, iy);
    }
    ctx.closePath();
    ctx.fillStyle = creature.color.toGlowHSLAWithAlpha(0.6, 0.5);
    ctx.shadowColor = creature.color.toGlowHSLA(0.8);
    ctx.shadowBlur = this._isMobile ? 0 : 10;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  // ── Morphological Plan 5: Phoenix (Fênix Astral) ──────────────────────────
  _drawPhoenix(ctx, creature, now, breath) {
    const px = creature.position.x;
    const py = creature.position.y;
    const r  = creature.radius;
    const angle = creature.facingAngle;
    const wingFlutter = Math.sin(creature.wingPhase) * (r * 0.42);

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);

    // 1. Feathered Plasma Wings Path
    ctx.beginPath();
    ctx.moveTo(r * 1.35, 0); // Beak / rostrum tip
    // Left sweeping wing
    ctx.bezierCurveTo(r * 0.7, -r * 0.5, r * 0.1, -r * 1.6 - wingFlutter, -r * 0.45, -r * 2.1 - wingFlutter);
    ctx.quadraticCurveTo(-r * 0.65, -r * 1.4 - wingFlutter * 0.7, -r * 0.35, -r * 0.8);
    ctx.quadraticCurveTo(-r * 0.8, -r * 0.4, -r * 1.1, 0); // To tail root
    // Right sweeping wing
    ctx.quadraticCurveTo(-r * 0.8, r * 0.4, -r * 0.35, r * 0.8);
    ctx.quadraticCurveTo(-r * 0.65, r * 1.4 + wingFlutter * 0.7, -r * 0.45, r * 2.1 + wingFlutter);
    ctx.bezierCurveTo(r * 0.1, r * 1.6 + wingFlutter, r * 0.7, r * 0.5, r * 1.35, 0);
    ctx.closePath();

    ctx.fillStyle = this._creatureGradLocal(ctx, creature, r);
    ctx.fill();

    ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.4, 0.6);
    ctx.lineWidth = 0.95;
    ctx.stroke();

    // Avian crest & wing primary feather quills
    ctx.beginPath();
    // Head crest feather
    ctx.moveTo(r * 0.6, 0);
    ctx.quadraticCurveTo(0, -r * 0.6, -r * 0.4, -r * 0.7);
    // Left wing primary quill
    ctx.moveTo(0, 0);
    ctx.lineTo(-r * 0.45, -r * 2.1 - wingFlutter);
    // Right wing primary quill
    ctx.moveTo(0, 0);
    ctx.lineTo(-r * 0.45, r * 2.1 + wingFlutter);
    ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.5, 0.35);
    ctx.lineWidth = 0.75;
    ctx.stroke();

    // Internal radiant heart flame
    const pulse = 0.6 + 0.4 * Math.sin(now * 0.006 + (creature.id.charCodeAt(0) || 0));
    ctx.beginPath();
    ctx.arc(r * 0.2, 0, r * 0.28 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = creature.color.toGlowHSLAWithAlpha(0.85, 0.5);
    ctx.fill();

    ctx.restore();

    // 2. Trailing Tripartite Comet Plume Tail (in world coords using creature.segments)
    const segs = creature.segments;
    if (segs && segs.length > 2) {
      const numSegs = Math.min(segs.length, creature.dna.segmentCount + 2);
      ctx.save();
      // Center feather plume
      ctx.beginPath();
      ctx.moveTo(segs[0].x, segs[0].y);
      for (let i = 1; i < numSegs; i++) {
        ctx.lineTo(segs[i].x, segs[i].y);
      }
      ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.5, 0.55);
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Left & Right trailing feather plumes with sinusoidal wave
      for (let side = -1; side <= 1; side += 2) {
        ctx.beginPath();
        ctx.moveTo(segs[0].x, segs[0].y);
        for (let i = 1; i < numSegs; i++) {
          const s = segs[i];
          const normAngle = s.angle + (Math.PI / 2) * side;
          const plumeWave = Math.sin(now * 0.004 + i * 0.8) * (r * 0.25);
          const pxPlume = s.x + Math.cos(normAngle) * (r * 0.35 + plumeWave);
          const pyPlume = s.y + Math.sin(normAngle) * (r * 0.35 + plumeWave);
          ctx.lineTo(pxPlume, pyPlume);
        }
        ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.35, 0.4);
        ctx.lineWidth = 0.85;
        ctx.stroke();
      }

      // Glowing plume ember at tip
      const tip = segs[numSegs - 1];
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = creature.color.toGlowHSLA(0.9);
      if (!this._isMobile) {
        ctx.shadowColor = creature.color.toGlowHSLA(0.9);
        ctx.shadowBlur = 8;
      }
      ctx.fill();
      if (!this._isMobile) ctx.shadowBlur = 0;
      ctx.restore();
    }
  }

  // ── Morphological Plan 6: Nautilus (Nautilus Áureo) ───────────────────────
  _drawNautilus(ctx, creature, now, breath) {
    const px = creature.position.x;
    const py = creature.position.y;
    const r  = creature.radius;
    const angle = creature.facingAngle;

    // 1. Undulating Front Tentacles (in world coords)
    const tentacles = creature.tentacles;
    const numT = Math.min(4, creature.dna.tentacleCount);
    for (let t = 0; t < numT && t < tentacles.length; t++) {
      const joints = tentacles[t];
      const maxJ = Math.min(3, joints.length);
      ctx.beginPath();
      ctx.moveTo(joints[0].x, joints[0].y);
      for (let j = 1; j < maxJ; j++) {
        ctx.lineTo(joints[j].x, joints[j].y);
      }
      ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.3, 0.45);
      ctx.lineWidth = 0.9;
      ctx.stroke();

      const tip = joints[maxJ - 1];
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = creature.color.toGlowHSLA(0.85);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);

    // 2. Logarithmic Golden Spiral Shell (Fibonacci Chambers)
    ctx.beginPath();
    ctx.moveTo(r * 1.15, -r * 0.3); // Hood crest above aperture
    ctx.bezierCurveTo(r * 0.8, -r * 1.1, -r * 0.4, -r * 1.35, -r * 1.1, -r * 0.7); // Outer dorsal curve
    ctx.bezierCurveTo(-r * 1.5, -r * 0.2, -r * 1.3, r * 0.8, -r * 0.6, r * 1.1); // Posterior whorl
    ctx.quadraticCurveTo(0, r * 1.15, r * 0.6, r * 0.65); // Ventral keel
    ctx.quadraticCurveTo(r * 1.25, r * 0.35, r * 1.15, -r * 0.3); // Shell aperture margin
    ctx.closePath();

    ctx.fillStyle = this._creatureGradLocal(ctx, creature, r);
    ctx.fill();

    ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.4, 0.55);
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // Concentric Fibonacci septa chamber arcs
    const septaCount = 5;
    for (let s = 1; s <= septaCount; s++) {
      const frac = s / septaCount;
      const arcR = r * (0.25 + frac * 0.65);
      ctx.beginPath();
      ctx.arc(-r * 0.15, 0, arcR, -Math.PI * 0.65, Math.PI * 0.45);
      ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.2 + frac * 0.25, 0.3);
      ctx.lineWidth = 0.65;
      ctx.stroke();
    }

    // Central spiral umbilicus eye
    ctx.beginPath();
    ctx.arc(-r * 0.15, 0, r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = creature.color.toGlowHSLAWithAlpha(0.7, 0.4);
    ctx.fill();

    // Jet propulsion siphon nozzle (lower aperture)
    ctx.beginPath();
    ctx.moveTo(r * 0.6, r * 0.65);
    ctx.lineTo(r * 0.9, r * 0.9);
    ctx.lineTo(r * 0.4, r * 0.85);
    ctx.closePath();
    ctx.fillStyle = creature.color.toHSLAWithAlpha(0.4);
    ctx.fill();

    ctx.restore();
  }

  // ── Chimeras 2.0: Secondary Anatomical Hallmarks ───────────────────────────
  _drawChimericFeatures(ctx, creature, now, breath) {
    const px = creature.position.x;
    const py = creature.position.y;
    const r  = creature.radius;
    const angle = creature.facingAngle;
    const plan = creature.chimericPlan;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);

    switch (plan) {
      case Config.BODY_PLAN.MANTA: {
        // Etheric secondary pectoral wings
        const flutter = Math.sin(now * 0.005 + (creature.id.charCodeAt(0) || 0)) * (r * 0.25);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-r * 0.2, -r * 1.2 - flutter, -r * 0.8, -r * 1.4 - flutter, -r * 0.6, 0);
        ctx.bezierCurveTo(-r * 0.8, r * 1.4 + flutter, -r * 0.2, r * 1.2 + flutter, 0, 0);
        ctx.fillStyle = creature.color.toGlowHSLAWithAlpha(0.25, 0.2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 0.8;
        ctx.fill();
        ctx.stroke();
        break;
      }
      case Config.BODY_PLAN.CRYSTAL: {
        // Orbiting prism shards
        for (let i = 0; i < 3; i++) {
          const shardAng = (i * Math.PI * 2) / 3 + now * 0.002;
          const sx = Math.cos(shardAng) * (r * 1.35);
          const sy = Math.sin(shardAng) * (r * 1.35);
          ctx.beginPath();
          ctx.moveTo(sx, sy - 3.5);
          ctx.lineTo(sx + 3.5, sy);
          ctx.lineTo(sx, sy + 3.5);
          ctx.lineTo(sx - 3.5, sy);
          ctx.closePath();
          ctx.fillStyle = 'rgba(230, 245, 255, 0.65)';
          ctx.fill();
        }
        break;
      }
      case Config.BODY_PLAN.PHOENIX: {
        // Solar crest flare
        const flare = Math.sin(now * 0.007) * 2;
        ctx.beginPath();
        ctx.moveTo(r * 0.4, 0);
        ctx.quadraticCurveTo(0, -r * 0.8 - flare, -r * 0.5, -r * 0.9 - flare);
        ctx.strokeStyle = 'rgba(255, 220, 120, 0.7)';
        ctx.lineWidth = 1.0;
        ctx.stroke();
        break;
      }
      case Config.BODY_PLAN.NAUTILUS: {
        // Small spiral shell emblem on dorsal mantle
        ctx.beginPath();
        ctx.arc(-r * 0.35, 0, r * 0.3, 0, Math.PI * 1.5);
        ctx.strokeStyle = 'rgba(255, 240, 200, 0.55)';
        ctx.lineWidth = 0.85;
        ctx.stroke();
        break;
      }
      case Config.BODY_PLAN.SERPENTINE: {
        // Vertebral dorsal spikes
        for (let i = -2; i <= 2; i++) {
          const sx = i * (r * 0.35);
          ctx.beginPath();
          ctx.moveTo(sx - 2, 0);
          ctx.lineTo(sx, -r * 0.45);
          ctx.lineTo(sx + 2, 0);
          ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.4, 0.4);
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
        break;
      }
      default:
        break;
    }

    ctx.restore();
  }

  // ── Conscious Sensory Gaze / Ocelli ───────────────────────────────────────
  _drawSensoryGaze(ctx, creature, now) {
    const r = creature.radius;
    const angle = creature.facingAngle;
    const px = creature.position.x;
    const py = creature.position.y;

    // Inquisitive look direction offset (tracks player touch if playing)
    let lookOffset = 0;
    if (creature.decision === 'play' && creature.decisionTarget) {
      const targetAngle = Math.atan2(creature.decisionTarget.y - py, creature.decisionTarget.x - px);
      lookOffset = Math.sin(targetAngle - angle) * 0.35;
    }

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);

    const eyeForward   = r * 0.42;
    const eyeSpread    = r * 0.32;
    const eyeR         = Math.max(1.2, r * 0.12);
    const lookY        = lookOffset * r * 0.2;
    const eyeY1        = -eyeSpread + lookY;
    const eyeY2        =  eyeSpread + lookY;

    const isLight      = creature.originZone === Config.ZONE.LIGHT;
    const socketColor  = isLight ? 'rgba(255, 255, 230, 0.95)' : 'rgba(230, 210, 255, 0.95)';
    const pupilColor   = isLight ? 'rgba(120, 60, 10, 0.8)'   : 'rgba(50, 10, 80, 0.8)';
    const pupilOffsetX = eyeR * 0.35;
    const pupilR       = eyeR * 0.45;

    // Sockets (left and right)
    ctx.beginPath();
    ctx.arc(eyeForward, eyeY1, eyeR, 0, Math.PI * 2);
    ctx.arc(eyeForward, eyeY2, eyeR, 0, Math.PI * 2);
    ctx.fillStyle = socketColor;
    if (!this._isMobile) {
      ctx.shadowColor = socketColor;
      ctx.shadowBlur = 6;
    }
    ctx.fill();
    if (!this._isMobile) ctx.shadowBlur = 0;

    // Pupils (left and right)
    ctx.beginPath();
    ctx.arc(eyeForward + pupilOffsetX, eyeY1, pupilR, 0, Math.PI * 2);
    ctx.arc(eyeForward + pupilOffsetX, eyeY2, pupilR, 0, Math.PI * 2);
    ctx.fillStyle = pupilColor;
    ctx.fill();

    ctx.restore();
  }

  _blobPath(ctx, pts) {
    const n = pts.length;
    const sx = (pts[n - 1].x + pts[0].x) / 2;
    const sy = (pts[n - 1].y + pts[0].y) / 2;
    ctx.moveTo(sx, sy);
    for (let i = 0; i < n; i++) {
      const c = pts[i];
      const nx = pts[(i + 1) % n];
      ctx.quadraticCurveTo(c.x, c.y, (c.x + nx.x) / 2, (c.y + nx.y) / 2);
    }
    ctx.closePath();
  }

  _drawSpecular(ctx, creature) {
    const r  = Math.max(1, creature.radius * 0.44);
    const ox = -creature.radius * 0.28;
    const oy = -creature.radius * 0.28;
    const g  = ctx.createRadialGradient(
      creature.position.x + ox, creature.position.y + oy, 0,
      creature.position.x + ox, creature.position.y + oy, r,
    );
    g.addColorStop(0,   'rgba(255,255,255,0.28)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.06)');
    g.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(creature.position.x + ox, creature.position.y + oy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.shadowBlur = 0;
    ctx.fill();
  }

  _drawWitnessEye(ctx, creature, now) {
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
    const r     = Math.max(1, creature.radius * 0.28);
    ctx.beginPath();
    ctx.arc(creature.position.x, creature.position.y, r * (1.5 + pulse * 0.5), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.14 + pulse * 0.1})`;
    ctx.lineWidth   = 1;
    ctx.shadowBlur  = this._isMobile ? 0 : 15;
    ctx.shadowColor = 'white';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(creature.position.x, creature.position.y, r, 0, Math.PI * 2);
    ctx.fillStyle  = `rgba(255,255,255,${0.7 + pulse * 0.3})`;
    ctx.shadowBlur = this._isMobile ? 0 : 20;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  _drawTranscendentHalo(ctx, creature, now) {
    const pulse  = 0.5 + 0.5 * Math.sin(now * 0.0018);
    const innerR = Math.max(1, creature.radius * 0.8);
    const hR     = Math.max(innerR + 2, creature.radius * (2.2 + pulse * 0.6));
    const g      = ctx.createRadialGradient(
      creature.position.x, creature.position.y, innerR,
      creature.position.x, creature.position.y, hR,
    );
    g.addColorStop(0,   'rgba(255,248,160,0.28)');
    g.addColorStop(0.5, 'rgba(255,240,120,0.07)');
    g.addColorStop(1,   'rgba(255,240,120,0)');
    ctx.beginPath();
    ctx.arc(creature.position.x, creature.position.y, hR, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.shadowBlur = 0;
    ctx.fill();
  }

  _drawTranscendentRays(ctx, creature, now) {
    const count = 8;
    const spin  = now * 0.0004;
    const pulse = 0.7 + 0.3 * Math.sin(now * 0.002);
    ctx.save();
    ctx.globalAlpha = 0.2 * pulse;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + spin;
      const len   = Math.max(creature.radius + 5, creature.radius * (2.5 + (i % 2) * 1.3));
      const x1 = creature.position.x + Math.cos(angle) * creature.radius * 0.9;
      const y1 = creature.position.y + Math.sin(angle) * creature.radius * 0.9;
      const x2 = creature.position.x + Math.cos(angle) * len;
      const y2 = creature.position.y + Math.sin(angle) * len;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = 'rgba(255,248,150,1)';
      ctx.lineWidth   = 1.5;
      ctx.shadowColor = 'rgba(255,248,150,1)';
      ctx.shadowBlur  = this._isMobile ? 0 : 12;
      ctx.stroke();
      ctx.shadowBlur  = 0;
    }
    ctx.restore();
  }

  _drawHybridShimmer(ctx, creature, now) {
    const shimmer = 0.5 + 0.5 * Math.sin(now * 0.005 + creature.blobPhases[0]);
    const r = Math.max(1, creature.radius);
    const g = ctx.createRadialGradient(
      creature.position.x, creature.position.y, 0,
      creature.position.x, creature.position.y, r,
    );
    g.addColorStop(0,   `rgba(255,238,120,${shimmer * 0.12})`);
    g.addColorStop(0.5, `rgba(150,80,255,${shimmer * 0.08})`);
    g.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(creature.position.x, creature.position.y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.shadowBlur = 0;
    ctx.fill();
  }

  _drawCrossingRipple(ctx, creature, now) {
    const p = creature.transformProgress;
    const r = Math.max(1, creature.radius * (1 + p * 0.6) + Math.sin(now * 0.005) * 4);
    ctx.beginPath();
    ctx.arc(creature.position.x, creature.position.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = creature.color.toHSLAWithAlpha((1 - p) * 0.3);
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    ctx.stroke();
  }

  // ── 12. Touch ripple waves ────────────────────────────────────────────────

  _drawRipples(ctx, ripples, now) {
    ctx.save();
    for (let i = 0; i < ripples.length; i++) {
      const ripple   = ripples[i];
      const age      = now - ripple.startTime;
      const duration = 1800;
      if (age > duration) continue;

      const t      = age / duration;       // 0→1
      const radius = Math.max(0.5, t * 80);
      const alpha  = (1 - t) * (1 - t) * 0.5;

      // Main ring
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(210, 170, 255, ${alpha})`;
      ctx.lineWidth   = Math.max(0.5, 1.5 * (1 - t));
      if (!this._isMobile) {
        ctx.shadowColor = 'rgba(190, 140, 255, 0.6)';
        ctx.shadowBlur  = 12;
      }
      ctx.stroke();
      if (!this._isMobile) ctx.shadowBlur = 0;

      // Inner secondary ring (half radius, half phase)
      if (t < 0.6) {
        const t2     = t / 0.6;
        const alpha2 = (1 - t2) * (1 - t2) * 0.3;
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, Math.max(0.5, t2 * 40), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(230, 195, 255, ${alpha2})`;
        ctx.lineWidth   = Math.max(0.5, 1 * (1 - t2));
        if (!this._isMobile) {
          ctx.shadowBlur  = 8;
        }
        ctx.stroke();
        if (!this._isMobile) ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
  }

  // ── 13. Eclipse overlay + moon ────────────────────────────────────────────

  _drawEclipseOverlay(ctx, w, h, ty, ea, now) {
    const darkness = 1 - ea;
    if (darkness < 0.01) return;

    // Dark veil
    ctx.fillStyle = `rgba(3,0,12,${darkness * 0.42})`;
    ctx.fillRect(0, 0, w, h);

    // Aurora-tinted bands
    if (darkness > 0.4) {
      const t = (darkness - 0.4) / 0.6;
      for (let i = 0; i < 3; i++) {
        const by    = h * (0.18 + i * 0.28) + Math.sin(now * 0.0004 + i * 1.2) * h * 0.05;
        const alpha = t * 0.035;
        const g     = ctx.createLinearGradient(0, by - 45, 0, by + 45);
        g.addColorStop(0,   'rgba(80,20,200,0)');
        g.addColorStop(0.5, `rgba(100,30,220,${alpha})`);
        g.addColorStop(1,   'rgba(80,20,200,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, by - 45, w, 90);
      }
    }

    // Eclipse moon — appears as darkness increases
    if (darkness > 0.25) {
      this._drawEclipseMoon(ctx, w, ty, darkness, now);
    }
  }

  _drawEclipseMoon(ctx, w, ty, darkness, now) {
    const t       = Math.min(1, (darkness - 0.25) / 0.75);
    const moonX   = w * 0.5 + Math.sin(now * 0.00008) * w * 0.04;
    const safeTy  = Math.max(80, ty);
    const moonY   = safeTy * 0.28 + Math.cos(now * 0.00006) * safeTy * 0.03;
    const moonR   = Math.max(12, Math.min(w, safeTy) * 0.075);
    const coronaR = moonR * 3.5;

    // Outer corona
    const corona = ctx.createRadialGradient(moonX, moonY, moonR, moonX, moonY, coronaR);
    corona.addColorStop(0,   `rgba(200, 160, 255, ${t * 0.3})`);
    corona.addColorStop(0.4, `rgba(160, 100, 255, ${t * 0.12})`);
    corona.addColorStop(1,   'rgba(140, 80, 255, 0)');
    ctx.beginPath();
    ctx.arc(moonX, moonY, coronaR, 0, Math.PI * 2);
    ctx.fillStyle = corona;
    ctx.fill();

    // Moon disk
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(2, 0, 10, ${t * 0.97})`;
    ctx.shadowColor = 'rgba(180, 130, 255, 0.8)';
    ctx.shadowBlur  = this._isMobile ? 0 : 30;
    ctx.fill();

    // Silver rim
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(210, 175, 255, ${t * 0.75})`;
    ctx.lineWidth   = 1.5;
    ctx.shadowBlur  = this._isMobile ? 0 : 20;
    ctx.stroke();
    ctx.shadowBlur  = 0;

    // Subtle craters (fixed random circles on the moon face)
    ctx.save();
    ctx.globalAlpha = t * 0.12;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.clip(); // clip to moon disk
    const craters = [[0.3, 0.2, 0.15], [-0.2, 0.35, 0.1], [0.1, -0.3, 0.08], [-0.35, -0.1, 0.12]];
    for (const [cx, cy, cr] of craters) {
      ctx.beginPath();
      ctx.arc(moonX + cx * moonR, moonY + cy * moonR, Math.max(1, cr * moonR), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(140, 100, 200, 0.5)';
      ctx.fill();
    }
    ctx.restore();
  }

  // ── 14. Post-process ──────────────────────────────────────────────────────

  _drawBloomPass(ctx, w, h, creatures, ty, ea, now, sunburst = 0, voidPulse = 0, diurnalCycle = 0, season = null) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.20 + sunburst * 0.12 + voidPulse * 0.08;

    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (!c.isAlive) continue;
      const s = c.state;
      if (s !== CreatureState.TRANSCENDENT && s !== CreatureState.HYBRID &&
          s !== CreatureState.WITNESS && s !== CreatureState.NATIVE) continue;
      const r = Math.max(2, c.radius * 2.2);
      const g = ctx.createRadialGradient(c.position.x, c.position.y, 0, c.position.x, c.position.y, r);
      g.addColorStop(0, c.color.toGlowHSLA(1));
      g.addColorStop(0.45, c.color.toGlowHSLA(0.35));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(c.position.x, c.position.y, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }

    // Bloom threshold glow harmonized with diurnal cycle and cosmic seasons
    if (ea > 0.3) {
      const diurnal = this._currentDiurnal;
      let btR = diurnal.bloomTint[0];
      let btG = diurnal.bloomTint[1];
      let btB = diurnal.bloomTint[2];

      if (season?.current === 'boreal_night') {
        const blended = blendRGB([btR, btG, btB], [52, 211, 153], 0.65, SCRATCH_RGB_A);
        btR = blended[0]; btG = blended[1]; btB = blended[2];
      } else if (season?.current === 'golden_eclipse') {
        const blended = blendRGB([btR, btG, btB], [251, 191, 36], 0.60, SCRATCH_RGB_A);
        btR = blended[0]; btG = blended[1]; btB = blended[2];
      } else if (season?.current === 'crystal_tide') {
        const blended = blendRGB([btR, btG, btB], [224, 242, 254], 0.45, SCRATCH_RGB_A);
        btR = blended[0]; btG = blended[1]; btB = blended[2];
      }

      const pulse = 0.5 + 0.5 * Math.sin(now * 0.0013);
      const bg    = ctx.createLinearGradient(0, ty - 28, 0, ty + 28);
      bg.addColorStop(0,   `rgba(${btR}, ${btG}, ${btB}, 0)`);
      bg.addColorStop(0.5, `rgba(${btR}, ${btG}, ${btB}, ${0.18 * ea * pulse})`);
      bg.addColorStop(1,   `rgba(${btR}, ${btG}, ${btB}, 0)`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, ty - 28, w, 56);
    }

    ctx.restore();
  }

  _drawVignette(ctx, w, h, diurnalFactor = 0.5) {
    if (w <= 0 || h <= 0) return;
    // Vignette subtly breathes between daytime (0.38) and night (0.50)
    const nightVignette = 0.38 + (1 - diurnalFactor) * 0.12;
    const r0 = Math.max(1, Math.min(w, h) * 0.28);
    const r1 = Math.max(r0 + 10, Math.max(w, h) * 0.85);
    const g = ctx.createRadialGradient(w/2, h/2, r0, w/2, h/2, r1);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${nightVignette.toFixed(3)})`);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // ── Pre-generated scene elements ──────────────────────────────────────────

  _genStars(rng, count) {
    return Array.from({ length: count }, () => {
      const type = rng.next();
      const [r, g, b] = type < 0.65
        ? [220, 225, 255]  // blue-white
        : type < 0.9
        ? [255, 255, 240]  // warm white
        : [255, 200, 130]; // gold
      return {
        x: rng.next(), y: rng.next(),
        size: rng.float(0.4, 2.2),
        alpha: rng.float(0.3, 0.9),
        twinkle: rng.float(0, Math.PI * 2),
        twinkleSpeed: rng.float(0.0003, 0.002),
        r, g, b,
        rgbString: `rgb(${r},${g},${b})`,
      };
    });
  }

  _genLightRays(rng, count) {
    return Array.from({ length: count }, () => ({
      xRatio:    rng.float(0.2, 0.8),
      angle:     rng.float(Math.PI / 3, Math.PI * 2 / 3),
      lenRatio:  rng.float(0.4, 0.9),
      spread:    rng.float(0.05, 0.2),
      phase:     rng.float(0, Math.PI * 2),
      pulseSpeed: rng.float(0.0003, 0.0009),
    }));
  }

  // ── Utilities & Photometric Diurnal Color Engine ──────────────────────────

  _parseColor(c) {
    if (typeof c !== 'string') return [255, 255, 255];
    if (c.startsWith('#')) {
      const h = c.replace('#', '');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    if (c.startsWith('rgb')) {
      const m = c.match(/\d+/g);
      if (m && m.length >= 3) return [parseInt(m[0], 10), parseInt(m[1], 10), parseInt(m[2], 10)];
    }
    return [255, 255, 255];
  }

  _blendHex(colorA, colorB, t) {
    if (t <= 0) return colorA;
    if (t >= 1) return colorB;
    const a = this._parseColor(colorA);
    const b = this._parseColor(colorB);
    return this._blendRGBString(a, b, t);
  }

  _blendRGBString(a, b, t) {
    // Energy-conserving square-root interpolation (prevents middle-tone mud/dimming)
    const r  = Math.round(Math.sqrt((1 - t) * a[0] * a[0] + t * b[0] * b[0]));
    const g  = Math.round(Math.sqrt((1 - t) * a[1] * a[1] + t * b[1] * b[1]));
    const bl = Math.round(Math.sqrt((1 - t) * a[2] * a[2] + t * b[2] * b[2]));
    return `rgb(${r},${g},${bl})`;
  }

  _blendRGBArray(a, b, t) {
    const r  = Math.round(Math.sqrt((1 - t) * a[0] * a[0] + t * b[0] * b[0]));
    const g  = Math.round(Math.sqrt((1 - t) * a[1] * a[1] + t * b[1] * b[1]));
    const bl = Math.round(Math.sqrt((1 - t) * a[2] * a[2] + t * b[2] * b[2]));
    return [r, g, bl];
  }

  _hex(h) {
    return this._parseColor(h);
  }

  /**
   * Sample the 4-phase diurnal palette smoothly into this._currentDiurnal (zero-allocation).
   * @param {number} cycle - 0.0 to 1.0 (continuous diurnal phase)
   */
  _sampleDiurnal(cycle) {
    const normalized = ((cycle % 1) + 1) % 1;
    const scaled = normalized * 4;
    const i0 = Math.floor(scaled) % 4;
    const i1 = (i0 + 1) % 4;
    const tLinear = scaled - Math.floor(scaled);

    // Cosine ease-in-out S-curve: C1 continuous everywhere, 0 velocity at endpoints
    const t = 0.5 - 0.5 * Math.cos(tLinear * Math.PI);

    const p0 = DIURNAL_PALETTES[i0];
    const p1 = DIURNAL_PALETTES[i1];

    const cd = this._currentDiurnal;
    blendRGB(p0.lightTop,  p1.lightTop,  t, cd.lightTop);
    blendRGB(p0.lightMid,  p1.lightMid,  t, cd.lightMid);
    blendRGB(p0.lightBot,  p1.lightBot,  t, cd.lightBot);
    blendRGB(p0.shadowTop, p1.shadowTop, t, cd.shadowTop);
    blendRGB(p0.shadowMid, p1.shadowMid, t, cd.shadowMid);
    blendRGB(p0.shadowBot, p1.shadowBot, t, cd.shadowBot);
    blendRGB(p0.fogColor,  p1.fogColor,  t, cd.fogColor);
    blendRGB(p0.coreColor, p1.coreColor, t, cd.coreColor);
    blendRGB(p0.bloomTint, p1.bloomTint, t, cd.bloomTint);

    const sunIntensity = 0.5 + 0.5 * Math.sin(normalized * Math.PI * 2);
    cd.sunIntensity = sunIntensity;
    cd.nightIntensity = 1.0 - sunIntensity;
    cd.tPhase = normalized;
  }

  /**
   * Sample the 4-phase diurnal palette smoothly using cosine ease-in-out.
   * Guarantees C1 continuity (zero angular jumps, zero abrupt steps).
   * Preserves backward-compatible return format for tests.
   * @param {number} cycle - 0.0 to 1.0 (continuous diurnal phase)
   */
  _getDiurnalSample(cycle) {
    this._sampleDiurnal(cycle);
    const cd = this._currentDiurnal;
    return {
      lightTop:  rgbString(cd.lightTop),
      lightMid:  rgbString(cd.lightMid),
      lightBot:  rgbString(cd.lightBot),
      shadowTop: rgbString(cd.shadowTop),
      shadowMid: rgbString(cd.shadowMid),
      shadowBot: rgbString(cd.shadowBot),
      fogColor:  [cd.fogColor[0], cd.fogColor[1], cd.fogColor[2]],
      coreColor: [cd.coreColor[0], cd.coreColor[1], cd.coreColor[2]],
      bloomTint: [cd.bloomTint[0], cd.bloomTint[1], cd.bloomTint[2]],
      sunIntensity: cd.sunIntensity,
      nightIntensity: cd.nightIntensity,
      tPhase: cd.tPhase,
    };
  }

  // ── 17. Expanded Sensory, Empathy & Mythic Rendering ──────────────────────

  /**
   * Render glowing celestial reticle around currently inspected creature.
   */
  _drawInspectedIndicator(ctx, creature, now) {
    const ix = creature.position.x;
    const iy = creature.position.y;
    const ir = creature.radius + 15;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);
    ctx.save();

    // Inner glowing breathing ring
    ctx.beginPath();
    ctx.arc(ix, iy, ir, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.45 + pulse * 0.35})`;
    ctx.lineWidth = 1.4;
    if (!this._isMobile) {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.85)';
      ctx.shadowBlur = 12;
    }
    ctx.stroke();
    if (!this._isMobile) ctx.shadowBlur = 0;

    // Outer rotating celestial reticle
    ctx.beginPath();
    ctx.arc(ix, iy, ir + 6, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(224, 231, 255, ${0.3 + pulse * 0.25})`;
    ctx.lineWidth = 1.0;
    ctx.setLineDash([5, 7]);
    ctx.stroke();

    // 4 cardinal star pips
    const rot = now * 0.0012;
    for (let i = 0; i < 4; i++) {
      const a = rot + (i * Math.PI) / 2;
      const px = ix + Math.cos(a) * (ir + 10);
      const py = iy + Math.sin(a) * (ir + 10);
      ctx.beginPath();
      ctx.arc(px, py, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Render 4 mythical legendary mutations.
   */
  _drawLegendaryMutation(ctx, creature, now, breath) {
    const trait = creature.legendaryTrait;
    const px = creature.position.x;
    const py = creature.position.y;

    switch (trait) {
      case 'twin_wings': {
        const angle = creature.facingAngle;
        const flap = Math.sin(now * 0.005 + creature.pulsePhase);
        const wingSpan = creature.radius * 2.2;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.fillStyle = creature.color.toHSLAWithAlpha(0.22);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 0.9;
        if (!this._isMobile) {
          ctx.shadowColor = creature.color.toHSLA();
          ctx.shadowBlur = 8;
        }

        // Left twin wing
        ctx.beginPath();
        ctx.moveTo(-creature.radius * 0.3, 0);
        ctx.quadraticCurveTo(-wingSpan * 0.8, -wingSpan * (0.6 + flap * 0.25), -wingSpan * 1.2, -wingSpan * (0.2 + flap * 0.2));
        ctx.quadraticCurveTo(-wingSpan * 0.6, 0, -creature.radius * 0.3, creature.radius * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Right twin wing
        ctx.beginPath();
        ctx.moveTo(-creature.radius * 0.3, 0);
        ctx.quadraticCurveTo(-wingSpan * 0.8, wingSpan * (0.6 + flap * 0.25), -wingSpan * 1.2, wingSpan * (0.2 + flap * 0.2));
        ctx.quadraticCurveTo(-wingSpan * 0.6, 0, -creature.radius * 0.3, -creature.radius * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'stellar_halo': {
        const hr = creature.radius * 1.65;
        const rot = now * 0.0018;
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, hr, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(253, 224, 71, 0.55)';
        ctx.lineWidth = 1.2;
        if (!this._isMobile) {
          ctx.shadowColor = 'rgba(250, 204, 21, 0.85)';
          ctx.shadowBlur = 10;
        }
        ctx.setLineDash([6, 6]);
        ctx.stroke();
        if (!this._isMobile) ctx.shadowBlur = 0;

        // 4 orbiting starlight diamonds
        for (let i = 0; i < 4; i++) {
          const a = rot + (i * Math.PI) / 2;
          const sx = px + Math.cos(a) * hr;
          const sy = py + Math.sin(a) * hr;
          ctx.fillStyle = '#fffbeb';
          ctx.beginPath();
          ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'abyssal_veins': {
        const vr = creature.radius * 0.85;
        const veinPulse = 0.5 + 0.5 * Math.sin(now * 0.004);
        ctx.save();
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.45 + veinPulse * 0.4})`;
        ctx.lineWidth = 1.0;
        if (!this._isMobile) {
          ctx.shadowColor = '#06b6d4';
          ctx.shadowBlur = 8;
        }
        for (let i = 0; i < 4; i++) {
          const va = (i * Math.PI * 2) / 4 + creature.pulsePhase;
          ctx.beginPath();
          ctx.moveTo(px, py);
          const midX = px + Math.cos(va + 0.3) * (vr * 0.5);
          const midY = py + Math.sin(va + 0.3) * (vr * 0.5);
          const endX = px + Math.cos(va) * vr;
          const endY = py + Math.sin(va) * vr;
          ctx.quadraticCurveTo(midX, midY, endX, endY);
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'prism_tail': {
        const heading = creature.velocity.heading();
        const colors = ['#f43f5e', '#fbbf24', '#34d399', '#38bdf8', '#a855f7'];
        ctx.save();
        ctx.lineWidth = 1.4;
        for (let i = 0; i < colors.length; i++) {
          const offset = (i - 2) * 2.2;
          const length = creature.radius * (1.8 + i * 0.2);
          const tailAngle = heading + Math.PI + Math.sin(now * 0.006 + i) * 0.35;
          const tx = px + Math.cos(heading + Math.PI / 2) * offset;
          const ty = py + Math.sin(heading + Math.PI / 2) * offset;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.quadraticCurveTo(
            tx + Math.cos(tailAngle) * (length * 0.5),
            ty + Math.sin(tailAngle) * (length * 0.5),
            tx + Math.cos(tailAngle) * length,
            ty + Math.sin(tailAngle) * length
          );
          ctx.strokeStyle = colors[i];
          if (!this._isMobile) {
            ctx.shadowColor = colors[i];
            ctx.shadowBlur = 6;
          }
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
    }
  }

  /**
   * Render dual orbiting motes for chimera creatures.
   */
  _drawChimeraAura(ctx, creature, now) {
    const cx = creature.position.x;
    const cy = creature.position.y;
    const r = creature.radius * 1.35;
    const rot = now * 0.003;
    ctx.save();

    const m1x = cx + Math.cos(rot) * r;
    const m1y = cy + Math.sin(rot) * r;
    const m2x = cx + Math.cos(rot + Math.PI) * r;
    const m2y = cy + Math.sin(rot + Math.PI) * r;

    ctx.beginPath();
    ctx.arc(m1x, m1y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fef08a';
    if (!this._isMobile) {
      ctx.shadowColor = '#facc15';
      ctx.shadowBlur = 7;
    }
    ctx.fill();

    ctx.beginPath();
    ctx.arc(m2x, m2y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#c084fc';
    if (!this._isMobile) {
      ctx.shadowColor = '#9333ea';
      ctx.shadowBlur = 7;
    }
    ctx.fill();

    ctx.restore();
  }

  /**
   * Render living glowing flora spores floating in ether.
   */
  _drawSpores(ctx, spores, now) {
    if (!spores || spores.length === 0) return;
    ctx.save();
    for (let i = 0; i < spores.length; i++) {
      const s = spores[i];
      const alpha = Math.max(0, Math.min(1, s.life * 0.85));
      const pulse = 1.0 + 0.15 * Math.sin(now * 0.005 + i);
      const r = Math.max(1, s.radius * pulse);
      const outerR = Math.max(1.5, r * 2.5);

      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, outerR);
      grad.addColorStop(0, s.color.toHSLAWithAlpha(alpha));
      grad.addColorStop(0.5, s.color.toHSLAWithAlpha(alpha * 0.4));
      grad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, outerR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fffdf0';
      if (!this._isMobile) {
        ctx.shadowColor = s.color.toHSLA();
        ctx.shadowBlur = 6;
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(1, r * 0.45), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Render cosmic player call acoustic ripples.
   */
  _drawPlayerCalls(ctx, calls, now) {
    if (!calls || calls.length === 0) return;
    ctx.save();
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      const alpha = Math.max(0, Math.min(1, c.life * 0.7));
      if (alpha <= 0.01) continue;

      for (let rOff = 0; rOff < 3; rOff++) {
        const waveR = Math.max(1, c.radius - rOff * 16);
        if (waveR <= 0) continue;
        const waveAlpha = alpha * (1 - rOff * 0.28);
        ctx.beginPath();
        ctx.arc(c.x, c.y, waveR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(254, 240, 138, ${waveAlpha})`;
        ctx.lineWidth = 1.4 - rOff * 0.3;
        if (!this._isMobile) {
          ctx.shadowColor = 'rgba(253, 224, 71, 0.8)';
          ctx.shadowBlur = 10;
        }
        ctx.stroke();
        if (!this._isMobile) ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
  }
}

// ── Internal types (JSDoc-only, no runtime overhead) ─────────────────────────
/**
 * @typedef {{ x:number, y:number, vx:number, vy:number, size:number,
 *             alpha:number, hue:number, sat:number, lit:number,
 *             life:number, decay:number, zone:string }} AmbientParticle
 * @typedef {{ x:number, y:number, radius:number, color:import('../utils/Color.js').Color,
 *             alpha:number, life:number, decay:number }} DissolutionEcho
 */
