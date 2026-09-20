import { Config } from '../core/Config.js';

/**
 * Diary — A rolling log of significant world events.
 * Displayed in the in-game journal overlay.
 */
export class Diary {
  constructor() {
    /** @type {{ timestamp: Date, text: string }[]} */
    this._entries = [];
    this._element = typeof document !== 'undefined' ? document.getElementById('diary-entries') : null;
    this._saveTimer = null;
    this._loadFromStorage();
  }

  /**
   * Record a new diary entry and update the UI.
   * @param {string} text
   */
  add(text) {
    const entry = {
      timestamp: new Date(),
      text,
    };
    this._entries.unshift(entry); // newest first
    if (this._entries.length > Config.DIARY.MAX_ENTRIES) {
      this._entries.pop();
    }
    this._renderLatest(entry, true);
    this._scheduleSave();
  }

  /** Flush any pending debounced save immediately. */
  flushSave() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._saveToStorage();
  }

  /** All diary entries (newest first). */
  get entries() { return [...this._entries]; }

  // ── Private ───────────────────────────────────────────────────────────────

  _loadFromStorage() {
    try {
      const saved = localStorage.getItem(Config.STORAGE?.DIARY_KEY || 'limiar_diary_v1');
      if (saved) {
        const raw = JSON.parse(saved);
        if (Array.isArray(raw)) {
          for (let i = raw.length - 1; i >= 0; i--) {
            const r = raw[i];
            const entry = { timestamp: new Date(r.timestamp), text: r.text };
            this._entries.unshift(entry);
            this._renderLatest(entry, false);
          }
        }
      }
    } catch (_) {}
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveToStorage();
    }, 600);
  }

  _saveToStorage() {
    try {
      const toSave = this._entries.slice(0, 20).map(e => ({
        timestamp: e.timestamp.toISOString(),
        text: e.text,
      }));
      localStorage.setItem(Config.STORAGE?.DIARY_KEY || 'limiar_diary_v1', JSON.stringify(toSave));
    } catch (_) {}
  }

  _renderLatest(entry, isNew = true) {
    if (!this._element) return;
    const el = document.createElement('div');
    el.className = `diary-entry ${isNew ? 'new' : ''}`;
    el.innerHTML = `
      <span class="diary-time">${this._formatTime(entry.timestamp)}</span>
      <span class="diary-text">${entry.text}</span>
    `;
    this._element.insertBefore(el, this._element.firstChild);

    if (isNew) {
      const schedule = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
      schedule(() => {
        setTimeout(() => el?.classList?.remove?.('new'), 600);
      });
    }

    // Trim to max in DOM as well
    while (this._element.children.length > Config.DIARY.MAX_ENTRIES) {
      this._element.removeChild(this._element.lastChild);
    }
  }

  _formatTime(date) {
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }
}
