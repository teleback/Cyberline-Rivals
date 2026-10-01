import Car from '../objects/Car.js';
import TurboFX from '../fx/TurboFX.js';
import OilFX from '../fx/OilFX.js';
import TurboAudio from '../fx/TurboAudio.js';
import EngineAudio from '../fx/EngineAudio.js';
import CarDropIn from '../fx/CarDropIn.js';
import StartCountdown from '../fx/StartCountdown.js';
import CarFX from '../fx/CarFX.js';
import { showTouchControls, hideTouchControls } from '../input/TouchControls.js';
import MQTTClient from '../MQTTClient.js';

class Race extends Phaser.Scene {
    constructor() { super('Race'); }

    create(data = {}) {
        // A seleção feita antes da corrida define a aparência do carro.
        // O `carSkin` fica no objeto de cena para podermos sincronizá-lo
        // depois com o multiplayer MQTT.
        this.playerNick = data.playerNick || 'PILOTO';
        this.roomId = Number(data.roomId) || 1;
        this.multiplayer = new MQTTClient(this, data.playerId);
        this.playerId = this.multiplayer.playerId;
        this.carSkin = data.carSkin || 'cyan';
        this.carTint = data.carTint || 0x00e5ff;
        this.remotePlayers = {};
        this.lastNetworkSend = 0;
        this.networkSendInterval = 33; // ~30 atualizações/s
        this.localCarReady = false;
        this.raceStartAt = null;
        this.startCountdownStarted = false;
        this.pendingClockProbes = new Map();
        this.clockOffsets = new Map();
        this.networkRoundTrips = new Map();
        this.podiumShown = false;
        this.finishElapsedMs = null;
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

        // CRONÔMETRO DA CORRIDA
        // Começa somente quando o "VAI!" libera os controles e para ao
        // cruzar a chegada. O valor é baseado no relógio interno do Phaser,
        // então não depende da taxa de atualização do HUD.
        this.raceTimerStarted = false;
        this.raceStartTime = 0;
        this.raceElapsedMs = 0;

        // SISTEMA DE PONTUAÇÃO
        // Pontos base: terminar +1, cada volta +1, cada checkpoint +1,
        // 1º lugar +2. Pontuação final = pontos base × multiplicador de tempo.
        // Ajuste os limites de tempo (em segundos) aqui, se precisar.
        this.scoreRules = {
            finish: 1,
            lap: 1,
            checkpoint: 1,
            firstPlace: 2,
            // do mais rápido para o mais lento; acima do último = ×1
            multipliers: [
                { maxSeconds: 150, value: 2 },
                { maxSeconds: 200, value: 1.5 },
                { maxSeconds: 270, value: 1.25 }
            ]
        };
        this.baseScore = 0;
        this.scoreStats = { checkpoints: 0, laps: 0 };

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
        // Os dois pilotos usam faixas diferentes da reta de largada para
        // nascerem lado a lado, sem um carro ficar dentro do outro.
        this.playerSlot = MQTTClient.slotFor(this.playerId);
        const networkStartY = startY + (this.playerSlot === 0 ? -58 : 58);
        this.startLineY = startY;
        this.car = new Car(this, startX, networkStartY, 'carro');
        this.car.setTint(this.carTint);
        this.car.setDepth(1000);
        // A pista aqui é uma reta horizontal (a linha de chegada corta ela
        // na vertical): o carro precisa nascer virado de lado, não de
        // "cabeça pra cima" como o sprite vem por padrão. -90° = de frente
        // pra esquerda (sentido contrário à curva que vem depois da linha).
        this.car.setAngle(-90);
        this.previousCarX = this.car.x;
        this.networkStartX = startX;
        this.networkStartY = networkStartY;

        // Colisões desenhadas no Tiled. São DUAS camadas de objetos:
        //  - "colisao": as 4 paredes externas do mapa;
        //  - "colisoes pista": os muros/limites da pista em si (642 objetos).
        // Antes só a primeira era lida, então a pista inteira ficava sem
        // colisão. Agora as duas viram corpos estáticos invisíveis.
        this.walls = this.physics.add.staticGroup();
        ['colisao', 'colisoes pista'].forEach(name => this.createWallsFromLayer(name));
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
        this.carFX = new CarFX(this, this.car);
        this.audio = new TurboAudio(this.car);
        // Motor + freio/derrapagem (loops do mp3 + síntese). Só lê o carro.
        this.engineAudio = new EngineAudio(this, this.car);
        this.events.once('shutdown', () => this.engineAudio && this.engineAudio.destroy());
        this.createObstacles();
        this.createOilZones();

        this.buildHud();
        this.updateCheckpointHud();
        this.createChampionOverlay();
        this.splitCameras();

        // O carro já nasce na posição certa (startX/startY), mas some pra
        // cima e cai de volta nela — ver CarDropIn pra a animação completa.
        // Só depois do pouso É QUE entra a contagem regressiva; os
        // controles ficam travados até o "VAI!".
        // Celular: joystick + botão de turbo aparecem junto com a partida
        // (e somem ao terminar a corrida ou se a cena for encerrada).
        showTouchControls();
        this.events.once('shutdown', hideTouchControls);
        this.events.once('shutdown', () => {
            if (this.multiplayer) {
                this.multiplayer.disconnect();
                this.multiplayer = null;
            }
            Object.values(this.remotePlayers).forEach(remote => {
                remote.sprite?.destroy();
                remote.label?.destroy();
            });
            this.remotePlayers = {};
        });

        this.dropIn = new CarDropIn(this, this.car);
        this.dropIn.play(startX, networkStartY, {
            onLand: () => this.onLocalCarReady()
        });

        // MQTT: entra na sala escolhida e passa a publicar/receber a posição
        // dos pilotos. O estado de cada jogador é retido pelo broker, então
        // quem entrar alguns segundos depois ainda recebe o carro adversário.
        this.initMultiplayer();

        this.input.keyboard.on('keydown-M', () => {
            const muted = this.audio.toggleMute();
            this.sound.mute = muted;
            this.muteLabel.setText(muted ? 'SOM: OFF  [M]' : 'SOM: ON  [M]');
        });
    }

    async initMultiplayer() {
        this.multiplayer.on('status', (status) => {
            console.log(`[MQTT] sala ${this.roomId}: ${status}`);
            this.updateLobbyStatus();
        });

        this.multiplayer.on('player', (state) => this.receiveRemotePlayer(state));

        try {
            await this.multiplayer.connect(this.roomId, {
                nick: this.playerNick,
                skin: this.carSkin,
                tint: this.carTint
            });

            // Publica imediatamente o estado inicial, mesmo antes do primeiro
            // frame de movimento.
            this.publishNetworkState(true, true);
            this.sendClockProbe();
            this.time.addEvent({
                delay: 3000,
                loop: true,
                callback: () => this.sendClockProbe()
            });
            this.updateLobbyStatus();
            this.tryCoordinateStart();
        } catch (error) {
            console.error('[MQTT] Não foi possível conectar ao multiplayer:', error);
            this.updateLobbyStatus();
        }
    }

    sendClockProbe() {
        if (!this.multiplayer?.connected) return;
        const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const sentAt = Date.now();
        this.pendingClockProbes.set(nonce, sentAt);
        if (this.pendingClockProbes.size > 8) {
            this.pendingClockProbes.delete(this.pendingClockProbes.keys().next().value);
        }
        this.publishNetworkState(true, false, { syncRequest: { nonce, sentAt } });
    }

