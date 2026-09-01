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

        // "cacheBust" evita que o navegador sirva uma versão antiga em cache
        // dos assets/tilemap depois de qualquer alteração nos arquivos.
        const cacheBust = `?v=${Date.now()}`;

        // Tilesets usados no mapa "pista.json" (chaves iguais aos "name" dos
        // tilesets dentro do JSON exportado do Tiled, pra bater com
        // addTilesetImage em RaceScene.js). O pista.json atual usa 4 camadas
        // de tile (Chão, Grama, Pista, Partida) que juntas dependem destes
        // tilesets:
        this.load.image('Soil_Tile', 'assets/images/tiles/Soil_Tile.png' + cacheBust); // Chão
        this.load.image('Grass_Tile', 'assets/images/tiles/Grass_Tile.png' + cacheBust); // Grama
        this.load.image('Road_01_Tile_02', 'assets/images/tiles/Road_01_Tile_02.png' + cacheBust); // Pista
        this.load.image('Road_01_Tile_03', 'assets/images/tiles/Road_01_Tile_03.png' + cacheBust); // Pista
        this.load.image('Road_01_Tile_04', 'assets/images/tiles/Road_01_Tile_04.png' + cacheBust); // Pista
        this.load.image('Road_01_Tile_06', 'assets/images/tiles/Road_01_Tile_06.png' + cacheBust); // Pista
        this.load.image('Road_01_Tile_07', 'assets/images/tiles/Road_01_Tile_07.png' + cacheBust); // Pista
        this.load.image('Start', 'assets/images/tiles/Start.png' + cacheBust); // Partida
        // "Road_Side_02" é usado por ~0,3% dos tiles da camada "Pista", mas o
        // arquivo de origem (Assets 2/PNG/.../Layers/Road_Side_02.png) não
        // está incluído neste projeto — só existe a imagem composta
        // Road_01_Tile_03.png. Usamos ela como substituta temporária pra não
        // quebrar o carregamento do mapa; adicione o PNG real em
        // assets/images/tiles/Road_Side_02.png e troque a linha abaixo
        // assim que ele estiver disponível.
        this.load.image('Road_Side_02', 'assets/images/tiles/Road_01_Tile_03.png' + cacheBust);

        // Carro do jogador
        this.load.image('carro1', 'assets/images/tiles/carro1.png' + cacheBust);

        // Mapa exportado do Tiled
        this.load.tilemapTiledJSON('pista', 'assets/images/tilemaps/pista.json' + cacheBust);
    }

    create() {
        this.scene.start('Race');
    }
}

export default Preloader;
