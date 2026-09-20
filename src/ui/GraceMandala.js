import { Config } from '../core/Config.js';

/**
 * GraceMandala — UI controller for the Celestial Grace & Blessings Mandala.
 * Renders the contemplative blessings panel, tracks point balance in real-time,
 * provides one-tap channeling of active and passive blessings, and shows subtle
 * toast notifications when cosmic grace is earned.
 */
export class GraceMandala {
  /**
   * @param {import('../world/World.js').World} world
   */
  constructor(world) {
    this._world = world;
    this._overlay = document.getElementById('grace-mandala');
    this._pointsEl = document.getElementById('grace-points');
    this._cardsContainer = document.getElementById('grace-blessings');
    this._toastEl = document.getElementById('grace-toast');
    this._toastTimer = null;

    this._bindEvents();
    this._renderCards();

    // Subscribe to Grace accrual notifications
    if (this._world.grace) {
      this._world.grace.onEarned((earned, total, reason) => {
        this.updateDisplay();
        if (earned > 0 && reason) {
          this.showToast(`+${earned} Graça ✨ (${reason})`);
        }
      });
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Open the Grace Mandala overlay and refresh cards state. */
  open() {
    this.updateDisplay();
    if (this._overlay) {
      this._overlay.classList.remove('hidden');
    }
  }

  /** Close the Grace Mandala overlay. */
  close() {
    if (this._overlay) {
      this._overlay.classList.add('hidden');
    }
  }

  /** Toggle overlay open/close. */
  toggle() {
    if (this._overlay?.classList.contains('hidden')) {
      this.open();
    } else {
      this.close();
    }
  }

  /** Update displayed point balance and button enablement states. */
  updateDisplay() {
    const points = this._world.grace?.points || 0;
    if (this._pointsEl) {
      this._pointsEl.textContent = String(points);
    }
    this._updateButtonsState();
  }

  /** Show a delicate, non-intrusive floating toast in the upper realm. */
  showToast(message) {
    if (!this._toastEl) return;
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
    }
    this._toastEl.textContent = message;
    this._toastEl.classList.remove('hidden');
    this._toastEl.classList.add('visible');

    this._toastTimer = setTimeout(() => {
      this._toastEl?.classList.remove('visible');
      setTimeout(() => {
        this._toastEl?.classList.add('hidden');
      }, 400);
      this._toastTimer = null;
    }, 2800);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _bindEvents() {
    const closeBtn = document.getElementById('grace-close');
    closeBtn?.addEventListener?.('click', () => this.close());
  }

  _renderCards() {
    if (!this._cardsContainer) return;
    const blessings = Config.GRACE?.BLESSINGS;
    if (!blessings) return;

    this._cardsContainer.innerHTML = '';
    const blessingList = Object.values(blessings);

    for (const b of blessingList) {
      const card = document.createElement('div');
      card.className = 'blessing-card';
      card.dataset.id = b.id;

      card.innerHTML = `
        <div class="blessing-header">
          <div class="blessing-icon">${b.icon}</div>
          <div class="blessing-title-wrap">
            <h3 class="blessing-name">${b.name}</h3>
            <span class="blessing-cost">💎 ${b.cost} Graça</span>
          </div>
        </div>
        <p class="blessing-desc">${b.description}</p>
        <button class="blessing-cast-btn" data-action="cast" data-id="${b.id}">
          Conjurar
        </button>
      `;

      const castBtn = card.querySelector?.('.blessing-cast-btn');
      castBtn?.addEventListener?.('click', (e) => {
        e.stopPropagation();
        this._handleCast(b.id);
      });

      this._cardsContainer.appendChild(card);
    }

    this._updateButtonsState();
  }

  _handleCast(blessingId) {
    if (!this._world.grace) return;
    if (!this._world.grace.canCast(blessingId)) return;

    const success = this._world.grace.cast(blessingId);
    if (success) {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate([12, 35, 12]); } catch (_) {}
      }
      this.updateDisplay();
    }
  }

  _updateButtonsState() {
    if (!this._cardsContainer || !this._world.grace) return;
    const currentPoints = this._world.grace.points;
    const cards = this._cardsContainer.querySelectorAll('.blessing-card');

    for (const card of cards) {
      const blessingId = card.dataset.id;
      const blessing = this._world.grace._getBlessingConfig?.(blessingId);
      if (!blessing) continue;

      const btn = card.querySelector('.blessing-cast-btn');
      if (!btn) continue;

      // Check if active buff
      let isActiveBuff = false;
      let remainingSec = 0;
      if (blessing.id === 'crystal_breath' && this._world.grace.hasCrystalBreath) {
        isActiveBuff = true;
        remainingSec = this._world.grace.crystalBreathRemainingSec;
      } else if (blessing.id === 'stellar_veil' && this._world.grace.hasStellarVeil) {
        isActiveBuff = true;
        remainingSec = this._world.grace.stellarVeilRemainingSec;
      }

      if (isActiveBuff) {
        btn.textContent = `Ativo (${remainingSec}s)`;
        btn.disabled = true;
        btn.classList.add('active-buff');
        btn.classList.remove('disabled');
      } else if (currentPoints >= blessing.cost) {
        btn.textContent = 'Conjurar';
        btn.disabled = false;
        btn.classList.remove('active-buff', 'disabled');
      } else {
        btn.textContent = `Faltam ${blessing.cost - currentPoints}`;
        btn.disabled = true;
        btn.classList.add('disabled');
        btn.classList.remove('active-buff');
      }
    }
  }
}
