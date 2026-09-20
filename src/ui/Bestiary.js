import { Config } from '../core/Config.js';

/**
 * Bestiary — Tracks discovered creature forms and rare phenomena.
 * Drives the bestiary overlay UI.
 */
export class Bestiary {
  constructor() {
    /** @type {Map<string, BestiaryEntry>} */
    this._entries = new Map([
      ['light',       { label: 'Criatura da Luz',       discovered: false, icon: '○',  hint: 'Observe o mundo superior.' }],
      ['shadow',      { label: 'Criatura da Sombra',    discovered: false, icon: '●',  hint: 'Observe o mundo inferior.' }],
      ['crossing',    { label: 'Atravessando',           discovered: false, icon: '◑',  hint: 'Uma criatura cruzou o limiar.' }],
      ['transformed', { label: 'Transformada',          discovered: false, icon: '◆',  hint: 'A transformação foi completa.' }],
      ['hybrid',      { label: 'Híbrida',               discovered: false, icon: '✦',  hint: '?' }],
      ['transcendent',{ label: 'Transcendente',         discovered: false, icon: '✨', hint: '???' }],
      ['symbiosis',   { label: 'Simbiose',              discovered: false, icon: '∞',  hint: '???' }],
      ['eclipse',     { label: 'Eclipse',               discovered: false, icon: '🌑', hint: '???' }],
      ['witness',     { label: 'Testemunha',            discovered: false, icon: '👁️', hint: '???' }],
      ['chain',       { label: 'Cadeia',                discovered: false, icon: '🔗', hint: '???' }],
      // Morphological & Evolutionary discoveries
      ['manta',       { label: 'Pipa Cósmica',          discovered: false, icon: '🪁', hint: 'Uma linhagem alada plana pelos céus.' }],
      ['jellyfish',   { label: 'Medusa Abissal',        discovered: false, icon: '🪼', hint: 'Uma forma pulsante com tentáculos de luz.' }],
      ['serpentine',  { label: 'Serpente do Limiar',    discovered: false, icon: '🐉', hint: 'Um ser articulado multi-segmentado.' }],
      ['crystal',     { label: 'Radiolário Sagrado',    discovered: false, icon: '💎', hint: 'Uma geometria viva que refrata prismas.' }],
      ['phoenix',     { label: 'Fênix Astral',          discovered: false, icon: '🔥', hint: 'Uma ave cósmica de asas de plasma estelar.' }],
      ['nautilus',    { label: 'Nautilus Áureo',        discovered: false, icon: '🐚', hint: 'Uma concha de Fibonacci navegando no abismo.' }],
      ['lineage',     { label: 'Nova Geração',          discovered: false, icon: '🌱', hint: 'Um filhote nascido da Dança dos Opostos.' }],
      ['legendary',   { label: 'Despertar Mítico',      discovered: false, icon: '🌟', hint: 'Uma mutação lendária despertou na linhagem.' }],
      ['chimera',     { label: 'Quimera Simbiótica',    discovered: false, icon: '☯️', hint: 'Dois seres de anatomias distintas fundiram-se.' }],
    ]);

    this._element = typeof document !== 'undefined' ? document.getElementById('bestiary-entries') : null;
    this._loadFromStorage();
    this._renderAll();
  }

  /** Register a creature's base form and morphology as discovered. */
  registerCreature(creature) {
    const key = creature.originZone; // 'light' or 'shadow'
    this.unlock(key, creature);
    if (creature.bodyPlan && creature.bodyPlan !== 'blob') {
      this.unlock(creature.bodyPlan, creature);
    }
    if (creature.generation > 1) {
      this.unlock('lineage', creature);
    }
    if (creature.legendaryTrait) {
      this.unlock('legendary', creature);
    }
    if (creature.isChimera) {
      this.unlock('chimera', creature);
    }
  }

  /**
   * Unlock a bestiary entry.
   * @param {string} key
   * @param {*} [context] - Optional context (creature, etc.)
   */
  unlock(key, context) {
    const entry = this._entries.get(key);
    if (!entry || entry.discovered) return;

    entry.discovered = true;
    entry.context    = context;
    this._saveToStorage();
    this._renderEntry(key, entry, true);

    // Mark crossing when a creature transforms
    if (key === 'transformed' && !this._entries.get('crossing')?.discovered) {
      this.unlock('crossing', context);
    }
  }

  _loadFromStorage() {
    try {
      const saved = localStorage.getItem(Config.STORAGE?.BESTIARY_KEY || 'limiar_bestiary_v1');
      if (saved) {
        const discoveredKeys = JSON.parse(saved);
        if (Array.isArray(discoveredKeys)) {
          for (const key of discoveredKeys) {
            const entry = this._entries.get(key);
            if (entry) entry.discovered = true;
          }
        }
      }
    } catch (_) {}
  }

  _saveToStorage() {
    try {
      const discoveredKeys = [];
      for (const [key, entry] of this._entries) {
        if (entry.discovered) discoveredKeys.push(key);
      }
      localStorage.setItem(Config.STORAGE?.BESTIARY_KEY || 'limiar_bestiary_v1', JSON.stringify(discoveredKeys));
    } catch (_) {}
  }

  get discoveredCount() {
    let count = 0;
    for (const e of this._entries.values()) {
      if (e.discovered) count++;
    }
    return count;
  }

  get totalCount() { return this._entries.size; }

  // ── Private ───────────────────────────────────────────────────────────────

  _renderAll() {
    if (!this._element) return;
    this._element.innerHTML = '';
    for (const [key, entry] of this._entries) {
      this._renderEntry(key, entry, false);
    }
  }

  _renderEntry(key, entry, isNew) {
    if (!this._element) return;

    const existing = this._element.querySelector(`[data-key="${key}"]`);
    const el = existing || document.createElement('div');
    el.className   = `bestiary-entry ${entry.discovered ? 'discovered' : 'hidden'} ${isNew ? 'new' : ''}`;
    el.dataset.key = key;
    el.innerHTML   = entry.discovered
      ? `<span class="b-icon">${entry.icon}</span><span class="b-label">${entry.label}</span>`
      : `<span class="b-icon">?</span><span class="b-label b-unknown">${entry.hint}</span>`;

    if (!existing) this._element.appendChild(el);
    if (isNew) setTimeout(() => el?.classList?.remove?.('new'), 800);
  }
}
