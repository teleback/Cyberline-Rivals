import TrackCollisions, { wallShapes } from '../objects/TrackCollisions.js';
import { playMusic, stopMusic } from '../fx/Music.js';
import Car from "../objects/Car.js";
import { getCarSkin } from "../objects/CarSkins.js";
import TurboFX from "../fx/TurboFX.js";
import OilFX from "../fx/OilFX.js";
import TurboAudio from "../fx/TurboAudio.js";
import EngineAudio from "../fx/EngineAudio.js";
import CarDropIn from "../fx/CarDropIn.js";
import StartCountdown from "../fx/StartCountdown.js";
import CarFX from "../fx/CarFX.js";
import NightLighting from "../fx/NightLighting.js";
import BoostFX from "../fx/BoostFX.js";
import RaceHUD from "../fx/RaceHUD.js";
import BrickCollectibles from "../objects/BrickCollectibles.js";
import RaceResults from "../fx/RaceResults.js";
import { BRICK_REWARD_RULES, computeBrickRewards } from "../objects/RaceRewards.js";
import {
  showTouchControls,
  hideTouchControls,
} from "../input/TouchControls.js";
import MQTTClient from "../MQTTClient.js";
import { pushRemoteMotion, sampleRemoteMotion, resetRemoteMotion } from "../objects/RemoteMotion.js";

const REMOTE_TIMEOUT = 5000;

class Race extends Phaser.Scene {
  constructor() {
    super("Race");
  }

