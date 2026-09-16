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

        this.setupChromaticAberration(width, height);

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

    // Aberração cromática "fake": duas cópias da imagem, uma tingida de
    // vermelho outra de ciano, levemente deslocadas e em blend ADD.
    // Não depende de WebGL, então fica sempre ligado.
    setupChromaticAberration(width, height) {
        const offset = 2;

        this.chromaR = this.add.image(width / 2 - offset, height / 2, 'bgMenuInicial')
            .setDisplaySize(width, height)
            .setTint(0xff2d55)
            .setAlpha(0.12)
            .setBlendMode(Phaser.BlendModes.ADD);

        this.chromaB = this.add.image(width / 2 + offset, height / 2, 'bgMenuInicial')
            .setDisplaySize(width, height)
            .setTint(0x00e5ff)
            .setAlpha(0.12)
            .setBlendMode(Phaser.BlendModes.ADD);

        // Deslocamento oscila bem devagar, então a aberração "respira" em
        // vez de ficar num valor fixo o tempo todo.
        this.tweens.add({
            targets: this.chromaR,
            x: width / 2 - offset * 2.2,
            duration: 1800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });
        this.tweens.add({
            targets: this.chromaB,
            x: width / 2 + offset * 2.2,
            duration: 1800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });
    }

    // Pós-processamento leve pra dar aquele ar cyberpunk instável.
    // Só roda em WebGL; em Canvas simplesmente não faz nada.
    setupGlitchFX() {
        if (!this.renderer || !this.renderer.gl) return;

        const cam = this.cameras.main;
        const list = cam.filters.internal;
        this.fColor = list.addColorMatrix();
        this.fBlur = list.addBlur(1, 1, 0, 0, 0xffffff, 2);
        this.fVignette = list.addVignette(0.5, 0.5, 0.85, 0.35);
        this.fVignette.setColor(0x1a0022);
        this.fVignette.strength = 0.22;

        // Respiração lenta: brilho, matiz/saturação e um blur bem fraco andam
        // juntos, tudo puxado pelo mesmo contador — o "sinal" nunca fica
        // 100% parado, mas também nunca embaça a leitura do texto.
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
                this.fColor.colorMatrix.brightness(1 + 0.08 * v, true);
                this.fBlur.strength = 0.05 + 0.06 * v;
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
