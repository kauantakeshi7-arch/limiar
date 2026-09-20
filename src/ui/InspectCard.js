/**
 * InspectCard — Floating empathy and telemetry modal for conscious creatures.
 *
 * Displays live thoughts, neural drives, morphological lineage,
 * and legendary mutations.
 */
export class InspectCard {
  constructor() {
    this._container = typeof document !== 'undefined' ? document.getElementById('inspect-card') : null;
    this._currentCreature = null;
    this._isOpen = false;
    this._lastUpdate = 0;
    this._lastBadgesHtml = '';

    this._nameEl = this._container?.querySelector?.('.inspect-name') || null;
    this._badgeEl = this._container?.querySelector?.('.inspect-badge') || null;
    this._thoughtEl = this._container?.querySelector?.('.inspect-thought') || null;
    this._legendaryEl = this._container?.querySelector?.('.inspect-legendary') || null;

    this._meters = {};
    if (this._container?.querySelector) {
      const meterNames = ['vitality', 'calm', 'social', 'curiosity', 'vigor'];
      for (let i = 0; i < meterNames.length; i++) {
        const name = meterNames[i];
        this._meters[name] = {
          fill: this._container.querySelector(`.meter-${name} .meter-fill`),
          val: this._container.querySelector(`.meter-${name} .meter-val`),
          lastPct: -1,
        };
      }
    }

    this._bindEvents();
  }

  _bindEvents() {
    if (!this._container) return;
    this._container.addEventListener?.('pointerdown', (e) => e.stopPropagation());
    const closeBtn = this._container.querySelector?.('.inspect-close');
    if (closeBtn) {
      closeBtn.addEventListener?.('click', (e) => {
        e.stopPropagation();
        this.close();
      });
    }
  }

  /**
   * Set target creature to inspect.
   * @param {import('../entities/Creature.js').Creature|null} creature
   */
  inspect(creature) {
    if (!creature || !creature.isAlive) {
      this.close();
      return;
    }

    this._currentCreature = creature;
    this._isOpen = true;
    this._lastBadgesHtml = '';
    this._resetMeterCaches();

    if (this._container) {
      this._container.classList.add('visible');
    }
    this.update(true);
  }

  close() {
    this._currentCreature = null;
    this._isOpen = false;
    this._lastBadgesHtml = '';
    this._resetMeterCaches();

    if (this._container) {
      this._container.classList.remove('visible');
    }
  }

  _resetMeterCaches() {
    for (const key in this._meters) {
      this._meters[key].lastPct = -1;
    }
  }

  get isOpen() {
    return this._isOpen;
  }

  get inspectedCreature() {
    return this._currentCreature;
  }

  static _ROMAN_GENS = Object.freeze(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']);

  /**
   * Update card UI with live telemetry of inspected creature.
   * @param {boolean} [force=false]
   */
  update(force = false) {
    if (!this._isOpen || !this._currentCreature || !this._container) return;
    if (!this._currentCreature.isAlive) {
      this.close();
      return;
    }

    const now = performance.now();
    if (!force && now - this._lastUpdate < 80) return; // throttle DOM updates to ~12fps
    this._lastUpdate = now;

    const c = this._currentCreature;
    const romanGen = InspectCard._ROMAN_GENS[Math.min(9, (c.generation || 1) - 1)] || c.generation;

    // Header info (cached DOM references)
    if (this._nameEl) this._nameEl.textContent = c.name;
    if (this._badgeEl) {
      const zoneName = c.originZone === 'light' ? 'Luz' : 'Sombra';
      this._badgeEl.textContent = `${c.bodyPlanLabel} • Geração ${romanGen} (${zoneName})`;
    }

    if (this._thoughtEl) {
      this._thoughtEl.textContent = `« ${c.getStatusText()} »`;
    }

    // Legendary & Chimera indicators
    if (this._legendaryEl) {
      let badgesStr = '';
      if (c.legendaryName) {
        badgesStr += `<span class="tag-legendary">🌟 ${c.legendaryName}</span>`;
      }
      if (c.isChimera) {
        if (badgesStr) badgesStr += ' ';
        badgesStr += `<span class="tag-chimera">☯️ Quimera Simbiótica</span>`;
      }

      if (badgesStr !== this._lastBadgesHtml) {
        this._lastBadgesHtml = badgesStr;
        if (badgesStr) {
          this._legendaryEl.innerHTML = badgesStr;
          this._legendaryEl.style.display = 'block';
        } else {
          this._legendaryEl.style.display = 'none';
        }
      }
    }

    // Drive Progress Bars (diffed)
    this._setMeter('vitality', c.energy);
    this._setMeter('calm', 1.0 - c.fear);
    this._setMeter('social', c.sociability);
    this._setMeter('curiosity', c.curiosity);
    this._setMeter('vigor', 1.0 - c.fatigue);
  }

  _setMeter(name, value) {
    const m = this._meters[name];
    if (!m) return;
    const clamped = Math.max(0, Math.min(1, value));
    const pct = Math.round(clamped * 100);
    if (pct === m.lastPct) return;
    m.lastPct = pct;

    if (m.fill) m.fill.style.width = `${pct}%`;
    if (m.val) m.val.textContent = `${pct}%`;
  }
}
