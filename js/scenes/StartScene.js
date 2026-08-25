class Start extends Phaser.Scene {
    constructor() {
        super('Start');
    }

    create() {
        const { width, height } = this.scale;

        this.cameras.main.setBackgroundColor('#111319');

        this.add
            .text(width / 2, height / 2 - 20, 'Cyberline Rivals', {
                fontFamily: 'monospace',
                fontSize: '32px',
                color: '#00e5ff',
            })
            .setOrigin(0.5);

        const startText = this.add
            .text(width / 2, height / 2 + 30, 'Clique para começar', {
                fontFamily: 'monospace',
                fontSize: '18px',
                color: '#ffffff',
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });

        startText.on('pointerdown', () => {
            this.scene.start('Preloader');
        });
    }

    update() {}
}

export default Start;
