import { getCarSkin } from '../objects/CarSkins.js';

const FONT = '"Cyber Arcade", monospace';

// Desenhada antes de carregar os assets da pista; também funciona sem carro em cache.
export default class RaceLoadingScreen {
    constructor(scene, data = {}) {
        this.scene = scene;
        this.progress = 0;
        this.target = 0;
        this.elapsed = 0;
        this.onProgress = value => { this.target = Math.max(this.target, Math.min(1, value)); };
        this.onUpdate = (_time, delta) => this.update(delta);
        scene.load.on('progress', this.onProgress);
        scene.events.on('update', this.onUpdate);
        scene.events.once('shutdown', () => this.destroy());
        this.build(data);
    }

    text(x, y, value, size, color = '#dceeff') {
        return this.scene.add.text(x, y, value, {
            fontFamily: FONT, fontSize: `${size}px`, color, align: 'center',
        }).setOrigin(0.5);
    }

    build(data) {
        const s = this.scene, { width: w, height: h } = s.scale;
        const compact = w < 600;
        this.left = w * 0.12;
        this.roadWidth = w * 0.76;
        this.roadY = h * 0.59;
        s.cameras.main.setBackgroundColor('#050917');
        const bg = s.add.graphics();
        bg.fillGradientStyle(0x09132c, 0x150b2c, 0x050917, 0x050917, 1);
        bg.fillRect(0, 0, w, h);
        // Horizonte urbano e uma malha em perspectiva, com custo fixo por quadro.
        for (let i = 0; i < 22; i++) {
            const x = i * w / 21, bw = w / 27, bh = h * (0.08 + (i * 7 % 9) * 0.012);
            bg.fillStyle(i % 2 ? 0x111831 : 0x0c1228).fillRect(x, h * 0.47 - bh, bw, bh);
            bg.fillStyle(i % 3 ? 0x39caff : 0xff39d4, 0.22);
            for (let y = h * 0.47 - bh + 8; y < h * 0.46; y += 9) {
                bg.fillRect(x + 5, y, 3, 2);
                bg.fillRect(x + bw - 8, y, 3, 2);
            }
        }
        bg.lineStyle(1, 0x694ec4, 0.16);
        for (let i = -8; i <= 8; i++) bg.lineBetween(w / 2 + i * 16, h * 0.47, w / 2 + i * w * 0.17, h);
        for (let y = h * 0.49, gap = 7; y < h; y += gap, gap *= 1.35) bg.lineBetween(0, y, w, y);
        bg.lineStyle(1, 0x47d9ff, 0.5).lineBetween(w * 0.08, h * 0.47, w * 0.92, h * 0.47);

        this.text(w / 2, h * 0.14, 'CORRIDAS CLANDESTINAS / NEON CITY', compact ? 5 : 7, '#7898bc');
        this.text(w / 2, h * 0.255, 'CYBERLINE', compact ? 27 : 39, '#effaff')
            .setShadow(0, 0, '#39caff', 16, true, true);
        this.text(w / 2, h * 0.355, 'R I V A L S', compact ? 14 : 21, '#ff63de');

        const room = Number(data.roomId) || 1;
        this.text(this.left, this.roadY - 61, `SALA ${String(room).padStart(2, '0')} / CIRCUITO URBANO`, compact ? 5 : 7, '#88b1d5')
            .setOrigin(0, 0.5);
        this.percent = this.text(this.left + this.roadWidth, this.roadY - 61, '0%', compact ? 11 : 14, '#72edff')
            .setOrigin(1, 0.5);
        s.add.rectangle(w / 2, this.roadY, this.roadWidth + 12, 84, 0x24cfff, 0.035)
            .setStrokeStyle(1, 0x24cfff, 0.18);
        s.add.rectangle(w / 2, this.roadY, this.roadWidth, 70, 0x080f22)
            .setStrokeStyle(1, 0x44638b, 0.65);
        this.road = s.add.graphics();
        this.fill = s.add.rectangle(this.left, this.roadY + 33, 1, 3, 0x56eaff).setOrigin(0, 0.5);
        this.glow = s.add.rectangle(this.left, this.roadY + 32, 1, 10, 0x39caff, 0.1).setOrigin(0, 0.5);
        // A chegada xadrez fica dentro da pista, depois da ponta da barra.
        const flag = s.add.graphics();
        for (let row = 0; row < 8; row++) for (let col = 0; col < 2; col++) {
            flag.fillStyle((row + col) % 2 ? 0x17253a : 0xd9ecff, 0.7)
                .fillRect(this.left + this.roadWidth - 13 + col * 5, this.roadY - 20 + row * 5, 5, 5);
        }
        this.trails = [24, 15, 9].map((length, i) => s.add.rectangle(0, 0, length, 2,
            i === 1 ? 0xff39d4 : 0x4feaff, 0.6 - i * 0.15));
        const skin = getCarSkin(data.carSkin);
        let texture = skin.texture;
        if (!s.textures.exists(texture)) {
            texture = 'fx-loading-car';
            if (!s.textures.exists(texture)) {
                const g = s.make.graphics({ x: 0, y: 0, add: false });
                g.fillStyle(0x070b15).fillRect(4, 5, 6, 10).fillRect(22, 5, 6, 10)
                    .fillRect(4, 37, 6, 10).fillRect(22, 37, 6, 10);
                g.fillStyle(0x8952ea).fillRect(8, 2, 16, 48).fillRect(5, 15, 22, 23);
                g.fillStyle(0x71efff).fillRect(10, 12, 12, 9).fillRect(7, 3, 4, 3).fillRect(21, 3, 4, 3);
                g.fillStyle(0x201a48).fillRect(10, 24, 12, 12);
                g.fillStyle(0xff45be).fillRect(7, 46, 5, 3).fillRect(20, 46, 5, 3);
                g.generateTexture(texture, 32, 52);
                g.destroy();
            }
        }
        this.car = s.add.image(this.left + 30, this.roadY, texture).setAngle(90);
        const scale = Math.min(54 / this.car.width, 62 / this.car.height);
        this.car.setScale(scale).setTint(data.carTint ?? 0xffffff);
        this.status = this.text(w / 2, h * 0.765, 'PREPARANDO A PISTA', compact ? 8 : 10, '#e4f4ff');
        this.text(w / 2, h * 0.84, 'Ligue os motores. A cidade é sua.', compact ? 6 : 8, '#8ca5c7');
        this.text(w / 2, h * 0.95, '03 VOLTAS  /  02 PILOTOS  /  01 VENCEDOR', compact ? 5 : 6, '#586f96');
        this.update(0);
    }

