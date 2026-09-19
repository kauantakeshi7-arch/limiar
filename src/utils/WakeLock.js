/**
 * WakeLock — Gerenciador de vigília da tela para observação e contemplação contínua.
 *
 * Impede que o celular ou tablet escureça e desligue a tela durante a experiência
 * meditativa de LIMIAR (Screensaver / Terrário Digital Contemplativo).
 *
 * Utiliza a API padrão W3C Screen Wake Lock (suportada no Android Chrome, iOS Safari 16.4+,
 * Edge e Samsung Internet) com readmissão automática ao retornar à aba/app, além de
 * fallback gracioso para navegadores mais antigos.
 */

export class WakeLock {
  constructor() {
    /** @type {WakeLockSentinel|null} */
    this._sentinel = null;
    this._enabled = true; // Habilitado por padrão para contemplação imediata
    this._fallbackVideo = null;
    this._listeners = new Set();
    this._supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

    this._bindVisibility();
  }

  get isSupported() {
    return this._supported;
  }

  get isActive() {
    return this._sentinel !== null && !this._sentinel.released;
  }

  get isEnabled() {
    return this._enabled;
  }

  /**
   * Registra ouvinte para alterações no estado de vigília da tela.
   * @param {Function} fn
   * @returns {Function} Função para desinscrever o ouvinte.
   */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify() {
    const state = {
      active: this.isActive,
      enabled: this._enabled,
      supported: this._supported
    };
    for (const fn of this._listeners) {
      try {
        fn(state);
      } catch (err) {
        console.error('[WakeLock] Erro no ouvinte:', err);
      }
    }
  }

  /**
   * Solicita o bloqueio de desligamento da tela (Wake Lock).
   * @returns {Promise<boolean>}
   */
  async request() {
    if (!this._enabled) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;

    // 1. API nativa W3C Screen Wake Lock
    if (this._supported) {
      try {
        if (this.isActive) return true;

        this._sentinel = await navigator.wakeLock.request('screen');
        this._sentinel.addEventListener('release', () => {
          this._sentinel = null;
          this._notify();
        });
        this._notify();
        return true;
      } catch (err) {
        // Pode falhar temporariamente se bateria estiver criticamente baixa ou sem foco
        console.warn('[WakeLock] Solicitação nativa falhou:', err.message);
      }
    }

    // 2. Fallback gracioso para navegadores antigos (vídeo invisível mudo em loop)
    return this._requestFallback();
  }

  /**
   * Libera o bloqueio de tela, permitindo que o celular volte a suspender normalmente.
   * @returns {Promise<void>}
   */
  async release() {
    if (this._sentinel) {
      try {
        await this._sentinel.release();
      } catch {
        // ignora se já foi liberado pelo SO
      }
      this._sentinel = null;
    }
    this._releaseFallback();
    this._notify();
  }

  /**
   * Alterna entre modo vigília ligado e desligado.
   * @returns {Promise<boolean>} Novo estado habilitado
   */
  async toggle() {
    this._enabled = !this._enabled;
    if (this._enabled) {
      await this.request();
    } else {
      await this.release();
    }
    this._notify();
    return this._enabled;
  }

  _bindVisibility() {
    if (typeof document === 'undefined') return;

    document.addEventListener('visibilitychange', () => {
      // Quando o jogador retorna ao LIMIAR após alternar abas ou desbloquear
      if (document.visibilityState === 'visible' && this._enabled) {
        this.request();
      }
    });
  }

  _requestFallback() {
    if (typeof document === 'undefined') return false;
    try {
      if (!this._fallbackVideo) {
        const video = document.createElement('video');
        video.setAttribute('playsinline', '');
        video.setAttribute('muted', '');
        video.setAttribute('loop', '');
        video.muted = true;
        video.style.position = 'fixed';
        video.style.left = '-9999px';
        video.style.width = '1px';
        video.style.height = '1px';
        video.style.opacity = '0.01';
        video.style.pointerEvents = 'none';
        video.setAttribute('aria-hidden', 'true');
        // Loop de vídeo mudo ultraleve base64 de 1 quadro
        video.src = 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAAAhmcmVlAAAAEG1kYXQAAAEAAQAAAABp';
        document.body.appendChild(video);
        this._fallbackVideo = video;
      }
      this._fallbackVideo.play().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  _releaseFallback() {
    if (this._fallbackVideo) {
      try {
        this._fallbackVideo.pause();
      } catch {}
    }
  }
}
