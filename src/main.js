import { Game } from './core/Game.js';

/**
 * main.js — Application bootstrap.
 * Waits for the DOM to be ready, then starts the game.
 */

function bootstrap() {
  const canvas = document.getElementById('canvas');
  if (!canvas) {
    console.error('[LIMIAR] Canvas element not found.');
    return;
  }

  const game = new Game(canvas);
  game.start();

  // Expose for debugging in dev console
  if (import.meta.env?.DEV || window.location.hostname === 'localhost') {
    window.__limiar = game;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