    complete(onComplete) {
        this.target = 1;
        this.onComplete = onComplete;
    }

    update(delta) {
        if (this.destroyed) return;
        this.elapsed += delta;
        this.progress += (this.target - this.progress) * (1 - Math.exp(-delta / 130));
        if (this.target - this.progress < 0.002) this.progress = this.target;
        const p = this.progress, x = this.left + 30 + (this.roadWidth - 60) * p;
        this.fill.width = this.glow.width = Math.max(1, this.roadWidth * p);
        this.car.setPosition(x, this.roadY + Math.sin(this.elapsed / 90) * 0.7);
        this.trails.forEach((trail, i) => trail.setPosition(x - 40 - i * 11, this.roadY - 8 + i * 8)
            .setAlpha((0.4 + Math.sin(this.elapsed / 100 + i) * 0.2) * Math.min(1, p * 8)));
        this.percent.setText(`${Math.floor(p * 100)}%`);
        this.status.setText(p === 1 ? 'PISTA PRONTA!' : p < 0.45 ? 'PREPARANDO A PISTA' : p < 0.8 ? 'AQUECENDO OS MOTORES' : 'ALINHANDO O GRID');
        this.road.clear().lineStyle(1, 0x9ec5e7, 0.18);
        for (let lane = -1; lane <= 1; lane += 2) {
            for (let offset = -(this.elapsed * 0.07 % 36); offset < this.roadWidth; offset += 36) {
                const start = Math.max(0, offset), end = Math.min(this.roadWidth, offset + 16);
                if (end > start) this.road.lineBetween(this.left + start, this.roadY + lane * 23,
                    this.left + end, this.roadY + lane * 23);
            }
        }
        if (p === 1 && this.onComplete && !this.transition) {
            this.transition = this.scene.time.delayedCall(350, () => {
                const callback = this.onComplete;
                this.onComplete = null;
                callback?.();
            });
        }
    }

    destroy() {
        this.destroyed = true;
        this.transition?.remove(false);
        this.scene.load.off('progress', this.onProgress);
        this.scene.events.off('update', this.onUpdate);
        this.onComplete = null;
    }
}
