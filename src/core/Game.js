import { World } from '../world/World.js';
import { Renderer } from '../rendering/Renderer.js';

/**
 * Game — The main application controller.
 *
 * Responsibilities:
 *   - Own the RAF (requestAnimationFrame) loop.
 *   - Handle all raw input (mouse & touch) and translate to game actions.
 *   - Coordinate World updates and Renderer calls.
 *   - Handle window resize.
 *   - Bootstrap audio on first user gesture (browser policy).
 */
export class Game {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this._canvas   = canvas;
    this._renderer = new Renderer(canvas);

    const { width, height } = this._renderer.resize();
    this._world    = new World(width, height);
    // Give the world a reference to the renderer for echo registration
    this._world.setRenderer(this._renderer);

    this._rafId        = null;
    this._lastTime     = 0;
    this._running      = false;
    this._audioReady   = false;

    this._diaryOpen    = false;
    this._bestiaryOpen = false;

    /** @type {Array<{x:number, y:number, startTime:number}>} */
    this._ripples = [];

    /** @type {Map<number, {x:number, y:number}>} */
    this._activePointers = new Map();

    // Nectar hold & Harp glide tracking
    this._holdStartPos   = null;
    this._holdStartTime = 0;
    this._nectarSpawned  = false;
    this._lastPointerY   = null;

    this._bindInput();
    this._bindUI();
    this._bindSplash();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start() {
    this._world.init();
    this._running = true;
    this._rafId   = requestAnimationFrame(ts => this._loop(ts));
  }

