class Preloader extends Phaser.Scene {
    constructor() { super('Preloader'); }

    preload() {
        const { width, height } = this.scale;
        this.cameras.main.setBackgroundColor('#111319');
        this.add.rectangle(width/2, height/2, 320, 24).setStrokeStyle(1, 0xffffff);
        const bar = this.add.rectangle(width/2-158, height/2, 4, 18, 0x00e5ff).setOrigin(0,0.5);
        this.load.on('progress', p => bar.width = 4 + 312*p);

        const v = `?v=${Date.now()}`;
        // Tilesets EXATAMENTE iguais aos do pista.json novo.
        this.load.image('pista', 'assets/images/tiles/tiles novos/pista.png'+v);
        this.load.image('predios', 'assets/images/tiles/tiles novos/predios.png'+v);
        this.load.image('chao', 'assets/images/tiles/tiles novos/chao.png'+v);
        this.load.image('favela', 'assets/images/tiles/tiles novos/favela.png'+v);
        this.load.image('placas', 'assets/images/tiles/tiles novos/placas.png'+v);
        this.load.image('calcada', 'assets/images/tiles/tiles novos/calcada.png'+v);
        this.load.image('objetos', 'assets/images/tiles/tiles novos/objetos.png'+v);
        this.load.image('carro', 'assets/images/tiles/tiles novos/carro.png'+v);
        this.load.tilemapTiledJSON('pista', 'assets/images/tilemaps/pista.json'+v);
        this.load.image('chegada', 'assets/images/tiles/tiles novos/chegada.png'+v);
        this.load.audio('countdown', 'assets/images/audio/countdown.mp3'+v);
    }

    create() { this.scene.start('Race'); }
}
export default Preloader;
