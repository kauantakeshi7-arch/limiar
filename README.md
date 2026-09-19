# LIMIAR 🌗

> *"Entre existir e desvanecer."*

**LIMIAR** é um ecossistema artificial contemplativo construído em JavaScript moderno e Canvas 2D nativo. O jogo explora a convivência, tensão e transcendência entre dois mundos separados por uma membrana viva: o Reino da Luz e o Abismo das Sombras.

---

## ✨ Características do Mundo

- **Dois Reinos Antagônicos e Complementares:**
  - ☀️ **Zona da Luz:** Habitada por seres dourados celestiais, alimentados por fótons e raios solares.
  - 🔮 **Zona das Sombras:** Habitada por seres ametistas de brilho bioluminescente cósmico, imersos em um manto estelar.
- **A Membrana Viva (Limiar):**
  - Uma linha com física de molas que oscila, deforma e vibra.
  - **Flora Bioluminescente:** Juncos e corais botânicos ancorados na membrana que oscilam ao vento e liberam esporos etéreos quando criaturas nadam por perto.
  - **Harpa Líquida:** Arraste o dedo pela membrana para dedilhar notas harmônicas pentatônicas.
- **Maré Circadiana (Dia & Noite Contemplativos):**
  - Ciclo de 100 segundos oscilando suavemente entre Alvorada, Zênite Solar, Crepúsculo e Nadir Abissal, transacionando céus e atmosferas organicamente.
- **Ciclos Biológicos Vivos:**
  - **Sono & Sonhos:** Criaturas pacíficas entram em dormência suave, emitindo orbes de sonhos flutuantes.
  - **Dança dos Opostos (Courtship):** Quando criaturas de luz e sombra se encontram em harmonia na fronteira, iniciam uma dança orbital espiralada entrelaçada com fitas de luz.
  - **Transcendência & Simbiose:** Criaturas que cruzam a membrana e sobrevivem tornam-se seres híbridos ou transcendentes luminescentes.
  - **Néctar Celeste:** Toque e segure por 600ms para condensar uma gota nutritiva de néctar cósmico que atrai e revigora os seres vivos.
- **Paisagem Sonora Generativa:**
  - Síntese pura em tempo real via **Web Audio API** (sem arquivos de áudio gravados), modulada pela respiração do ecossistema e movimento do limiar.

---

## 📱 Otimização Mobile de Primeira Classe

- **PWA Instalável:** Suporte completo a Progressive Web App com `manifest.json` e execução em tela cheia (`display: standalone`).
- **Suporte a Notch & Dynamic Island:** Adaptação completa a `viewport-fit=cover` e `safe-area-insets` em iPhones e Androids modernos.
- **Performance & Bateria:** Clamping dinâmico de DPR (Device Pixel Ratio) a 2.0x, garantindo nitidez Retina sem superaquecimento de GPU em telas 3x/4x.
- **Ergonomia Tátil:** Hitboxes ampliadas (68px) para arraste suave com os dedos, prevenção de zoom acidental, menus nativos desabilitados e modais responsivos em formato *Bottom Sheet*.
- **Desbloqueio de Áudio Universal:** Inicialização instantânea do motor de som no primeiro toque e suspensão automática na troca de abas (`visibilitychange`).

---

## 🎮 Controles

| Ação | Como Executar |
|---|---|
| **Mover o Limiar** | Arraste a linha divisória verticalmente com o dedo ou mouse |
| **Dedilhar a Harpa** | Deslize horizontalmente ao longo da membrana |
| **Sussurrar (Whisper)** | Toque em uma criatura para impulsioná-la suavemente |
| **Onda de Perturbação** | Toque no fundo para criar ondulações na água cósmica |
| **Condensar Néctar** | Pressione e segure o dedo/mouse por 0.6s em qualquer ponto |
| **Bolha Cósmica** | Toque com dois dedos simultâneos |
| **Diário & Bestiário** | Botões 📖 e 🦋 no canto inferior direito |

---

## 🛠️ Tecnologias

- **Linguagem:** JavaScript Moderno (ES Modules nativos)
- **Renderização:** HTML5 Canvas 2D de alta performance (sem dependências externas)
- **Áudio:** Web Audio API (síntese analógica procedural com convolução e filtros biquad)
- **Estilos:** CSS3 Moderno (Custom Properties, Backdrop Filter, Safe Areas, Flexbox & CSS Grid)
- **Arquitetura:** Zero-dependency, Zero-bundler, 60+ FPS constante

---

## 🚀 Executando Localmente

Clone o repositório e execute qualquer servidor estático ou o servidor Node nativo incluso:

```bash
# Iniciar com o servidor embutido:
npm start

# Ou com qualquer servidor estático:
npx serve .
```

Acesse em seu navegador ou celular em `http://localhost:3000`.

---

## 📄 Licença

Distribuído sob a licença MIT. Criado com contemplação e código artesanal.
