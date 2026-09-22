import Car from '../objects/Car.js';
import TurboFX from '../fx/TurboFX.js';
import TurboAudio from '../fx/TurboAudio.js';
import CarDropIn from '../fx/CarDropIn.js';
import StartCountdown from '../fx/StartCountdown.js';

class Race extends Phaser.Scene {
    constructor() { super('Race'); }

    create() {
        const map = this.make.tilemap({ key: 'pista' });
        this.map = map;

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
            if (layer && layerData.name === 'Cyber placa') this.boostLayer = layer;
        });

        const worldW = map.width * map.tileWidth;
        const worldH = map.height * map.tileHeight;
        this.physics.world.setBounds(0, 0, worldW, worldH);
        this.cameras.main.setBounds(0, 0, worldW, worldH);

        // --------------------------------------------------------------
        // SISTEMA DE VOLTAS
        // A camada `chegada` do Tiled é a própria linha de largada/chegada.
        // Neste mapa ela ocupa x=80 e y=52..56 (tiles de 64px).
        // O carro larga exatamente nela e segue para a esquerda, então
        // contamos uma volta quando ele cruza essa linha novamente no
        // sentido correto.
        this.totalLaps = 3;
        this.currentLap = 1;
        this.raceFinished = false;
        this.lapArmed = false;
        this.previousCarX = null;
        this.finishLineX = 80 * map.tileWidth + map.tileWidth / 2;
        this.finishLineYMin = 52 * map.tileHeight - 20;
        this.finishLineYMax = 57 * map.tileHeight + 20;

        // Spawn na linha de chegada: camada "chegada" do Tiled fica na
        // coluna de tile 80, linhas 52–56 (tiles de 64px), centralizada na
        // pista, que ali vai de x=5 até x=90 tiles.
        const startTileX = 80, startTileY = 54; // linha 54 = meio das 5 linhas (52–56)
        const startX = startTileX * map.tileWidth + map.tileWidth / 2;
        const startY = startTileY * map.tileHeight + map.tileHeight / 2;
        this.car = new Car(this, startX, startY, 'carro');
        this.car.setDepth(1000);
        // A pista aqui é uma reta horizontal (a linha de chegada corta ela
        // na vertical): o carro precisa nascer virado de lado, não de
        // "cabeça pra cima" como o sprite vem por padrão. -90° = de frente
        // pra esquerda (sentido contrário à curva que vem depois da linha).
        this.car.setAngle(-90);
        this.previousCarX = this.car.x;

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
        this.createBoostSensors();

        this.cameras.main.setZoom(0.65);
        this.cameras.main.startFollow(this.car, true, 0.08, 0.08);

        // Efeitos e som do turbo. Os dois leem `car.turboIntensity`; nenhum
        // dos dois sabe o que o outro faz.
        this.fx = new TurboFX(this, this.car);
        this.audio = new TurboAudio(this.car);

        this.buildHud();
        this.createChampionOverlay();
        this.splitCameras();

        // O carro já nasce na posição certa (startX/startY), mas some pra
        // cima e cai de volta nela — ver CarDropIn pra a animação completa.
        // Só depois do pouso É QUE entra a contagem regressiva; os
        // controles ficam travados até o "VAI!".
        this.dropIn = new CarDropIn(this, this.car);
        this.dropIn.play(startX, startY, {
            onLand: () => this.startCountdown()
        });

        // Rede de segurança: se por qualquer motivo a queda ou a contagem
        // travarem no meio do caminho, o jogador nunca fica preso sem poder
        // andar — os controles liberam sozinhos depois de um tempo.
        this.time.delayedCall(8000, () => {
            if (this.car && !this.car.controlsEnabled) {
                console.warn('Failsafe: liberando controles do carro.');
                this.car.body.enable = true;
                this.car.controlsEnabled = true;
            }
        });

        this.input.keyboard.on('keydown-M', () => {
            const muted = this.audio.toggleMute();
            this.sound.mute = muted;
            this.muteLabel.setText(muted ? 'SOM: OFF  [M]' : 'SOM: ON  [M]');
        });
    }

    startCountdown() {
        try {
            this.countdown = new StartCountdown(this);
            this.countdown.play(() => {
                this.car.controlsEnabled = true;
            });
        } catch (e) {
            console.error('RaceScene: contagem regressiva falhou, liberando o carro direto', e);
            this.car.controlsEnabled = true;
        }
    }

    onCrash() {
        if (this.car.turboIntensity < 0.25) return;
        this.car.turboSpool = 0;
        this.car.turboFuel = Math.max(0, this.car.turboFuel - 22);
        this.cameras.main.shake(180, 0.011);
    }

    createBoostSensors() {
        if (!this.boostLayer) return;

        // A camada original tinha dois blocos 4x4 fora do asfalto. Ela serve
        // apenas como referência no Tiled; as placas jogáveis ficam abaixo,
        // distribuídas em trechos diferentes da pista.
        this.boostLayer.setVisible(false);
        const boostPositions = [
            { x: 68, y: 54 },
            { x: 85, y: 45 },
            { x: 65, y: 42 },
            { x: 32, y: 38 },
            { x: 22, y: 24 },
            { x: 7, y: 20 }
        ];

        this.boostSensors = this.physics.add.staticGroup();
        this.boostVisuals = this.add.graphics().setDepth(900);
        const tileWidth = this.map.tileWidth;
        const tileHeight = this.map.tileHeight;
        boostPositions.forEach(position => {
            const centerX = position.x * tileWidth + tileWidth;
            const centerY = position.y * tileHeight + tileHeight / 2;
            const plateWidth = tileWidth * 2;
            const halfWidth = plateWidth / 2;
            const halfHeight = tileHeight / 2;

            this.boostVisuals.fillStyle(0x071a2b, 0.9);
            this.boostVisuals.fillRect(
                centerX - halfWidth + 3,
                centerY - halfHeight + 3,
                plateWidth - 6,
                tileHeight - 6
            );
            this.boostVisuals.lineStyle(2, 0x00e5ff, 0.95);
            this.boostVisuals.strokeRect(
                centerX - halfWidth + 4,
                centerY - halfHeight + 4,
                plateWidth - 8,
                tileHeight - 8
            );
            this.boostVisuals.lineStyle(3, 0xff2bd6, 0.9);
            this.boostVisuals.lineBetween(
                centerX - halfWidth + 10,
                centerY - halfHeight + 10,
                centerX + halfWidth - 10,
                centerY + halfHeight - 10
            );
            this.boostVisuals.lineBetween(
                centerX - halfWidth + 10,
                centerY + halfHeight - 10,
                centerX + halfWidth - 10,
                centerY - halfHeight + 10
            );

            const sensor = this.add.rectangle(
                centerX,
                centerY,
                plateWidth,
                tileHeight
            );
            sensor.setVisible(false);
            sensor.boostCooldownUntil = 0;
            this.physics.add.existing(sensor, true);
            this.boostSensors.add(sensor);
        });

        this.physics.add.overlap(this.car, this.boostSensors, (car, sensor) => {
            const now = this.time.now;
            if (now < sensor.boostCooldownUntil) return;

            sensor.boostCooldownUntil = now + 250;
            car.activateTrackBoost(now);
        });
    }

    // ------------------------------------------------------------------
    // VOLTAS / CHEGADA
    // ------------------------------------------------------------------
    updateLapSystem() {
        if (!this.car || this.raceFinished) return;

        const x = this.car.x;
        const y = this.car.y;
        const previousX = this.previousCarX ?? x;

        // Primeiro obrigamos o jogador a sair da linha de largada.
        // Assim o spawn em cima da linha nunca conta como uma volta.
        if (!this.lapArmed && Math.abs(x - this.finishLineX) > 220) {
            this.lapArmed = true;
        }

        const crossedFinish =
            this.lapArmed &&
            previousX > this.finishLineX + 4 &&
            x <= this.finishLineX + 4 &&
            this.car.body.velocity.x < -20 &&
            y >= this.finishLineYMin &&
            y <= this.finishLineYMax;

        if (crossedFinish) {
            this.lapArmed = false;

            if (this.currentLap < this.totalLaps) {
                this.currentLap++;
                this.lapLabel.setText(`VOLTA ${this.currentLap} / ${this.totalLaps}`);

                // Pequeno feedback visual sem interromper a corrida.
                this.tweens.add({
                    targets: this.lapLabel,
                    scale: 1.22,
                    duration: 120,
                    yoyo: true,
                    ease: 'Quad.easeOut'
                });
            } else {
                this.finishRace();
            }
        }

        this.previousCarX = x;
    }

    finishRace() {
        if (this.raceFinished) return;
        this.raceFinished = true;
        this.currentLap = this.totalLaps;
        this.lapLabel.setText(`VOLTA ${this.totalLaps} / ${this.totalLaps}`);

        // Para o carro exatamente ao cruzar a chegada.
        this.car.controlsEnabled = false;
        this.car.setVelocity(0, 0);
        this.car.body.setAcceleration(0, 0);
        this.car.setAngularVelocity(0);

        this.playChampionAnimation();
    }

    createChampionOverlay() {
        const { width, height } = this.scale;

        this.championOverlay = this.add.rectangle(
            width / 2, height / 2, width, height, 0x050711, 0.72
        ).setScrollFactor(0).setDepth(5000).setVisible(false);

        this.championPanel = this.add.rectangle(
            width / 2, height / 2 + 8, Math.min(620, width - 60), 150, 0x0a1020, 0.96
        ).setScrollFactor(0).setDepth(5001).setStrokeStyle(3, 0x00e5ff).setVisible(false);

        this.championText = this.add.text(
            width / 2, height / 2 - 18, 'CAMPEÃO!',
            { fontFamily: 'monospace', fontSize: '48px', fontStyle: 'bold', color: '#00e5ff', stroke: '#07111f', strokeThickness: 8, align: 'center' }
        ).setOrigin(0.5).setScrollFactor(0).setDepth(5002).setVisible(false);

        this.championSubtext = this.add.text(
            width / 2, height / 2 + 38, '3 VOLTAS COMPLETAS',
            { fontFamily: 'monospace', fontSize: '17px', color: '#ffffff', align: 'center' }
        ).setOrigin(0.5).setScrollFactor(0).setDepth(5002).setVisible(false);

        // Confetes simples feitos com retângulos: não precisa de novo asset.
        this.championConfetti = [];
        for (let i = 0; i < 28; i++) {
            const piece = this.add.rectangle(
                Phaser.Math.Between(0, width), -20,
                Phaser.Math.Between(4, 9), Phaser.Math.Between(7, 15),
                [0x00e5ff, 0xff2bd6, 0xffe066, 0xffffff][i % 4]
            ).setScrollFactor(0).setDepth(5003).setVisible(false);
            this.championConfetti.push(piece);
        }

        this.hud.push(
            this.championOverlay,
            this.championPanel,
            this.championText,
            this.championSubtext,
            ...this.championConfetti
        );
    }

    playChampionAnimation() {
        const show = [
            this.championOverlay, this.championPanel,
            this.championText, this.championSubtext
        ];
        show.forEach(o => o.setVisible(true));

        this.championOverlay.setAlpha(0);
        this.championPanel.setAlpha(0).setScale(0.82);
        this.championText.setAlpha(0).setScale(0.55);
        this.championSubtext.setAlpha(0);

        this.tweens.add({ targets: this.championOverlay, alpha: 1, duration: 350 });
        this.tweens.add({ targets: this.championPanel, alpha: 1, scale: 1, duration: 500, ease: 'Back.easeOut' });
        this.tweens.add({ targets: this.championText, alpha: 1, scale: 1, duration: 650, ease: 'Back.easeOut' });
        this.tweens.add({ targets: this.championSubtext, alpha: 1, duration: 450, delay: 300 });

        // O carro faz uma pequena comemoração: sobe, gira e volta para o
        // chão, sem perder a posição onde terminou a terceira volta.
        this.tweens.add({
            targets: this.car,
            scale: 1.22,
            angle: this.car.angle - 360,
            duration: 900,
            ease: 'Cubic.easeOut',
            yoyo: true,
            hold: 120
        });

        this.championConfetti.forEach((piece, i) => {
            piece.setPosition(Phaser.Math.Between(20, this.scale.width - 20), -20);
            piece.setRotation(Phaser.Math.FloatBetween(-1, 1));
            piece.setVisible(true);
            this.tweens.add({
                targets: piece,
                y: this.scale.height + Phaser.Math.Between(20, 160),
                x: piece.x + Phaser.Math.Between(-100, 100),
                angle: Phaser.Math.Between(-5, 5),
                duration: Phaser.Math.Between(1200, 2100),
                delay: i * 22,
                ease: 'Quad.easeIn',
                onComplete: () => piece.setVisible(false)
            });
        });
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

        this.lapLabel = push(this.add.text(x, y + h + 55, `VOLTA 1 / ${this.totalLaps}`, {
            fontFamily: 'monospace', fontSize: '18px', fontStyle: 'bold', color: '#ff2bd6'
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
            this.boostVisuals,
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
        this.updateLapSystem();
        if (this.fx) this.fx.update(time, delta);
        if (this.audio) this.audio.update();
        if (this.turboBarFill) this.updateHud();
    }
}
export default Race;
