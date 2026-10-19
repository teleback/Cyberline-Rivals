import { playMusic } from '../fx/Music.js';
import { readGamepad } from "../input/GamepadInput.js";
import RoomPresence, { PRESENCE_TIMEOUT } from "../input/RoomPresence.js";
import { ROOMS, ROOM_COUNT, ROOM_CAPACITY } from "../objects/Rooms.js";

export function roomGridLayout(width, height) {
  const compact = width < 600;
  const margin = width * 0.07;
  const columns = compact ? 2 : 3;
  const pageSize = columns * 2;
  const gap = compact ? 10 : 14;
  const gridTop = height * 0.275;
  const gridBottom = height * 0.69;
  return { compact, margin, columns, pageSize, gap, gridTop,
    cardWidth: (width - margin * 2 - gap * (columns - 1)) / columns,
    cardHeight: (gridBottom - gridTop - gap) / 2,
    pageY: height * (compact ? 0.76 : 0.775), confirmY: height * 0.89 };
}

// A ocupação vem dos jogadores que publicam presença ao vivo no multiplayer.
class RoomSelectionScene extends Phaser.Scene {
  constructor() {
    super("RoomSelection");
    this.selectedRoom = 1;
    this.roomCards = [];
    this.playerNick = "PILOTO";
  }