    publishNetworkState(force = false, retain = false, extra = {}) {
        if (!this.multiplayer || !this.multiplayer.connected || !this.car) return;

        const now = performance.now();
        if (!force && now - this.lastNetworkSend < this.networkSendInterval - 3) return;
        this.lastNetworkSend = now;

        this.multiplayer.publish({
            id: this.multiplayer.playerId,
            sessionId: this.multiplayer.sessionId,
            nick: this.playerNick,
            skin: this.carSkin,
            tint: this.carTint,
            online: true,
            ready: this.localCarReady,
            startAt: this.raceStartAt,
            finished: this.raceFinished,
            finishElapsedMs: this.finishElapsedMs,
            // Durante a queda (CarDropIn) o carro está no ar e encolhido:
            // publica a posição final da largada, não a do tween.
            x: this.localCarReady ? this.car.x : this.networkStartX,
            y: this.localCarReady ? this.car.y : this.networkStartY,
            rotation: this.localCarReady ? this.car.rotation : -Math.PI / 2,
            vx: this.localCarReady ? (this.car.body?.velocity?.x || 0) : 0,
            vy: this.localCarReady ? (this.car.body?.velocity?.y || 0) : 0,
            speed: this.localCarReady ? (this.car.body?.speed || 0) : 0,
            angularVelocity: this.localCarReady ? (this.car.body?.angularVelocity || 0) : 0,
            controls: this.car.networkControls,
            turboActive: this.car.isTurboActive,
            turboIntensity: this.car.turboIntensity,
            drifting: this.car.isDrifting,
            lap: this.currentLap,
            ts: Date.now(),
            ...extra
        }, { retain });
    }

    receiveRemotePlayer(state) {
        if (!state || !state.id || state.id === this.playerId) return;

        if (state.syncRequest?.nonce && Number.isFinite(state.syncRequest.sentAt)) {
            const remoteReceivedAt = Date.now();
            this.publishNetworkState(true, false, {
                syncResponse: {
                    nonce: state.syncRequest.nonce,
                    sentAt: state.syncRequest.sentAt,
                    remoteReceivedAt,
                    remoteSentAt: Date.now()
                }
            });
        }

        const response = state.syncResponse;
        const probeSentAt = response && this.pendingClockProbes.get(response.nonce);
        if (Number.isFinite(probeSentAt)
            && Number.isFinite(response.remoteReceivedAt)
            && Number.isFinite(response.remoteSentAt)) {
            const localReceivedAt = Date.now();
            const offset = (
                (response.remoteReceivedAt - probeSentAt)
                + (response.remoteSentAt - localReceivedAt)
            ) / 2;
            const roundTripMs = Math.max(0,
                localReceivedAt - probeSentAt
                - (response.remoteSentAt - response.remoteReceivedAt)
            );
            const previousOffset = this.clockOffsets.get(state.id);
            const smoothedOffset = previousOffset === undefined
                ? offset
                : previousOffset + (offset - previousOffset) * 0.2;
            this.clockOffsets.set(state.id, smoothedOffset);
            this.networkRoundTrips.set(state.id, roundTripMs);
            const existingRemote = this.remotePlayers[state.id];
            if (existingRemote) {
                existingRemote.clockOffset = smoothedOffset;
                existingRemote.roundTripMs = roundTripMs;
                if (existingRemote.startAt !== null && this.playerId.localeCompare(state.id) > 0) {
                    this.raceStartAt = existingRemote.startAt - smoothedOffset;
                }
            }
            this.pendingClockProbes.delete(response.nonce);
        }

        if (state.online === false) {
            this.removeRemotePlayer(state.id);
            return;
        }

        let remote = this.remotePlayers[state.id];
        if (!remote && Object.keys(this.remotePlayers).length >= 1) return;
        if (!remote) {
            const remoteSlot = MQTTClient.slotFor(state.id);
            const baseY = this.networkStartY - (this.playerSlot === 0 ? -58 : 58);
            const initialX = this.networkStartX;
            const initialY = baseY + (remoteSlot === 0 ? -58 : 58);
            const tint = Number.isFinite(state.tint) ? state.tint : 0x00e5ff;
            const sprite = this.physics.add.image(initialX, initialY, 'carro')
                .setTint(tint)
                .setDepth(999)
                .setVisible(false);
            sprite.setRotation(-Math.PI / 2);
            sprite.body.setCircle(24, 25.5, 56);
            sprite.body.setImmovable(true);
            sprite.body.setAllowGravity(false);
            const collider = this.physics.add.collider(this.car, sprite);
            collider.active = false;

            const label = this.add.text(0, 0, state.nick || 'RIVAL', {
                fontFamily: 'monospace',
                fontSize: '11px',
                fontStyle: 'bold',
                color: '#ffffff',
                backgroundColor: '#05060acc',
                padding: { left: 4, right: 4, top: 2, bottom: 2 }
            }).setOrigin(0.5, 1).setDepth(1001).setVisible(false);

            remote = this.remotePlayers[state.id] = {
                id: state.id,
                sessionId: state.sessionId || null,
                sprite,
                label,
                collider,
                online: true,
                ready: false,
                finished: false,
                finishElapsedMs: null,
                startAt: null,
                tint,
                nick: state.nick || 'RIVAL',
                clockOffset: this.clockOffsets.get(state.id) || 0,
                roundTripMs: this.networkRoundTrips.get(state.id) || 0,
                turboIntensity: 0,
                networkControls: null,
                snapshots: [],
                lastNetworkTs: 0,
                offsetSamples: [],
                timeOffset: null,
                shown: false,
                lastSeen: Date.now()
            };

            if (this.uiCam) {
                this.uiCam.ignore([sprite, label]);
            }
        }

        if (state.sessionId && remote.sessionId && state.sessionId !== remote.sessionId) {
            remote.ready = false;
            remote.finished = false;
            remote.finishElapsedMs = null;
            remote.startAt = null;
            remote.snapshots = [];
            remote.lastNetworkTs = 0;
            remote.offsetSamples = [];
            remote.timeOffset = null;
        }
        remote.sessionId = state.sessionId || remote.sessionId;
        remote.online = true;
        remote.lastSeen = Date.now();
        remote.ready = state.ready === true;
        remote.finished = state.finished === true;
        remote.finishElapsedMs = typeof state.finishElapsedMs === 'number' && Number.isFinite(state.finishElapsedMs)
            ? Number(state.finishElapsedMs)
            : null;
        remote.startAt = typeof state.startAt === 'number' && Number.isFinite(state.startAt)
            ? state.startAt
            : null;

        const isCoordinator = this.playerId.localeCompare(state.id) < 0;
        if (!isCoordinator) {
            this.raceStartAt = remote.startAt === null
                ? null
                : remote.startAt - remote.clockOffset;
        }

        const networkTs = Number(state.ts) || Date.now();
        // Mapeia o relógio do rival para o local usando o MENOR atraso
        // observado numa janela de 4s (independe das sondas de relógio, que
        // antes zeravam o buffer e deslocavam todos os snapshots).
        const arrival = Date.now();
        remote.offsetSamples.push({ t: arrival, v: arrival - networkTs });
        while (remote.offsetSamples.length && arrival - remote.offsetSamples[0].t > 4000) remote.offsetSamples.shift();
        const targetOffset = Math.min(...remote.offsetSamples.map(o => o.v));
        remote.timeOffset = remote.timeOffset === null
            ? targetOffset
            : remote.timeOffset + (targetOffset - remote.timeOffset) * 0.05;
        if (Number.isFinite(Number(state.x)) && Number.isFinite(Number(state.y))
            && networkTs > remote.lastNetworkTs) {
            remote.snapshots.push({
                x: Number(state.x),
                y: Number(state.y),
                rotation: Number.isFinite(Number(state.rotation)) ? Number(state.rotation) : -Math.PI / 2,
                vx: Number(state.vx) || 0,
                vy: Number(state.vy) || 0,
                angularVelocity: Number(state.angularVelocity) || 0,
                turboIntensity: Phaser.Math.Clamp(Number(state.turboIntensity) || 0, 0, 1),
                turboActive: state.turboActive === true,
                drifting: state.drifting === true,
                controls: state.controls || null,
                receivedAt: networkTs + remote.timeOffset
            });
            remote.lastNetworkTs = networkTs;
            if (remote.snapshots.length > 12) remote.snapshots.shift();
        }

        if (state.tint !== undefined) remote.tint = Number(state.tint) || 0x00e5ff;
        if (state.nick) remote.nick = state.nick;
        remote.networkControls = state.controls || remote.networkControls;
        remote.turboIntensity = Phaser.Math.Clamp(Number(state.turboIntensity) || 0, 0, 1);
        const remoteStatus = state.turboActive ? 'TURBO'
            : state.drifting ? 'DRIFT'
                : `${Math.round((Number(state.speed) || 0) * 0.42)} KM/H`;
        const labelText = `${remote.nick}  ${remoteStatus}`;
        if (remote.label.text !== labelText) remote.label.setText(labelText);
        remote.sprite.setTint(state.turboActive ? 0xff5577 : remote.tint);
        remote.sprite.setScale(1 + remote.turboIntensity * 0.045);
        if (!remote.shown && remote.ready && remote.snapshots.length) {
            remote.shown = true;
            const f = remote.snapshots[remote.snapshots.length - 1];
            remote.sprite.setPosition(f.x, f.y).setRotation(f.rotation).setVisible(true);
            remote.sprite.body.reset(f.x, f.y);
            remote.label.setVisible(true);
        }
        this.updateLobbyStatus();
        this.tryCoordinateStart();
        this.tryResolvePodium();
    }

