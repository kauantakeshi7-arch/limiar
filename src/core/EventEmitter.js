/**
 * EventEmitter — Minimal, typed pub/sub event bus.
 * Supports namespaced events, one-time listeners, and listener removal.
 */
export class EventEmitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} Unsubscribe function for convenient cleanup.
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Subscribe once — handler is automatically removed after first call.
   * @param {string} event
   * @param {Function} handler
   */
  once(event, handler) {
    const wrapper = (...args) => {
      handler(...args);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  /**
   * Unsubscribe a specific handler from an event.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
  }

  /**
   * Emit an event, invoking all subscribers with the given payload.
   * Zero heap allocations during dispatch.
   * @param {string} event
   * @param {...*} args
   */
  emit(event, ...args) {
    const handlers = this._listeners.get(event);
    if (!handlers || handlers.size === 0) return;
    handlers.forEach(handler => handler(...args));
  }

  /** Remove all listeners for a given event (or all events if omitted). */
  clear(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }

  /** Returns true if the event has at least one subscriber. */
  has(event) {
    return (this._listeners.get(event)?.size ?? 0) > 0;
  }
}

/** Shared global event bus for cross-system communication. */
export const globalBus = new EventEmitter();

/** Well-known event names used across systems. */
export const Events = Object.freeze({
  // Creature lifecycle
  CREATURE_SPAWNED:        'creature:spawned',
  CREATURE_DESTROYED:      'creature:destroyed',
  CREATURE_CROSSING:       'creature:crossing',
  CREATURE_TRANSFORMED:    'creature:transformed',
  CREATURE_TRANSCENDED:    'creature:transcended',
  CREATURE_DISSOLVED:      'creature:dissolved',
  CREATURE_HYBRID:         'creature:hybrid',

  // Interactions
  INTERACTION_ABSORBED:    'interaction:absorbed',
  INTERACTION_EXPLOSION:   'interaction:explosion',
  INTERACTION_SYMBIOSIS:   'interaction:symbiosis',
  CREATURE_DANCE:          'creature:dance',

  // Rare events
  RARE_ECLIPSE:            'rare:eclipse',
  RARE_ECLIPSE_END:        'rare:eclipse:end',
  RARE_SINGULARITY:        'rare:singularity',
  RARE_WITNESS:            'rare:witness',
  RARE_CHAIN:              'rare:chain',

  // World / Game
  THRESHOLD_MOVED:         'threshold:moved',
  WHISPER:                 'player:whisper',
  BUBBLE:                  'player:bubble',
  NECTAR_SPAWNED:          'player:nectar',

  // Consciousness & AI
  CREATURE_INQUISITIVE:    'creature:inquisitive',
  CREATURE_CAUTIOUS:       'creature:cautious',
  CREATURE_FORAGING:       'creature:foraging',
  CREATURE_YEARNING:       'creature:yearning',
  CREATURE_BORN:           'creature:born',
  CREATURE_LEGENDARY:      'creature:legendary',

  // Expanded Interactivity
  FLORA_SPORES:            'flora:spores',
  PLAYER_CALL:             'player:call',
});
