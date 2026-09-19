/**
 * LIMIAR — PWAInstaller
 * Gerencia a instalação do ecossistema no celular (Android, iOS, Desktop PWA),
 * registro de Service Worker e guia para adição à tela inicial.
 */

export class PWAInstaller {
  constructor() {
    this._deferredPrompt = null;
    this._banner = document.getElementById('pwa-install-banner');
    this._btnBannerInstall = document.getElementById('btn-pwa-install');
    this._btnBannerDismiss = document.getElementById('btn-pwa-dismiss');
    this._btnHudInstall = document.getElementById('btn-install');
    this._iosModal = document.getElementById('ios-install-modal');
    this._iosModalClose = document.getElementById('ios-modal-close');

    this._init();
  }

  /** Inicializa ouvintes de eventos e Service Worker */
  _init() {
    // 1. Registro de Service Worker para suporte PWA e offline
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then((reg) => {
            // Service worker registrado
          })
          .catch((err) => {
            console.warn('[PWA] Falha ao registrar Service Worker:', err);
          });
      });
    }

    // Se já estiver em modo standalone (app instalado), esconde banners e ajusta botão
    if (this.isStandalone()) {
      this._btnHudInstall?.classList.add('installed');
      if (this._btnHudInstall) {
        this._btnHudInstall.title = 'LIMIAR já instalado';
      }
      return;
    }

    // 2. Captura o evento de instalação padrão do navegador (Android Chrome, Edge, Samsung Internet)
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this._deferredPrompt = e;
      this._onInstallable();
    });

    // 3. Detecta quando o app é efetivamente instalado
    window.addEventListener('appinstalled', () => {
      this._deferredPrompt = null;
      this._hideBanner();
      if (this._btnHudInstall) {
        this._btnHudInstall.classList.add('installed');
        this._btnHudInstall.title = 'LIMIAR já instalado';
      }
      this._notify('LIMIAR instalado com sucesso na sua tela inicial! ✦');
    });

    // 4. Conecta cliques nos botões de instalação
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

    // Fechar modal do iOS
    this._iosModalClose?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._closeIosModal();
    });

    this._iosModal?.addEventListener('pointerdown', (e) => {
      if (e.target === this._iosModal) {
        this._closeIosModal();
      }
    });

    // 5. No iOS ou após carregamento, decide se exibe banner para novos usuários
    this._checkBannerEligibility();
  }

  /** Verifica se o app já está rodando como PWA autônomo (standalone) */
  isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://')
    );
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

  /** Verifica elegibilidade e exibe banner suavemente após alguns segundos */
  _checkBannerEligibility() {
    if (this.isStandalone()) return;

    // Se usuário dispensou recentemente (últimos 3 dias), não incomoda
    try {
      const dismissed = localStorage.getItem('limiar_pwa_dismissed_at');
      if (dismissed) {
        const timePassed = Date.now() - parseInt(dismissed, 10);
        if (timePassed < 3 * 24 * 60 * 60 * 1000) {
          return;
        }
      }
    } catch (_) {}

    // Exibe após 4 segundos de contemplação para não sobrecarregar a entrada
    setTimeout(() => {
      if (!this.isStandalone()) {
        this._showBanner();
      }
    }, 4500);
  }

  /** Exibe o banner discreto no rodapé */
  _showBanner() {
    if (!this._banner) return;
    this._banner.classList.remove('hidden');
    // Adiciona classe de animação suave
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

  /** Executa a ação de instalação */
  async promptInstall() {
    // Caso 1: Já está em modo standalone
    if (this.isStandalone()) {
      this._notify('O LIMIAR já está instalado no seu dispositivo! ✦');
      return;
    }

    // Caso 2: Navegador suporta beforeinstallprompt nativo (Chrome Android, Edge, etc.)
    if (this._deferredPrompt) {
      const prompt = this._deferredPrompt;
      this._deferredPrompt = null;
      try {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') {
          this._hideBanner();
        }
      } catch (err) {
        console.warn('[PWA] Erro ao invocar prompt:', err);
      }
      return;
    }

    // Caso 3: iOS Safari (requer ação manual através de Compartilhar > Adicionar à Tela de Início)
    if (this.isIOS()) {
      this._openIosModal();
      return;
    }

    // Caso 4: Outros navegadores mobile ou desktop sem suporte a prompt programático direto
    this._openGenericGuideModal();
  }

  /** Abre modal instrutivo exclusivo para iPhone / iPad */
  _openIosModal() {
    if (!this._iosModal) return;
    this._hideBanner();
    this._iosModal.classList.remove('hidden');
    requestAnimationFrame(() => {
      this._iosModal.classList.add('visible');
    });
  }

  /** Fecha modal do iOS */
  _closeIosModal() {
    if (!this._iosModal) return;
    this._iosModal.classList.remove('visible');
    setTimeout(() => {
      this._iosModal.classList.add('hidden');
    }, 300);
  }

  /** Abre modal de orientação genérica para navegadores sem prompt automático */
  _openGenericGuideModal() {
    this._openIosModal(); // Compartilha o modal estilizado com instruções universais
  }

  /** Pequena notificação temporária no topo ou centro */
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
