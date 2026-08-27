import Car from '../objects/Car.js';

class Race extends Phaser.Scene {
    constructor() {
        super('Race');
    }

    create() {
        const map = this.make.tilemap({ key: 'pista' });

        // Um tileset por imagem carregada no Preloader. A chave usada aqui
        // precisa bater com o "name" do tileset dentro do pista.json. Lista
        // atualizada pra cobrir os tilesets usados pelas 4 camadas de tile
        // do mapa atual (Chão, Grama, Pista, Partida) — sem isso, qualquer
        // camada que usasse um tileset não registrado aqui não era criada
        // corretamente.
        const tilesets = [
            map.addTilesetImage('Soil_Tile', 'Soil_Tile'),
            map.addTilesetImage('Grass_Tile', 'Grass_Tile'),
            map.addTilesetImage('Road_01_Tile_02', 'Road_01_Tile_02'),
            map.addTilesetImage('Road_01_Tile_03', 'Road_01_Tile_03'),
            map.addTilesetImage('Road_01_Tile_04', 'Road_01_Tile_04'),
            map.addTilesetImage('Road_01_Tile_06', 'Road_01_Tile_06'),
            map.addTilesetImage('Road_01_Tile_07', 'Road_01_Tile_07'),
            map.addTilesetImage('Road_Side_02', 'Road_Side_02'),
            map.addTilesetImage('Start', 'Start'),
        ];

        // Cria todas as camadas do mapa, na ordem em que existem no Tiled.
        //
        // IMPORTANTE: passamos "layerData.x, layerData.y" (em vez de "0, 0")
        // como posição da camada. O Phaser 4.2.1, para mapas INFINITOS com
        // conteúdo em coordenadas negativas, achata os chunks num array
        // denso só com índices locais (0..largura, 0..altura) e, ao
        // desenhar, ignora o deslocamento negativo real da camada — ou
        // seja, ele desenha tudo como se a camada começasse em (0,0), em
        // vez de começar em (layerData.x, layerData.y), que é onde os tiles
        // foram desenhados de fato no Tiled. Isso fazia a pista renderizar
        // inteira fora do lugar (bem longe de onde a câmera, o carro e as
        // paredes de colisão realmente estão), parecendo que "a pista não
        // aparece". Repassar o deslocamento aqui cancela esse desvio.
        const layers = map.layers.map((layerData) =>
            map.createLayer(layerData.name, tilesets, layerData.x, layerData.y)
        );

        // O "pista.json" é um mapa infinito do Tiled: os tiles não começam
        // em (0,0), tem trecho em coordenadas negativas.
        //
        // IMPORTANTE: "layer.getBounds()" NÃO pode ser usado aqui. No Phaser
        // 4.2.1, pra mapas infinitos com chunks em coordenadas negativas,
        // getBounds() calcula o TAMANHO certo mas a POSIÇÃO errada — ele
        // ancora o retângulo em (0,0) (a origem em que a layer foi criada
        // via createLayer(..., 0, 0)) em vez da posição real onde os tiles
        // foram desenhados no Tiled. Isso fazia o carro nascer, a câmera e
        // os limites do mundo ficarem deslocados da pista de verdade — o
        // que parecia "a camada colisao não funciona" (a área visível
        // ficava numa região do mapa sem nenhuma parede por perto).
        //
        // A posição real de cada layer (incluindo o deslocamento negativo)
        // fica em map.layers[i].x/.y (em pixels) e .width/.height (em
        // tiles), preenchidos pelo parser do Tiled para mapas infinitos.
        // Usamos esses dados brutos em vez de getBounds().
        const bounds = map.layers.reduce((acc, layerData) => {
            const layerBounds = new Phaser.Geom.Rectangle(
                layerData.x,
                layerData.y,
                layerData.width * map.tileWidth,
                layerData.height * map.tileHeight
            );
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