  create(data = {}) {
    playMusic(this, 'lobby');
    this.playerNick = data.playerNick || this.getSavedNickname() || "PILOTO";
    this.playerId = data.playerId || this.getPlayerId();
    this.selectedRoom = this.getSavedSelectedRoom();
    this.roomCards = [];
    this.enteringRoom = false;
    this.roomPlayers = new Map();
    this.roomPresenceReady = false;
    this.roomPresenceStatus = 'connecting';
    this.padConfirmArmed = false;
    this.padNavigationAt = this.time.now + 350;
    this.padReadyAt = this.time.now + 350;
    this.padDirection = 0;
    const { width, height } = this.scale;
    this.roomLayout = roomGridLayout(width, height);
    const { compact, margin, columns, pageSize, gap, cardWidth, cardHeight, gridTop, pageY, confirmY } = this.roomLayout;
    this.roomColumns = columns;
    this.roomsPerPage = pageSize;
    this.roomPage = Math.floor((this.selectedRoom - 1) / pageSize);
    this.pageCount = Math.ceil(ROOM_COUNT / pageSize);

    this.cameras.main.setBackgroundColor("#09051c");
    const backdrop = this.add.graphics();
    backdrop.fillStyle(0x09051c).fillRect(0, 0, width, height);
    // Halos em camadas: iluminação também funciona no renderizador Canvas.
    for (const [x, y, tint] of [
      [width * 0.1, height * 0.4, 0xff39d4],
      [width * 0.5, height * 0.1, 0xa855ff],
      [width * 0.9, height * 0.6, 0x3995ff],
    ]) {
      for (let radius = width * 0.42; radius > 20; radius -= 20) {
        backdrop.fillStyle(tint, 0.008).fillCircle(x, y, radius);
      }
    }
    // Grade em perspectiva, skyline e linhas de circuito desenhados no Phaser.
    backdrop.lineStyle(1, 0xa855ff, 0.18);
    for (let i = -8; i <= 8; i++) {
      backdrop.lineBetween(width / 2 + i * 22, height * 0.25,
        width / 2 + i * 110, height);
    }
    for (let y = height * 0.25; y < height; y += 22) {
      backdrop.lineBetween(0, y, width, y);
    }
    for (let i = 0; i < 24; i++) {
      const x = i * width / 24;
      const buildingHeight = height * (0.12 + ((i * 7) % 9) * 0.012);
      backdrop.fillStyle(0x100b29).fillRect(x, height - buildingHeight, width / 28, buildingHeight);
      backdrop.lineStyle(1, i % 2 ? 0xff39d4 : 0x3995ff, 0.4);
      backdrop.lineBetween(x, height - buildingHeight, x + width / 28, height - buildingHeight);
    }
    backdrop.lineStyle(2, 0xff39d4, 0.8);
    backdrop.strokePoints([{ x: margin, y: 22 }, { x: margin + 60, y: 22 },
      { x: margin + 72, y: 34 }, { x: width - margin, y: 34 }]);
    backdrop.lineStyle(2, 0xa855ff, 0.65);
    backdrop.lineBetween(margin, height - 24, width - margin, height - 24);
    backdrop.fillStyle(0x000000, 0.1);
    for (let y = 0; y < height; y += 4) backdrop.fillRect(0, y, width, 1);
    const signalGlow = this.add.rectangle(margin + 80, 34, 48, 10, 0xff39d4, 0.18);
    const signal = this.add.rectangle(margin + 80, 34, 16, 2, 0xffc4f4);
    this.tweens.add({
      targets: [signalGlow, signal], x: width - margin - 20,
      duration: 2800, repeat: -1, yoyo: true, ease: "Sine.easeInOut",
    });

    const text = (x, y, label, size, color, extra = {}) => this.add.text(x, y, label, {
      fontFamily: "monospace", fontSize: `${size}px`, color, ...extra,
    });
    const arcade = (color, blur = 12) => ({
      fontFamily: '"Cyber Arcade", monospace',
      shadow: { offsetX: 0, offsetY: 0, color, blur, fill: true },
    });
    text(width / 2, height * 0.105, "SELECIONE UMA SALA", compact ? 16 : 24,
      "#ffe5fc", arcade("#ff39d4", 18)).setOrigin(0.5, 0);
    text(margin, height * 0.195, `${ROOM_COUNT} SALAS  /  0${ROOM_CAPACITY} PILOTOS POR SALA`, compact ? 8 : 11, "#7186a9");
    text(width - margin, height * 0.195, this.playerNick.slice(0, compact ? 10 : 16), compact ? 9 : 12,
      "#acbfff", { fontStyle: "bold" }).setOrigin(1, 0);

    ROOMS.forEach((room, index) => {
      const roomId = room.id;
      const position = index % pageSize;
      const x = margin + (position % columns) * (cardWidth + gap);
      const y = gridTop + Math.floor(position / columns) * (cardHeight + gap);
      const glowWide = this.add.rectangle(x + cardWidth / 2, y + cardHeight / 2,
        cardWidth + 12, cardHeight + 12, room.tint, 0).setStrokeStyle(8, room.tint, 0.07);
      const glow = this.add.rectangle(x + cardWidth / 2, y + cardHeight / 2,
        cardWidth + 4, cardHeight + 4, room.tint, 0).setStrokeStyle(4, room.tint, 0.22);
      const card = this.add.rectangle(x + cardWidth / 2, y + cardHeight / 2,
        cardWidth, cardHeight, 0x150d2b).setStrokeStyle(1, room.tint, 0.5)
        .setInteractive({ useHandCursor: true });
      const ornament = this.add.graphics();
      // Pista miniatura e cantos chanfrados iluminam cada sala.
      ornament.lineStyle(2, room.tint, 0.18);
      const laneX = x + cardWidth * 0.76;
      ornament.strokePoints([{ x: laneX, y: y + 12 },
        { x: laneX - 12, y: y + cardHeight * 0.5 },
        { x: laneX + 24, y: y + cardHeight - 12 }]);
      ornament.strokePoints([{ x: laneX + 30, y: y + 12 },
        { x: laneX + 18, y: y + cardHeight * 0.5 },
        { x: laneX + 54, y: y + cardHeight - 12 }]);
      ornament.lineStyle(2, room.tint, 0.85);
      ornament.strokePoints([{ x, y: y + 18 }, { x, y }, { x: x + 24, y }]);
      ornament.strokePoints([{ x: x + cardWidth - 24, y: y + cardHeight },
        { x: x + cardWidth, y: y + cardHeight }, { x: x + cardWidth, y: y + cardHeight - 18 }]);
      const title = text(x + 14, y + 17, `SALA ${String(roomId).padStart(2, '0')}`,
        compact ? 16 : 18, "#fff0fc", arcade(room.color, 6));
      const detail = text(x + 14, y + cardHeight - 22, "", compact ? 9 : 10, "#91a4c5",
        { wordWrap: { width: cardWidth - 48 } });
      const count = text(x + cardWidth - 12, y + 12, `0/${ROOM_CAPACITY}`, 10, '#91a4c5').setOrigin(1, 0);
      const indicator = text(x + cardWidth - 12, y + cardHeight - 43, "◆", 10, room.color).setOrigin(1, 0);
      const slots = Array.from({ length: ROOM_CAPACITY }, (_, slot) => this.add.rectangle(x + cardWidth - 31 + slot * 12,
        y + cardHeight - 20, 6, 10, 0x293852));
      const accent = this.add.rectangle(x + 2, y + cardHeight / 2, 3, cardHeight - 28, room.tint);
      card.on("pointerdown", () => this.selectRoom(roomId));
      card.on("pointerover", () => {
        if (this.selectedRoom !== roomId) card.setStrokeStyle(1, room.tint, 0.8);
      });
      card.on("pointerout", () => {
        if (this.selectedRoom !== roomId) card.setStrokeStyle(1, room.tint, 0.5);
      });
      const container = this.add.container(0, 0,
        [glowWide, glow, card, ornament, title, detail, count, indicator, ...slots, accent]);
      this.roomCards.push({ roomId, container, card, glow, glowWide, title, detail, count, indicator, slots, accent, ...room });
    });

    const pageButton = (x, label, step) => {
      const button = this.add.rectangle(x, pageY, 64, 38, 0x1b1031)
        .setStrokeStyle(1, 0xa855ff, 0.7);
      button.setInteractive(new Phaser.Geom.Rectangle(0, -11, 64, 60), Phaser.Geom.Rectangle.Contains);
      button.on('pointerdown', () => this.changePage(step));
      text(x, pageY - 1, label, 26, '#e5baff').setOrigin(0.5);
      return button;
    };
    this.previousPageButton = pageButton(margin + 32, '‹', -1);
    this.nextPageButton = pageButton(width - margin - 32, '›', 1);
    this.pageLabel = text(width / 2, pageY - 12, '', compact ? 9 : 10, '#b3acd0').setOrigin(0.5);
    this.statusText = text(width / 2, pageY + 12, "", compact ? 9 : 11, "#ff39d4").setOrigin(0.5);
    this.confirm = text(width / 2, confirmY, "ENTRAR NA SALA  ›", compact ? 10 : 12,
      "#ffe5fc", { ...arcade("#ff39d4", 14), backgroundColor: "#26103e",
        padding: { left: 28, right: 28, top: compact ? 12 : 16, bottom: compact ? 12 : 16 } })
      .setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.confirm.on("pointerdown", () => this.confirmSelection());
    text(width / 2, height * 0.985, this.game?.device?.input?.touch
      ? 'DESLIZE PARA VER MAIS SALAS  •  TOQUE PARA ESCOLHER' : "DIRECIONAL: ESCOLHER   •   A / ENTER: ENTRAR",
      compact ? 7 : 9, "#7385a7").setOrigin(0.5, 1);
    this.selectRoom(this.selectedRoom);

    const keys = {
      "keydown-LEFT": () => this.moveSelection(-1),
      "keydown-RIGHT": () => this.moveSelection(1),
      "keydown-UP": () => this.moveSelection(-columns),
      "keydown-DOWN": () => this.moveSelection(columns),
      "keydown-PAGE_UP": () => this.changePage(-1),
      "keydown-PAGE_DOWN": () => this.changePage(1),
      "keydown-ENTER": () => this.confirmSelection(),
      "keydown-SPACE": () => this.confirmSelection(),
    };
    for (const [event, handler] of Object.entries(keys)) this.input.keyboard?.on(event, handler);
    this.events.once("shutdown", () => {
      for (const [event, handler] of Object.entries(keys)) this.input.keyboard?.off(event, handler);
    });
    let swipeStart = null;
    const startSwipe = pointer => {
      swipeStart = pointer.y >= gridTop && pointer.y <= height * 0.69
        ? { id: pointer.id, x: pointer.x, y: pointer.y } : null;
    };
    const finishSwipe = pointer => {
      if (!swipeStart || swipeStart.id !== pointer.id) return;
      const dx = pointer.x - swipeStart.x, dy = pointer.y - swipeStart.y;
      swipeStart = null;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.3) this.changePage(dx < 0 ? 1 : -1);
    };
    this.input.on('pointerdown', startSwipe);
    this.input.on('pointerup', finishSwipe);
    this.events.once('shutdown', () => {
      this.input.off('pointerdown', startSwipe);
      this.input.off('pointerup', finishSwipe);
    });
    // Remove presenças sem mensagens recentes enquanto a tela está aberta.
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.selectRoom(this.selectedRoom) });
    this.startRoomPresence();
  }

  startRoomPresence() {
    let disposed = false;
    let statusVersion = 0;
    this.roomDirectory = new RoomPresence(this.playerId, (roomId, state) => {
      const players = this.roomPlayers.get(roomId) || new Map();
      const wasPresent = players.has(state.id);
      if (state.online) players.set(state.id, Date.now());
      else players.delete(state.id);
      this.roomPlayers.set(roomId, players);
      // As mensagens de movimento só renovam o prazo. Redesenha os cartões
      // quando alguém entra ou sai, sem repintar dez salas a cada heartbeat.
      if (wasPresent !== state.online) this.selectRoom(this.selectedRoom);
    }, status => {
      const version = ++statusVersion;
      this.roomPresenceStatus = status;
      this.roomPresenceReady = false;
      if (status !== 'connected') this.roomPlayers.clear();
      this.selectRoom(this.selectedRoom);
      if (status === 'connected') {
        // Dá tempo de receber os primeiros estados ao vivo das dez salas.
        this.time.delayedCall(600, () => {
          if (disposed || version !== statusVersion) return;
          this.roomPresenceReady = true;
          this.selectRoom(this.selectedRoom);
        });
      }
    });
    this.events.once('shutdown', () => {
      disposed = true;
      this.roomDirectory.destroy();
      this.roomPlayers.clear();
    });
    this.roomDirectory.start();
  }

  moveSelection(step) {
    let next = this.selectedRoom - 1 + step;
    if (Math.abs(step) === this.roomColumns) {
      const column = (this.selectedRoom - 1) % this.roomColumns;
      if (next >= ROOM_COUNT) next = column;
      if (next < 0) next = column + Math.floor((ROOM_COUNT - 1 - column) / this.roomColumns) * this.roomColumns;
    }
    this.selectRoom(((next + ROOM_COUNT) % ROOM_COUNT) + 1);
  }

  changePage(step) {
    const page = (this.roomPage + step + this.pageCount) % this.pageCount;
    const position = (this.selectedRoom - 1) % this.roomsPerPage;
    this.selectRoom(Math.min(ROOM_COUNT, page * this.roomsPerPage + position + 1));
  }

  update(time) {
    const pad = readGamepad();
    if (!pad.any) this.padConfirmArmed = true;
    if (time < this.padReadyAt) return;
    const direction = pad.left ? -1 : pad.right ? 1 : pad.up ? -this.roomColumns : pad.down ? this.roomColumns : 0;
    if (direction && (direction !== this.padDirection || time >= this.padNavigationAt)) {
      this.moveSelection(direction);
      this.padNavigationAt = time + 220;
    }
    this.padDirection = direction;
    if (pad.any && this.padConfirmArmed) {
      this.padConfirmArmed = false;
      this.confirmSelection();
    }
  }

  selectRoom(roomId) {
    this.selectedRoom = Number.isInteger(roomId) ? Math.max(1, Math.min(ROOM_COUNT, roomId)) : 1;
    this.roomPage = Math.floor((this.selectedRoom - 1) / this.roomsPerPage);
    const first = this.roomPage * this.roomsPerPage + 1;
    const last = Math.min(ROOM_COUNT, first + this.roomsPerPage - 1);
    this.pageLabel?.setText(`SALAS ${String(first).padStart(2, '0')}–${String(last).padStart(2, '0')}  /  ${ROOM_COUNT}`);
    this.roomCards.forEach(view => {
      const { roomId: id, container, card, glow, glowWide, title, detail, count, indicator, slots, accent, tint, color } = view;
      container.setVisible(Math.floor((id - 1) / this.roomsPerPage) === this.roomPage);
      const active = id === this.selectedRoom;
      const occupancy = this.getRoomOccupancy(id);
      const full = occupancy >= ROOM_CAPACITY && !this.playerIsInRoom(id);
      const visualState = `${active}:${occupancy}:${this.roomPresenceReady}:${this.roomPresenceStatus}`;
      if (view.visualState === visualState) return;
      view.visualState = visualState;
      card.setStrokeStyle(active ? 3 : 1, tint, active ? 1 : 0.5);
      card.setFillStyle(active ? 0x271443 : 0x150d2b);
      glow.setAlpha(active ? 1 : 0.4);
      glowWide.setAlpha(active ? 1 : 0.3);
      title.setColor(active ? "#ffffff" : "#eadcff");
      title.setShadow(0, 0, color, active ? 8 : 4, false, true);
      detail.setText(this.roomPresenceReady
        ? this.getRoomDetailText(occupancy)
        : this.roomPresenceStatus === 'offline' ? 'OCUPAÇÃO INDISPONÍVEL' : 'VERIFICANDO...');
      count.setText(`${this.roomPresenceReady ? Math.min(occupancy, ROOM_CAPACITY) : '–'}/${ROOM_CAPACITY}`);
      count.setColor(full ? '#ff8de6' : '#b4c8ef');
      detail.setColor(full ? "#ff8de6" : active ? "#f4e9ff" : "#a49cc4");
      indicator.setVisible(active);
      accent.setAlpha(active ? 1 : 0.25);
      slots.forEach((slot, index) => slot.setFillStyle(index < occupancy ? tint : 0x293852));
    });
    const room = ROOMS[this.selectedRoom - 1];
    const occupancy = this.getRoomOccupancy(this.selectedRoom);
    const isFull = occupancy >= ROOM_CAPACITY && !this.playerIsInRoom(this.selectedRoom);
    this.statusText?.setText(isFull
      ? `SALA ${this.selectedRoom}: PARTIDA EM ANDAMENTO`
      : `SALA ${this.selectedRoom} SELECIONADA`).setColor(isFull ? "#ff8de6" : room.color);
    this.confirm?.setColor(isFull ? "#ff8de6" : "#fff0fc");
    this.confirm?.setShadow(0, 0, room.color, 14, false, true);
    this.confirm?.setText(!this.roomPresenceReady
      ? this.roomPresenceStatus === 'offline' ? 'RECONECTANDO...' : 'VERIFICANDO SALAS...'
      : isFull ? "PARTIDA EM ANDAMENTO" : "ENTRAR NA SALA  ›");
    this.confirm?.setAlpha(!this.roomPresenceReady || isFull ? 0.55 : 1);
  }

  confirmSelection() {
    if (this.enteringRoom) return;
    if (!this.roomPresenceReady) {
      this.statusText?.setText(this.roomPresenceStatus === 'offline'
        ? 'AGUARDE A CONEXÃO COM AS SALAS' : 'VERIFICANDO A OCUPAÇÃO...');
      return;
    }
    const currentOccupancy = this.getRoomOccupancy(this.selectedRoom);
    if (currentOccupancy >= ROOM_CAPACITY && !this.playerIsInRoom(this.selectedRoom)) {
      if (this.statusText) {
        this.statusText.setText(
          `SALA ${this.selectedRoom}: PARTIDA EM ANDAMENTO`,
        );
      }
      return;
    }

    this.enteringRoom = true;
    try {
      localStorage.setItem(
        "cyberlineLastSelectedRoom",
        String(this.selectedRoom),
      );
    } catch (_) {}
    this.scene.start("CarSelection", {
      playerNick: this.playerNick,
      playerId: this.playerId,
      roomId: this.selectedRoom,
    });
  }

  playerIsInRoom(roomId) {
    this.getRoomOccupancy(roomId);
    return this.roomPlayers.get(roomId)?.has(this.playerId) || false;
  }

  getRoomOccupancy(roomId) {
    const players = this.roomPlayers.get(roomId);
    if (!players) return 0;
    const now = Date.now();
    for (const [id, lastSeen] of players) {
      if (now - lastSeen > PRESENCE_TIMEOUT) players.delete(id);
    }
    return players.size;
  }

  getRoomDetailText(occupancy) {
    if (occupancy >= ROOM_CAPACITY) return "PARTIDA EM ANDAMENTO";
    if (occupancy === 1) return "1 JOGADOR";
    return "LIVRE";
  }

  getSavedSelectedRoom() {
    try {
      const selected = Number(
        localStorage.getItem("cyberlineLastSelectedRoom"),
      );
      return Number.isInteger(selected) && selected >= 1 && selected <= ROOM_COUNT
        ? selected
        : 1;
    } catch (_) {
      return 1;
    }
  }

  getPlayerId() {
    try {
      let id = localStorage.getItem("cyberlinePlayerId");
      if (!id) {
        id =
          (window.crypto && typeof window.crypto.randomUUID === "function"
            ? window.crypto.randomUUID()
            : "") ||
          `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem("cyberlinePlayerId", id);
      }
      return id;
    } catch (_) {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  getSavedNickname() {
    try {
      return localStorage.getItem("cyberlinePlayerNick") || "";
    } catch (_) {
      return "";
    }
  }
}

export default RoomSelectionScene;
