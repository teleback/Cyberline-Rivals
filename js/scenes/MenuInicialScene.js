import { loadMusic, playMusic } from '../fx/Music.js';
import { onAnyButton } from '../input/GamepadInput.js';

const CYAN = 0x00eaff;
const PINK = 0xff2bd6;

class MenuInicial extends Phaser.Scene {
  constructor() {
    super('MenuInicial');
  }

  preload() {
    loadMusic(this, 'lobby');
    this.load.image('menuCover', 'assets/images/ui/capa.png');
    this.load.image('menuLogo', encodeURI('assets/images/ui/Logo Neon Cyberline Rivals.png'));
    this.load.image('menuStart', 'assets/images/ui/toque.png');
  }

  create() {
    playMusic(this, 'lobby');
    this.leaving = false;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    this.logoGlow = null;
    const { width, height } = this.scale;
    const pad = Math.max(20, width * 0.04);
    this.cameras.main.setBackgroundColor('#060215');

    // Preenche a tela sem deformar a arte, deixando margem para o parallax.
    this.cover = this.add.image(width / 2, height / 2, 'menuCover');
    const coverScale = Math.max(width / this.cover.width, height / this.cover.height) * 1.035;
    this.cover.setScale(coverScale);
    this.createAtmosphere(width, height);

    // Frames removem só o espaço transparente; os PNGs originais são preservados.
    const logoTexture = this.textures.get('menuLogo');
    if (!logoTexture.has('menu-trim')) logoTexture.add('menu-trim', 0, 13, 80, 1938, 686);
    const startTexture = this.textures.get('menuStart');
    if (!startTexture.has('menu-trim')) startTexture.add('menu-trim', 0, 0, 276, 2170, 192);

    this.logoBaseY = height * 0.075;
    this.logoGroup = this.add.container(pad, this.logoBaseY);
    const logoWidth = Math.min(width * 0.54, height * 1.04);
    const logoHeight = logoWidth * 686 / 1938;
    this.logoCyan = this.add.image(1.5, 0, 'menuLogo', 'menu-trim')
      .setOrigin(0).setDisplaySize(logoWidth, logoHeight).setTint(CYAN)
      .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.14);
    this.logoPink = this.add.image(-1.5, 0, 'menuLogo', 'menu-trim')
      .setOrigin(0).setDisplaySize(logoWidth, logoHeight).setTint(PINK)
      .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.18);
    this.logo = this.add.image(0, 0, 'menuLogo', 'menu-trim')
      .setOrigin(0).setDisplaySize(logoWidth, logoHeight);
    this.logoGroup.add([this.logoPink, this.logoCyan, this.logo]);

    const signature = this.add.graphics();
    signature.lineStyle(1, CYAN, 0.5).lineBetween(pad + 8, this.logoBaseY + logoHeight + 14,
      pad + logoWidth * 0.68, this.logoBaseY + logoHeight + 14);
    signature.lineStyle(2, PINK, 0.85).lineBetween(pad + 8, this.logoBaseY + logoHeight + 14,
      pad + 40, this.logoBaseY + logoHeight + 14);
    this.add.text(pad + 8, this.logoBaseY + logoHeight + 24, 'A NOITE É SUA. ACELERE.', {
      fontFamily: 'monospace', fontSize: `${Math.max(9, Math.round(height * 0.023))}px`,
      color: '#a7bdda', letterSpacing: 2,
    });

    this.createStartPrompt(width, height);
    this.createNeonFrame(width, height);
    this.setupFilters();

    if (!this.reducedMotion) {
      this.tweens.add({
        targets: this.cover, scale: coverScale * 1.018,
        duration: 9000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }

    this.input.once('pointerdown', this.enterMenu, this);
    const keyboard = this.input.keyboard;
    keyboard.on('keydown-ENTER', this.enterMenu, this);
    keyboard.on('keydown-SPACE', this.enterMenu, this);
    this.events.once('shutdown', () => {
      keyboard.off('keydown-ENTER', this.enterMenu, this);
      keyboard.off('keydown-SPACE', this.enterMenu, this);
      this.input.off('pointerdown', this.enterMenu, this);
    });
    onAnyButton(this, () => this.enterMenu());
  }

  createAtmosphere(width, height) {
    if (!this.textures.exists('menu-neon-halo')) {
      const texture = this.textures.createCanvas('menu-neon-halo', 256, 256);
      const ctx = texture.getContext();
      const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, 'rgba(255,255,255,0.65)');
      gradient.addColorStop(0.3, 'rgba(255,255,255,0.24)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);
      texture.refresh();
    }
    this.add.image(width * 0.2, height * 0.19, 'menu-neon-halo')
      .setDisplaySize(width * 0.72, height * 0.95).setTint(CYAN)
      .setAlpha(0.13).setBlendMode(Phaser.BlendModes.ADD);
    this.add.image(width * 0.86, height * 0.69, 'menu-neon-halo')
      .setDisplaySize(width * 0.64, height * 1.1).setTint(PINK)
      .setAlpha(0.2).setBlendMode(Phaser.BlendModes.ADD);

    // Vinheta e scanlines também funcionam no renderizador Canvas.
    const shade = this.add.graphics();
    for (let i = 0; i < 24; i++) {
      const alpha = 0.019 * (1 - i / 24);
      shade.fillStyle(0x020015, alpha);
      shade.fillRect(0, i * height / 85, width, height / 85);
      shade.fillRect(0, height - (i + 1) * height / 100, width, height / 100);
    }
    const scanlines = this.add.graphics();
    scanlines.fillStyle(0x020016, 0.12);
    for (let y = 0; y < height; y += 4) scanlines.fillRect(0, y, width, 1);

    this.rain = this.add.graphics();
    this.rainStreaks = Array.from({ length: 26 }, (_, index) => ({
      x: Phaser.Math.FloatBetween(0, width), y: Phaser.Math.FloatBetween(0, height),
      length: Phaser.Math.FloatBetween(5, 16), speed: Phaser.Math.FloatBetween(26, 65),
      tint: index % 3 === 0 ? PINK : CYAN,
    }));
  }

  createStartPrompt(width, height) {
    const promptWidth = Math.min(width * 0.16, height * 0.31);
    this.startBaseY = height * 0.88;
    this.startGroup = this.add.container(width / 2, this.startBaseY).setDepth(20);
    this.startImage = this.add.image(0, 0, 'menuStart', 'menu-trim')
      .setDisplaySize(promptWidth, promptWidth * 192 / 2170)
      .setAlpha(0.61);
    this.startGroup.add(this.startImage);

    this.add.text(width / 2, this.startBaseY + 24, 'ENTER  /  ESPAÇO  /  CONTROLE', {
      fontFamily: 'monospace', fontSize: '9px', color: '#9ba8c4', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(20);
    this.add.zone(width / 2, this.startBaseY, promptWidth + 40, 56)
      .setInteractive({ useHandCursor: true });
  }

  createNeonFrame(width, height) {
    const edge = this.add.graphics();
    for (const [lineWidth, alpha] of [[8, 0.035], [4, 0.08], [1, 0.7]]) {
      edge.lineStyle(lineWidth, CYAN, alpha);
      edge.beginPath().moveTo(14, 64).lineTo(14, 14).lineTo(100, 14).strokePath();
      edge.lineStyle(lineWidth, PINK, alpha);
      edge.beginPath().moveTo(width - 100, height - 14).lineTo(width - 14, height - 14)
        .lineTo(width - 14, height - 64).strokePath();
    }
  }

  setupFilters() {
    if (!this.renderer.gl) return;
    this.cover.enableFilters();
    const color = this.cover.filters.internal.addColorMatrix();
    color.colorMatrix.saturate(0.18, false);
    color.colorMatrix.hue(-3, true);
    color.colorMatrix.brightness(1.04, true);
    this.logo.enableFilters();
    this.logoGlow = this.logo.filters.internal.addGlow(CYAN, 0.85, 0, 1, false, 4, 5);
  }

  enterMenu() {
    if (this.leaving) return;
    this.leaving = true;
    this.tweens.killTweensOf([this.cover, this.logoGroup, this.startGroup]);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('MenuJogar'));
    this.cameras.main.fadeOut(this.reducedMotion ? 100 : 260, 4, 0, 15);
  }

  update(time, delta) {
    if (this.leaving) return;
    const { width, height } = this.scale;
    const startPulse = this.reducedMotion ? 0.5 : (Math.sin(time / 1400) + 1) / 2;
    this.startImage.setAlpha(0.5 + startPulse * 0.22);
    if (this.reducedMotion) return;

    const pointer = this.input.activePointer;
    const targetX = width / 2 + (pointer.x / width - 0.5) * -5;
    const targetY = height / 2 + (pointer.y / height - 0.5) * -3;
    const factor = 1 - Math.exp(-Math.min(delta, 100) / 180);
    this.cover.x += (targetX - this.cover.x) * factor;
    this.cover.y += (targetY - this.cover.y) * factor;

    this.rain.clear();
    for (const drop of this.rainStreaks) {
      drop.y += drop.speed * Math.min(delta, 100) / 1000;
      if (drop.y > height + drop.length) drop.y = -drop.length;
      this.rain.lineStyle(1, drop.tint, 0.15);
      this.rain.lineBetween(drop.x, drop.y, drop.x - drop.length * 0.3, drop.y + drop.length);
    }
  }
}

export default MenuInicial;
