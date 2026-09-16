class MenuInicial extends Phaser.Scene {
    constructor() {
        super('MenuInicial');
    }

    preload() {
        this.load.image('bgMenuInicial', 'assets/images/ui/menuinicial.png');
    }

    create() {
        const { width, height } = this.scale;

        this.add.image(width / 2, height / 2, 'bgMenuInicial')
            .setDisplaySize(width, height);

        const startText = this.add
            .text(width / 2, height - 40, 'Aperte na tela para começar', {
                fontFamily: 'monospace',
                fontSize: '18px',
                color: '#ffffff',
            })
            .setOrigin(0.5);

        // Piscando: sem ease, sobe e desce em degrau, feito "sinal digital".
        this.tweens.add({
            targets: startText,
            alpha: 0.15,
            duration: 550,
            yoyo: true,
            repeat: -1,
        });

        this.setupGlitchFX();

        this.input.once('pointerdown', () => {
            this.scene.start('MenuJogar');
        });
    }

    // Pós-processamento leve pra dar aquele ar cyberpunk instável.
    // Só roda em WebGL; em Canvas simplesmente não faz nada.
    setupGlitchFX() {
        if (!this.renderer || !this.renderer.gl) return;

        const cam = this.cameras.main;
        const list = cam.filters.internal;
        this.fColor = list.addColorMatrix();
        this.fVignette = list.addVignette(0.5, 0.5, 0.85, 0.35);
        this.fVignette.setColor(0x1a0022);
        this.fVignette.strength = 0.22;

        // Respiração lenta de matiz/saturação — o "sinal" nunca fica 100% parado.
        this.tweens.addCounter({
            from: 0,
            to: 1,
            duration: 2600,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
            onUpdate: (tween) => {
                const v = tween.getValue();
                this.fColor.colorMatrix.saturate(0.3 * v, false);
                this.fColor.colorMatrix.hue(-8 * v, true);
            },
        });

        // De vez em quando, um "soluço" de sinal: tremor rápido + vinheta fecha um instante.
        this.time.addEvent({
            delay: Phaser.Math.Between(3500, 6000),
            loop: true,
            callback: () => this.glitchBlip(),
        });
    }

    glitchBlip() {
        this.cameras.main.shake(80, 0.004);
        this.fVignette.strength = 0.5;
        this.time.delayedCall(90, () => {
            this.fVignette.strength = 0.22;
        });
    }
}

export default MenuInicial;
