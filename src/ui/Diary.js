import { Config } from '../core/Config.js';

/**
 * Diary — A rolling log of significant world events.
 * Displayed in the in-game journal overlay.
 */
export class Diary {
  constructor() {
    /** @type {{ timestamp: Date, text: string }[]} */
    this._entries = [];
    this._element = document.getElementById('diary-entries');
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
    this._renderLatest(entry);
  }

  /** All diary entries (newest first). */
  get entries() { return [...this._entries]; }

  // ── Private ───────────────────────────────────────────────────────────────

  _renderLatest(entry) {
    if (!this._element) return;
    const el = document.createElement('div');
    el.className = 'diary-entry new';
    el.innerHTML = `
      <span class="diary-time">${this._formatTime(entry.timestamp)}</span>
      <span class="diary-text">${entry.text}</span>
    `;
    this._element.insertBefore(el, this._element.firstChild);

    // Remove "new" animation class after it plays
    requestAnimationFrame(() => {
      setTimeout(() => el.classList.remove('new'), 600);
    });

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