    updateRemotePlayers(delta) {
        const now = Date.now();
        Object.entries(this.remotePlayers).forEach(([id, remote]) => {
            if (!remote.online) return;
            if (now - remote.lastSeen > 3500) {
                this.removeRemotePlayer(id);
                return;
            }

            const snapshots = remote.snapshots;
            if (!snapshots.length || !remote.shown) return;

            const bufferMs = 100;
            const renderAt = Date.now() - bufferMs;
            while (snapshots.length > 2 && snapshots[1].receivedAt <= renderAt) snapshots.shift();
            const first = snapshots[0];
            const second = snapshots[1] || first;
            let x, y, rotation;
            if (renderAt < first.receivedAt) {
                const extrapolateSeconds = Math.max(-0.06, (renderAt - first.receivedAt) / 1000);
                x = first.x + first.vx * extrapolateSeconds;
                y = first.y + first.vy * extrapolateSeconds;
                rotation = first.rotation + first.angularVelocity * (Math.PI / 180) * extrapolateSeconds;
            } else if (snapshots.length > 1 && renderAt <= second.receivedAt) {
                const span = Math.max(1, second.receivedAt - first.receivedAt);
                const alpha = Phaser.Math.Clamp((renderAt - first.receivedAt) / span, 0, 1);
                const angleDelta = Phaser.Math.Angle.Wrap(second.rotation - first.rotation);
                x = Phaser.Math.Linear(first.x, second.x, alpha);
                y = Phaser.Math.Linear(first.y, second.y, alpha);
                rotation = first.rotation + angleDelta * alpha;
            } else {
                const latest = snapshots[snapshots.length - 1];
                const extrapolateSeconds = Math.min(120, Math.max(0, renderAt - latest.receivedAt)) / 1000;
                x = latest.x + latest.vx * extrapolateSeconds;
                y = latest.y + latest.vy * extrapolateSeconds;
                rotation = latest.rotation + latest.angularVelocity * (Math.PI / 180) * extrapolateSeconds;
            }

            remote.sprite.setPosition(x, y);
            remote.sprite.rotation = rotation;
            remote.sprite.body.updateFromGameObject();

            remote.label.setPosition(remote.sprite.x, remote.sprite.y - 82);
        });
    }

    removeRemotePlayer(id) {
        const remote = this.remotePlayers[id];
        if (!remote) return;
        if (remote.finished && Number.isFinite(remote.finishElapsedMs)) {
            remote.online = false;
            remote.lastSeen = Date.now();
            this.updateLobbyStatus();
            this.tryResolvePodium();
            return;
        }
        remote.collider?.destroy();
        remote.sprite?.destroy();
        remote.label?.destroy();
        delete this.remotePlayers[id];
        this.updateLobbyStatus();
        this.tryCoordinateStart();
    }

    getActiveOpponents() {
        const now = Date.now();
        return Object.values(this.remotePlayers).filter(player =>
            player.online && now - player.lastSeen <= 3500
        );
    }

    hasReadyPair() {
        const opponents = this.getActiveOpponents();
        return this.multiplayer?.connected === true
            && this.localCarReady
            && opponents.length === 1
            && opponents[0].ready;
    }

    onLocalCarReady() {
        this.localCarReady = true;
        this.publishNetworkState(true, true);
        this.updateLobbyStatus();
        this.tryCoordinateStart();
    }

    updateLobbyStatus() {
        if (!this.roomStatusLabel || this.raceTimerStarted || this.raceFinished) return;
        const opponents = this.getActiveOpponents();
        let message = 'CONECTANDO À SALA...';
        if (this.multiplayer?.connected) {
            if (opponents.length === 0) message = 'AGUARDANDO OUTRO JOGADOR...';
            else if (opponents.length > 1) message = 'SALA CHEIA — MÁXIMO 2 JOGADORES';
            else if (!this.localCarReady || !opponents[0].ready) message = 'AGUARDANDO OS DOIS CARROS...';
            else message = 'PREPARANDO A LARGADA...';
        }
        this.roomStatusLabel.setText(message).setVisible(true);
    }

    alignStartingCars(opponent) {
        if (!this.localCarReady || this.startSlotsAppliedTo === opponent.id) return;
        this.startSlotsAppliedTo = opponent.id;

        // Só há ajuste se os dois caíram na mesma faixa; o de id maior
        // troca de faixa (deslizando, sem teleporte). O rival publica a
        // própria posição, então nada é forçado no sprite remoto.
        const localSlot0 = MQTTClient.slotFor(this.playerId);
        const remoteSlot0 = MQTTClient.slotFor(opponent.id);
        let localSlot = localSlot0;
        if (localSlot0 === remoteSlot0 && this.playerId.localeCompare(opponent.id) > 0) {
            localSlot = 1 - localSlot0;
        }
        this.playerSlot = localSlot;
        const localY = this.startLineY + (localSlot === 0 ? -58 : 58);
        if (Math.abs(this.car.y - localY) < 1) return;
        this.networkStartY = localY;
        this.car.body.setVelocity(0, 0);
        this.tweens.add({
            targets: this.car,
            y: localY,
            duration: 350,
            ease: 'Sine.easeInOut',
            onUpdate: () => this.car.body.reset(this.car.x, this.car.y),
            onComplete: () => {
                this.car.body.reset(this.networkStartX, localY);
                this.car.setAngle(-90);
            }
        });
    }

    tryCoordinateStart() {
        if (this.raceTimerStarted || this.raceFinished) return;
        const opponents = this.getActiveOpponents();
        const opponent = opponents.length === 1 ? opponents[0] : null;
        const ready = this.hasReadyPair();

        if (!ready) {
            if (this.startCountdownStarted) {
                this.countdown?.cancel();
                this.countdown = null;
                this.startCountdownStarted = false;
            }
            if (this.raceStartAt !== null) {
                const isCoordinator = !opponent || this.playerId.localeCompare(opponent.id) < 0;
                this.raceStartAt = null;
                if (isCoordinator && this.multiplayer?.connected) this.publishNetworkState(true, true);
            }
            this.updateLobbyStatus();
            return;
        }

        this.alignStartingCars(opponent);
        const isCoordinator = this.playerId.localeCompare(opponent.id) < 0;
        if (isCoordinator && this.raceStartAt === null) {
            this.raceStartAt = Date.now() + 5000;
            this.publishNetworkState(true, true);
        } else if (!isCoordinator && Number.isFinite(opponent.startAt)) {
            this.raceStartAt = opponent.startAt - opponent.clockOffset;
        }

        this.updateLobbyStatus();
        if (this.raceStartAt && Date.now() >= this.raceStartAt - 3120) this.startCountdown();
    }

    startCountdown() {
        if (this.startCountdownStarted || !this.raceStartAt || !this.hasReadyPair()) return;
        this.startCountdownStarted = true;
        try {
            this.countdown = new StartCountdown(this);
            this.countdown.play(() => {
                this.beginRace();
            }, this.raceStartAt);
        } catch (e) {
            console.error('RaceScene: contagem regressiva falhou.', e);
            this.time.delayedCall(Math.max(0, this.raceStartAt - Date.now()), () => this.beginRace());
        }
    }

    beginRace() {
        if (!this.hasReadyPair() || !this.raceStartAt) return;
        this.roomStatusLabel?.setVisible(false);
        Object.values(this.remotePlayers).forEach(remote => {
            if (remote.online && remote.collider) remote.collider.active = true;
        });
        this.car.controlsEnabled = true;
        this.startRaceTimer();
    }

