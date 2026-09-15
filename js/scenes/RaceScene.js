import Car from '../objects/Car.js';

class Race extends Phaser.Scene {
    constructor() { super('Race'); }

    create() {
        const map = this.make.tilemap({ key: 'pista' });

        const tilesets = [
            map.addTilesetImage('Pista.png', 'pista'),
            map.addTilesetImage('Prédios', 'predios'),
            map.addTilesetImage('10', 'chao'),
            map.addTilesetImage('favela', 'favela'),
            map.addTilesetImage('placas', 'placas'),
            map.addTilesetImage('calçada', 'calcada'),
            map.addTilesetImage('objetos', 'objetos'),
            map.addTilesetImage('pixel invisivel', 'placas')
        ].filter(Boolean);

        // BUG CORRIGIDO: `map.layers` (o Tilemap já parseado pelo Phaser) NUNCA
        // teve uma propriedade `.type` como "tilelayer"/"group" — isso só existe
        // no JSON bruto do Tiled. Cada item de `map.layers` já é um objeto
        // LayerData (só de tile layers; as camadas de objeto, como "colisao",
        // ficam fora). Além disso o Phaser já "achata" os grupos do Tiled
        // sozinho, prefixando o nome com o nome do grupo (ex.: "Prédios/Prédio 2"),
        // então não existe estrutura de grupo pra percorrer aqui.
        // Por causa disso `data.type === 'tilelayer'` nunca era verdade, o loop
        // não criava NENHUMA camada, e só o carro (que não depende do tilemap)
        // aparecia na tela.
        //
        // A correção: percorrer `map.layers` direto e criar cada camada pelo
        // ÍNDICE (não pelo nome) — o mapa tem duas camadas chamadas "Telões",
        // e criar por nome faria o Phaser pegar sempre a primeira e ignorar a
        // segunda.
        this.mapLayers = [];
        map.layers.forEach((layerData, index) => {
            const layer = map.createLayer(index, tilesets, 0, 0);
            if (layer) this.mapLayers.push(layer);
        });

        const worldW = map.width * map.tileWidth;
        const worldH = map.height * map.tileHeight;
        this.physics.world.setBounds(0, 0, worldW, worldH);
        this.cameras.main.setBounds(0, 0, worldW, worldH);

        // O novo mapa usa tiles de 64px. O centro é um ponto seguro inicial;
        // depois podemos colocar o spawn exatamente na linha de largada.
        this.car = new Car(this, worldW/2, worldH/2, 'carro');
        this.car.setDepth(1000);

        // Colisões desenhadas no objeto "colisao" do Tiled.
        this.walls = this.physics.add.staticGroup();
        const collisionLayer = map.getObjectLayer('colisao');
        if (collisionLayer) {
            collisionLayer.objects.forEach(obj => {
                const wall = this.add.rectangle(
                    obj.x + (obj.width || 0)/2,
                    obj.y + (obj.height || 0)/2,
                    obj.width || 1, obj.height || 1
                );
                wall.setVisible(false);
                this.physics.add.existing(wall, true);
                this.walls.add(wall);
            });
        }
        this.physics.add.collider(this.car, this.walls);
        this.cameras.main.startFollow(this.car, true, 0.08, 0.08);
    }

    update(time, delta) {
        if (this.car) this.car.update(time, delta);
    }
}
export default Race;
