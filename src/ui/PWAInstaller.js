/**
 * LIMIAR — PWAInstaller
 * Gerencia a instalação do ecossistema no celular (Android, iOS, Desktop PWA),
 * captura imediata do prompt de instalação automática e guia detalhado com abas OS.
 */

export class PWAInstaller {
  constructor() {
    this._deferredPrompt = window.__pwaPrompt || null;
    this._banner = document.getElementById('pwa-install-banner');
    this._btnBannerInstall = document.getElementById('btn-pwa-install');
    this._btnBannerDismiss = document.getElementById('btn-pwa-dismiss');
    this._btnHudInstall = document.getElementById('btn-install');
    
    // Modal e abas de instruções
    this._guideModal = document.getElementById('ios-install-modal');
    this._guideModalClose = document.getElementById('ios-modal-close');
    this._tabAndroid = document.getElementById('tab-android');
    this._tabIos = document.getElementById('tab-ios');
    this._guideAndroid = document.getElementById('pwa-guide-android');
    this._guideIos = document.getElementById('pwa-guide-ios');

    this._init();
  }

  /** Inicializa ouvintes de eventos e integração PWA */
  _init() {
    // 1. Registro do Service Worker de fallback caso ainda não tenha sido registrado pelo head
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('[PWA] Service Worker:', err);
      });
    }

    // 2. Se já estiver em modo standalone (app instalado), esconde o banner
    if (this.isStandalone()) {
      this._btnHudInstall?.classList.add('installed');
      if (this._btnHudInstall) {
        this._btnHudInstall.title = 'LIMIAR já instalado';
      }
      return;
    }

    // 3. Captura o evento de instalação padrão do navegador
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this._deferredPrompt = e;
      window.__pwaPrompt = e;
      this._onInstallable();
    });

    // Evento customizado disparado caso o head tenha capturado antes
    window.addEventListener('limiar-installable', () => {
      if (window.__pwaPrompt) {
        this._deferredPrompt = window.__pwaPrompt;
        this._onInstallable();
      }
    });

    // 4. Detecta quando o app é efetivamente instalado
    window.addEventListener('appinstalled', () => {
      this._deferredPrompt = null;
      window.__pwaPrompt = null;
      this._hideBanner();
      if (this._btnHudInstall) {
        this._btnHudInstall.classList.add('installed');
        this._btnHudInstall.title = 'LIMIAR já instalado';
      }
      this._notify('LIMIAR instalado com sucesso na sua tela inicial! ✦');
    });

    // 5. Conecta cliques nos botões de instalação
    this._btnBannerInstall?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.promptInstall();
    });

    this._btnBannerDismiss?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._dismissBanner();
    });

    this._btnHudInstall?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.promptInstall();
    });

    // 6. Controle do Modal e Abas (Android / iOS)
    this._guideModalClose?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._closeGuideModal();
    });

    this._guideModal?.addEventListener('pointerdown', (e) => {
      if (e.target === this._guideModal) {
        this._closeGuideModal();
      }
    });

    this._tabAndroid?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._switchTab('android');
    });

    this._tabIos?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._switchTab('ios');
    });

    // 7. Decide se exibe banner suave após alguns segundos
    this._checkBannerEligibility();
  }

  /** Verifica se o app já está rodando como PWA autônomo (standalone) */
  isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://')
    );
  }

  /** Detecta se o dispositivo é Android */
  isAndroid() {
    return /android/i.test(window.navigator.userAgent);
  }

  /** Detecta se o dispositivo é iOS (iPhone/iPad/iPod) */
  isIOS() {
    const ua = window.navigator.userAgent.toLowerCase();
    return (
      /iphone|ipad|ipod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }

  /** Disparado quando o navegador confirma que o app é instalável */
  _onInstallable() {
    this._btnHudInstall?.classList.remove('hidden');
    this._checkBannerEligibility();
  }

  /** Alterna entre abas Android e iOS no modal */
  _switchTab(os) {
    if (os === 'android') {
      this._tabAndroid?.classList.add('active');
      this._tabIos?.classList.remove('active');
      this._guideAndroid?.classList.remove('hidden');
      this._guideIos?.classList.add('hidden');
    } else {
      this._tabIos?.classList.add('active');
      this._tabAndroid?.classList.remove('active');
      this._guideIos?.classList.remove('hidden');
      this._guideAndroid?.classList.add('hidden');
    }
  }

  /** Verifica elegibilidade e exibe banner suavemente */
  _checkBannerEligibility() {
    if (this.isStandalone()) return;

    // Se usuário dispensou recentemente (últimos 3 dias), respeita a decisão
    try {
      const dismissed = localStorage.getItem('limiar_pwa_dismissed_at');
      if (dismissed) {
        const timePassed = Date.now() - parseInt(dismissed, 10);
        if (timePassed < 3 * 24 * 60 * 60 * 1000) {
          return;
        }
      }
    } catch (_) {}

    // Exibe após 3.5 segundos de contemplação inicial
    setTimeout(() => {
      if (!this.isStandalone()) {
        this._showBanner();
      }
    }, 3500);
  }

  /** Exibe o banner discreto no rodapé */
  _showBanner() {
    if (!this._banner) return;
    this._banner.classList.remove('hidden');
    requestAnimationFrame(() => {
      this._banner.classList.add('visible');
    });
  }

  /** Esconde o banner */
  _hideBanner() {
    if (!this._banner) return;
    this._banner.classList.remove('visible');
    setTimeout(() => {
      this._banner.classList.add('hidden');
    }, 300);
  }

  /** Usuário clicou no 'X' para fechar o banner */
  _dismissBanner() {
    this._hideBanner();
    try {
      localStorage.setItem('limiar_pwa_dismissed_at', Date.now().toString());
    } catch (_) {}
  }

  /**
   * Executa a ação de instalação:
   * Prioridade 1: Instalação automática nativa (1 clique via prompt do sistema)
   * Prioridade 2: Guia inteligente com a aba do sistema do usuário já ativa
   */
  async promptInstall() {
    if (this.isStandalone()) {
      this._notify('O LIMIAR já está instalado no seu dispositivo! ✦');
      return;
    }

    const prompt = this._deferredPrompt || window.__pwaPrompt;

    // Se temos o prompt nativo disponível (Chrome Android, Edge, Samsung Internet), dispara a instalação com 1 toque!
    if (prompt) {
      try {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') {
          this._hideBanner();
          this._notify('Instalando o LIMIAR na sua tela inicial... ✦');
        }
        this._deferredPrompt = null;
        window.__pwaPrompt = null;
        return;
      } catch (err) {
        console.warn('[PWA] Erro no prompt nativo:', err);
      }
    }

    // Caso não haja prompt automático disponível (iOS Safari, navegadores in-app ou Firefox):
    // Abre o modal orientativo já posicionado na aba correta (Android ou iOS)
    this._openGuideModal();
  }

  /** Abre o modal de guia posicionando automaticamente na aba correspondente ao dispositivo */
  _openGuideModal() {
    if (!this._guideModal) return;
    this._hideBanner();

    // Auto-seleciona a aba apropriada para o usuário
    if (this.isIOS()) {
      this._switchTab('ios');
    } else {
      this._switchTab('android'); // Default para Android / outros navegadores
    }

    this._guideModal.classList.remove('hidden');
    requestAnimationFrame(() => {
      this._guideModal.classList.add('visible');
    });
  }

  /** Fecha o modal de guia */
  _closeGuideModal() {
    if (!this._guideModal) return;
    this._guideModal.classList.remove('visible');
    setTimeout(() => {
      this._guideModal.classList.add('hidden');
    }, 300);
  }

  /** Pequena notificação temporária no topo */
  _notify(message) {
    const toast = document.createElement('div');
    toast.className = 'pwa-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 3200);
  }
}