    startRaceTimer() {
        if (this.raceTimerStarted || this.raceFinished) return;

        this.raceTimerStarted = true;
        this.raceStartTime = this.time.now;
        this.raceElapsedMs = 0;
        this.updateRaceTimerHud();
        this.publishNetworkState(true, true);
    }

    updateRaceTimerHud() {
        if (!this.raceTimerLabel) return;

        const elapsed = this.raceTimerStarted
            ? (this.raceFinished ? this.raceElapsedMs : this.time.now - this.raceStartTime)
            : 0;

        this.raceTimerLabel.setText(this.formatRaceTime(Math.max(0, elapsed)));
    }

    formatRaceTime(ms) {
        const totalCentiseconds = Math.floor(ms / 10);
        const minutes = Math.floor(totalCentiseconds / 6000);
        const seconds = Math.floor((totalCentiseconds % 6000) / 100);
        const centiseconds = totalCentiseconds % 100;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
    }

    // Cria os corpos estáticos de colisão a partir de uma camada de objetos
    // do Tiled. Tratamento de cada tipo de objeto:
    //  - retângulo normal: vira um corpo retangular do mesmo tamanho;
    //  - "ponto" (largura e altura ~0, feito com um clique só no Tiled — a
    //    pista tem ~550 desses, formando as curvas): vira um círculo de
    //    raio POINT_RADIUS. Como estão ~22px um do outro, os círculos se
    //    sobrepõem e formam um muro contínuo;
    //  - retângulo fino demais (uma dimensão ~0): ganha espessura mínima,
    //    senão o carro atravessaria.
    createWallsFromLayer(layerName) {
        const layer = this.map.getObjectLayer(layerName);
        if (!layer) {
            console.warn(`[Race] Camada de colisão "${layerName}" não encontrada no Tiled.`);
            return;
        }
        const POINT_RADIUS = 14;
        const MIN_THICKNESS = 4;

        layer.objects.forEach(obj => {
            const w = obj.width || 0;
            const h = obj.height || 0;
            const isPoint = w < 2 && h < 2;

            let cx, cy, bw, bh;
            if (isPoint) {
                cx = obj.x; cy = obj.y;
                bw = bh = POINT_RADIUS * 2;
            } else {
                bw = Math.max(w, MIN_THICKNESS);
                bh = Math.max(h, MIN_THICKNESS);
                cx = obj.x + w / 2;
                cy = obj.y + h / 2;
            }

            const wall = this.add.rectangle(cx, cy, bw, bh);
            wall.setVisible(false);
            this.physics.add.existing(wall, true);
            if (isPoint) wall.body.setCircle(POINT_RADIUS);
            this.walls.add(wall);
        });
    }

    onCrash() {
        if (this.car.turboIntensity < 0.25) return;
        this.car.turboSpool = 0;
        this.car.turboFuel = Math.max(0, this.car.turboFuel - 22);
        this.cameras.main.shake(180, 0.011);
    }

    // ------------------------------------------------------------------
    // OBSTÁCULOS (barris azuis)
    // ------------------------------------------------------------------
    // Posições calculadas a partir da própria camada "Pista" do Tiled,
    // uma por trecho de pista (nunca colado numa curva fechada, sempre
    // afastado das placas de boost, dos checkpoints e da linha de
    // chegada). Cada ponto já vem deslocado ~90px pro lado a partir do
    // centro do corredor — o carro sempre tem espaço livre de um lado
    // pra desviar, em vez do barril bloquear bem no meio da pista.
    createObstacles() {
        const obstacleSpots = [
            { x: 1248, y: 838 },
            { x: 3424, y: 1018 },
            { x: 4090, y: 1440 },
            { x: 2310, y: 1696 },
            { x: 5242, y: 2528 },
            { x: 1030, y: 2656 },
            { x: 570, y: 3104 },
            { x: 3296, y: 3398 },
            { x: 4832, y: 3578 }
        ];

        // Só o barril azul. Corpo de colisão em círculo (mais barato que
        // retângulo aqui e não precisa se preocupar com rotação do
        // sprite).
        // O desenho do barril ocupa x=3..44, y=24..92 do frame 48x96
        // (centro em ~23.5, 58). O círculo antigo (raio 16 no centro do
        // frame) cobria só uma fatia pequena e ficava ~10px acima do
        // desenho, então o carro entrava no barril. Agora ele cobre a
        // largura toda do barril.
        const kind = { key: 'barril', cx: 23.5, cy: 58, radius: 20 };

        this.obstacles = this.physics.add.staticGroup();

        obstacleSpots.forEach((spot) => {
            const obstacle = this.obstacles.create(spot.x, spot.y, kind.key);
            obstacle.setDepth(500);
            obstacle.body.setCircle(
                kind.radius,
                kind.cx - kind.radius,
                kind.cy - kind.radius
            );
            obstacle.refreshBody();
            obstacle.hitCooldownUntil = 0;
            // Ponto do chão onde o barril "pisa" (base do desenho). Usado
            // pra decidir se o carro está na frente ou atrás dele.
            obstacle.groundY = spot.y + (92 - 48);
        });

        // Um collider só (com callback), do mesmo jeito que a colisão com
        // as paredes: dois colliders pro mesmo par resolveriam a física
        // duas vezes e disparariam o efeito em dobro.
        this.physics.add.collider(this.car, this.obstacles, (car, obstacle) => {
            this.onObstacleHit(obstacle);
        });
    }

    // Ordem de desenho barril x carro (top-down com barril "em pé"):
    // se o carro está ATRÁS do barril (mais pra cima na tela), o barril
    // desenha por cima; se está na frente (mais pra baixo), o carro
    // desenha por cima. Sem isso o carro sempre ficava por cima do barril
    // (depth 500 < 1000), mesmo passando por trás dele.
    // 1010 fica acima do carro (1000) e das partículas dele (<=1002), e
    // abaixo do HUD/pontuação (>=1090).
    sortObstacleDepth() {
        if (!this.obstacles) return;
        const carY = this.car.y;
        this.obstacles.getChildren().forEach((obstacle) => {
            // só mexe quando o carro está por perto (barato)
            if (Math.abs(this.car.x - obstacle.x) > 220) {
                if (obstacle.depth !== 500) obstacle.setDepth(500);
                return;
            }
            const depth = carY < obstacle.groundY ? 1010 : 500;
            if (obstacle.depth !== depth) obstacle.setDepth(depth);
        });
    }

    onObstacleHit(obstacle) {
        const now = this.time.now;
        if (now < obstacle.hitCooldownUntil) return;
        obstacle.hitCooldownUntil = now + 700;

        // Só pune de verdade se o carro vinha com alguma velocidade —
        // encostar de leve, quase parado, não devia contar como batida.
        if (this.car.body.speed < 40) return;

        // O impacto tira uma boa parte da velocidade na hora — sem isso
        // o obstáculo vira decoração que o carro atravessa raspando.
        this.car.body.velocity.scale(0.45);
        this.car.turboSpool = 0;
        this.car.turboFuel = Math.max(0, this.car.turboFuel - 18);

        this.cameras.main.shake(200, 0.014);

        // Feedback no próprio obstáculo: pisca vermelho e sacode um pouco.
        this.tweens.killTweensOf(obstacle);
        obstacle.setTint(0xff6b6b);
        this.tweens.add({
            targets: obstacle,
            angle: obstacle.angle + Phaser.Math.Between(-6, 6),
            duration: 90,
            yoyo: true,
            ease: 'Quad.easeOut',
            onComplete: () => obstacle.clearTint()
        });

        // Reaproveita as faíscas do turbo pra não criar outro emissor.
        if (this.fx && this.fx.sparks) {
            this.fx.sparks.explode(18, this.car.x, this.car.y);
        }
    }

