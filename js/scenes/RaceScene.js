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
        this.checkpointIndex = 0;
        this.checkpointCount = 4;
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
        this.createCheckpoints();

        this.cameras.main.setZoom(0.65);
        this.cameras.main.startFollow(this.car, true, 0.08, 0.08);

        // Efeitos e som do turbo. Os dois leem `car.turboIntensity`; nenhum
        // dos dois sabe o que o outro faz.
        this.fx = new TurboFX(this, this.car);
        this.audio = new TurboAudio(this.car);

        this.buildHud();
        this.updateCheckpointHud();
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

        // A camada "Cyber placa" do Tiled contém as placas de referência,
        // mas algumas delas ficam fora do asfalto. Por isso as placas jogáveis
        // são recriadas aqui, usando pontos que ficam no CENTRO dos trechos
        // retos da pista. Cada ponto também informa a orientação da pista:
        // 0 = trecho horizontal, Math.PI / 2 = trecho vertical.
        this.boostLayer.setVisible(false);

        const boostPositions = [
            // trecho inferior longo
            { x: 46, y: 54, angle: 0 },
            { x: 70, y: 54, angle: 0 },

            // trecho vertical da direita
            { x: 85, y: 45, angle: Math.PI / 2 },

            // trecho horizontal do meio-direita
            { x: 65, y: 42, angle: 0 },

            // trecho horizontal central
            { x: 32, y: 38, angle: 0 },

            // trecho vertical central-esquerda
            { x: 22, y: 24, angle: Math.PI / 2 },

            // trecho vertical da esquerda
            { x: 7, y: 20, angle: Math.PI / 2 },

            // reta superior central
            { x: 48, y: 14, angle: 0 }
        ];

        this.boostSensors = this.physics.add.staticGroup();
        this.boostVisuals = this.add.container(0, 0).setDepth(900);

        const tileWidth = this.map.tileWidth;
        const tileHeight = this.map.tileHeight;
        const plateLength = tileWidth * 1.75;
        const plateWidth = tileHeight * 0.72;

        boostPositions.forEach((position, index) => {
            const centerX = position.x * tileWidth + tileWidth / 2;
            const centerY = position.y * tileHeight + tileHeight / 2;

            // A placa fica atravessada na pista. Nos trechos verticais ela
            // gira 90 graus; isso evita a placa ficar atravessada/saindo do
            // asfalto, que era o problema das posições antigas.
            const plate = this.add.container(centerX, centerY);
            plate.setRotation(position.angle);

            const g = this.add.graphics();
            g.fillStyle(0x071a2b, 0.96);
            g.fillRoundedRect(
                -plateLength / 2,
                -plateWidth / 2,
                plateLength,
                plateWidth,
                8
            );

            g.lineStyle(2, 0x00e5ff, 0.95);
            g.strokeRoundedRect(
                -plateLength / 2 + 2,
                -plateWidth / 2 + 2,
                plateLength - 4,
                plateWidth - 4,
                6
            );

            // Setas no sentido da pista: visualmente deixa claro que é uma
            // placa de aceleração, e não um obstáculo.
            g.fillStyle(0xff2bd6, 0.95);
            const arrowW = plateLength * 0.20;
            const arrowH = plateWidth * 0.42;
            for (let a = -1; a <= 1; a++) {
                const ax = a * plateLength * 0.27;
                g.beginPath();
                g.moveTo(ax - arrowW * 0.55, -arrowH / 2);
                g.lineTo(ax + arrowW * 0.10, -arrowH / 2);
                g.lineTo(ax + arrowW * 0.55, 0);
                g.lineTo(ax + arrowW * 0.10, arrowH / 2);
                g.lineTo(ax - arrowW * 0.55, arrowH / 2);
                g.lineTo(ax - arrowW * 0.08, 0);
                g.closePath();
                g.fillPath();
            }

            plate.add(g);
            this.boostVisuals.add(plate);

            // Sensor um pouco menor que a arte: o jogador precisa realmente
            // passar pela placa, sem ativar ao raspar na borda da pista.
            const sensor = this.add.rectangle(
                centerX,
                centerY,
                plateLength * 0.88,
                plateWidth * 0.82
            );
            sensor.setVisible(false);
            sensor.setRotation(position.angle);
            sensor.boostCooldownUntil = 0;
            sensor.boostIndex = index;
            this.physics.add.existing(sensor, true);
            this.boostSensors.add(sensor);
        });

        this.physics.add.overlap(this.car, this.boostSensors, (car, sensor) => {
            const now = this.time.now;
            if (now < sensor.boostCooldownUntil) return;

            // Pequeno cooldown evita que a mesma placa seja acionada várias
            // vezes enquanto o carro ainda está em cima dela.
            sensor.boostCooldownUntil = now + 500;
            car.activateTrackBoost(now);

            // Feedback rápido: a placa "pisca" quando é usada.
            const plate = this.boostVisuals.list[sensor.boostIndex];
            if (plate) {
                plate.setScale(1.08);
                this.tweens.add({
                    targets: plate,
                    scale: 1,
                    duration: 180,
                    ease: 'Quad.easeOut'
                });
            }
        });
    }

    // ------------------------------------------------------------------
    // CHECKPOINTS
    // ------------------------------------------------------------------
    createCheckpoints() {
        // 4 portões por volta. Eles ficam em trechos bem claros da PISTA REAL
        // (não no minimapa) e atravessam a largura da estrada, então o carro
        // precisa realmente passar pelo portão para registrar.
        // Ordem: reta inferior -> subida esquerda -> reta superior -> subida direita.
        const checkpoints = [
            // CP1 — reta inferior. Fica ENTRE as placas boost da parte de baixo.
            { x: 3872, y: 3488, w: 150, h: 300, name: 'CP1' },

            // CP2 — trecho vertical da esquerda, longe da placa boost.
            { x: 544, y: 1824, w: 300, h: 150, name: 'CP2' },

            // CP3 — reta superior. Sai da posição da placa boost e vai para
            // outro ponto da mesma reta, sem sobrepor o boost.
            { x: 3872, y: 928, w: 150, h: 300, name: 'CP3' },

            // CP4 — trecho vertical da direita, antes de voltar para a chegada.
            // Fica acima da região das placas boost da curva inferior direita.
            { x: 4896, y: 2208, w: 300, h: 150, name: 'CP4' }
        ];

        this.checkpoints = [];
        this.checkpointSensors = this.physics.add.staticGroup();
        this.checkpointVisuals = this.add.container(0, 0).setDepth(850);

        checkpoints.forEach((cp, index) => {
            const gate = this.add.rectangle(cp.x, cp.y, cp.w, cp.h, 0x00e5ff, 0.0);
            gate.setVisible(false);
            gate.setData('index', index);
            gate.setData('name', cp.name);
            this.physics.add.existing(gate, true);
            gate.checkpointCooldownUntil = 0;
            this.checkpointSensors.add(gate);
            this.checkpoints.push(gate);
        });

        this.physics.add.overlap(this.car, this.checkpointSensors, (car, gate) => {
            this.registerCheckpoint(gate);
        });
    }

    registerCheckpoint(gate) {
        if (!gate || !this.car || this.raceFinished) return;

        const index = gate.getData('index');
        const now = this.time.now;

        if (now < gate.checkpointCooldownUntil) return;
        if (index !== this.checkpointIndex) return;

        gate.checkpointCooldownUntil = now + 900;
        this.checkpointIndex++;

        // Feedback completo: HUD + som + efeito de passagem.
        this.playCheckpointFeedback(index);
        this.updateCheckpointHud();
    }

    // Checagem manual além do overlap físico. Ela evita falhas de detecção
    // quando o carro está rápido demais para o callback do Arcade Physics.
    checkCheckpointFallback() {
        if (!this.car || !this.checkpoints || this.raceFinished) return;

        const gate = this.checkpoints[this.checkpointIndex];
        if (!gate) return;

        const padX = Math.max(18, this.car.width * 0.35);
        const padY = Math.max(18, this.car.height * 0.35);
        const insideX = Math.abs(this.car.x - gate.x) <= gate.width / 2 + padX;
        const insideY = Math.abs(this.car.y - gate.y) <= gate.height / 2 + padY;

        if (insideX && insideY) this.registerCheckpoint(gate);
    }

    updateCheckpointHud(message = null) {
        if (!this.checkpointLabel) return;

        if (message) {
            this.checkpointLabel.setText(message).setColor('#ffe066');
            this.tweens.add({
                targets: this.checkpointLabel,
                scale: 1.18,
                duration: 120,
                yoyo: true,
                ease: 'Quad.easeOut',
                onComplete: () => this.updateCheckpointHud()
            });
            return;
        }

        this.checkpointLabel
            .setText(`CHECKPOINT ${this.checkpointIndex} / ${this.checkpointCount}`)
            .setColor(this.checkpointIndex >= this.checkpointCount ? '#00ff9d' : '#8da7c7');

        // Indicador visual de progresso: 4 módulos que acendem conforme
        // o jogador passa pelos checkpoints.
        if (this.checkpointProgress) {
            this.checkpointProgress.forEach((segment, i) => {
                const done = i < this.checkpointIndex;
                segment.fillColor = done ? 0x00e5ff : 0x17243b;
                segment.setAlpha(done ? 1 : 0.85);
                segment.setStrokeStyle(1.5, done ? 0x00e5ff : 0x3b4c68, done ? 1 : 0.8);
            });
        }
    }

    playCheckpointFeedback(index) {
        this.flashCheckpoint(index);
        this.playCheckpointSound(index);
        this.checkpointPassEffect();
    }

    flashCheckpoint(index) {
        if (!this.checkpointBanner || !this.checkpointBannerText) return;

        const completed = index + 1;
        const last = completed === this.checkpointCount;

        this.checkpointBannerText
            .setText(last ? 'CHECKPOINT FINAL!' : `CHECKPOINT ${completed}`)
            .setColor(last ? '#00ff9d' : '#00e5ff');

        this.checkpointBannerCount.setText(`${completed} / ${this.checkpointCount}`);

        [this.checkpointBanner, this.checkpointBannerText, this.checkpointBannerCount]
            .forEach(obj => obj.setVisible(true));

        this.checkpointBanner.setAlpha(0).setScale(0.72);
        this.checkpointBannerText.setAlpha(0).setScale(0.45);
        this.checkpointBannerCount.setAlpha(0).setScale(0.8);

        this.tweens.killTweensOf([
            this.checkpointBanner,
            this.checkpointBannerText,
            this.checkpointBannerCount
        ]);

        this.tweens.add({
            targets: this.checkpointBanner,
            alpha: 0.96,
            scale: 1,
            duration: 180,
            ease: 'Back.easeOut'
        });

        this.tweens.add({
            targets: this.checkpointBannerText,
            alpha: 1,
            scale: 1,
            duration: 260,
            ease: 'Back.easeOut'
        });

        this.tweens.add({
            targets: this.checkpointBannerCount,
            alpha: 1,
            scale: 1,
            duration: 220,
            delay: 90,
            ease: 'Quad.easeOut'
        });

        this.tweens.add({
            targets: this.checkpointBannerText,
            scale: 1.08,
            duration: 130,
            delay: 260,
            yoyo: true,
            ease: 'Sine.easeInOut'
        });

        this.tweens.add({
            targets: [this.checkpointBanner, this.checkpointBannerText, this.checkpointBannerCount],
            alpha: 0,
            duration: 260,
            delay: 1050,
            ease: 'Quad.easeIn',
            onComplete: () => {
                this.checkpointBanner.setVisible(false);
                this.checkpointBannerText.setVisible(false);
                this.checkpointBannerCount.setVisible(false);
            }
        });
    }

    // Efeito de passagem no carro: anel neon + partículas radiais.
    checkpointPassEffect() {
        if (!this.car) return;

        const x = this.car.x;
        const y = this.car.y;
        const accent = 0x00e5ff;
        const ring = this.add.circle(x, y, 18, accent, 0.08)
            .setStrokeStyle(4, accent, 0.95)
            .setDepth(1800);

        this.tweens.add({
            targets: ring,
            radius: 72,
            alpha: 0,
            duration: 420,
            ease: 'Cubic.easeOut',
            onComplete: () => ring.destroy()
        });

        for (let i = 0; i < 10; i++) {
            const a = (Math.PI * 2 * i) / 10;
            const dist = Phaser.Math.Between(38, 68);
            const dot = this.add.circle(x, y, Phaser.Math.Between(3, 5), i % 2 ? 0xff2bd6 : 0x00e5ff, 1)
                .setDepth(1801);
            this.tweens.add({
                targets: dot,
                x: x + Math.cos(a) * dist,
                y: y + Math.sin(a) * dist,
                alpha: 0,
                scale: 0.2,
                duration: 360,
                ease: 'Cubic.easeOut',
                onComplete: () => dot.destroy()
            });
        }

        this.cameras.main.shake(110, 0.0035);
    }

    // Som curto gerado pelo próprio navegador: não depende de asset externo.
    playCheckpointSound(index) {
        try {
            const ctx = this.sound && this.sound.context;
            if (!ctx || ctx.state === 'suspended' || this.sound.mute) return;

            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const base = index === this.checkpointCount - 1 ? 740 : 520;

            osc.type = 'square';
            osc.frequency.setValueAtTime(base, now);
            osc.frequency.exponentialRampToValueAtTime(base * 1.5, now + 0.11);
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(0.075, now + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.24);
        } catch (e) {
            // O jogo continua normalmente se o navegador bloquear WebAudio.
        }
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

            // Chegou na linha, mas ainda faltou algum checkpoint: não conta.
            // O jogador continua na mesma volta e precisa completar o trecho
            // que pulou.
            if (this.checkpointIndex < this.checkpointCount) {
                this.updateCheckpointHud('VOLTA BLOQUEADA — COMPLETE OS CHECKPOINTS');
                this.tweens.add({
                    targets: this.lapLabel,
                    scale: 1.12,
                    duration: 120,
                    yoyo: true,
                    ease: 'Quad.easeOut'
                });
            } else if (this.currentLap < this.totalLaps) {
                this.currentLap++;
                this.checkpointIndex = 0;
                this.lapLabel.setText(`VOLTA ${this.currentLap} / ${this.totalLaps}`);
                this.updateCheckpointHud();

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

        this.checkpointLabel = push(this.add.text(x, y + h + 82, `CHECKPOINT 0 / ${this.checkpointCount}`, {
            fontFamily: 'monospace', fontSize: '12px', fontStyle: 'bold', color: '#8da7c7'
        }).setScrollFactor(0).setDepth(2004).setOrigin(0, 0));

        // 4 blocos de progresso: cada um acende quando o checkpoint correspondente é concluído.
        this.checkpointProgress = [];
        const progressY = y + h + 101;
        for (let i = 0; i < this.checkpointCount; i++) {
            const segment = push(this.add.rectangle(
                x + 7 + i * 34, progressY, 28, 6, 0x17243b, 0.9
            ).setOrigin(0, 0.5).setScrollFactor(0).setDepth(2004)
                .setStrokeStyle(1.5, 0x3b4c68, 0.8));
            this.checkpointProgress.push(segment);
        }

        // Banner de checkpoint: feedback grande e animado no HUD.
        const bannerY = 116;
        this.checkpointBanner = push(this.add.rectangle(
            this.scale.width / 2, bannerY, 300, 70, 0x061020, 0.94
        ).setScrollFactor(0).setDepth(2600).setStrokeStyle(2, 0x00e5ff, 0.9)
            .setVisible(false));

        this.checkpointBannerText = push(this.add.text(
            this.scale.width / 2, bannerY - 8, 'CHECKPOINT 1',
            {
                fontFamily: 'monospace', fontSize: '24px', fontStyle: 'bold',
                color: '#00e5ff', stroke: '#020611', strokeThickness: 5,
                align: 'center'
            }
        ).setOrigin(0.5).setScrollFactor(0).setDepth(2601).setVisible(false));

        this.checkpointBannerCount = push(this.add.text(
            this.scale.width / 2, bannerY + 20, '1 / 4',
            {
                fontFamily: 'monospace', fontSize: '12px', fontStyle: 'bold',
                color: '#ffffff', align: 'center'
            }
        ).setOrigin(0.5).setScrollFactor(0).setDepth(2601).setVisible(false));

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

        // --------------------------------------------------------------
        // MINI-MAPA LEVE
        // O minimapa antigo usava uma segunda câmera renderizando o mapa
        // inteiro a cada frame. Como o seu mapa tem muitas camadas, isso
        // pesa bastante. Agora o circuito é desenhado UMA VEZ como uma
        // linha simples, seguindo o formato real da pista do Tiled.
        // Resultado: visual no estilo de mapa de corrida e muito menos
        // trabalho por frame.
        this.createLightMinimap();

        // --------------------------------------------------------------
        // CÂMERA DE UI
        // Criada por último para manter HUD e minimapa sempre nítidos.
        this.uiCam = this.cameras.add(0, 0, width, height);
        this.uiCam.setScroll(0, 0);

        const world = [
            ...this.mapLayers,
            this.car,
            ...this.walls.getChildren(),
            this.boostVisuals,
            ...this.fx.worldObjects
        ];
        const ui = [
            ...this.hud,
            ...this.fx.uiObjects,
            this.miniMapBackground,
            this.miniMapImage,
            this.miniMapPlayer,
            this.miniMapFrame,
            this.miniMapLabel
        ];

        this.cameras.main.ignore(ui);
        this.uiCam.ignore(world);
    }

    createLightMinimap() {
        const { width, height } = this.scale;

        // Minimapa leve: o traçado é uma imagem pré-renderizada a partir
        // da própria camada "Pista" do Tiled. Assim o desenho é fiel ao
        // circuito e não precisamos de uma segunda câmera renderizando o
        // mapa inteiro a cada frame.
        this.miniW = Math.min(210, width - 28);
        this.miniH = 114;
        this.miniX = 14;
        this.miniY = height - this.miniH - 18;

        this.miniMapBackground = this.add.rectangle(
            this.miniX + this.miniW / 2,
            this.miniY + this.miniH / 2,
            this.miniW,
            this.miniH,
            0x050711,
            0.94
        ).setScrollFactor(0).setDepth(7000);

        this.miniMapImage = this.add.image(
            this.miniX + this.miniW / 2,
            this.miniY + this.miniH / 2 + 2,
            'minimapTrack'
        ).setOrigin(0.5).setScrollFactor(0).setDepth(7001);

        // O PNG foi gerado usando exatamente o contorno da camada Pista.
        // Estes limites correspondem ao recorte do mapa usado no PNG.
        this.miniWorldMinX = 312;
        this.miniWorldMaxX = 5832;
        this.miniWorldMinY = 760;
        this.miniWorldMaxY = 3648;

        // IMPORTANTE: o PNG já é uma representação completa do circuito.
        // Antes ele era escalado duas vezes (mundo -> minimapa e PNG ->
        // minimapa), fazendo a pista aparecer como um pontinho no centro.
        // Agora o desenho ocupa o painel inteiro, mantendo a proporção do
        // circuito. Só o marcador do carro é atualizado durante a corrida.
        this.miniTrackScale = Math.min(
            (this.miniW - 10) / 460,
            (this.miniH - 10) / 250
        );

        const displayW = 460 * this.miniTrackScale;
        const displayH = 250 * this.miniTrackScale;

        this.miniMapImage.setDisplaySize(displayW, displayH);

        this.miniMapFrame = this.add.rectangle(
            this.miniX + this.miniW / 2,
            this.miniY + this.miniH / 2,
            this.miniW,
            this.miniH,
            0x000000,
            0
        ).setScrollFactor(0).setDepth(7003)
            .setStrokeStyle(2, 0x00e5ff, 0.9);

        this.miniMapLabel = this.add.text(
            this.miniX + 8,
            this.miniY - 14,
            'MAPA',
            {
                fontFamily: 'monospace',
                fontSize: '10px',
                fontStyle: 'bold',
                color: '#00e5ff'
            }
        ).setScrollFactor(0).setDepth(7004);

        // Marcador do jogador: somente este objeto muda a cada frame.
        // Marcador do jogador: uma bolinha simples, leve e fácil de enxergar.
        this.miniMapPlayer = this.add.circle(
            0, 0, 5,
            0xff2bd6, 1
        ).setScrollFactor(0).setDepth(7005);
        this.miniMapPlayer.setStrokeStyle(1.5, 0xffffff, 1);

        this.updateMinimap();
    }

    updateMinimap() {
        if (!this.miniMapPlayer || !this.car) return;

        const displayW = 460 * this.miniTrackScale;
        const displayH = 250 * this.miniTrackScale;
        const trackLeft = this.miniX + (this.miniW - displayW) / 2;
        const trackTop = this.miniY + (this.miniH - displayH) / 2;

        const x = Phaser.Math.Clamp(
            trackLeft + (this.car.x - this.miniWorldMinX) /
                (this.miniWorldMaxX - this.miniWorldMinX) * displayW,
            trackLeft,
            trackLeft + displayW
        );

        const y = Phaser.Math.Clamp(
            trackTop + (this.car.y - this.miniWorldMinY) /
                (this.miniWorldMaxY - this.miniWorldMinY) * displayH,
            trackTop,
            trackTop + displayH
        );

        this.miniMapPlayer.setPosition(x, y);
        this.miniMapPlayer.setRotation(this.car.rotation);
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
        this.checkCheckpointFallback();
        this.updateLapSystem();
        if (this.fx) this.fx.update(time, delta);
        if (this.audio) this.audio.update();
        if (this.turboBarFill) this.updateHud();
        this.updateMinimap();
    }
}
export default Race;
