import Car from '../objects/Car.js';

class Race extends Phaser.Scene {
    constructor() {
        super('Race');
    }

    create() {
        const map = this.make.tilemap({ key: 'pista' });

        // Um tileset por imagem carregada no Preloader. A chave usada aqui
        // precisa bater com o "name" do tileset dentro do pista.json.
        const tilesets = [
            map.addTilesetImage('Grass_Tile', 'Grass_Tile'),
            map.addTilesetImage('Road_01_Tile_05', 'Road_01_Tile_05'),
            map.addTilesetImage('Start', 'Start'),
            map.addTilesetImage('Road_01_Tile_04', 'Road_01_Tile_04'),
            map.addTilesetImage('Road_01_Tile_02', 'Road_01_Tile_02'),
        ];

        // Cria todas as camadas do mapa, na ordem em que existem no Tiled
        map.layers.forEach((layerData) => {
            map.createLayer(layerData.name, tilesets, 0, 0);
        });

        const mapWidth = map.widthInPixels;
        const mapHeight = map.heightInPixels;

        this.physics.world.setBounds(0, 0, mapWidth, mapHeight);
        this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);

        // Spawn do carro1 no centro do mapa
        this.car = new Car(this, mapWidth / 2, mapHeight / 2, 'carro1');

        this.cameras.main.startFollow(this.car, true, 0.08, 0.08);
    }

    update(time, delta) {
        this.car.update(delta);
    }
}

export default Race;
