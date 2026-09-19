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
export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    // Clamp DPR to 2.0: delivers crisp Retina sharpness while saving >50% GPU fill rate on 3x/4x mobile screens
    this._dpr   = Math.min(window.devicePixelRatio || 1, 2.0);
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

    // ── Pre-allocated wave points cache ───────────────────────────────────
    this._wavePointsCache = Array.from({ length: 91 }, () => [0, 0]);
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  resize() {
    this._dpr = Math.min(window.devicePixelRatio || 1, 2.0);
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
    diurnalFactor = 0.5,
    diurnalCycle = 0,
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
      for (const c of creatures) {
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

      // 1. Background (breathes + diurnal tide + micro-weather)
      this._drawBackground(ctx, w, h, ty, ea, breath, sunburst, voidPulse, diurnalCycle, diurnalFactor);

      // 2. Stars (twinkle + nadir shooting stars)
      this._drawStars(ctx, w, h, ty, ea, voidPulse, diurnalCycle, diurnalFactor);

      // 3. Light rays (light zone + sunburst flares + zenith warmth)
      this._drawLightAtmosphere(ctx, w, ty, now, ea, breath, sunburst, diurnalFactor, diurnalCycle);

      // 5. Ambient floating particles (nudged by wind + weather spawns + creature grazing)
      this._updateAmbient(dt, w, h, ty, wind, sunburst, voidPulse, creatures);
      this._drawAmbient(ctx);

      // 6. Threshold (tension waves + harp impulses + living flora reeds + diurnal tint)
      this._drawThreshold(ctx, w, h, ty, ea, now, creatures, tension, breath, threshold, diurnalCycle);

      // 7. Courtship ribbons (Dança dos Opostos)
      this._drawCourtshipRibbons(ctx, creatures, now);

      // 8. Connection threads
      this._drawConnectionThreads(ctx, creatures);

      // 9. Dissolution echoes
      this._updateEchoes(dt);
      this._drawEchoes(ctx);

      // 10. Motion trails
      this._drawTrails(ctx, creatures);

      // 11. External particles
      this._drawParticles(ctx, particles);

      // 12. Celestial nectar droplet
      this._drawNectar(ctx, activeNectar, now);

      // 13. Creatures + orbital motes + sleeping auras
      this._drawCreatures(ctx, creatures, now, breath, dt);

      // 14. Touch ripples
      this._drawRipples(ctx, ripples, now);

      // 15. Eclipse overlay + moon
      this._drawEclipseOverlay(ctx, w, h, ty, ea, now);

      // 16. Post-process
      this._drawBloomPass(ctx, w, h, creatures, ty, ea, now, sunburst, voidPulse, diurnalCycle);
      this._drawVignette(ctx, w, h, diurnalFactor);
    } catch (err) {
      console.error('[Limiar Renderer] Frame render error:', err);
    }
  }

  // ── 1. Background ─────────────────────────────────────────────────────────

  _drawBackground(ctx, w, h, ty, ea, breath = 0.5, sunburst = 0, voidPulse = 0, diurnalCycle = 0, diurnalFactor = 0.5) {
    const eclipse = 1 - ea;
    const diurnal = this._getDiurnalSample(diurnalCycle);

    // 1. Light zone background (breathes & shifts with diurnal tide)
    const lightStop = 0.55 + breath * 0.08;
    const lg = ctx.createLinearGradient(0, 0, 0, ty);

    // Sunburst golden infusion (smoothly blended without hard threshold)
    let lTop = diurnal.lightTop;
    let lMid = diurnal.lightMid;
    let lBot = diurnal.lightBot;
    if (sunburst > 0) {
      lTop = this._blendHex(lTop, '#fff5d6', sunburst * 0.65);
      lMid = this._blendHex(lMid, '#fde293', sunburst * 0.75);
      lBot = this._blendHex(lBot, '#fbc05c', sunburst * 0.75);
    }

    lg.addColorStop(0,         this._blendHex(lTop, '#0f0520', eclipse));
    lg.addColorStop(lightStop, this._blendHex(lMid, '#1a0835', eclipse));
    lg.addColorStop(1,         this._blendHex(lBot, '#220a42', eclipse));
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, w, ty);

    // 2. Shadow zone background (breathes & shifts with diurnal tide)
    const shadowStop = 0.5 - breath * 0.06;
    const sg = ctx.createLinearGradient(0, ty, 0, h);

    let sTop = diurnal.shadowTop;
    let sMid = diurnal.shadowMid;
    let sBot = diurnal.shadowBot;
    if (voidPulse > 0) {
      sTop = this._blendHex(sTop, '#2d055a', voidPulse * 0.7);
      sMid = this._blendHex(sMid, '#1a0236', voidPulse * 0.75);
      sBot = this._blendHex(sBot, '#060012', voidPulse * 0.8);
    }

    sg.addColorStop(0,          this._blendHex(sTop, '#080215', eclipse));
    sg.addColorStop(shadowStop, this._blendHex(sMid, '#050114', eclipse));
    sg.addColorStop(1,          this._blendHex(sBot, '#020008', eclipse));
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

    for (const s of this._stars) {
      const sx      = s.x * w;
      const sy      = ty + s.y * shadowH;
      const twinkle = 0.5 + 0.5 * Math.sin(this._time * s.twinkleSpeed + s.twinkle);
      const alpha   = Math.min(1, s.alpha * twinkle * base);
      if (alpha < 0.01) continue;

      ctx.beginPath();
      ctx.arc(sx, sy, s.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${s.r},${s.g},${s.b},${alpha})`;
      ctx.fill();

      if (s.size > 1.4 && alpha > 0.25) {
        ctx.strokeStyle = `rgba(${s.r},${s.g},${s.b},${alpha * 0.4})`;
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
          ctx.shadowBlur  = 8;
          ctx.stroke();
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

    for (const ray of this._lightRays) {
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
    if (this._ambient.length > 320) this._ambient.splice(0, 60);
  }

  _drawAmbient(ctx) {
    ctx.save();
    // 1. Light motes (warm golden aura batch)
    ctx.shadowColor = 'rgba(255, 220, 140, 0.45)';
    ctx.shadowBlur  = 6;
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
    ctx.shadowBlur  = 6;
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

  // ── 6. Threshold ──────────────────────────────────────────────────────────

  _drawThreshold(ctx, w, h, ty, ea, now, creatures = [], tension = 0, breath = 0.5, threshold = null, diurnalCycle = 0) {
    if (ea < 0.02) return;
    const points = this._wavePath(w, ty, now, creatures, tension, breath);
    const pulse  = 0.5 + 0.5 * Math.sin(now * 0.0013);
    const tensionGlow = Math.min(tension * 0.35, 1.2);
    const diurnal = this._getDiurnalSample(diurnalCycle);
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
    points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.strokeStyle = `rgba(${fcR}, ${fcG}, ${fcB}, ${0.25 + pulse * 0.1 + tensionGlow * 0.2})`;
    ctx.lineWidth   = 4 + tensionGlow * 1.5;
    ctx.shadowColor = tension > 1.5 ? `rgba(${ccR}, ${ccG}, ${ccB}, 1)` : `rgba(${fcR}, ${fcG}, ${fcB}, 0.9)`;
    ctx.shadowBlur  = 22 + tension * 8;
    ctx.stroke();

    // Core line
    ctx.beginPath();
    points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.strokeStyle = `rgba(${ccR}, ${ccG}, ${ccB}, ${0.55 + pulse * 0.2 + tensionGlow * 0.25})`;
    ctx.lineWidth   = 1.2 + tensionGlow * 0.6;
    ctx.shadowBlur  = 6 + tensionGlow * 4;
    ctx.stroke();

    // Electric tension micro-sparkles along the line when tension is notable
    if (tension > 0.8) {
      this._drawTensionSparks(ctx, points, tension, now);
    }

    ctx.restore();
  }

  _drawHarpWaves(ctx, harpWaves, w, ty) {
    ctx.save();
    for (const hw of harpWaves) {
      const cx = hw.xRatio * w;
      const r = Math.max(1, hw.radius);
      const alpha = Math.max(0, hw.life * (hw.intensity || 1));
      if (alpha < 0.01) continue;

      // Outer ripple
      ctx.beginPath();
      ctx.ellipse(cx, ty, r, Math.max(1, r * 0.42), 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(225, 205, 255, ${alpha * 0.55})`;
      ctx.lineWidth = Math.max(0.5, 2.2 * hw.life);
      ctx.shadowColor = 'rgba(200, 160, 255, 0.9)';
      ctx.shadowBlur = 10;
      ctx.stroke();

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
        ctx.shadowColor = 'rgba(255, 240, 180, 1)';
        ctx.shadowBlur = 12;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _drawFloraReeds(ctx, flora, points, w, ty, ea, now, breath = 0.5) {
    if (!flora || flora.length === 0 || !points || points.length === 0) return;
    const n = points.length - 1;

    ctx.save();
    for (const reed of flora) {
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
      ctx.shadowBlur = 8;
      ctx.fill();

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
      ctx.shadowBlur = 10;
      ctx.fill();
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
    const visitedPairs = new Set();

    for (let i = 0; i < creatures.length; i++) {
      const a = creatures[i];
      if (!a.isAlive || !a.isDancing || !a.dancePartner || !a.dancePartner.isAlive) continue;
      const b = a.dancePartner;
      const pairKey = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
      if (visitedPairs.has(pairKey)) continue;
      visitedPairs.add(pairKey);
      visitedPairs.add(pairKey);

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
      ctx.shadowBlur = 10;
      ctx.stroke();

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
      ctx.shadowBlur = 10;
      ctx.stroke();
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

    // Symbiotic bond — curved glowing cord
    const bonded = new Set();
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (c.isAlive && c.state === CreatureState.SYMBIOTIC && c.bondedWith?.isAlive && !bonded.has(c.id)) {
        bonded.add(c.id);
        bonded.add(c.bondedWith.id);
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
    ctx.shadowBlur  = 8;
    ctx.stroke();
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
      ctx.shadowColor = echo.hsla;
      ctx.shadowBlur  = 12;
      ctx.stroke();

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
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (!c.isAlive || c.trail.length < 2) continue;
      const n = c.trail.length;
      const cRadius = c.radius * 0.55;
      for (let j = 1; j < n; j++) {
        const t     = j / n;
        const alpha = t * t * 0.32;
        ctx.beginPath();
        ctx.moveTo(c.trail[j - 1].x, c.trail[j - 1].y);
        ctx.lineTo(c.trail[j].x,     c.trail[j].y);
        ctx.strokeStyle = c.color.toHSLAWithAlpha(alpha);
        ctx.lineWidth   = Math.max(0.5, t * cRadius);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── 11. External particles ────────────────────────────────────────────────

  _drawParticles(ctx, particles) {
    ctx.save();
    const active = particles.active;
    for (let i = 0; i < active.length; i++) {
      const p = active[i];
      const alpha = p.alpha * p.life;
      if (alpha < 0.01) continue;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, p.radius * p.life), 0, Math.PI * 2);
      ctx.fillStyle = p.hsla || p.color.toHSLA();
      if (p.radius > 2.5) {
        ctx.shadowColor = p.hsla || p.color.toHSLA();
        ctx.shadowBlur  = p.radius * 3;
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
    ctx.shadowBlur = 14;
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
      ctx.shadowBlur = 6;
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
    const pts = creature.getBlobPoints(now);
    if (pts.length < 3) return;

    ctx.save();
    try {
      ctx.globalAlpha = creature.color.a;

      // Outer glow (harmonized with world breath)
      ctx.shadowColor = creature.color.toGlowHSLA(0.5);
      ctx.shadowBlur  = this._glowFor(creature, now, breath);

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
        case Config.BODY_PLAN.BLOB:
        default:
          ctx.beginPath();
          this._blobPath(ctx, pts);
          ctx.fillStyle = this._creatureGrad(ctx, creature);
          ctx.fill();

          ctx.strokeStyle = creature.color.toGlowHSLAWithAlpha(0.3, 0.4);
          ctx.lineWidth   = 0.8;
          ctx.shadowBlur  = 0;
          ctx.stroke();

          this._drawSpecular(ctx, creature);
          break;
      }

      // Conscious Sensory Organelles / Gaze
      this._drawSensoryGaze(ctx, creature, now);

      // Orbital motes (DNA echo gene)
      this._drawOrbitalMotes(ctx, creature, now);

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
        creature.metabolicFlash = Math.max(0, creature.metabolicFlash - dt * 0.0032);
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
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.restore();
  }

  _drawAgingAura(ctx, creature, now) {
    const flicker = 0.35 + 0.65 * Math.sin(now * 0.009 + (creature.id.charCodeAt(1) || 0));
    const r = Math.max(1, creature.radius * (1.35 + Math.sin(now * 0.004) * 0.15));
    ctx.save();
    ctx.beginPath();
    ctx.arc(creature.position.x, creature.position.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = creature.color.withAlpha(0.25 * flicker).toHSLA();
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
    ctx.shadowBlur = 6;
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

  // ── Orbital motes (DNA echo gene → orbit count) ────────────────────────────

  _drawOrbitalMotes(ctx, creature, now) {
    const count = Math.floor(creature.dna.echo * 4.9); // 0–4 motes
    if (count === 0) return;

    const orbitR = Math.max(2, creature.radius * 1.75);
    const speed  = 0.001 + creature.dna.rhythm * 0.0015;

    ctx.save();
    ctx.shadowColor = creature.color.glow().toHSLA();
    ctx.shadowBlur  = 8;

    for (let i = 0; i < count; i++) {
      const angle  = (i / count) * Math.PI * 2 + now * speed;
      const mx     = creature.position.x + Math.cos(angle) * orbitR;
      const my     = creature.position.y + Math.sin(angle) * orbitR;
      const pulse  = 0.55 + 0.45 * Math.sin(now * 0.004 + i * 1.3);
      const moteR  = Math.max(0.5, (1.2 + pulse * 0.8) * (creature.dna.luminosity * 0.5 + 0.5));

      ctx.globalAlpha = (0.5 + pulse * 0.4) * creature.color.a;
      ctx.beginPath();
      ctx.arc(mx, my, moteR, 0, Math.PI * 2);
      ctx.fillStyle = creature.color.glow(0.5).toHSLA();
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
      ctx.shadowBlur = 8;
      ctx.fill();
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
      ctx.shadowBlur = 6;
      ctx.fill();
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

    // 1. Translucent dorsal fin connecting the spine
    if (numSegs > 2) {
      ctx.beginPath();
      ctx.moveTo(segs[0].x, segs[0].y);
      for (let i = 1; i < numSegs; i++) {
        const s = segs[i];
        const normalAng = s.angle + Math.PI / 2;
        const finWave = Math.sin(now * 0.005 + i * 0.9) * (s.radius * 0.4);
        const fx = s.x + Math.cos(normalAng) * (s.radius * 0.7 + finWave);
        const fy = s.y + Math.sin(normalAng) * (s.radius * 0.7 + finWave);
        ctx.lineTo(fx, fy);
      }
      for (let i = numSegs - 1; i >= 0; i--) {
        ctx.lineTo(segs[i].x, segs[i].y);
      }
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
    ctx.shadowBlur = 10;
    ctx.fill();

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

    const eyeForward = r * 0.42;
    const eyeSpread  = r * 0.32;
    const eyeR       = Math.max(1.2, r * 0.12);

    // Left and Right Ocelli
    const eyes = [
      { x: eyeForward, y: -eyeSpread + lookOffset * r * 0.2 },
      { x: eyeForward, y:  eyeSpread + lookOffset * r * 0.2 },
    ];

    for (const e of eyes) {
      // Glow socket
      ctx.beginPath();
      ctx.arc(e.x, e.y, eyeR, 0, Math.PI * 2);
      ctx.fillStyle = creature.originZone === Config.ZONE.LIGHT
        ? 'rgba(255, 255, 230, 0.95)'
        : 'rgba(230, 210, 255, 0.95)';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 6;
      ctx.fill();

      // Pupil point
      ctx.beginPath();
      ctx.arc(e.x + eyeR * 0.35, e.y, eyeR * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = creature.originZone === Config.ZONE.LIGHT
        ? 'rgba(120, 60, 10, 0.8)'
        : 'rgba(50, 10, 80, 0.8)';
      ctx.shadowBlur = 0;
      ctx.fill();
    }

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
    ctx.shadowBlur  = 15;
    ctx.shadowColor = 'white';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(creature.position.x, creature.position.y, r, 0, Math.PI * 2);
    ctx.fillStyle  = `rgba(255,255,255,${0.7 + pulse * 0.3})`;
    ctx.shadowBlur = 20;
    ctx.fill();
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
      ctx.shadowBlur  = 12;
      ctx.stroke();
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
    ctx.strokeStyle = creature.color.withAlpha((1 - p) * 0.3).toHSLA();
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    ctx.stroke();
  }

  // ── 12. Touch ripple waves ────────────────────────────────────────────────

  _drawRipples(ctx, ripples, now) {
    ctx.save();
    for (const ripple of ripples) {
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
      ctx.shadowColor = 'rgba(190, 140, 255, 0.6)';
      ctx.shadowBlur  = 12;
      ctx.stroke();

      // Inner secondary ring (half radius, half phase)
      if (t < 0.6) {
        const t2    = t / 0.6;
        const alpha2 = (1 - t2) * (1 - t2) * 0.3;
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, Math.max(0.5, t2 * 40), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(230, 195, 255, ${alpha2})`;
        ctx.lineWidth   = Math.max(0.5, 1 * (1 - t2));
        ctx.shadowBlur  = 8;
        ctx.stroke();
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
    ctx.shadowBlur  = 30;
    ctx.fill();

    // Silver rim
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(210, 175, 255, ${t * 0.75})`;
    ctx.lineWidth   = 1.5;
    ctx.shadowBlur  = 20;
    ctx.stroke();

    // Subtle craters (fixed random circles on the moon face)
    ctx.save();
    ctx.globalAlpha = t * 0.12;
    ctx.clip(); // clip to moon disk
    ctx.beginPath(); ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2); ctx.clip();
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

  _drawBloomPass(ctx, w, h, creatures, ty, ea, now, sunburst = 0, voidPulse = 0, diurnalCycle = 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.16 + sunburst * 0.10 + voidPulse * 0.08;
    ctx.filter      = 'blur(14px)';

    for (const c of creatures) {
      if (!c.isAlive) continue;
      if (![CreatureState.TRANSCENDENT, CreatureState.HYBRID,
            CreatureState.WITNESS, CreatureState.NATIVE].includes(c.state)) continue;
      const r = Math.max(2, c.radius * 1.5);
      const g = ctx.createRadialGradient(c.position.x, c.position.y, 0, c.position.x, c.position.y, r);
      g.addColorStop(0, c.color.glow(1).toHSLA());
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(c.position.x, c.position.y, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }

    // Bloom threshold glow harmonized with diurnal cycle
    if (ea > 0.3) {
      const diurnal = this._getDiurnalSample(diurnalCycle);
      const [btR, btG, btB] = diurnal.bloomTint;
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.0013);
      const bg    = ctx.createLinearGradient(0, ty - 22, 0, ty + 22);
      bg.addColorStop(0,   `rgba(${btR}, ${btG}, ${btB}, 0)`);
      bg.addColorStop(0.5, `rgba(${btR}, ${btG}, ${btB}, ${0.16 * ea * pulse})`);
      bg.addColorStop(1,   `rgba(${btR}, ${btG}, ${btB}, 0)`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, ty - 22, w, 44);
    }

    ctx.filter = 'none';
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
   * Sample the 4-phase diurnal palette smoothly using cosine ease-in-out.
   * Guarantees C1 continuity (zero angular jumps, zero abrupt steps).
   * @param {number} cycle - 0.0 to 1.0 (continuous diurnal phase)
   */
  _getDiurnalSample(cycle) {
    const PALETTES = [
      // 0: Alvorada (Dawn) - soft morning peach, rose-gold & waking plum abyss
      {
        lightTop:  '#fff8f0',
        lightMid:  '#f8e3cb',
        lightBot:  '#ebc19f',
        shadowTop: '#190a30',
        shadowMid: '#0f0520',
        shadowBot: '#070214',
        fogColor:  [215, 150, 255],
        coreColor: [240, 195, 255],
        bloomTint: [255, 225, 195],
      },
      // 1: Zênite (Solar Noon) - radiant golden warmth, sunbeams & deep amethyst abyss
      {
        lightTop:  '#fffff2',
        lightMid:  '#fff1c4',
        lightBot:  '#fad485',
        shadowTop: '#1e0a38',
        shadowMid: '#120426',
        shadowBot: '#090119',
        fogColor:  [200, 145, 255],
        coreColor: [255, 230, 205],
        bloomTint: [255, 240, 175],
      },
      // 2: Crepúsculo (Dusk) - fiery copper, dusky coral, twilight lavender & wine abyss
      {
        lightTop:  '#f7ded4',
        lightMid:  '#ecb4be',
        lightBot:  '#c783ad',
        shadowTop: '#26083d',
        shadowMid: '#150326',
        shadowBot: '#0a0116',
        fogColor:  [225, 130, 215],
        coreColor: [255, 185, 225],
        bloomTint: [250, 175, 220],
      },
      // 3: Nadir (Cosmic Midnight) - serene celestial moonlit pearl & starlit velvet void
      {
        lightTop:  '#d6cbe8',
        lightMid:  '#bfb0dc',
        lightBot:  '#a28ec6',
        shadowTop: '#100322',
        shadowMid: '#070114',
        shadowBot: '#03000a',
        fogColor:  [150, 105, 245],
        coreColor: [200, 170, 255],
        bloomTint: [185, 145, 255],
      },
    ];

    const normalized = ((cycle % 1) + 1) % 1;
    const scaled = normalized * 4;
    const i0 = Math.floor(scaled) % 4;
    const i1 = (i0 + 1) % 4;
    const tLinear = scaled - Math.floor(scaled);

    // Cosine ease-in-out S-curve: C1 continuous everywhere, 0 velocity at endpoints
    const t = 0.5 - 0.5 * Math.cos(tLinear * Math.PI);

    const p0 = PALETTES[i0];
    const p1 = PALETTES[i1];

    const sunIntensity = 0.5 + 0.5 * Math.sin(normalized * Math.PI * 2);
    const nightIntensity = 1.0 - sunIntensity;

    return {
      lightTop:  this._blendHex(p0.lightTop,  p1.lightTop,  t),
      lightMid:  this._blendHex(p0.lightMid,  p1.lightMid,  t),
      lightBot:  this._blendHex(p0.lightBot,  p1.lightBot,  t),
      shadowTop: this._blendHex(p0.shadowTop, p1.shadowTop, t),
      shadowMid: this._blendHex(p0.shadowMid, p1.shadowMid, t),
      shadowBot: this._blendHex(p0.shadowBot, p1.shadowBot, t),
      fogColor:  this._blendRGBArray(p0.fogColor,  p1.fogColor,  t),
      coreColor: this._blendRGBArray(p0.coreColor, p1.coreColor, t),
      bloomTint: this._blendRGBArray(p0.bloomTint, p1.bloomTint, t),
      sunIntensity,
      nightIntensity,
      tPhase: normalized,
    };
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
