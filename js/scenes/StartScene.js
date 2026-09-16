class Start extends Phaser.Scene {
    constructor() {
        super('Start');
    }

    create() {
        const { width, height } = this.scale;

        this.cameras.main.setBackgroundColor('#111319');

        const title = this.add
            .text(width / 2, height / 2 - 92, 'Cyberline Rivals', {
                fontFamily: 'monospace',
                fontSize: '32px',
                color: '#00e5ff',
            })
            .setOrigin(0.5);

        // O título respira devagar. Tela parada parece tela travada.
        this.tweens.add({
            targets: title,
            alpha: { from: 0.75, to: 1 },
            duration: 1400,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // O turbo agora tem regra (superaquece, some se bater) e ninguém
        // descobre regra por acidente. Vale a tela.
        const controls = [
            'SETAS          acelerar / frear / ré',
            'BAIXO + LADO   drift',
            'SHIFT + CIMA   TURBO',
            'M              liga/desliga o som',
        ];

        this.add
            .text(width / 2, height / 2 - 30, controls.join('\n'), {
                fontFamily: 'monospace',
                fontSize: '13px',
                color: '#8fa0c0',
                align: 'left',
                lineSpacing: 7,
            })
            .setOrigin(0.5, 0);

        this.add
            .text(width / 2, height / 2 + 62,
                'Segurar o turbo até o fim superaquece o motor.', {
                fontFamily: 'monospace',
                fontSize: '12px',
                color: '#ff7aa0',
            })
            .setOrigin(0.5);

        const startText = this.add
            .text(width / 2, height / 2 + 105, 'Clique para começar', {
                fontFamily: 'monospace',
                fontSize: '18px',
                color: '#ffffff',
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });

        startText.on('pointerover', () => startText.setColor('#00e5ff'));
        startText.on('pointerout', () => startText.setColor('#ffffff'));
        startText.on('pointerdown', () => {
            this.scene.start('Preloader');
        });
    }

    update() {}
}

export default Start;