    // ------------------------------------------------------------------
    // ZONAS DE ÓLEO
    // ------------------------------------------------------------------
    // Sensor por cima da pista (overlap, não collider — óleo não é
    // parede, o carro atravessa por cima). Enquanto o carro estiver
    // sobre qualquer mancha, ele é desacelerado com força (ver
    // Car.applyOilDeceleration). `isOnOil` é recalculado todo frame em
    // update(), então ao sair da mancha o carro volta ao normal.
    createOilZones() {
        const oilSpots = [
            { x: 480, y: 928, tex: 'zonaoleo' },
            { x: 2400, y: 928, tex: 'zonaoleo2' },
            { x: 1440, y: 1120, tex: 'zonaoleo' },
            { x: 4000, y: 1760, tex: 'zonaoleo2' },
            { x: 1952, y: 1888, tex: 'zonaoleo' },
            { x: 4896, y: 1888, tex: 'zonaoleo2' },
            { x: 480, y: 2144, tex: 'zonaoleo' },
            { x: 2400, y: 2720, tex: 'zonaoleo2' },
            { x: 5664, y: 3168, tex: 'zonaoleo' },
            { x: 3616, y: 3488, tex: 'zonaoleo2' }
        ];

        this.oilSensors = this.physics.add.staticGroup();
        this.oilVisuals = this.add.container(0, 0).setDepth(480);

        const oilFxSpots = [];

        // Área que realmente ativa o óleo, medida em cima do que aparece
        // desenhado em cada textura (a mancha não preenche o quadrado todo).
        // Antes o sensor era um quadrado 60x60 igual pras duas, bem mais
        // alto que a mancha — o óleo pegava onde não tinha nada e, com a
        // física do carro deslocada, falhava onde tinha. dx/dy alinham o
        // sensor ao centro real da mancha.
        const oilHit = {
            zonaoleo:  { w: 62, h: 38, dx: -1, dy: 3 },
            zonaoleo2: { w: 69, h: 37, dx: -1, dy: -1 }
        };

        oilSpots.forEach((spot) => {
            const puddle = this.add.image(spot.x, spot.y, spot.tex);
            puddle.setDisplaySize(84, 84);
            puddle.setAlpha(0.92);
            this.oilVisuals.add(puddle);

            const hit = oilHit[spot.tex];
            const sensor = this.add.rectangle(spot.x + hit.dx, spot.y + hit.dy, hit.w, hit.h);
            sensor.setVisible(false);
            this.physics.add.existing(sensor, true);
            this.oilSensors.add(sensor);
            oilFxSpots.push({ sensor, puddle });
        });

        // Animação da zona de óleo (só visual — a mecânica de
        // desaceleração está no Car). Criada aqui, antes de
        // splitCameras(), pra câmera de UI ignorar os objetos dela.
        this.oilFX = new OilFX(this, this.car, oilFxSpots, this.oilVisuals);
    }

    createBoostSensors() {
        if (!this.boostLayer) return;

        this.boostLayer.setVisible(false);

        const boostPositions = [
            { x: 46, y: 54, direction: Math.PI },
            { x: 70, y: 54, direction: Math.PI },
            { x: 85, y: 45, direction: Math.PI / 2 },
            { x: 65, y: 42, direction: Math.PI },
            { x: 32, y: 38, direction: Math.PI },
            { x: 22, y: 24, direction: -Math.PI / 2 },
            { x: 7.5, y: 20, direction: -Math.PI / 2 },
            { x: 48, y: 15, direction: 0 }
        ];

        this.boostSensors = this.physics.add.staticGroup();
        this.boostVisuals = this.add.container(0, 0).setDepth(900);
        this.boostData = [];

        const tileWidth = this.map.tileWidth;
        const tileHeight = this.map.tileHeight;
        // O asset é 64x96. A placa deve ficar exatamente no formato
        // horizontal da placa amarela da pista, sem deformar a arte.
        const plateWidth = tileWidth;          // 64
        const plateLength = tileHeight * 1.5;  // 96
        const carRadius = 16;                  // margem do corpo físico do carro

        boostPositions.forEach((position, index) => {
            const centerX = position.x * tileWidth + tileWidth / 2;
            const centerY = position.y * tileHeight + tileHeight / 2;
            const rotation = position.direction + Math.PI / 2;

            const plate = this.add.image(centerX, centerY, 'placaboost');
            plate.setDisplaySize(plateWidth, plateLength);
            plate.setRotation(rotation);
            plate.setOrigin(0.5);
            plate.setAlpha(1);
            this.boostVisuals.add(plate);

            // Sensor físico maior que a placa NÃO é usado para decidir o
            // acerto. Guardamos a geometria real e fazemos a interseção
            // círculo x retângulo rotacionado no update. Assim qualquer parte
            // da placa pode ser atingida, inclusive os cantos.
            const sensor = this.add.rectangle(centerX, centerY, plateLength, plateWidth);
            sensor.setVisible(false);
            this.physics.add.existing(sensor, true);
            this.boostSensors.add(sensor);

            sensor.boostCooldownUntil = 0;
            sensor.boostIndex = index;

            this.boostData.push({
                x: centerX,
                y: centerY,
                rotation,
                halfX: plateWidth / 2,
                halfY: plateLength / 2,
                radius: carRadius,
                sensor,
                plate
            });
        });

        // Efeito principal: partículas de impacto. São criadas uma vez e
        // reutilizadas para não gerar centenas de objetos durante a corrida.
        this.boostBurst = this.add.particles(0, 0, 'fx-dot', {
            lifespan: { min: 280, max: 700 },
            speed: { min: 100, max: 360 },
            scale: { start: 0.55, end: 0 },
            alpha: { start: 1, end: 0 },
            tint: [0xfff36a, 0xffa600, 0x00e5ff, 0xff22cc, 0xffffff],
            blendMode: Phaser.BlendModes.ADD,
            emitting: false
        }).setDepth(1100);

        this.boostSparkBurst = this.add.particles(0, 0, 'fx-dot', {
            lifespan: { min: 180, max: 420 },
            speed: { min: 180, max: 500 },
            scale: { start: 0.30, end: 0 },
            alpha: { start: 1, end: 0 },
            tint: [0xffffff, 0xffe34d, 0xff6b00],
            blendMode: Phaser.BlendModes.ADD,
            emitting: false
        }).setDepth(1110);
    }

    checkBoostPlates(time) {
        if (!this.car || !this.boostData) return;

        const carX = this.car.x;
        const carY = this.car.y;

        for (const boost of this.boostData) {
            if (time < boost.sensor.boostCooldownUntil) continue;

            // Transformamos a posição do carro para o espaço local da placa.
            // A placa é um retângulo rotacionado; o corpo do carro é tratado
            // como círculo. Isso faz o boost disparar ao tocar QUALQUER parte
            // da placa, e não apenas quando o centro do carro passa no meio.
            const dx = carX - boost.x;
            const dy = carY - boost.y;
            const cos = Math.cos(boost.rotation);
            const sin = Math.sin(boost.rotation);
            const localX = dx * cos + dy * sin;
            const localY = -dx * sin + dy * cos;

            const closestX = Phaser.Math.Clamp(localX, -boost.halfX, boost.halfX);
            const closestY = Phaser.Math.Clamp(localY, -boost.halfY, boost.halfY);
            const diffX = localX - closestX;
            const diffY = localY - closestY;

            // Se a distância até o retângulo for maior que o raio do
            // corpo do carro, ainda não tocou na placa. Caso contrário,
            // qualquer ponto/canto da placa conta como acerto.
            if ((diffX * diffX + diffY * diffY) > boost.radius * boost.radius) {
                continue;
            }

            this.activateBoostPlate(boost, time);
        }
    }