  stop() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._world.audio.dispose();
  }

  // ── Game loop ─────────────────────────────────────────────────────────────

  _loop(timestamp) {
    if (!this._running) return;

    // Schedule next frame immediately so unexpected errors cannot halt the game loop
    this._rafId = requestAnimationFrame(ts => this._loop(ts));

    try {
      const dt = Math.min(timestamp - this._lastTime, 80); // cap at 80ms to avoid spiral of death
      this._lastTime = timestamp;

      // Collect continuous active touch points + recent disturbance ripples
      const activeTouches = Array.from(this._activePointers.values());
      const freshRipples  = this._ripples
        .filter(r => timestamp - r.startTime < 600)
        .map(r => ({ x: r.x, y: r.y }));
      const touchDisturbances = [...activeTouches, ...freshRipples];

      if (dt > 0) {
        this._world.update(timestamp, dt, touchDisturbances);
      }

      // Check hold-to-condense celestial nectar
      if (this._holdStartPos && !this._nectarSpawned) {
        const holdElapsed = timestamp - this._holdStartTime;
        if (holdElapsed > 180 && holdElapsed < 600) {
          this._world.particles.emitNectarSwirl(this._holdStartPos.x, this._holdStartPos.y);
        } else if (holdElapsed >= 600) {
          this._world.spawnNectar(this._holdStartPos.x, this._holdStartPos.y);
          this._nectarSpawned = true;
        }
      }

      // Prune expired ripples (duration: 1800ms)
      this._ripples = this._ripples.filter(r => timestamp - r.startTime < 1800);

      this._renderer.render({
        creatures:     this._world.creatures,
        threshold:     this._world.threshold,
        particles:     this._world.particles,
        ripples:       this._ripples,
        wind:          this._world.wind,
        activeNectar:  this._world.activeNectar,
        diurnalFactor: this._world.diurnalFactor,
        diurnalCycle:  this._world.diurnalCycle,
        now:           timestamp,
        dt,
      });
    } catch (err) {
      console.error('[Limiar] Loop execution error caught:', err);
    }
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  _bindInput() {
    const canvas = this._canvas;

    // Universal audio bootstrap on ANY initial user gesture anywhere on the screen
    const unlockAudio = () => {
      if (!this._audioReady) {
        this._world.audio.init();
        this._audioReady = true;
      }
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
    window.addEventListener('touchstart',  unlockAudio, { once: true, passive: true });
    window.addEventListener('keydown',     unlockAudio, { once: true, passive: true });

    canvas.addEventListener('pointerdown',   e => this._onPointerDown(e),  { passive: false });
    canvas.addEventListener('pointermove',   e => this._onPointerMove(e),  { passive: true  });
    canvas.addEventListener('pointerup',     e => this._onPointerUp(e),    { passive: true  });
    canvas.addEventListener('pointercancel', e => this._onPointerUp(e),    { passive: true  });

    // Prevent browser native touch gestures (scroll, zoom, long-press menu) on the canvas
    canvas.addEventListener('touchstart',  e => e.preventDefault(), { passive: false });
    canvas.addEventListener('touchmove',   e => e.preventDefault(), { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Window resize and mobile orientation change
    window.addEventListener('resize', () => this._onResize());
    window.addEventListener('orientationchange', () => {
      // Small timeout allows mobile browser to settle viewport dimensions after rotation
      setTimeout(() => this._onResize(), 150);
    });

    // Mobile app lifecycle: pause/resume audio & reset clock when switching tabs or locking phone
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this._world.audio._ctx && this._world.audio._ctx.state === 'running') {
          this._world.audio._ctx.suspend().catch(() => {});
        }
      } else {
        this._lastTime = performance.now();
        if (this._audioReady && this._world.audio._ctx && this._world.audio._ctx.state === 'suspended') {
          this._world.audio._ctx.resume().catch(() => {});
        }
      }
    });
  }

  _onPointerDown(event) {
    event.preventDefault();

    // Bootstrap audio on first gesture (browser requires user interaction)
    if (!this._audioReady) {
      this._world.audio.init();
      this._audioReady = true;
    }

    const { x, y } = this._canvasPos(event);
    this._activePointers.set(event.pointerId, { x, y });

    // Start hold tracking for celestial nectar
    if (event.isPrimary) {
      this._holdStartPos   = { x, y };
      this._holdStartTime = performance.now();
      this._nectarSpawned  = false;
      this._lastPointerY   = y;
      this._ripples.push({ x, y, startTime: performance.now() });
    }

    // Secondary pointer (multi-touch) → bubble effect
    if (!event.isPrimary) {
      this._world.bubble(x, y);
      return;
    }

    // Try to drag threshold
    this._world.threshold.startDrag(y);
  }

  _onPointerMove(event) {
    const pos = this._canvasPos(event);
    if (this._activePointers.has(event.pointerId)) {
      this._activePointers.set(event.pointerId, pos);
    }

    if (!event.isPrimary) return;

    // Cancel hold if moved significantly
    if (this._holdStartPos) {
      const dist = Math.hypot(pos.x - this._holdStartPos.x, pos.y - this._holdStartPos.y);
      if (dist > 18) {
        this._holdStartPos = null;
      }
    }

    // Liquid harp: glide across or along threshold
    const ty = this._world.threshold.y;
    if (this._lastPointerY !== null && !this._world.threshold.isDragging) {
      const crossed = (this._lastPointerY < ty && pos.y >= ty) ||
                      (this._lastPointerY > ty && pos.y <= ty) ||
                      Math.abs(pos.y - ty) < 14;
      if (crossed) {
        this._world.pluckHarp(pos.x / this._renderer.width);
      }
    }
    this._lastPointerY = pos.y;

    this._world.threshold.moveDrag(pos.y);

    // Keep audio threshold mix in sync
    const ratio = this._world.threshold.y / this._renderer.height;
    this._world.audio.updateThresholdRatio(1 - ratio);
  }

  _onPointerUp(event) {
    this._activePointers.delete(event.pointerId);

    if (!event.isPrimary) return;
    const { x, y } = this._canvasPos(event);
    this._holdStartPos = null;
    this._lastPointerY = null;
    this._world.threshold.endDrag();
    // Tap on or near a creature = whisper
    this._world.whisper(x, y);
  }

  // ── Splash ────────────────────────────────────────────────────────────────

  _bindSplash() {
    const splash = document.getElementById('splash');
    if (!splash) return;

    const dismiss = () => {
      splash.classList.add('fade-out');
      // Bootstrap audio
      if (!this._audioReady) {
        this._world.audio.init();
        this._audioReady = true;
      }
    };

    splash.addEventListener('pointerdown', dismiss, { once: true });
    // Also auto-dismiss after 5s so the game is never blocked
    setTimeout(dismiss, 5000);
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  _bindUI() {
    document.getElementById('btn-diary')?.addEventListener('click', () => this._toggleOverlay('diary'));
    document.getElementById('btn-bestiary')?.addEventListener('click', () => this._toggleOverlay('bestiary'));
    document.getElementById('diary-close')?.addEventListener('click', () => this._closeOverlay('diary'));
    document.getElementById('bestiary-close')?.addEventListener('click', () => this._closeOverlay('bestiary'));

    // Close overlays when tapping the backdrop
    ['diary', 'bestiary'].forEach(id => {
      document.getElementById(id)?.addEventListener('pointerdown', e => {
        if (e.target.id === id) this._closeOverlay(id);
      });
    });
  }

  _toggleOverlay(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('hidden');
  }

  _closeOverlay(id) {
    document.getElementById(id)?.classList.add('hidden');
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  _onResize() {
    const { width, height } = this._renderer.resize();
    this._world.onResize(width, height);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Convert a PointerEvent to CSS-pixel canvas coordinates. */
  _canvasPos(event) {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left),
      y: (event.clientY - rect.top),
    };
  }
}
