import { onAnyButton } from '../input/GamepadInput.js';

// Seleção de sala antes da escolha do carro. O limite de 2 jogadores é a
// regra pretendida para cada sala; a ocupação compartilhada entre navegadores
// precisará ser confirmada pelo servidor MQTT/backend.
class RoomSelectionScene extends Phaser.Scene {
    constructor() {
        super('RoomSelection');
        this.selectedRoom = 1;
        this.roomCards = [];
        this.playerNick = 'PILOTO';
    }

    create(data = {}) {
        this.playerNick = data.playerNick || this.getSavedNickname() || 'PILOTO';
        this.playerId = data.playerId || this.getPlayerId();
        this.selectedRoom = 1;
        this.roomCards = [];
        const { width, height } = this.scale;

        this.cameras.main.setBackgroundColor('#05060a');
        this.add.rectangle(width / 2, height / 2, width, height, 0x05060a);
        this.add.rectangle(width / 2, height * 0.14, width * 0.82, 2, 0x00e5ff, 0.8);
        this.add.rectangle(width / 2, height * 0.88, width * 0.82, 2, 0xff3355, 0.5);

        this.add.text(width / 2, height * 0.075, 'SELECIONE UMA SALA', {
            fontFamily: 'monospace', fontSize: '27px', fontStyle: 'bold',
            color: '#ffffff', stroke: '#00e5ff', strokeThickness: 1,
            align: 'center', wordWrap: { width: width * 0.9 }
        }).setOrigin(0.5);

        this.add.text(width / 2, height * 0.12, `PILOTO: ${this.playerNick}  •  MÁXIMO 2 JOGADORES POR SALA`, {
            fontFamily: 'monospace', fontSize: width < 600 ? '10px' : '12px',
            color: '#8ea0b5', align: 'center'
        }).setOrigin(0.5);

        const columns = width < 520 ? 2 : 3;
        const rows = 2;
        const areaWidth = Math.min(width * 0.84, 690);
        const gapX = width < 520 ? 12 : 18;
        const gapY = 16;
        const cardWidth = (areaWidth - gapX * (columns - 1)) / columns;
        const cardHeight = Math.min(94, height * 0.15);
        const startX = width / 2 - areaWidth / 2 + cardWidth / 2;
        const gridHeight = rows * cardHeight + (rows - 1) * gapY;
        const startY = height * 0.25 + Math.max(0, (height * 0.62 - gridHeight) / 2) + cardHeight / 2;

        for (let roomId = 1; roomId <= 6; roomId++) {
            const index = roomId - 1;
            const col = index % columns;
            const row = Math.floor(index / columns);
            const x = startX + col * (cardWidth + gapX);
            const y = startY + row * (cardHeight + gapY);

            const card = this.add.rectangle(x, y, cardWidth, cardHeight, 0x101722, 1)
                .setStrokeStyle(2, 0x334355, 1)
                .setInteractive({ useHandCursor: true });
            const title = this.add.text(x, y - 15, `SALA ${String(roomId).padStart(2, '0')}`, {
                fontFamily: 'monospace', fontSize: width < 520 ? '14px' : '17px',
                fontStyle: 'bold', color: '#ffffff'
            }).setOrigin(0.5);
            const detail = this.add.text(x, y + 13, 'LIMITE: 2 JOGADORES', {
                fontFamily: 'monospace', fontSize: width < 520 ? '8px' : '10px',
                color: '#8ea0b5'
            }).setOrigin(0.5);

            const select = () => this.selectRoom(roomId);
            card.on('pointerdown', select);
            title.setInteractive({ useHandCursor: true }).on('pointerdown', select);
            detail.setInteractive({ useHandCursor: true }).on('pointerdown', select);
            card.on('pointerover', () => {
                if (this.selectedRoom !== roomId) card.setStrokeStyle(2, 0x607080, 1);
            });
            card.on('pointerout', () => {
                if (this.selectedRoom !== roomId) card.setStrokeStyle(2, 0x334355, 1);
            });
            this.roomCards.push({ roomId, card, title, detail });
        }

        this.statusText = this.add.text(width / 2, height * 0.79, 'SALA 01 SELECIONADA', {
            fontFamily: 'monospace', fontSize: '12px', color: '#00e5ff'
        }).setOrigin(0.5);

        this.confirm = this.add.text(width / 2, height * 0.86, 'ENTRAR NA SALA  ›', {
            fontFamily: 'monospace', fontSize: '16px', fontStyle: 'bold',
            color: '#ffffff', backgroundColor: '#101722',
            padding: { left: 20, right: 20, top: 10, bottom: 10 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        this.confirm.on('pointerdown', () => this.confirmSelection());

        this.selectRoom(1);
        this.input.keyboard?.on('keydown-LEFT', () => this.selectRoom(((this.selectedRoom - 2 + 6) % 6) + 1));
        this.input.keyboard?.on('keydown-RIGHT', () => this.selectRoom((this.selectedRoom % 6) + 1));
        this.input.keyboard?.on('keydown-UP', () => this.selectRoom(((this.selectedRoom - 1 + 6 - columns) % 6) + 1));
        this.input.keyboard?.on('keydown-DOWN', () => this.selectRoom(((this.selectedRoom - 1 + columns) % 6) + 1));
        this.input.keyboard?.on('keydown-ENTER', () => this.confirmSelection());
        this.input.keyboard?.on('keydown-SPACE', () => this.confirmSelection());
        this.time.delayedCall(500, () => onAnyButton(this, () => this.confirmSelection()));
    }

    selectRoom(roomId) {
        this.selectedRoom = Math.max(1, Math.min(6, roomId));
        this.roomCards.forEach(({ roomId: id, card, title, detail }) => {
            const active = id === this.selectedRoom;
            const tint = active ? 0x00e5ff : 0x334355;
            card.setStrokeStyle(active ? 3 : 2, tint, 1);
            card.setFillStyle(active ? 0x182330 : 0x101722, 1);
            title.setColor(active ? '#00e5ff' : '#ffffff');
            detail.setColor(active ? '#ffffff' : '#8ea0b5');
        });
        if (this.statusText) this.statusText.setText(`SALA ${String(this.selectedRoom).padStart(2, '0')} SELECIONADA`);
    }

    confirmSelection() {
        this.scene.start('CarSelection', {
            playerNick: this.playerNick,
            playerId: this.playerId,
            roomId: this.selectedRoom
        });
    }

    getPlayerId() {
        try {
            let id = sessionStorage.getItem('cyberlinePlayerId');
            if (!id) {
                id = (window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : '') || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
                sessionStorage.setItem('cyberlinePlayerId', id);
            }
            return id;
        } catch (_) {
            return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        }
    }

    getSavedNickname() {
        try { return localStorage.getItem('cyberlinePlayerNick') || ''; }
        catch (_) { return ''; }
    }
}

export default RoomSelectionScene;