    activateBoostPlate(boost, time) {
        // Impede retrigger instantâneo enquanto o carro ainda está sobre a
        // placa, mas permite que ele use a mesma placa novamente depois.
        boost.sensor.boostCooldownUntil = time + 550;
        this.car.activateTrackBoost(time);

        const x = boost.x;
        const y = boost.y;

        // Explosão radial forte.
        this.boostBurst.explode(55, x, y);
        this.boostSparkBurst.explode(32, x, y);

        // Aproveita as faíscas do sistema de turbo do carro.
        if (this.fx && this.fx.sparks) this.fx.sparks.explode(30, x, y);

        // Onda de energia neon: não altera o tamanho da placa.
        const ring1 = this.add.circle(x, y, 10, 0x00e5ff, 0.15)
            .setStrokeStyle(4, 0xffe34d, 0.95)
            .setDepth(1090);
        const ring2 = this.add.circle(x, y, 5, 0xff22cc, 0.08)
            .setStrokeStyle(2, 0xffffff, 0.9)
            .setDepth(1091);

        this.tweens.add({
            targets: ring1,
            radius: 62,
            alpha: 0,
            duration: 320,
            ease: 'Cubic.easeOut',
            onComplete: () => ring1.destroy()
        });
        this.tweens.add({
            targets: ring2,
            radius: 38,
            alpha: 0,
            duration: 220,
            ease: 'Cubic.easeOut',
            onComplete: () => ring2.destroy()
        });

        // Pequeno impacto de câmera para o boost parecer realmente físico.
        if (this.cameras && this.cameras.main) {
            this.cameras.main.shake(110, 0.0045);
        }

        const plate = boost.plate;
        if (plate) {
            this.tweens.killTweensOf(plate);
            plate.setScale(1);
            plate.setAlpha(1);
            this.tweens.add({
                targets: plate,
                alpha: 0.55,
                duration: 55,
                yoyo: true,
                repeat: 2,
                ease: 'Quad.easeOut'
            });
        }
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
            // O radar acompanha o formato da PISTA: além de atravessar a
            // largura da estrada, ele tem uma boa profundidade no sentido
            // da corrida. Assim não é necessário acertar um ponto exato.
            // CP1 — reta inferior (horizontal).
            { x: 3872, y: 3608, w: 560, h: 230, name: 'CP1' },

            // CP2 — trecho vertical da esquerda.
            { x: 544, y: 1824, w: 230, h: 560, name: 'CP2' },

            // CP3 — reta superior (horizontal).
            { x: 3872, y: 928, w: 560, h: 230, name: 'CP3' },

            // CP4 — trecho vertical da direita. O sensor agora está na
            // orientação correta da pista, colocando o checkpoint realmente
            // sobre o trecho vertical do circuito.
            { x: 4896, y: 2208, w: 230, h: 560, name: 'CP4' }
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
        this.baseScore += this.scoreRules.checkpoint;
        this.scoreStats.checkpoints++;

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

        // Radar adicional: a área já é grande, mas acrescentamos uma margem
        // baseada no tamanho do carro para não perder o checkpoint em alta
        // velocidade ou quando o carro passa ligeiramente pela borda.
        const padX = Math.max(28, this.car.width * 0.65);
        const padY = Math.max(28, this.car.height * 0.65);
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
                this.baseScore += this.scoreRules.lap;
                this.scoreStats.laps++;
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
                this.baseScore += this.scoreRules.lap; // última volta
                this.scoreStats.laps++;
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

        if (this.raceTimerStarted) {
            this.raceElapsedMs = Math.max(0, this.time.now - this.raceStartTime);
            this.updateRaceTimerHud();
            this.raceTimerLabel.setColor('#00ff9d');
        }
        this.finishElapsedMs = this.raceElapsedMs;

        // Some o joystick: a tela de pontuação precisa receber os toques.
        hideTouchControls();

        // Para o carro exatamente ao cruzar a chegada.
        this.car.controlsEnabled = false;
        if (this.engineAudio) this.engineAudio.fadeOut();
        this.car.setVelocity(0, 0);
        this.car.body.setAcceleration(0, 0);
        this.car.setAngularVelocity(0);

        // A colocação só é definida depois de receber a chegada do adversário.
        this.baseScore += this.scoreRules.finish;
        this.publishNetworkState(true, true);
        this.showWaitingForOpponent();
        this.tryResolvePodium();
    }

    showWaitingForOpponent() {
        this.championOverlay.setVisible(true).setAlpha(0.72);
        this.championPanel.setVisible(true).setAlpha(1).setScale(1);
        this.championText
            .setText('CORRIDA FINALIZADA')
            .setFontSize(this.scale.width < 500 ? 23 : 38)
            .setColor('#00e5ff').setVisible(true).setAlpha(1).setScale(1);
        this.championSubtext.setText('AGUARDANDO ADVERSÁRIO...').setVisible(true).setAlpha(1);
    }

    tryResolvePodium() {
        if (!this.raceFinished || this.podiumShown) return;
        const finishers = Object.values(this.remotePlayers).filter(player =>
            player.finished && Number.isFinite(player.finishElapsedMs)
        );
        if (finishers.length !== 1) return;

        const opponent = finishers[0];
        const results = [
            { id: this.playerId, nick: this.playerNick, elapsed: this.finishElapsedMs },
            { id: opponent.id, nick: opponent.nick || 'PILOTO', elapsed: opponent.finishElapsedMs }
        ].sort((a, b) => a.elapsed - b.elapsed || a.id.localeCompare(b.id));

        this.finishPlace = results[0].id === this.playerId ? 1 : 2;
        this.championNick = results[0].nick;
        if (this.finishPlace === 1) this.baseScore += this.scoreRules.firstPlace;
        this.finalScoreData = this.computeFinalScore();
        this.podiumShown = true;
        this.playChampionAnimation(this.finishPlace, this.championNick);
        this.time.delayedCall(2600, () => this.showScorePanel());
    }

    getTimeMultiplier(seconds) {
        for (const tier of this.scoreRules.multipliers) {
            if (seconds <= tier.maxSeconds) return tier.value;
        }
        return 1;
    }

    computeFinalScore() {
        const seconds = this.raceElapsedMs / 1000;
        const multiplier = this.getTimeMultiplier(seconds);
        return {
            base: this.baseScore,
            multiplier,
            total: Math.round(this.baseScore * multiplier * 100) / 100
        };
    }

