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
            map.addTilesetImage('Road_01_Tile_04', 'Road_01_Tile_04'),
            map.addTilesetImage('Soil_Tile', 'Soil_Tile'),
            map.addTilesetImage('Road_01_Tile_01', 'Road_01_Tile_01'),
            map.addTilesetImage('Road_01_Tile_02', 'Road_01_Tile_02'),
            map.addTilesetImage('Start', 'Start'),
        ];

        // Cria todas as camadas do mapa, na ordem em que existem no Tiled
        const layers = map.layers.map((layerData) =>
            map.createLayer(layerData.name, tilesets, 0, 0)
        );

        // O "pista.json" é um mapa infinito do Tiled: os tiles não começam
        // em (0,0), tem trecho em coordenadas negativas. Por isso calculamos
        // os limites reais do que foi desenhado, em vez de usar o tamanho
        // nominal do mapa (que não corresponde à pista de verdade).
        const bounds = layers.reduce((acc, layer) => {
            const layerBounds = layer.getBounds();
            return acc ? Phaser.Geom.Rectangle.Union(acc, layerBounds) : layerBounds;
        }, null);

        this.physics.world.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
        this.cameras.main.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);

        // Spawn do carro1 no centro da área real da pista
        this.car = new Car(this, bounds.centerX, bounds.centerY, 'carro1');

        // Camada de objetos "colisao": cada retângulo desenhado no Tiled
        // vira uma parede física invisível que o carro não consegue atravessar.
        this.walls = this.physics.add.staticGroup();
        const collisionLayer = map.getObjectLayer('colisao');

        if (collisionLayer) {
            collisionLayer.objects.forEach((obj) => {
                const wall = this.add.rectangle(
                    obj.x + obj.width / 2,
                    obj.y + obj.height / 2,
                    obj.width,
                    obj.height
                );
                wall.setVisible(false);
                this.physics.add.existing(wall, true); // true = corpo estático
                this.walls.add(wall);
            });
        }

        this.physics.add.collider(this.car, this.walls);

        this.cameras.main.startFollow(this.car, true, 0.08, 0.08);
    }

    update(time, delta) {
        this.car.update(time, delta);
    }
}

export default Race;
