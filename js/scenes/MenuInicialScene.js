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

        this.add
            .text(width / 2, height - 40, 'Aperte na tela para começar', {
                fontFamily: 'monospace',
                fontSize: '18px',
                color: '#ffffff',
            })
            .setOrigin(0.5);

        this.input.once('pointerdown', () => {
            this.scene.start('MenuJogar');
        });
    }
}

export default MenuInicial;