  create(data = {}) {
    playMusic(this, 'lobby');
    this.events.once('shutdown', () => stopMusic(this));
    this.crashFeedbackAfter = 0;
    // A seleção feita antes da corrida define a aparência do carro.
    // O `carSkin` fica no objeto de cena para podermos sincronizá-lo
    // depois com o multiplayer MQTT.
    this.playerNick = data.playerNick || "PILOTO";
    this.roomId = Number(data.roomId) || 1;
    this.multiplayer = new MQTTClient(data.playerId);
    this.playerId = this.multiplayer.playerId;
    this.carSkin = getCarSkin(data.carSkin).id;
    this.carTint = data.carTint ?? 0xffffff;
    this.remotePlayers = {};
    this.lastNetworkSend = 0;
    this.networkSendInterval = 33; // ~30 atualizações/s para reduzir atraso online
    this.pendingNetworkExtra = {};
    this.pendingNetworkRetain = false;
    this.localCarReady = false;
    this.raceStartAt = null;
    this.startCountdownStarted = false;
    this.countdownStartAt = null;
    this.countdownFallbackTimer = null;
    this.startAlignmentComplete = false;
    this.startAlignmentTween = null;
    this.pendingClockProbes = new Map();
    this.clockOffsets = new Map();
    this.networkRoundTrips = new Map();
    this.podiumShown = false;
    this.finishElapsedMs = null;
    this.finishPlace = null;
    this.raceRoundId = null;
    this.raceResultsData = null;
    this.finalScoreData = null;
    const map = this.make.tilemap({ key: "pista" });
    this.map = map;

    const tilesets = [
      map.addTilesetImage("Pista.png", "pista"),
      map.addTilesetImage("Prédios", "predios"),
      map.addTilesetImage("10", "chao"),
      map.addTilesetImage("favela", "favela"),
      map.addTilesetImage("placas", "placas"),
      map.addTilesetImage("calçada", "calcada"),
      map.addTilesetImage("objetos", "objetos"),
      map.addTilesetImage("pixel invisivel", "placas"),
      map.addTilesetImage("start", "chegada"),
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
    // A camada vazia "carro trajeto" marca onde os carros entram na
    // ordem de desenho do Tiled. Reservamos o intervalo 480..1256 para
    // os objetos e efeitos da corrida; o cenário acima dela começa em
    // 1500, ainda abaixo da interface (1800+).
    const carLayerIndex = map.layers.findIndex(
      (layerData) => layerData.name.split("/").pop() === "carro trajeto",
    );
    this.mapLayers = [];
    map.layers.forEach((layerData, index) => {
      const layer = map.createLayer(index, tilesets, 0, 0);
      if (layer && carLayerIndex >= 0) {
        const depth =
          index < carLayerIndex
            ? index
            : index === carLayerIndex
              ? 1000
              : 1500 + index;
        layer.setDepth(depth);
      }
      if (layer) this.mapLayers.push(layer);
      if (layer && layerData.name === "Cyber placa") this.boostLayer = layer;
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

    // TIJOLINHOS: coleta na pista + voltas válidas + chegada + vitória.
    this.rewardRules = BRICK_REWARD_RULES;
    this.completedLaps = 0;

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
    const startTileX = 80,
      startTileY = 54; // linha 54 = meio das 5 linhas (52–56)
    const startX = startTileX * map.tileWidth + map.tileWidth / 2;
    const startY = startTileY * map.tileHeight + map.tileHeight / 2;
    // Os carros ficam lado a lado na pista: mesma posição de largada em X,
    // faixas separadas no eixo Y.
    this.playerSlot = MQTTClient.slotFor(this.playerId);
    const networkStartY = startY + (this.playerSlot === 0 ? -84 : 84);
    this.startLineY = startY;
    this.car = new Car(this, startX, networkStartY, getCarSkin(this.carSkin).texture);
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
    // Os contatos usam segmentos contínuos e busca espacial, sem centenas
    // de corpos estáticos sobrepostos nos cantos.
    this.wallShapes = [];
    ["colisao", "colisoes pista"].forEach((name) =>
      this.createWallsFromLayer(name),
    );
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
    this.events.once(
      "shutdown",
      () => this.engineAudio && this.engineAudio.destroy(),
    );
    this.createObstacles();
    this.createOilZones();
    this.trackCollisions = new TrackCollisions(this, this.wallShapes);
    this.brickCollectibles = new BrickCollectibles(this);

    this.buildHud();
    this.updateCheckpointHud();
    this.createChampionOverlay();
    this.nightLighting = new NightLighting(this);
    this.splitCameras();

    // O carro já nasce na posição certa (startX/startY), mas some pra
    // cima e cai de volta nela — ver CarDropIn pra a animação completa.
    // Só depois do pouso É QUE entra a contagem regressiva; os
    // controles ficam travados até o "VAI!".
    // Celular: joystick + botão de turbo aparecem junto com a partida
    // (e somem ao terminar a corrida ou se a cena for encerrada).
    showTouchControls();
    this.events.once("shutdown", hideTouchControls);
    this.events.once("shutdown", () => {
      if (this.multiplayer) {
        this.multiplayer.disconnect();
        this.multiplayer = null;
      }
      Object.values(this.remotePlayers).forEach((remote) => {
        remote.sprite?.destroy();
        remote.label?.destroy();
      });
      this.remotePlayers = {};
    });

    this.dropIn = new CarDropIn(this, this.car);
    this.dropIn.play(startX, networkStartY, {
      onLand: () => this.onLocalCarReady(),
    });

    // Descobre os pilotos pelas mensagens ao vivo. Estados retidos de uma
    // corrida anterior não podem ocupar a sala nem reposicionar o rival.
    this.initMultiplayer();

    this.input.keyboard.on("keydown-M", () => {
      const muted = this.audio.toggleMute();
      this.sound.mute = muted;
      this.muteLabel.setText(muted ? "SOM: OFF  [M]" : "SOM: ON  [M]");
    });
  }

  async initMultiplayer() {
    this.multiplayer.on("status", (status) => {
      console.log(`[MQTT] sala ${this.roomId}: ${status}`);
      if (this.multiplayer?.connected) this.publishNetworkState(true, true);
      this.updateLobbyStatus();
    });

    this.multiplayer.on("player", (state) => this.receiveRemotePlayer(state));

    try {
      await this.multiplayer.connect(this.roomId, {
        nick: this.playerNick,
        skin: this.carSkin,
        tint: this.carTint,
      });

      // Publica imediatamente o estado inicial, mesmo antes do primeiro
      // frame de movimento.
      this.publishNetworkState(true, true);
      this.sendClockProbe();
      this.time.addEvent({
        delay: 3000,
        loop: true,
        callback: () => this.sendClockProbe(),
      });
      this.updateLobbyStatus();
      this.tryCoordinateStart();
    } catch (error) {
      console.error("[MQTT] Não foi possível conectar ao multiplayer:", error);
      this.updateLobbyStatus();
    }
  }

  sendClockProbe() {
    if (!this.multiplayer?.connected) return;
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const sentAt = Date.now();
    this.pendingClockProbes.set(nonce, sentAt);
    if (this.pendingClockProbes.size > 8) {
      this.pendingClockProbes.delete(
        this.pendingClockProbes.keys().next().value,
      );
    }
    this.publishNetworkState(true, false, { syncRequest: { nonce, sentAt } });
  }

  publishNetworkState(force = false, retain = false, extra = {}) {
    if (!this.multiplayer || !this.multiplayer.connected || !this.car) return;

    const now = performance.now();
    if (!force && now - this.lastNetworkSend < this.networkSendInterval) {
      this.pendingNetworkExtra = { ...this.pendingNetworkExtra, ...extra };
      this.pendingNetworkRetain ||= retain;
      return;
    }
    const publishExtra = { ...this.pendingNetworkExtra, ...extra };
    retain = this.pendingNetworkRetain || retain;
    this.pendingNetworkExtra = {};
    this.pendingNetworkRetain = false;
    this.lastNetworkSend = now;

    this.multiplayer.publish(
      {
        id: this.multiplayer.playerId,
        sessionId: this.multiplayer.sessionId,
        nick: this.playerNick,
        skin: this.carSkin,
        tint: this.carTint,
        online: true,
        ready: this.localCarReady && this.startAlignmentComplete,
        startAt: this.raceStartAt,
        finished: this.raceFinished,
        finishElapsedMs: this.finishElapsedMs,
        roundId: this.raceRoundId,
        completedLaps: this.completedLaps,
        brickState: this.brickCollectibles?.getNetworkState(),
        // Durante a queda (CarDropIn) o carro está no ar e encolhido:
        // publica a posição final da largada, não a do tween.
        x: this.localCarReady ? this.car.x : this.networkStartX,
        y: this.localCarReady ? this.car.y : this.networkStartY,
        rotation: this.localCarReady ? this.car.rotation : -Math.PI / 2,
        vx: this.localCarReady ? this.car.body?.velocity?.x || 0 : 0,
        vy: this.localCarReady ? this.car.body?.velocity?.y || 0 : 0,
        speed: this.localCarReady ? this.car.body?.speed || 0 : 0,
        angularVelocity: this.localCarReady
          ? this.car.body?.angularVelocity || 0
          : 0,
        controls: this.car.networkControls,
        turboActive: this.car.isTurboActive,
        turboIntensity: this.car.turboIntensity,
        drifting: this.car.isDrifting,
        lap: this.currentLap,
        checkpointIndex: this.checkpointIndex,
        ts: Date.now(),
        motionTime: now,
        ...publishExtra,
      },
      { retain, qos: force ? 1 : 0 },
    );
  }

  receiveRemotePlayer(state) {
    if (!state || !state.id || state.id === this.playerId) return;

    const incomingTs = Number.isFinite(Number(state.ts))
      ? Number(state.ts)
      : null;
    const knownRemote = this.remotePlayers[state.id];
    if (knownRemote?.retiredSessions?.has(state.sessionId)) return;
    const newRemoteSession =
      knownRemote &&
      state.sessionId &&
      knownRemote.sessionId &&
      state.sessionId !== knownRemote.sessionId;
    // Uma aba reiniciada não pertence à corrida que já está em andamento.
    // Pacotes da sessão antiga e da nova não podem alternar o mesmo sprite.
    if (newRemoteSession && (this.raceTimerStarted || state.online === false)) return;
    if (this.raceTimerStarted && 'roundId' in state && state.roundId !== this.raceRoundId) return;
    // MQTT sequence also orders packets sent in the same millisecond.
    const incomingSeq = Number.isSafeInteger(state.seq) && state.seq > 0 ? state.seq : null;
    if (knownRemote && !newRemoteSession) {
      if (incomingSeq !== null && knownRemote.lastMessageSeq > 0) {
        if (incomingSeq <= knownRemote.lastMessageSeq) return;
      } else if (incomingTs !== null && incomingTs < knownRemote.lastMessageTs) {
        return;
      }
    }
    if (newRemoteSession) {
      knownRemote.retiredSessions ??= new Set();
      knownRemote.retiredSessions.add(knownRemote.sessionId);
      knownRemote.lastMessageTs = 0;
      knownRemote.lastMessageSeq = 0;
    }

    if (state.syncRequest?.nonce && Number.isFinite(state.syncRequest.sentAt)) {
      const remoteReceivedAt = Date.now();
      this.publishNetworkState(true, false, {
        syncResponse: {
          nonce: state.syncRequest.nonce,
          sentAt: state.syncRequest.sentAt,
          remoteReceivedAt,
          remoteSentAt: Date.now(),
        },
      });
    }

    const response = state.syncResponse;
    const probeSentAt = response && this.pendingClockProbes.get(response.nonce);
    if (
      Number.isFinite(probeSentAt) &&
      Number.isFinite(response.remoteReceivedAt) &&
      Number.isFinite(response.remoteSentAt)
    ) {
      const localReceivedAt = Date.now();
      const offset =
        (response.remoteReceivedAt -
          probeSentAt +
          (response.remoteSentAt - localReceivedAt)) /
        2;
      const measuredRoundTripMs = Math.max(
        0,
        localReceivedAt -
          probeSentAt -
          (response.remoteSentAt - response.remoteReceivedAt),
      );
      const previousRoundTripMs = this.networkRoundTrips.get(state.id);
      const roundTripMs =
        previousRoundTripMs === undefined
          ? measuredRoundTripMs
          : previousRoundTripMs +
            (measuredRoundTripMs - previousRoundTripMs) * 0.2;
      const previousOffset = this.clockOffsets.get(state.id);
      const smoothedOffset =
        previousOffset === undefined
          ? offset
          : previousOffset + (offset - previousOffset) * 0.2;
      this.clockOffsets.set(state.id, smoothedOffset);
      this.networkRoundTrips.set(state.id, roundTripMs);
      const existingRemote = this.remotePlayers[state.id];
      if (existingRemote) {
        existingRemote.clockOffset = smoothedOffset;
        existingRemote.roundTripMs = roundTripMs;
        existingRemote.interpolationDelay = Phaser.Math.Clamp(
          80 + existingRemote.arrivalJitter * 1.2,
          80,
          180,
        );
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
      const initialX = this.finishLineX;
      const initialY = this.startLineY + (this.playerId.localeCompare(state.id) < 0 ? 84 : -84);
      const tint = Number.isFinite(state.tint) ? state.tint : 0xffffff;
      const sprite = this.physics.add
        .image(initialX, initialY, getCarSkin(state.skin).texture)
        .setTint(tint)
        .setDepth(999)
        .setVisible(true);
      sprite.setRotation(-Math.PI / 2);
      sprite.body.setCircle(24, 25.5, 56);
      sprite.body.setImmovable(true);
      sprite.body.setAllowGravity(false);
      // Only the network renderer moves the rival; Arcade must not integrate it.
      sprite.body.moves = false;
      const collider = this.physics.add.collider(this.car, sprite);
      collider.active = false;

      const label = this.add
        .text(0, 0, state.nick || "RIVAL", {
          fontFamily: "monospace",
          fontSize: "11px",
          fontStyle: "bold",
          color: "#ffffff",
          backgroundColor: "#05060acc",
          padding: { left: 4, right: 4, top: 2, bottom: 2 },
        })
        .setOrigin(0.5, 1)
        .setDepth(1001)
        .setVisible(true);

      remote = this.remotePlayers[state.id] = {
        id: state.id,
        sessionId: state.sessionId || null,
        retiredSessions: new Set(),
        sprite,
        label,
        collider,
        online: true,
        ready: false,
        finished: false,
        finishElapsedMs: null,
        startAt: null,
        tint,
        nick: state.nick || "RIVAL",
        clockOffset: this.clockOffsets.get(state.id) || 0,
        roundTripMs: this.networkRoundTrips.get(state.id) || 0,
        turboIntensity: 0,
        networkControls: null,
        stateBuffer: [],
        vx: 0,
        vy: 0,
        angularVelocity: 0,
        lastMessageTs: 0,
        lastMessageSeq: 0,
        roundId: null,
        completedLaps: 0,
        skin: getCarSkin(state.skin).id,
        lastPacketAt: null,
        interpolationDelay: 80,
        arrivalJitter: 0,
        lastSeen: Date.now(),
      };

      if (this.uiCam) {
        this.uiCam.ignore([sprite, label]);
      }
      this.nightLighting?.addCar(sprite, state.skin);
    }

    if (
      state.sessionId &&
      remote.sessionId &&
      state.sessionId !== remote.sessionId
    ) {
      remote.ready = false;
      remote.finished = false;
      remote.finishElapsedMs = null;
      remote.roundId = null;
      remote.completedLaps = 0;
      remote.startAt = null;
      resetRemoteMotion(remote);
      remote.vx = 0;
      remote.vy = 0;
      remote.angularVelocity = 0;
      remote.arrivalJitter = 0;
      remote.lastPacketAt = null;
      this.clockOffsets.delete(state.id);
      this.networkRoundTrips.delete(state.id);
      remote.clockOffset = 0;
      remote.roundTripMs = 0;
    }
    remote.sessionId = state.sessionId || remote.sessionId;
    if (incomingTs !== null) remote.lastMessageTs = incomingTs;
    if (incomingSeq !== null) remote.lastMessageSeq = incomingSeq;
    const receivedAt = performance.now();
    const hasMotion = Number.isFinite(state.x) && Number.isFinite(state.y) &&
      Number.isFinite(state.rotation);
    const packetInterval = receivedAt - remote.lastPacketAt;
    if (hasMotion && remote.lastPacketAt !== null && packetInterval > 0 && packetInterval < 2000) {
      const intervalJitter = Math.abs(
        packetInterval - this.networkSendInterval,
      );
      remote.arrivalJitter += (intervalJitter - remote.arrivalJitter) * 0.125;
      remote.interpolationDelay = Phaser.Math.Clamp(
        80 + remote.arrivalJitter * 1.2,
        80,
        180,
      );
    }
    if (hasMotion) remote.lastPacketAt = receivedAt;
    remote.online = true;
    remote.lastSeen = Date.now();
    // Presença de reconexão não inclui pose nem informações da corrida.
    // Só os campos publicados podem mudar ready/start/voltas já confirmados.
    if (typeof state.ready === 'boolean') remote.ready = state.ready;
    if ('roundId' in state) remote.roundId = typeof state.roundId === "string" ? state.roundId : null;
    if (typeof state.finished === 'boolean') {
      remote.finished = state.finished && remote.roundId === this.raceRoundId;
    }
    if (Number.isInteger(state.completedLaps)) {
      remote.completedLaps = Math.max(0, Math.min(this.totalLaps, state.completedLaps));
    }
    if (Number.isFinite(state.lap)) remote.lap = Math.max(1, state.lap);
    if (Number.isInteger(state.checkpointIndex)) remote.checkpointIndex = state.checkpointIndex;
    if ('finishElapsedMs' in state) {
      remote.finishElapsedMs = Number.isFinite(state.finishElapsedMs) && state.finishElapsedMs >= 0
        ? state.finishElapsedMs : null;
    }
    if ('startAt' in state) remote.startAt = Number.isFinite(state.startAt) ? state.startAt : null;

    const isCoordinator = this.playerId.localeCompare(state.id) < 0;
    if (!isCoordinator && !this.raceTimerStarted) {
      this.raceStartAt =
        remote.startAt === null ? null : remote.startAt - remote.clockOffset;
    }

    // O callback MQTT só acrescenta um estado ao buffer; a posição
    // visível é escolhida no loop de update.
    if (!this.raceTimerStarted) {
      // A grade é calculada pelos mesmos IDs nos dois clientes e não passa
      // pelo buffer de movimento. Presença usa Date.now; movimento usa um
      // relógio monotônico. Misturá-los travava o buffer desde a entrada.
      remote.vx = 0;
      remote.vy = 0;
      remote.angularVelocity = 0;
      this.placeRemoteOnGrid(remote);
    } else if (hasMotion && remote.roundId === this.raceRoundId) {
      remote.vx = Number.isFinite(state.vx) ? state.vx : 0;
      remote.vy = Number.isFinite(state.vy) ? state.vy : 0;
      remote.angularVelocity = Number.isFinite(state.angularVelocity) ? state.angularVelocity : 0;
      this.pushRemoteState(remote, {
        x: state.x,
        y: state.y,
        angle: state.rotation,
        time: receivedAt,
        timestamp: incomingTs,
        motionTime: state.motionTime,
        vx: remote.vx,
        vy: remote.vy,
        angularVelocity: remote.angularVelocity,
      });
    }
    if (remote.collider) remote.collider.active = this.raceTimerStarted && !remote.finished;

    if (state.tint !== undefined) remote.tint = Number(state.tint) || 0xffffff;
    if (state.skin && remote.sprite.texture.key !== getCarSkin(state.skin).texture) {
      remote.sprite.setTexture(getCarSkin(state.skin).texture);
    }
    if (state.skin) remote.skin = getCarSkin(state.skin).id;
    if (state.nick) remote.nick = state.nick;
    this.brickCollectibles?.receiveNetworkState(state);
    remote.networkControls = state.controls || remote.networkControls;
    remote.sprite.networkControls = remote.networkControls;
    remote.turboIntensity = Phaser.Math.Clamp(
      Number(state.turboIntensity) || 0,
      0,
      1,
    );
    const remoteStatus = state.turboActive
      ? "TURBO"
      : state.drifting
        ? "DRIFT"
        : `${Math.round((Number(state.speed) || 0) * 0.42)} KM/H`;
    const labelText = `${remote.nick}  ${remoteStatus}`;
    if (remote.label.text !== labelText) remote.label.setText(labelText);
    remote.sprite.setTint(state.turboActive ? 0xff5577 : remote.tint);
    remote.sprite.setScale(1 + remote.turboIntensity * 0.045);
    this.updateLobbyStatus();
    this.tryCoordinateStart();
    this.tryResolvePodium();
  }

  pushRemoteState(remote, state) {
    pushRemoteMotion(remote, state);
  }

  updateRemotePlayers() {
    const now = Date.now();
    const nowPerformance = performance.now();
    Object.entries(this.remotePlayers).forEach(([id, remote]) => {
      if (!remote.online) return;
      if (now - remote.lastSeen > REMOTE_TIMEOUT) {
        this.removeRemotePlayer(id);
        return;
      }

      if (!this.raceTimerStarted) {
        this.placeRemoteOnGrid(remote);
        return;
      }
      const pose = sampleRemoteMotion(remote, nowPerformance);
      if (!pose) return;
      const { x, y, angle } = pose;

      remote.sprite.setPosition(x, y);
      remote.sprite.rotation = angle;
      remote.sprite.body.updateFromGameObject();

      remote.label.setPosition(remote.sprite.x, remote.sprite.y - 82);
    });
  }

  removeRemotePlayer(id) {
    const remote = this.remotePlayers[id];
    if (!remote) return;
    // Oscilações da rede não destroem e recriam o rival na largada durante
    // a corrida. Mantém a última pose e retoma o mesmo sprite ao reconectar.
    if (this.raceTimerStarted || (remote.finished && Number.isFinite(remote.finishElapsedMs))) {
      remote.online = false;
      remote.lastSeen = Date.now();
      if (remote.collider) remote.collider.active = false;
      if (!remote.finished) remote.label?.setText(`${remote.nick}  RECONECTANDO...`);
      this.updateLobbyStatus();
      this.tryResolvePodium();
      return;
    }
    remote.collider?.destroy();
    this.nightLighting?.removeCar(remote.sprite);
    remote.sprite?.destroy();
    remote.label?.destroy();
    delete this.remotePlayers[id];
    this.updateLobbyStatus();
    this.tryCoordinateStart();
  }

  getActiveOpponents() {
    const now = Date.now();
    return Object.values(this.remotePlayers).filter(
      (player) => player.online && now - player.lastSeen <= REMOTE_TIMEOUT,
    );
  }

  hasReadyPair() {
    const opponents = this.getActiveOpponents();
    return (
      this.multiplayer?.connected === true &&
      this.localCarReady &&
      this.startAlignmentComplete &&
      opponents.length === 1 &&
      opponents[0].ready
    );
  }

  onLocalCarReady() {
    this.localCarReady = true;
    this.tryCoordinateStart();
    this.publishNetworkState(true, true);
    this.updateLobbyStatus();
  }

  updateLobbyStatus() {
    if (!this.roomStatusLabel || this.raceTimerStarted || this.raceFinished)
      return;
    const opponents = this.getActiveOpponents();
    let message = "CONECTANDO À SALA...";
    if (this.multiplayer?.connected) {
      if (opponents.length === 0) message = "AGUARDANDO OUTRO JOGADOR...";
      else if (opponents.length > 1)
        message = "SALA CHEIA — MÁXIMO 2 JOGADORES";
      else if (!this.localCarReady || !opponents[0].ready)
        message = "AGUARDANDO OS DOIS CARROS...";
      else message = "PREPARANDO A LARGADA...";
    }
    this.roomStatusLabel.setText(message).setVisible(true);
  }

  placeRemoteOnGrid(remote) {
    if (!remote?.sprite) return;
    const remoteSlot = this.playerId.localeCompare(remote.id) < 0 ? 1 : 0;
    const x = this.finishLineX;
    const y = this.startLineY + (remoteSlot === 0 ? -84 : 84);
    if (
      Math.abs(remote.sprite.x - x) > 0.001 ||
      Math.abs(remote.sprite.y - y) > 0.001 ||
      Math.abs(remote.sprite.rotation + Math.PI / 2) > 0.001
    ) {
      resetRemoteMotion(remote);
      remote.sprite.setPosition(x, y).setRotation(-Math.PI / 2);
      remote.sprite.body?.reset(x, y);
    }
    remote.vx = 0;
    remote.vy = 0;
    remote.angularVelocity = 0;
    remote.label?.setPosition(x, y - 82);
  }

  alignStartingCars(opponent) {
    if (!this.localCarReady) return false;

    // O ID menor fica na faixa de cima e o maior na faixa de baixo. Os dois clientes
    // calculam as mesmas posições, mesmo se os hashes iniciais coincidirem.
    const localSlot = this.playerId.localeCompare(opponent.id) < 0 ? 0 : 1;
    this.playerSlot = localSlot;
    const targetX = this.finishLineX;
    const targetY = this.startLineY + (localSlot === 0 ? -84 : 84);
    this.networkStartX = targetX;
    this.networkStartY = targetY;
    this.placeRemoteOnGrid(opponent);
    if (this.startAlignmentTween?.isPlaying()) return false;
    if (
      Math.abs(this.car.x - targetX) < 1 &&
      Math.abs(this.car.y - targetY) < 1
    ) {
      if (!this.startAlignmentComplete) {
        this.car.body.reset(targetX, targetY);
        this.car.setAngle(-90);
        this.startAlignmentComplete = true;
        this.publishNetworkState(true, true);
      }
      return true;
    }
    this.car.body.setVelocity(0, 0);
    this.startAlignmentComplete = false;
    this.startAlignmentTween = this.tweens.add({
      targets: this.car,
      x: targetX,
      y: targetY,
      duration: 350,
      ease: "Sine.easeInOut",
      onUpdate: () => this.car.body.reset(this.car.x, this.car.y),
      onComplete: () => {
        this.car.body.reset(targetX, targetY);
        this.car.setAngle(-90);
        this.startAlignmentComplete = true;
        this.startAlignmentTween = null;
        this.publishNetworkState(true, true);
        this.tryCoordinateStart();
      },
    });
    return false;
  }

  tryCoordinateStart() {
    if (this.raceTimerStarted || this.raceFinished) return;
    const opponents = this.getActiveOpponents();
    const opponent = opponents.length === 1 ? opponents[0] : null;
    const aligned = opponent ? this.alignStartingCars(opponent) : false;
    const ready = aligned && this.hasReadyPair();

    if (!ready) {
      if (this.startCountdownStarted) {
        this.cancelStartCountdown();
        playMusic(this, 'lobby');
      }
      if (this.raceStartAt !== null) {
        const isCoordinator =
          !opponent || this.playerId.localeCompare(opponent.id) < 0;
        this.raceStartAt = null;
        if (isCoordinator && this.multiplayer?.connected)
          this.publishNetworkState(true, true);
      }
      this.updateLobbyStatus();
      return;
    }

    const isCoordinator = this.playerId.localeCompare(opponent.id) < 0;
    if (isCoordinator && this.raceStartAt === null) {
      this.raceStartAt = Date.now() + 5000;
      this.publishNetworkState(true, true);
    } else if (!isCoordinator && Number.isFinite(opponent.startAt)) {
      this.raceStartAt = opponent.startAt - opponent.clockOffset;
    }

    // A resposta de sincronização pode ajustar o relógio durante o 3, 2, 1.
    // Os timers precisam acompanhar o horário compartilhado atualizado.
    if (this.startCountdownStarted && Number.isFinite(this.countdownStartAt) &&
      Math.abs(this.raceStartAt - this.countdownStartAt) > 20) {
      this.cancelStartCountdown();
    }
    this.updateLobbyStatus();
    if (this.raceStartAt && Date.now() >= this.raceStartAt - 3120)
      this.startCountdown();
  }

  cancelStartCountdown() {
    this.countdown?.cancel();
    this.countdown = null;
    this.countdownFallbackTimer?.remove(false);
    this.countdownFallbackTimer = null;
    this.startCountdownStarted = false;
    this.countdownStartAt = null;
  }

  startCountdown() {
    if (this.startCountdownStarted || !this.raceStartAt || !this.hasReadyPair())
      return;
    this.startCountdownStarted = true;
    this.countdownStartAt = this.raceStartAt;
    playMusic(this, 'lobby', 0.07);
    try {
      this.countdown = new StartCountdown(this);
      this.countdown.play(() => {
        this.beginRace();
      }, this.raceStartAt);
    } catch (e) {
      console.error("RaceScene: contagem regressiva falhou.", e);
      this.countdownFallbackTimer = this.time.delayedCall(Math.max(0, this.raceStartAt - Date.now()), () =>
        this.beginRace(),
      );
    }
  }

  beginRace() {
    if (this.raceTimerStarted || this.raceFinished || !this.hasReadyPair() || !this.raceStartAt)
      return;
    this.roomStatusLabel?.setVisible(false);
    Object.values(this.remotePlayers).forEach((remote) => {
      this.placeRemoteOnGrid(remote);
      if (remote.online && remote.collider) remote.collider.active = true;
    });
    this.car.controlsEnabled = true;
    this.startRaceTimer();
  }

  startRaceTimer() {
    if (this.raceTimerStarted || this.raceFinished) return;

    const opponent = this.getActiveOpponents()[0];
    if (!opponent) return;
    const coordinatorId = [this.playerId, opponent.id].sort((a, b) => a.localeCompare(b))[0];
    const localCoordinator = coordinatorId === this.playerId;
    const session = localCoordinator ? this.multiplayer.sessionId : opponent.sessionId;
    const startAt = localCoordinator ? this.raceStartAt : opponent.startAt;
    this.raceRoundId = JSON.stringify([this.roomId, coordinatorId, session, startAt]);
    this.brickCollectibles.startRace({ roundId: this.raceRoundId, coordinatorId,
      participantIds: [this.playerId, opponent.id] });
    this.raceTimerStarted = true;
    playMusic(this, 'race');
    this.raceStartTime = this.time.now;
    this.raceElapsedMs = 0;
    this.updateRaceTimerHud();
    this.publishNetworkState(true, true);
  }

  updateRaceTimerHud() {
    this.raceHud?.updateTimer();
  }

  formatRaceTime(ms) {
    const totalCentiseconds = Math.floor(ms / 10);
    const minutes = Math.floor(totalCentiseconds / 6000);
    const seconds = Math.floor((totalCentiseconds % 6000) / 100);
    const centiseconds = totalCentiseconds % 100;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
  }

  // Mantém os limites originais do Tiled com superfícies contínuas.
  createWallsFromLayer(layerName) {
    const layer = this.map.getObjectLayer(layerName);
    if (!layer) {
      console.warn(`[Race] Camada de colisão "${layerName}" não encontrada.`);
      return;
    }
    this.wallShapes.push(...wallShapes(layer.objects));
  }

  onCrash(impactSpeed, contact) {
    const now = this.time.now;
    if (now < (this.crashFeedbackAfter || 0)) return;
    const severity = impactSpeed ?? Math.max(0,
      this.car.lastDriveSpeed - this.car.body.velocity.length());
    if (severity < 50) return;
    this.crashFeedbackAfter = now + 550;
    if (this.car.isTurboActive || this.car.turboIntensity > 0.25) {
      this.car.turboSpool = 0;
      this.car.isTurboActive = false;
      this.car.turboIntensity *= 0.45;
      this.car.turboFuel = Math.max(0, this.car.turboFuel - 12);
      this.car._turboBlockedUntil = now + 600;
      this.car._rechargeAfter = now + this.car.turboRechargeDelay;
      this.car.emit('turbo-stop');
    }
    this.carFX?.crash(severity, contact);
    this.cameras.main.shake(130, Math.min(0.005, severity / 100000));
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
      { x: 4832, y: 3578 },
    ];

    // Só o barril azul. Corpo de colisão em círculo (mais barato que
    // retângulo aqui e não precisa se preocupar com rotação do
    // sprite).
    // O desenho do barril ocupa x=3..44, y=24..92 do frame 48x96
    // (centro em ~23.5, 58). O círculo antigo (raio 16 no centro do
    // frame) cobria só uma fatia pequena e ficava ~10px acima do
    // desenho, então o carro entrava no barril. Agora ele cobre a
    // largura toda do barril.
    const kind = { key: "barril", cx: 23.5, cy: 58, radius: 20 };

    this.obstacles = this.physics.add.staticGroup();

    obstacleSpots.forEach((spot) => {
      const obstacle = this.obstacles.create(spot.x, spot.y, kind.key);
      obstacle.setDepth(500);
      obstacle.body.setCircle(
        kind.radius,
        kind.cx - kind.radius,
        kind.cy - kind.radius,
      );
      obstacle.refreshBody();
      obstacle.hitCooldownUntil = 0;
      // Ponto do chão onde o barril "pisa" (base do desenho). Usado
      // pra decidir se o carro está na frente ou atrás dele.
      obstacle.groundY = spot.y + (92 - 48);
    });

    // TrackCollisions resolve os contatos sem uma segunda separação do Arcade.
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

  onObstacleHit(obstacle, impactSpeed = this.car.body.speed) {
    const now = this.time.now;
    if (now < obstacle.hitCooldownUntil) return;
    obstacle.hitCooldownUntil = now + 700;

    if (impactSpeed < 40) return;

    // Feedback no próprio obstáculo: pisca vermelho e sacode um pouco.
    this.tweens.killTweensOf(obstacle);
    obstacle.setTint(0xff6b6b);
    this.tweens.add({
      targets: obstacle,
      angle: obstacle.angle + Phaser.Math.Between(-9, 9),
      scaleX: 0.93,
      scaleY: 0.96,
      duration: 110,
      yoyo: true,
      ease: "Quad.easeOut",
      onComplete: () => obstacle.clearTint(),
    });
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
      { x: 480, y: 928, tex: "zonaoleo" },
      { x: 2400, y: 928, tex: "zonaoleo2" },
      { x: 1440, y: 1120, tex: "zonaoleo" },
      { x: 4000, y: 1760, tex: "zonaoleo2" },
      { x: 1952, y: 1888, tex: "zonaoleo" },
      { x: 4896, y: 1888, tex: "zonaoleo2" },
      { x: 480, y: 2144, tex: "zonaoleo" },
      { x: 2400, y: 2720, tex: "zonaoleo2" },
      // Dois tiles após a placa 8, antes da curva para a reta de chegada.
      { x: 5664, y: 3296, tex: "zonaoleo" },
      { x: 3616, y: 3488, tex: "zonaoleo2" },
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
      zonaoleo: { w: 62, h: 38, dx: -1, dy: 3 },
      zonaoleo2: { w: 69, h: 37, dx: -1, dy: -1 },
    };

    oilSpots.forEach((spot) => {
      const puddle = this.add.image(spot.x, spot.y, spot.tex);
      puddle.setDisplaySize(84, 84);
      puddle.setAlpha(0.92);
      this.oilVisuals.add(puddle);

      const hit = oilHit[spot.tex];
      const sensor = this.add.rectangle(
        spot.x + hit.dx,
        spot.y + hit.dy,
        hit.w,
        hit.h,
      );
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

    // Numeração no sentido horário, começando após a linha de largada.
    // Os valores são coordenadas de tiles; a posição final soma meio tile.
    const boostPositions = [
      { x: 70, y: 54, direction: Math.PI },          // 1: reta da largada, esquerda
      { x: 46, y: 54, direction: Math.PI },          // 2: mesma reta
      { x: 32, y: 38, direction: Math.PI },          // 3: curva interna
      { x: 7.5, y: 20, direction: -Math.PI / 2 },   // 4: subida à esquerda
      { x: 22, y: 24, direction: Math.PI / 2 },     // 5: descida, seta para baixo
      { x: 48, y: 15, direction: 0 },               // 6: reta superior, direita
      { x: 65, y: 44, direction: 0 },               // 7: centro da reta (linhas 42..46)
      { x: 88, y: 49, direction: Math.PI / 2 },     // 8: centro da descida (colunas 86..90)
    ];

    this.boostSensors = this.physics.add.staticGroup();
    this.boostVisuals = this.add.container(0, 0).setDepth(900);
    this.boostData = [];
    this.boostFX = new BoostFX(this);

    const tileWidth = this.map.tileWidth;
    const tileHeight = this.map.tileHeight;
    // A nova arte mantém o formato 64x96 e a geometria das placas.
    const plateWidth = tileWidth; // 64
    const plateLength = tileHeight * 1.5; // 96
    const carRadius = 16; // margem do corpo físico do carro

    boostPositions.forEach((position, index) => {
      const centerX = position.x * tileWidth + tileWidth / 2;
      const centerY = position.y * tileHeight + tileHeight / 2;
      const rotation = position.direction + Math.PI / 2;

      const plate = this.add.image(centerX, centerY, "placaboost");
      plate.setDisplaySize(plateWidth, plateLength);
      plate.setRotation(rotation);
      plate.setOrigin(0.5);
      plate.setAlpha(1);
      this.boostVisuals.add(plate);
      this.boostFX.addPlate(plate, index);
      const number = index + 1;
      const numberLabel = this.add
        .text(centerX - Math.sin(rotation) * 37, centerY + Math.cos(rotation) * 37,
          String(number), {
            fontFamily: "monospace", fontSize: "11px", fontStyle: "bold",
            color: "#d8f7ff", backgroundColor: "#080f23",
            padding: { left: 2, right: 2, top: 0, bottom: 0 },
          })
        .setOrigin(0.5).setRotation(rotation);
      this.boostVisuals.add(numberLabel);

      // Sensor físico maior que a placa NÃO é usado para decidir o
      // acerto. Guardamos a geometria real e fazemos a interseção
      // círculo x retângulo rotacionado no update. Assim qualquer parte
      // da placa pode ser atingida, inclusive os cantos.
      const sensor = this.add.rectangle(
        centerX,
        centerY,
        plateLength,
        plateWidth,
      );
      sensor.setVisible(false);
      this.physics.add.existing(sensor, true);
      this.boostSensors.add(sensor);

      sensor.boostCooldownUntil = 0;
      sensor.boostIndex = index;
      sensor.boostNumber = number;

      this.boostData.push({
        number,
        x: centerX,
        y: centerY,
        rotation,
        halfX: plateWidth / 2,
        halfY: plateLength / 2,
        radius: carRadius,
        sensor,
        plate,
        numberLabel,
      });
    });
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
      if (diffX * diffX + diffY * diffY > boost.radius * boost.radius) {
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

    this.boostFX.activate(boost, this.car, time);

    // Pequeno impacto de câmera para o boost parecer realmente físico.
    if (this.cameras && this.cameras.main) {
      this.cameras.main.shake(110, 0.0045);
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
      { x: 3872, y: 3608, w: 560, h: 230, name: "CP1" },

      // CP2 — trecho vertical da esquerda.
      { x: 544, y: 1824, w: 230, h: 560, name: "CP2" },

      // CP3 — reta superior (horizontal).
      { x: 3872, y: 928, w: 560, h: 230, name: "CP3" },

      // CP4 — trecho vertical da direita. O sensor agora está na
      // orientação correta da pista, colocando o checkpoint realmente
      // sobre o trecho vertical do circuito.
      { x: 4896, y: 2208, w: 230, h: 560, name: "CP4" },
    ];

    this.checkpoints = [];
    this.checkpointSensors = this.physics.add.staticGroup();
    this.checkpointVisuals = this.add.container(0, 0).setDepth(850);

    checkpoints.forEach((cp, index) => {
      const gate = this.add.rectangle(cp.x, cp.y, cp.w, cp.h, 0x00e5ff, 0.0);
      gate.setVisible(false);
      gate.setData("index", index);
      gate.setData("name", cp.name);
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

    const index = gate.getData("index");
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
      this.checkpointLabel
        .setText(message.length > 18 ? "FALTA CHECKPOINT" : message)
        .setColor("#ffe066");
      this.tweens.add({
        targets: this.checkpointLabel,
        scale: 1.18,
        duration: 120,
        yoyo: true,
        ease: "Quad.easeOut",
        onComplete: () => this.updateCheckpointHud(),
      });
      return;
    }

    this.checkpointLabel
      .setText(`CHECKPOINT ${this.checkpointIndex}/${this.checkpointCount}`)
      .setColor(
        this.checkpointIndex >= this.checkpointCount ? "#00ff9d" : "#9bdfff",
      );

    // Indicador visual de progresso: 4 módulos que acendem conforme
    // o jogador passa pelos checkpoints.
    if (this.checkpointProgress) {
      this.checkpointProgress.forEach((segment, i) => {
        const done = i < this.checkpointIndex;
        segment.fillColor = done ? 0x00e5ff : 0x17243b;
        segment.setAlpha(done ? 1 : 0.85);
        segment.setStrokeStyle(1, done ? 0x00e5ff : 0x3b4c68, done ? 1 : 0.8);
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
      .setText(last ? "CHECKPOINT FINAL!" : `CHECKPOINT ${completed}`)
      .setColor(last ? "#00ff9d" : "#00e5ff");

    this.checkpointBannerCount.setText(
      `${completed} / ${this.checkpointCount}`,
    );

    [
      this.checkpointBanner,
      this.checkpointBannerText,
      this.checkpointBannerCount,
    ].forEach((obj) => obj.setVisible(true));

    this.checkpointBanner.setAlpha(0).setScale(0.72);
    this.checkpointBannerText.setAlpha(0).setScale(0.45);
    this.checkpointBannerCount.setAlpha(0).setScale(0.8);

    this.tweens.killTweensOf([
      this.checkpointBanner,
      this.checkpointBannerText,
      this.checkpointBannerCount,
    ]);

    this.tweens.add({
      targets: this.checkpointBanner,
      alpha: 0.96,
      scale: 1,
      duration: 180,
      ease: "Back.easeOut",
    });

    this.tweens.add({
      targets: this.checkpointBannerText,
      alpha: 1,
      scale: 1,
      duration: 260,
      ease: "Back.easeOut",
    });

    this.tweens.add({
      targets: this.checkpointBannerCount,
      alpha: 1,
      scale: 1,
      duration: 220,
      delay: 90,
      ease: "Quad.easeOut",
    });

    this.tweens.add({
      targets: this.checkpointBannerText,
      scale: 1.08,
      duration: 130,
      delay: 260,
      yoyo: true,
      ease: "Sine.easeInOut",
    });

    this.tweens.add({
      targets: [
        this.checkpointBanner,
        this.checkpointBannerText,
        this.checkpointBannerCount,
      ],
      alpha: 0,
      duration: 260,
      delay: 1050,
      ease: "Quad.easeIn",
      onComplete: () => {
        this.checkpointBanner.setVisible(false);
        this.checkpointBannerText.setVisible(false);
        this.checkpointBannerCount.setVisible(false);
      },
    });
  }

  // Efeito de passagem no carro: anel neon + partículas radiais.
  checkpointPassEffect() {
    if (!this.car) return;

    const x = this.car.x;
    const y = this.car.y;
    const accent = 0x00e5ff;
    const ring = this.add
      .circle(x, y, 18, accent, 0.08)
      .setStrokeStyle(4, accent, 0.95)
      .setDepth(1800);

    this.tweens.add({
      targets: ring,
      radius: 72,
      alpha: 0,
      duration: 420,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });

    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 * i) / 10;
      const dist = Phaser.Math.Between(38, 68);
      const dot = this.add
        .circle(x, y, Phaser.Math.Between(3, 5), i % 2 ? 0xff2bd6 : 0x00e5ff, 1)
        .setDepth(1801);
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(a) * dist,
        y: y + Math.sin(a) * dist,
        alpha: 0,
        scale: 0.2,
        duration: 360,
        ease: "Cubic.easeOut",
        onComplete: () => dot.destroy(),
      });
    }

    this.cameras.main.shake(110, 0.0035);
  }

  // Som curto gerado pelo próprio navegador: não depende de asset externo.
  playCheckpointSound(index) {
    try {
      if (this.sound?.mute || this.audio?.muted) return;
      const ctx = this.sound && this.sound.context;
      if (!ctx || ctx.state === "suspended" || this.sound.mute) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const base = index === this.checkpointCount - 1 ? 740 : 520;

      osc.type = "square";
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
        this.updateCheckpointHud("VOLTA BLOQUEADA — COMPLETE OS CHECKPOINTS");
        this.tweens.add({
          targets: this.lapLabel,
          scale: 1.12,
          duration: 120,
          yoyo: true,
          ease: "Quad.easeOut",
        });
      } else if (this.currentLap < this.totalLaps) {
        this.completedLaps++;
        this.currentLap++;
        this.brickCollectibles?.resetForLap(this.currentLap);
        this.checkpointIndex = 0;
        this.lapLabel.setText(`VOLTA ${this.currentLap} / ${this.totalLaps}`);
        this.updateCheckpointHud();

        // Pequeno feedback visual sem interromper a corrida.
        this.tweens.add({
          targets: this.lapLabel,
          scale: 1.22,
          duration: 120,
          yoyo: true,
          ease: "Quad.easeOut",
        });
      } else {
        this.completedLaps++;
        this.finishRace();
      }
    }

    this.previousCarX = x;
  }

  finishRace() {
    if (this.raceFinished) return;
    this.raceFinished = true;
    stopMusic(this);
    this.currentLap = this.totalLaps;
    this.lapLabel.setText(`VOLTA ${this.totalLaps} / ${this.totalLaps}`);

    if (this.raceTimerStarted) {
      this.raceElapsedMs = Math.max(0, this.time.now - this.raceStartTime);
      this.updateRaceTimerHud();
      this.raceTimerLabel.setColor("#00ff9d");
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
    this.publishNetworkState(true, true);
    this.showWaitingForOpponent();
    this.tryResolvePodium();
  }

  showWaitingForOpponent() {
    this.raceResults.showWaiting();
  }

  tryResolvePodium() {
    if (!this.raceFinished || this.podiumShown || this.brickCollectibles?.hasPendingClaims()) return;
    const finishers = Object.values(this.remotePlayers).filter(player =>
      player.finished && player.roundId === this.raceRoundId && Number.isFinite(player.finishElapsedMs));
    if (finishers.length !== 1) return;

    const opponent = finishers[0];
    const results = [
      { id: this.playerId, nick: this.playerNick, skin: this.carSkin, tint: this.carTint,
        elapsed: this.finishElapsedMs, laps: this.completedLaps, local: true },
      { id: opponent.id, nick: opponent.nick || "PILOTO", skin: opponent.skin, tint: opponent.tint,
        elapsed: opponent.finishElapsedMs, laps: opponent.completedLaps, local: false },
    ].sort((a, b) => a.elapsed - b.elapsed || a.id.localeCompare(b.id));

    this.raceResultsData = results.map((driver, index) => {
      const collected = this.brickCollectibles?.countFor(driver.id) || 0;
      const place = index + 1;
      return { ...driver, collected, place,
        rewards: computeBrickRewards({ collected, laps: driver.laps, finished: true, place }, this.rewardRules) };
    });
    this.finishPlace = this.raceResultsData.find(driver => driver.local).place;
    this.championNick = this.raceResultsData[0].nick;
    this.finalScoreData = this.computeFinalScore();
    this.podiumShown = true;
    this.publishNetworkState(true, true);
    this.playChampionAnimation();
    this.time.delayedCall(2400, () => this.showScorePanel());
  }

  computeFinalScore() {
    return computeBrickRewards({ collected: this.brickCount || 0,
      laps: this.completedLaps || 0, finished: this.raceFinished, place: this.finishPlace }, this.rewardRules);
  }

  // Synthesized feedback for checkpoints, pickups and the result animation.
  scoreTone(freq, dur = 0.06, vol = 0.05, type = "square", slideTo = null) {
    try {
      if (this.sound?.mute || this.audio?.muted) return;
      const ctx = this.sound && this.sound.context;
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
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
    } catch (e) {
      /* som é opcional */
    }
  }

  showScorePanel() {
    this.raceResults.showResults(this.raceResultsData);
  }

  createChampionOverlay() {
    this.raceResults = new RaceResults(this);
  }

  playChampionAnimation() {
    this.raceResults.showPodium(this.raceResultsData);
  }

  // ------------------------------------------------------------------
  // HUD
  // ------------------------------------------------------------------
  buildHud() {
    this.raceHud = new RaceHUD(this);
    this.raceHud.build();
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
      ...this.obstacles.getChildren(),
      this.oilVisuals,
      this.boostVisuals,
      ...(this.brickCollectibles ? this.brickCollectibles.worldObjects : []),
      ...(this.boostFX ? this.boostFX.worldObjects : []),
      ...this.fx.worldObjects,
      this.carFX.smoke,
      this.carFX.dust,
      this.carFX.impact,
      this.carFX.impactFlash,
      ...this.carFX.marks,
      ...(this.oilFX ? this.oilFX.worldObjects : []),
      ...this.nightLighting.worldObjects,
    ];
    const ui = [
      ...this.hud,
      ...this.fx.uiObjects,
      this.miniMapBackground,
      this.miniMapImage,
      this.miniMapPlayer,
      this.miniMapRival,
      this.miniMapFrame,
      this.miniMapLabel,
    ];

    this.cameras.main.ignore(ui);
    this.uiCam.ignore(world);
  }

  createLightMinimap() {
    this.raceHud.createMinimap();
  }

  updateMinimap() {
    this.raceHud?.updateMinimap();
  }

  updateHud() {
    this.raceHud.update();
  }

  update(time, delta) {
    if (this.car) {
      // Checagem direta por frame (sem callback): o carro está
      // em cima de alguma mancha de óleo agora?
      this.car.isOnOil =
        !!this.oilSensors && this.physics.overlap(this.car, this.oilSensors);
      this.car.update(time, delta);
      this.sortObstacleDepth();
      this.publishNetworkState();
    }
    this.updateRemotePlayers();
    this.tryCoordinateStart();
    this.checkBoostPlates(time);
    if (this.boostFX) this.boostFX.update(time);
    this.checkCheckpointFallback();
    this.brickCollectibles?.update(time);
    this.updateLapSystem();
    if (this.raceFinished && !this.podiumShown) {
      this.raceResults?.updateWaiting();
      this.tryResolvePodium();
    }
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
    if (this.nightLighting) this.nightLighting.update();
  }
}
export default Race;
