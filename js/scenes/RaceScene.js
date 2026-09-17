import Car from '../objects/Car.js';
import TurboFX from '../fx/TurboFX.js';
import TurboAudio from '../fx/TurboAudio.js';

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
            map.addTilesetImage('pixel invisivel', 'placas'),
            map.addTilesetImage('start', 'chegada')     

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
        this.car = new Car(this, worldW / 2, worldH / 2, 'carro');
        this.car.setDepth(1000);

        // Colisões desenhadas no objeto "colisao" do Tiled.
        this.walls = this.physics.add.staticGroup();
        const collisionLayer = map.getObjectLayer('colisao');
        if (collisionLayer) {
            collisionLayer.objects.forEach(obj => {
                const wall = this.add.rectangle(
                    obj.x + (obj.width || 0) / 2,
                    obj.y + (obj.height || 0) / 2,
                    obj.width || 1, obj.height || 1
                );
                wall.setVisible(false);
                this.physics.add.existing(wall, true);
                this.walls.add(wall);
            });
        }
        // Bater na parede em pleno turbo tem que custar: mata a turbina,
        // queima parte do tanque e sacode a tela. Sem isso, o turbo vira
        // "segurar SHIFT e raspar no muro", que é a forma mais rápida de
        // matar a graça de um jogo de corrida. (Um collider só, com callback
        // — dois colliders pro mesmo par resolveriam a colisão duas vezes.)
        this.physics.add.collider(this.car, this.walls, () => this.onCrash());

        this.cameras.main.setZoom(0.65);
        this.cameras.main.startFollow(this.car, true, 0.08, 0.08);

        // Efeitos e som do turbo. Os dois leem `car.turboIntensity`; nenhum
        // dos dois sabe o que o outro faz.
        this.fx = new TurboFX(this, this.car);
        this.audio = new TurboAudio(this.car);

        this.buildHud();
        this.splitCameras();

        this.input.keyboard.on('keydown-M', () => {
            const muted = this.audio.toggleMute();
            this.muteLabel.setText(muted ? 'SOM: OFF  [M]' : 'SOM: ON  [M]');
        });
    }

    onCrash() {
        if (this.car.turboIntensity < 0.25) return;
        this.car.turboSpool = 0;
        this.car.turboFuel = Math.max(0, this.car.turboFuel - 22);
        this.cameras.main.shake(180, 0.011);
    }

    // ------------------------------------------------------------------
    // HUD
    // ------------------------------------------------------------------
    buildHud() {
        this.hud = [];
        const push = (...o) => { this.hud.push(...o); return o[0]; };

        const x = 24, y = 24, w = 210, h = 20;
        this.barX = x; this.barY = y; this.barW = w; this.barH = h;

        // Trilho do tanque.
        push(this.add.rectangle(x - 3, y - 3, w + 6, h + 6, 0x0a0c14, 0.82)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(2000)
            .setStrokeStyle(2, 0x2a3350));

        this.turboBarFill = push(this.add.rectangle(x, y, w, h, 0x00e5ff)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(2001));

        // Camada aditiva por cima do preenchimento: é ela que "acende"
        // quando o turbo está ativo, sem mexer na cor de base.
        this.turboBarGlow = push(this.add.rectangle(x, y, w, h, 0xffffff)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(2002)
            .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0));

        // Divisórias: dá pra ler "quanto sobrou" de relance, sem precisar
        // interpretar o comprimento de uma barra lisa.
        const ticks = this.add.graphics().setScrollFactor(0).setDepth(2003);
        ticks.lineStyle(1, 0x0a0c14, 0.55);
        for (let i = 1; i < 5; i++) {
            ticks.lineBetween(x + (w / 5) * i, y, x + (w / 5) * i, y + h);
        }
        push(ticks);

        this.turboLabel = push(this.add.text(x, y + h + 6, 'TURBO PRONTO  [SHIFT]', {
            fontFamily: 'monospace', fontSize: '13px', color: '#00e5ff'
        }).setScrollFactor(0).setDepth(2004));

        this.speedLabel = push(this.add.text(x, y + h + 24, '0 km/h', {
            fontFamily: 'monospace', fontSize: '22px', color: '#ffffff'
        }).setScrollFactor(0).setDepth(2004).setOrigin(0, 0));

        this.muteLabel = push(this.add.text(this.scale.width - 16, 16, 'SOM: ON  [M]', {
            fontFamily: 'monospace', fontSize: '11px', color: '#6a7899'
        }).setScrollFactor(0).setDepth(2004).setOrigin(1, 0));
    }

    /**
     * Duas câmeras: a principal leva o mundo E os filtros de pós-processamento
     * do turbo; a de UI leva o HUD e os efeitos de tela cheia, sem filtro
     * nenhum. Se o HUD passasse pelos mesmos filtros, o texto entortaria com o
     * barrel e borraria com o blur bem na hora em que você mais precisa ler o
     * tanque de turbo.
     *
     * Cada câmera precisa ignorar explicitamente o que não é dela — objeto
     * esquecido aparece duplicado nas duas.
     */
    splitCameras() {
        const { width, height } = this.scale;
        this.uiCam = this.cameras.add(0, 0, width, height);
        this.uiCam.setScroll(0, 0);

        const world = [
            ...this.mapLayers,
            this.car,
            ...this.walls.getChildren(),
            ...this.fx.worldObjects
        ];
        const ui = [...this.hud, ...this.fx.uiObjects];

        this.uiCam.ignore(world);
        this.cameras.main.ignore(ui);
    }

    updateHud() {
        const car = this.car;
        const pct = Phaser.Math.Clamp(car.turboFuel / car.turboMax, 0, 1);
        const k = car.turboIntensity;

        this.turboBarFill.width = Math.max(1, this.barW * pct);
        this.turboBarGlow.width = this.turboBarFill.width;

        const t = this.time.now;
        if (car.isOverheated) {
            // Piscada rápida: o olho pega "alarme" antes de ler a palavra.
            const blink = Math.sin(t * 0.018) > 0;
            this.turboBarFill.fillColor = blink ? 0xff2d55 : 0x8a1630;
            this.turboBarGlow.setAlpha(blink ? 0.25 : 0);
            this.turboLabel.setText('SUPERAQUECIDO').setColor('#ff2d55');
        } else if (car.isTurboActive) {
            this.turboBarFill.fillColor = 0xff2d55;
            this.turboBarGlow.setAlpha(0.18 + 0.22 * Math.abs(Math.sin(t * 0.02)));
            this.turboLabel.setText('BOOST').setColor('#ff7aa0');
        } else if (pct >= car.turboMinToActivate / car.turboMax) {
            this.turboBarFill.fillColor = 0x00e5ff;
            this.turboBarGlow.setAlpha(pct >= 1 ? 0.12 : 0);
            this.turboLabel.setText('TURBO PRONTO  [SHIFT]').setColor('#00e5ff');
        } else {
            this.turboBarFill.fillColor = 0x2f6f80;
            this.turboBarGlow.setAlpha(0);
            this.turboLabel.setText('RECARREGANDO').setColor('#6a7899');
        }

        // O número de velocidade cresce e esquenta junto com o turbo. É um
        // detalhe bobo, mas é o que faz o HUD parecer parte do carro em vez
        // de um adesivo colado na tela.
        this.speedLabel.setText(`${car.speedKmh} km/h`);
        this.speedLabel.setScale(1 + 0.16 * k);
        this.speedLabel.setColor(k > 0.45 ? '#ffe066' : '#ffffff');
    }

    update(time, delta) {
        if (this.car) this.car.update(time, delta);
        if (this.fx) this.fx.update(time, delta);
        if (this.audio) this.audio.update();
        if (this.turboBarFill) this.updateHud();
    }
}
export default Race;
