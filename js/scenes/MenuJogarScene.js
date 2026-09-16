class MenuJogar extends Phaser.Scene {
    constructor() {
        super('MenuJogar');
    }

    preload() {
        this.load.image('bgMenuJogar', 'assets/images/ui/menujogar.png');
    }

    create() {
        const { width, height } = this.scale;

        this.add.image(width / 2, height / 2, 'bgMenuJogar')
            .setDisplaySize(width, height);

        // Botão JOGAR, embaixo do nome do jogo (que fica no topo esquerdo da imagem)
        const jogarBtn = this.add
            .text(width * 0.15, height * 0.28, 'JOGAR', {
                fontFamily: 'monospace',
                fontSize: '24px',
                color: '#ffffff',
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });

        jogarBtn.on('pointerover', () => {
            jogarBtn.setColor('#00e5ff');
            jogarBtn.setShadow(0, 0, '#00e5ff', 12, true, true);
        });
        jogarBtn.on('pointerout', () => {
            jogarBtn.setColor('#ffffff');
            jogarBtn.setShadow(0, 0, 'transparent', 0);
        });
        jogarBtn.on('pointerdown', () => {
            this.scene.start('Preloader');
        });
    }
}

export default MenuJogar;
