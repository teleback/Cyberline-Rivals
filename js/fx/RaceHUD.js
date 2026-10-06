import { createRaceRoute, rankDrivers } from '../objects/RaceProgress.js';

const FONT = '"Cyber Arcade", monospace';
const PINK = 0xff39d4;
const BLUE = 0x173f9f;

export default class RaceHUD {
    constructor(scene) {
        this.scene = scene;
        this.route = createRaceRoute(scene.map.tileWidth, scene.map.tileHeight);
        this.lastUpdate = -Infinity;
        this.lastTimer = -Infinity;
        this.leaderId = null;
        this.leaderChangedAt = -Infinity;
        this.isTouch = Boolean(scene.game?.device?.input?.touch);
    }

    register(object, depth = 2004) {
        object.setScrollFactor(0).setDepth(depth);
        this.scene.hud.push(object);
        return object;
    }

    text(x, y, value, size, color = '#eaf2ff', extra = {}) {
        return this.register(this.scene.add.text(x, y, value, {
            fontFamily: FONT, fontSize: `${size}px`, color, ...extra,
        }));
    }

    panel(x, y, width, height, accent = 0x29cfff) {
        return this.register(this.scene.add.rectangle(x, y, width, height, 0x071022, 0.68)
            .setOrigin(0).setStrokeStyle(1, accent, 0.3), 2000);
    }