    // ------------------------------------------------------------------
    // PAINEL DE PONTUAÇÃO ANIMADO
    // Linhas entram uma a uma com números subindo e "tick" sonoro, os
    // pontos base se somam, o multiplicador "carimba" na tela e o total
    // final sobe com easing, terminando com flash, onda e faíscas.
    // Clique / toque / qualquer tecla pula direto para o resultado.
    // ------------------------------------------------------------------
    scoreTone(freq, dur = 0.06, vol = 0.05, type = 'square', slideTo = null) {
        try {
            const ctx = this.sound && this.sound.context;
            if (!ctx) return;
            if (ctx.state === 'suspended') ctx.resume();
            const t = ctx.currentTime;
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, t);
            if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            osc.connect(g).connect(ctx.destination);
            osc.start(t);
            osc.stop(t + dur + 0.02);
        } catch (e) { /* som é opcional */ }
    }

    showScorePanel() {
        const { width, height } = this.scale;
        const d = this.finalScoreData || this.computeFinalScore();
        const st = this.scoreStats || { checkpoints: 0, laps: 0 };
        const rules = this.scoreRules;
        const cx = width / 2, cy = height / 2;
        const depth = 5100;
        const mono = 'monospace';

        // quantas casas decimais o total final precisa
        const decimals = Math.abs(d.total * 100 % 10) > 0.001 ? 2 : (Math.abs(d.total % 1) > 0.001 ? 1 : 0);
        const fmtNum = (n, dec = decimals) => n.toFixed(dec).replace('.', ',');
        const fmtMult = m => '×' + String(m).replace('.', ',');

        // cor do multiplicador conforme a faixa
        const multColor = d.multiplier >= 2 ? '#ffd23f'
            : d.multiplier >= 1.5 ? '#ff2bd6'
            : d.multiplier > 1 ? '#00e5ff' : '#9fb3c8';

        // Esconde a tela de CAMPEÃO.
        [this.championOverlay, this.championPanel, this.championText, this.championSubtext]
            .forEach(o => o.setVisible(false));

        // O minimapa sai de cena enquanto a pontuação aparece.
        const miniObjs = [
            this.miniMapBackground, this.miniMapImage, this.miniMapPlayer,
            this.miniMapFrame, this.miniMapLabel
        ].filter(Boolean);
        this.tweens.add({
            targets: miniObjs, alpha: 0, duration: 250,
            onComplete: () => miniObjs.forEach(o => o.setVisible(false))
        });

        this.scoreAnimObjs = [];
        this.scoreAnimTweens = [];
        this.scoreAnimTimers = [];
        const reg = (o) => {
            o.setScrollFactor(0);
            this.cameras.main.ignore(o); // só a câmera de UI desenha
            this.hud.push(o);
            this.scoreAnimObjs.push(o);
            return o;
        };
        const addTween = (cfg) => { const t = this.tweens.add(cfg); this.scoreAnimTweens.push(t); return t; };
        const addCounter = (cfg) => { const t = this.tweens.addCounter(cfg); this.scoreAnimTweens.push(t); return t; };
        const later = (ms, fn) => { const t = this.time.delayedCall(ms, fn); this.scoreAnimTimers.push(t); return t; };

        // ---------- layout ----------
        const pw = Math.min(540, width - 40), ph = 336;
        const left = cx - pw / 2 + 34, right = cx + pw / 2 - 34;

        // Fundo: a arte cyberpunk cobre a tela toda (modo "cover") e recebe
        // uma camada escura leve para as letras ficarem bem legíveis.
        const hasBg = this.textures.exists('scoreBg');
        const bg = reg(hasBg
            ? this.add.image(cx, cy, 'scoreBg').setDepth(depth)
            : this.add.rectangle(cx, cy, width, height, 0x0a1020).setDepth(depth));
        let bgScale = 1;
        if (hasBg) {
            const src = this.textures.get('scoreBg').getSourceImage();
            bgScale = Math.max(width / src.width, height / src.height);
            bg.setScale(bgScale);
        }
        const dim = reg(this.add.rectangle(cx, cy, width, height, 0x050711, 0.38).setDepth(depth + 1));
        const title = reg(this.add.text(cx, cy - ph / 2 + 28, 'PONTUAÇÃO', {
            fontFamily: mono, fontSize: '26px', fontStyle: 'bold', color: '#ffe066',
            stroke: '#07111f', strokeThickness: 7
        }).setOrigin(0.5).setDepth(depth + 2));

        const rowY = i => cy - ph / 2 + 70 + i * 28;
        const mkRow = (i, label) => {
            const l = reg(this.add.text(left, rowY(i), label, { fontFamily: mono, fontSize: '17px', color: '#dbe6f5', stroke: '#050711', strokeThickness: 4 })
                .setOrigin(0, 0.5).setDepth(depth + 2));
            const v = reg(this.add.text(right, rowY(i), '+0', { fontFamily: mono, fontSize: '19px', fontStyle: 'bold', color: '#ffffff', stroke: '#050711', strokeThickness: 4 })
                .setOrigin(1, 0.5).setDepth(depth + 2));
            l.setAlpha(0); v.setAlpha(0);
            return { l, v };
        };

        const rows = [
            { ...mkRow(0, `CHECKPOINTS  ×${st.checkpoints}`), n: st.checkpoints * rules.checkpoint },
            { ...mkRow(1, `VOLTAS  ×${st.laps}`),             n: st.laps * rules.lap },
            { ...mkRow(2, 'CHEGADA'),                          n: rules.finish },
            { ...mkRow(3, '1º LUGAR'),                         n: rules.firstPlace }
        ];

        const divY = rowY(4) - 4;
        const divider = reg(this.add.rectangle(cx, divY, pw - 68, 2, 0x00e5ff, 0.75).setDepth(depth + 2));
        divider.setScale(0, 1);

        const baseLabel = reg(this.add.text(left, divY + 24, 'PONTOS BASE', { fontFamily: mono, fontSize: '17px', color: '#a9c2e0', stroke: '#050711', strokeThickness: 4 })
            .setOrigin(0, 0.5).setDepth(depth + 2)).setAlpha(0);
        const baseVal = reg(this.add.text(right, divY + 24, '0', { fontFamily: mono, fontSize: '22px', fontStyle: 'bold', color: '#ffffff', stroke: '#050711', strokeThickness: 4 })
            .setOrigin(1, 0.5).setDepth(depth + 2)).setAlpha(0);

        const timeLabel = reg(this.add.text(left, divY + 54, `TEMPO  ${this.formatRaceTime(this.raceElapsedMs)}`, {
            fontFamily: mono, fontSize: '17px', color: '#a9c2e0', stroke: '#050711', strokeThickness: 4
        }).setOrigin(0, 0.5).setDepth(depth + 2)).setAlpha(0);
        const multText = reg(this.add.text(right, divY + 54, fmtMult(d.multiplier), {
            fontFamily: mono, fontSize: '30px', fontStyle: 'bold', color: multColor,
            stroke: '#07111f', strokeThickness: 5
        }).setOrigin(1, 0.5).setDepth(depth + 3)).setAlpha(0);

        const totalY = cy + ph / 2 - 52;
        const totalText = reg(this.add.text(cx, totalY, fmtNum(0), {
            fontFamily: mono, fontSize: '68px', fontStyle: 'bold', color: '#ffffff',
            stroke: '#07111f', strokeThickness: 9
        }).setOrigin(0.5).setDepth(depth + 3)).setAlpha(0);

        const hint = reg(this.add.text(cx, cy + ph / 2 - 12, 'toque para pular', {
            fontFamily: mono, fontSize: '11px', color: '#56688a'
        }).setOrigin(0.5).setDepth(depth + 2)).setAlpha(0.8);

        // ---------- efeitos ----------
        const burst = (x, y, n, colors, power = 1) => {
            for (let i = 0; i < n; i++) {
                const c = colors[i % colors.length];
                const sp = reg(this.add.rectangle(x, y, Phaser.Math.Between(3, 6), Phaser.Math.Between(3, 6), c).setDepth(depth + 4));
                const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
                const dist = Phaser.Math.Between(50, 150) * power;
                addTween({
                    targets: sp,
                    x: x + Math.cos(ang) * dist, y: y + Math.sin(ang) * dist + 25,
                    alpha: 0, angle: Phaser.Math.Between(-180, 180), scale: 0.2,
                    duration: Phaser.Math.Between(450, 850), ease: 'Cubic.easeOut',
                    onComplete: () => sp.destroy()
                });
            }
        };
        const ring = (x, y, color, big = 220) => {
            const r = reg(this.add.circle(x, y, 10).setStrokeStyle(4, color, 1).setDepth(depth + 4));
            addTween({ targets: r, radius: big, alpha: 0, duration: 650, ease: 'Cubic.easeOut', onComplete: () => r.destroy() });
        };
        const punch = (obj, to = 1.3, dur = 110) => {
            addTween({ targets: obj, scale: to, duration: dur, yoyo: true, ease: 'Quad.easeOut' });
        };

        let finished = false;
        let runningBase = 0;

        const finalState = () => {
            rows.forEach(r => { r.l.setAlpha(1).setX(left); r.v.setAlpha(1).setText('+' + r.n); });
            divider.setScale(1, 1);
            baseLabel.setAlpha(1); baseVal.setAlpha(1).setText(String(d.base));
            timeLabel.setAlpha(1); multText.setAlpha(1).setScale(1);
            totalText.setAlpha(1).setScale(1).setText(fmtNum(d.total)).setColor('#00ff9d');
            hint.setVisible(false);
        };

        const skip = () => {
            if (finished) return;
            finished = true;
            this.scoreAnimTweens.forEach(t => t.stop && t.stop());
            this.scoreAnimTimers.forEach(t => t.remove && t.remove(false));
            finalState();
            this.scoreTone(880, 0.12, 0.05, 'triangle');
            this.input.off('pointerdown', skip);
            this.input.keyboard && this.input.keyboard.off('keydown', skip);
        };

        // ---------- sequência ----------
        // 1) painel entra
        [bg, dim, title].forEach(o => o.setAlpha(0));
        bg.setScale(bgScale * 1.12);
        addTween({ targets: bg, alpha: 1, duration: 500, ease: 'Sine.easeOut' });
        // zoom lento e suave, dando vida ao fundo durante a contagem
        addTween({ targets: bg, scale: bgScale, duration: 6000, ease: 'Sine.easeOut' });
        addTween({ targets: dim, alpha: 0.38, duration: 500 });
        addTween({ targets: title, alpha: 1, duration: 300, delay: 250 });
        this.scoreTone(330, 0.18, 0.05, 'triangle', 660);

        // 2) linhas com contagem (encadeadas)
        let t = 420;
        rows.forEach((r, idx) => {
            const n = r.n;
            const dur = Phaser.Math.Clamp(n * 55, 260, 720);
            later(t, () => {
                if (finished) return;
                r.l.setX(left - 24);
                addTween({ targets: r.l, alpha: 1, x: left, duration: 220, ease: 'Cubic.easeOut' });
                addTween({ targets: r.v, alpha: 1, duration: 160 });
                let last = 0;
                addCounter({
                    from: 0, to: n, duration: dur, ease: 'Sine.easeOut',
                    onUpdate: (tw) => {
                        const val = Math.round(tw.getValue());
                        if (val !== last) {
                            last = val;
                            r.v.setText('+' + val);
                            this.scoreTone(520 + (val / Math.max(1, n)) * 420, 0.045, 0.035, 'square');
                        }
                    },
                    onComplete: () => {
                        r.v.setText('+' + n).setColor('#00ff9d');
                        punch(r.v, 1.35, 110);
                        runningBase += n;
                        baseVal.setAlpha(1).setText(String(runningBase));
                        baseLabel.setAlpha(1);
                        punch(baseVal, 1.2, 100);
                        this.scoreTone(740 + idx * 110, 0.09, 0.05, 'triangle');
                    }
                });
            });
            t += dur + 260;
        });

        // 3) linha divisória + base
        later(t, () => {
            if (finished) return;
            addTween({ targets: divider, scaleX: 1, duration: 260, ease: 'Cubic.easeOut' });
        });
        t += 420;

        // 4) multiplicador carimba
        later(t, () => {
            if (finished) return;
            addTween({ targets: timeLabel, alpha: 1, duration: 250 });
            multText.setAlpha(1).setScale(3.2);
            addTween({
                targets: multText, scale: 1, duration: 360, ease: 'Back.easeOut',
                onComplete: () => {
                    if (d.multiplier > 1) {
                        this.cameras.main.shake(180, 0.004);
                        this.uiCam.shake(180, 0.004);
                        ring(right - 26, multText.y, Phaser.Display.Color.HexStringToColor(multColor).color, 120);
                        burst(right - 26, multText.y, 14, [Phaser.Display.Color.HexStringToColor(multColor).color, 0xffffff], 0.8);
                    }
                }
            });
            this.scoreTone(d.multiplier > 1 ? 160 : 220, 0.2, 0.09, 'sawtooth', 70);
            if (d.multiplier > 1) later(120, () => this.scoreTone(660 + d.multiplier * 200, 0.16, 0.05, 'triangle'));
        });
        t += 700;

        // 5) total sobe de base -> final
        later(t, () => {
            if (finished) return;
            totalText.setAlpha(1).setText(fmtNum(d.base)).setScale(0.9);
            addTween({ targets: totalText, scale: 1, duration: 200, ease: 'Back.easeOut' });
            let lastTick = -1;
            const steps = 28;
            addCounter({
                from: d.base, to: d.total, duration: 1700, ease: 'Cubic.easeOut',
                onUpdate: (tw) => {
                    const v = tw.getValue();
                    totalText.setText(fmtNum(v));
                    const k = Math.floor(tw.progress * steps);
                    if (k !== lastTick) {
                        lastTick = k;
                        this.scoreTone(380 + tw.progress * 900, 0.04, 0.03, 'square');
                        totalText.setColor(k % 2 ? '#ffffff' : '#ffe066');
                        totalText.setScale(1 + (k % 2) * 0.03);
                    }
                },
                onComplete: () => {
                    if (finished) return;
                    finished = true;
                    totalText.setText(fmtNum(d.total)).setColor('#00ff9d');
                    addTween({ targets: totalText, scale: { from: 1.45, to: 1 }, duration: 420, ease: 'Back.easeOut' });
                    // flash branco rápido
                    const flash = reg(this.add.rectangle(cx, cy, width, height, 0xffffff, 0.35).setDepth(depth + 5));
                    addTween({ targets: flash, alpha: 0, duration: 380, onComplete: () => flash.destroy() });
                    ring(cx, totalY, 0x00ff9d, 260);
                    burst(cx, totalY, 34, [0x00ff9d, 0xffe066, 0xffffff, 0x00e5ff, 0xff2bd6], 1.4);
                    [784, 988, 1175, 1568].forEach((f, i) => later(i * 85, () => this.scoreTone(f, 0.18, 0.05, 'triangle')));
                    hint.setVisible(false);
                    this.input.off('pointerdown', skip);
                    this.input.keyboard && this.input.keyboard.off('keydown', skip);
                }
            });
        });

        // pular
        later(400, () => {
            this.input.on('pointerdown', skip);
            this.input.keyboard && this.input.keyboard.on('keydown', skip);
        });
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

    playChampionAnimation(place, championNick) {
        const isWinner = place === 1;
        this.championText
            .setText(isWinner ? 'CAMPEÃO!' : '2º LUGAR')
            .setFontSize(this.scale.width < 500 ? 32 : 48)
            .setColor(isWinner ? '#00e5ff' : '#ffe066');
        this.championSubtext.setText(isWinner
            ? '1º LUGAR • VOCÊ VENCEU'
            : `CAMPEÃO: ${championNick}`);
        this.championPanel.setStrokeStyle(3, isWinner ? 0x00e5ff : 0xffe066);

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
            if (!isWinner) {
                piece.setVisible(false);
                return;
            }
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

        // Cronômetro: canto superior direito, compacto e legível.
        const timerX = this.scale.width - 24;
        const timerY = 22;
        // Cronômetro sem painel/fundo: mantém apenas os textos na HUD.
        this.raceTimerPanel = null;

        this.playerNickLabel = push(this.add.text(x, y - 5, `PILOTO: ${this.playerNick}`, {
            fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: '#00e5ff'
        }).setScrollFactor(0).setDepth(2004));

        this.roomStatusLabel = push(this.add.text(this.scale.width / 2, this.scale.height * 0.76, 'CONECTANDO À SALA...', {
            fontFamily: 'monospace',
            fontSize: this.scale.width < 600 ? '12px' : '15px',
            fontStyle: 'bold',
            color: '#ffffff',
            backgroundColor: '#05060acc',
            padding: { left: 12, right: 12, top: 8, bottom: 8 },
            align: 'center',
            wordWrap: { width: this.scale.width - 36 }
        }).setOrigin(0.5).setScrollFactor(0).setDepth(2602));

        this.raceTimerTitle = push(this.add.text(timerX - 75, timerY + 7, 'TIME', {
            fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold', color: '#8da7c7'
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(2001));

        this.raceTimerLabel = push(this.add.text(timerX - 75, timerY + 19, '00:00.00', {
            fontFamily: 'monospace', fontSize: '19px', fontStyle: 'bold', color: '#ffffff'
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(2001));
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
            ...this.obstacles.getChildren(),
            this.oilVisuals,
            this.boostVisuals,
            ...this.fx.worldObjects,
            ...(this.oilFX ? this.oilFX.worldObjects : [])
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
        this.miniW = Math.min(180, width - 28);
        this.miniH = 98;
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
            0, 0, 4.5,
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
        if (this.car) {
            // Checagem direta por frame (sem callback): o carro está
            // em cima de alguma mancha de óleo agora?
            this.car.isOnOil = !!this.oilSensors
                && this.physics.overlap(this.car, this.oilSensors);
            this.car.update(time, delta);
            this.sortObstacleDepth();
            this.publishNetworkState();
        }
        this.updateRemotePlayers(delta);
        this.tryCoordinateStart();
        this.checkBoostPlates(time);
        this.checkCheckpointFallback();
        this.updateLapSystem();
        if (this.fx) this.fx.update(time, delta);
        if (this.carFX) this.carFX.update(delta);
        // Depois do TurboFX: o tint do carro é do TurboFX, o OilFX só
        // entra por cima quando turbo/drift/superaquecimento estão de fora.
        if (this.oilFX) this.oilFX.update(time, delta);
        if (this.audio) this.audio.update();
        if (this.engineAudio) this.engineAudio.update();
        if (this.turboBarFill) this.updateHud();
        this.updateRaceTimerHud();
        this.updateMinimap();
    }
}
export default Race;
