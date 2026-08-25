class Preloader extends Phaser.Scene {
    constructor() {
        super('Preloader');
    }

    preload() {
        const { width, height } = this.scale;

        this.cameras.main.setBackgroundColor('#111319');

        this.add.rectangle(width / 2, height / 2, 320, 24).setStrokeStyle(1, 0xffffff);
        const bar = this.add
            .rectangle(width / 2 - 158, height / 2, 4, 18, 0x00e5ff)
            .setOrigin(0, 0.5);

        this.load.on('progress', (progress) => {
            bar.width = 4 + 312 * progress;
        });

        // Tilesets usados no mapa "pista.json" (chaves iguais aos nomes dos
        // tilesets dentro do JSON exportado do Tiled, pra bater com addTilesetImage)
        this.load.image('Grass_Tile', 'assets/images/tiles/Grass_Tile.png');
        this.load.image('Road_01_Tile_05', 'assets/images/tiles/Road_01_Tile_05.png');
        this.load.image('Start', 'assets/images/tiles/Start.png');
        this.load.image('Road_01_Tile_04', 'assets/images/tiles/Road_01_Tile_04.png');
        this.load.image('Road_01_Tile_02', 'assets/images/tiles/Road_01_Tile_02.png');

        // Carro do jogador
        this.load.image('carro1', 'assets/images/tiles/carro1.png');

        // Mapa exportado do Tiled
        this.load.tilemapTiledJSON('pista', 'assets/images/tilemaps/pista.json');
    }

    create() {
        this.scene.start('Race');
    }
}

export default Preloader;