    build() {
        const s = this.scene, width = s.scale.width;
        s.hud = [];
        s.playerNickLabel = null;
        const x = 12;
        // One compact panel replaces the separate stats and turbo cards.
        this.panel(x, 12, 148, 144);
        this.register(s.add.rectangle(x, 12, 2, 144, PINK).setOrigin(0), 2001);
        s.lapLabel = this.text(x + 10, 22, `VOLTA 1 / ${s.totalLaps}`, 10, '#ff88e5');
        s.speedLabel = this.text(x + 10, 44, '000', 20);
        this.text(x + 80, 57, 'KM/H', 7, '#8faec9');
        s.checkpointLabel = this.text(x + 10, 77, `CHECKPOINT 0/${s.checkpointCount}`, 7,
            '#9bdfff', { wordWrap: { width: 128 } });
        s.checkpointProgress = Array.from({ length: s.checkpointCount }, (_, index) =>
            this.register(s.add.rectangle(x + 10 + index * 33, 97, 27, 3, 0x17243b)
                .setOrigin(0).setStrokeStyle(1, 0x355579, 0.8)));

        this.text(x + 10, 114, 'TURBO', 7, '#a9dcff');
        this.turboPercent = this.text(x + 138, 114, '100%', 6, '#f0abff').setOrigin(1, 0);
        s.barX = x + 10; s.barY = 128; s.barW = 128; s.barH = 4;
        this.register(s.add.rectangle(s.barX, s.barY, s.barW, s.barH, 0x17243b).setOrigin(0), 2001);
        s.turboBarFill = this.register(s.add.rectangle(s.barX, s.barY, s.barW, s.barH, 0x29cfff).setOrigin(0), 2002);
        s.turboBarGlow = this.register(s.add.rectangle(s.barX, s.barY, s.barW, 1, PINK)
            .setOrigin(0).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.15), 2003);
        this.turboScan = this.register(s.add.rectangle(s.barX, s.barY - 1, 4, 6, 0xd8f7ff)
            .setOrigin(0).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0), 2003);
        s.turboLabel = this.text(x + 10, 141, this.isTouch ? 'PRONTO' : 'PRONTO / SHIFT', 6, '#88e2ff');

        s.roomStatusLabel = this.text(width / 2, s.scale.height * 0.76, 'CONECTANDO À SALA...',
            8, '#ffffff', { backgroundColor: '#05060acc',
                padding: { left: 12, right: 12, top: 8, bottom: 8 }, align: 'center',
                wordWrap: { width: width - 50 } }).setOrigin(0.5).setDepth(2602);

        const bannerY = s.scale.height * 0.62;
        s.checkpointBanner = this.panel(width / 2 - 112, bannerY - 22, 224, 44)
            .setPosition(width / 2, bannerY).setOrigin(0.5).setDepth(2600).setVisible(false);
        s.checkpointBannerText = this.text(width / 2, bannerY - 6, 'CHECKPOINT 1', 10,
            '#86edff', { align: 'center', stroke: '#020611', strokeThickness: 2 })
            .setOrigin(0.5).setDepth(2601).setVisible(false);
        s.checkpointBannerCount = this.text(width / 2, bannerY + 12, '1 / 4', 7, '#f7acff')
            .setOrigin(0.5).setDepth(2601).setVisible(false);
        s.muteLabel = this.text(x, s.scale.height - 18, 'SOM: ON [M]', 5, '#7593b0');
        if (this.isTouch) s.muteLabel.setVisible(false);
        // Keep the timer above the compact minimap.
        const rightX = width - 140;
        this.rightPanel = this.panel(rightX, 12, 128, 148);
        s.raceTimerTitle = this.text(rightX + 8, 68, 'TIME', 5, '#8db9d7');
        s.raceTimerLabel = this.text(rightX + 120, 68, '00:00.00', 9).setOrigin(1, 0);
        this.rankingTitle = this.text(rightX + 8, 20, 'POSIÇÕES', 6, '#98bfdc');
        this.rows = Array.from({ length: 2 }, (_, index) => ({
            dot: this.register(s.add.circle(rightX + 10, 36 + index * 14, 3, index ? BLUE : PINK)),
            text: this.text(rightX + 22, 32 + index * 14, index ? '2º AGUARDANDO' : '1º VOCÊ', 7),
        }));
        this.rankingFlash = this.register(s.add.rectangle(rightX, 12, 128, 47, 0, 0)
            .setOrigin(0).setStrokeStyle(2, PINK).setAlpha(0), 2005);
    }

    createMinimap() {
        const s = this.scene;
        s.miniW = Math.min(128, s.scale.width - 24); s.miniH = 68;
        s.miniX = s.scale.width - s.miniW - 12; s.miniY = 85;
        s.miniWorldMinX = 312; s.miniWorldMaxX = 5832;
        s.miniWorldMinY = 760; s.miniWorldMaxY = 3648;
        s.miniTrackScale = Math.min((s.miniW - 10) / 460, (s.miniH - 10) / 250);
        s.miniMapBackground = this.rightPanel;
        s.miniMapFrame = this.register(s.add.rectangle(s.miniX, s.miniY, s.miniW, s.miniH, 0, 0)
            .setOrigin(0).setVisible(false), 7003);
        s.miniMapImage = this.register(s.add.image(s.miniX + s.miniW / 2, s.miniY + s.miniH / 2 + 2, 'minimapTrack')
            .setDisplaySize(460 * s.miniTrackScale, 250 * s.miniTrackScale), 7001);
        s.miniMapLabel = this.text(s.miniX + 6, s.miniY + 5, 'CIRCUITO', 4, '#90b7d1')
            .setDepth(7004).setVisible(false);
        s.miniMapPlayer = this.register(s.add.circle(0, 0, 3, PINK)
            .setStrokeStyle(1, 0xffffff), 7006);
        s.miniMapRival = this.register(s.add.circle(0, 0, 3, BLUE)
            .setStrokeStyle(1.2, 0xb7d4ff).setVisible(false), 7005);
        this.updateMinimap();
    }

    updateMinimap() {
        const s = this.scene;
        if (!s.miniMapPlayer || !s.car || s.podiumShown) return;
        const width = 460 * s.miniTrackScale, height = 250 * s.miniTrackScale;
        const left = s.miniX + (s.miniW - width) / 2, top = s.miniY + (s.miniH - height) / 2 + 2;
        const place = (marker, car) => marker.setPosition(
            left + Math.max(0, Math.min(1, (car.x - s.miniWorldMinX) / (s.miniWorldMaxX - s.miniWorldMinX))) * width,
            top + Math.max(0, Math.min(1, (car.y - s.miniWorldMinY) / (s.miniWorldMaxY - s.miniWorldMinY))) * height);
        place(s.miniMapPlayer, s.car);
        const rival = Object.values(s.remotePlayers).find(remote => remote.sprite && (remote.online || remote.finished));
        s.miniMapRival.setVisible(Boolean(rival));
        if (rival) place(s.miniMapRival, rival.sprite);
    }

    updateRanking(time) {
        const s = this.scene;
        const drivers = [{ id: s.playerId, local: true, x: s.car.x, y: s.car.y,
            lap: s.currentLap, checkpoints: s.checkpointIndex, finished: s.raceFinished, elapsed: s.finishElapsedMs }];
        for (const remote of Object.values(s.remotePlayers)) {
            if (!remote.sprite || (!remote.online && !remote.finished)) continue;
            drivers.push({ id: remote.id, local: false, x: remote.sprite.x, y: remote.sprite.y,
                lap: remote.lap || 1, checkpoints: remote.checkpointIndex,
                finished: remote.finished, elapsed: remote.finishElapsedMs });
        }
        const ranked = rankDrivers(this.route, drivers);
        const leader = ranked[0];
        if (drivers.length > 1 && s.raceTimerStarted && this.leaderId && leader.id !== this.leaderId) {
            this.leaderChangedAt = time;
            this.rankingFlash.setStrokeStyle(2, leader.local ? PINK : BLUE);
        }
        this.leaderId = leader.id;
        this.rankingTitle.setText(drivers.length < 2 ? 'POSIÇÕES' : leader.local ? 'VOCÊ NA FRENTE' : 'RIVAL NA FRENTE');
        ranked.forEach((driver, index) => {
            this.rows[index].dot.fillColor = driver.local ? PINK : BLUE;
            this.rows[index].text.setText(`${index + 1}º ${driver.local ? 'VOCÊ' : 'RIVAL'}`)
                .setColor(driver.local ? '#ff88e5' : '#a3c0ff');
        });
        if (drivers.length < 2) this.rows[1].text.setText('2º AGUARDANDO').setColor('#627f9c');
    }

    updateTimer() {
        const s = this.scene, now = s.time.now;
        if (!s.raceFinished && now - this.lastTimer < 100) return;
        this.lastTimer = now;
        const elapsed = s.raceTimerStarted ? s.raceFinished ? s.raceElapsedMs : now - s.raceStartTime : 0;
        s.raceTimerLabel.setText(s.formatRaceTime(Math.max(0, elapsed)));
    }

    update() {
        const s = this.scene, car = s.car, time = s.time.now;
        const fuel = Math.max(0, Math.min(1, car.turboFuel / car.turboMax));
        s.turboBarFill.width = s.barW * fuel; s.turboBarGlow.width = s.turboBarFill.width;
        this.turboScan.setVisible(fuel > 0).setPosition(s.barX + (time / 900 % 1) * Math.max(0, s.turboBarFill.width - 5), s.barY - 1)
            .setAlpha(car.isTurboActive ? 0.4 : 0.12);
        s.turboBarGlow.setAlpha(car.isTurboActive ? 0.15 + 0.08 * Math.sin(time / 110) : 0.05);
        this.rankingFlash.setAlpha(Math.max(0, 0.8 * (1 - (time - this.leaderChangedAt) / 650)));
        if (time - this.lastUpdate < 100) return;
        this.lastUpdate = time;
        const ready = fuel >= car.turboMinToActivate / car.turboMax;
        const color = car.isOverheated ? 0xff5f88 : car.isTurboActive ? PINK : ready ? 0x29cfff : 0x466481;
        s.turboBarFill.fillColor = color;
        s.turboLabel.setText(car.isOverheated ? 'RESFRIANDO' : car.isTurboActive ? 'BOOST ATIVO' : ready ? (this.isTouch ? 'PRONTO' : 'PRONTO / SHIFT') : 'RECARREGANDO')
            .setColor(car.isOverheated || car.isTurboActive ? '#ff88e5' : '#88cfff');
        this.turboPercent.setText(`${Math.round(fuel * 100)}%`);
        s.speedLabel.setText(String(car.speedKmh).padStart(3, '0')).setColor(car.isTurboActive ? '#ffb9ec' : '#eaf2ff');
        this.updateRanking(time);
    }
}
