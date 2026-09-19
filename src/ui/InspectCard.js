/**
 * InspectCard — Floating empathy and telemetry modal for conscious creatures.
 *
 * Displays live thoughts, neural drives, morphological lineage,
 * and legendary mutations.
 */
export class InspectCard {
  constructor() {
    this._container = document.getElementById('inspect-card');
    this._currentCreature = null;
    this._isOpen = false;
    this._lastUpdate = 0;

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
    if (this._container) {
      this._container.classList.add('visible');
    }
    this.update(true);
  }

  close() {
    this._currentCreature = null;
    this._isOpen = false;
    if (this._container) {
      this._container.classList.remove('visible');
    }
  }

  get isOpen() {
    return this._isOpen;
  }

  get inspectedCreature() {
    return this._currentCreature;
  }

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
    const genRomans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    const romanGen = genRomans[Math.min(9, (c.generation || 1) - 1)] || c.generation;

    // Header info
    const nameEl = this._container.querySelector('.inspect-name');
    const badgeEl = this._container.querySelector('.inspect-badge');
    const thoughtEl = this._container.querySelector('.inspect-thought');
    const legendaryEl = this._container.querySelector('.inspect-legendary');

    if (nameEl) nameEl.textContent = c.name;
    if (badgeEl) {
      const zoneName = c.originZone === 'light' ? 'Luz' : 'Sombra';
      badgeEl.textContent = `${c.bodyPlanLabel} • Geração ${romanGen} (${zoneName})`;
    }

    if (thoughtEl) {
      thoughtEl.textContent = `« ${c.getStatusText()} »`;
    }

    // Legendary & Chimera indicators
    if (legendaryEl) {
      const badges = [];
      if (c.legendaryName) {
        badges.push(`<span class="tag-legendary">🌟 ${c.legendaryName}</span>`);
      }
      if (c.isChimera) {
        badges.push(`<span class="tag-chimera">☯️ Quimera Simbiótica</span>`);
      }
      if (badges.length > 0) {
        legendaryEl.innerHTML = badges.join(' ');
        legendaryEl.style.display = 'block';
      } else {
        legendaryEl.style.display = 'none';
      }
    }

    // Drive Progress Bars
    this._setMeter('vitality', c.energy);
    this._setMeter('calm', 1.0 - c.fear);
    this._setMeter('social', c.sociability);
    this._setMeter('curiosity', c.curiosity);
    this._setMeter('vigor', 1.0 - c.fatigue);
  }

  _setMeter(name, value) {
    const bar = this._container.querySelector(`.meter-${name} .meter-fill`);
    const valText = this._container.querySelector(`.meter-${name} .meter-val`);
    const clamped = Math.max(0, Math.min(1, value));
    const pct = Math.round(clamped * 100);
    if (bar) bar.style.width = `${pct}%`;
    if (valText) valText.textContent = `${pct}%`;
  }
}
