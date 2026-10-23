import { getCarSkin } from '../objects/CarSkins.js';
import { readGamepad } from '../input/GamepadInput.js';
import drawResultsBackdrop from './ResultsBackdrop.js';

const FONT = '"Trebuchet MS", sans-serif';
const ARCADE = '"Cyber Arcade", monospace';
const GOLD = 0xffd16b;
const SILVER = 0x91deef;
const DEPTH = 8200;
const REWARD_KEYS = ['collected', 'laps', 'finish', 'victory'];
const REWARD_STEP_MS = 680;
const amount = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
const number = value => amount(value).toLocaleString('pt-BR');

// A narrow screen keeps the rewards below the cars; landscape has room
// for rewards alongside them. All positions stay inside the two cards.
export function resultsLayout(width, height) {
    const compact = height < 440;
    const margin = width < 700 ? 14 : 38;
    const gap = width < 700 ? 12 : 22;
    const top = compact ? 70 : 88;
    const cardWidth = (width - margin * 2 - gap) / 2;
    const cardHeight = height - top - 78;
    return { width, height, compact, margin, gap, top, cardWidth, cardHeight,
        stacked: cardWidth < 270,
        cards: [margin, margin + cardWidth + gap].map(x => ({ x, y: top, width: cardWidth, height: cardHeight })) };
}

/** Final standings, with real garage sprites and tijolinho rewards only. */
export default class RaceResults {
    constructor(scene) {
        this.scene = scene;
        this.objects = [];
        this.tweens = new Set();
        this.timers = new Set();
        this.rewardTweens = new Set();
        this.rewardTimers = new Set();
        this.state = 'hidden';
        this.rows = [];
        this.destroyed = false;
        this.returning = false;
        this.padConfirmArmed = false;
        this.onSkip = event => {
            if (event?.key?.toLowerCase() === 'm') return;
            this.skipEvent = event;
            this.settleRewards();
        };
        this.onReturnKey = event => {
            if (event === this.skipEvent || event?.repeat) return;
            if (['Enter', ' ', 'Escape'].includes(event?.key)) this.returnToMenu();
        };
        this.onUpdate = () => {
            if (this.state !== 'settled') return;
            const pad = readGamepad();
            if (!pad.any) this.padConfirmArmed = true;
            else if (this.padConfirmArmed) this.returnToMenu();
        };
        this.onShutdown = () => this.destroy();
        scene.events.once('shutdown', this.onShutdown);
    }

    register(object, depth = DEPTH + 2) {
        object.setScrollFactor(0).setDepth(depth);
        this.objects.push(object);
        this.scene.hud ??= [];
        this.scene.hud.push(object);
        // Most objects are created after the cameras were split.
        this.scene.cameras?.main?.ignore(object);
        return object;
    }

    text(x, y, value, size, color = '#edf4ff', extra = {}) {
        return this.register(this.scene.add.text(x, y, value, {
            fontFamily: FONT, fontSize: `${size}px`, color, ...extra,
        }));
    }

    arcade(x, y, value, size, color = '#edf4ff', extra = {}) {
        return this.text(x, y, value, size, color, { fontFamily: ARCADE, ...extra });
    }

    plate(x, y, width, height, accent, options = {}) {
        const { cut = 10, fill = 0x091324, alpha = 0.9, border = 0.4, depth = DEPTH + 1 } = options;
        const points = [{ x: x + cut, y }, { x: x + width, y },
            { x: x + width, y: y + height - cut }, { x: x + width - cut, y: y + height },
            { x, y: y + height }, { x, y: y + cut }];
        const g = this.scene.add.graphics();
        g.fillStyle(fill, alpha).fillPoints(points, true);
        g.lineStyle(1, accent, border).strokePoints(points, true);
        g.lineStyle(2, accent, 0.85).lineBetween(x + cut, y, x + Math.min(width * 0.28, 80), y);
        g.lineStyle(2, accent, 0.5).lineBetween(x + width - cut - Math.min(width * 0.15, 40),
            y + height, x + width - cut, y + height);
        return this.register(g, depth);
    }

    tween(config, reward = false) {
        let tween;
        const onComplete = config.onComplete;
        tween = this.scene.tweens.add({ ...config, onComplete: (...args) => {
            this.tweens.delete(tween);
            this.rewardTweens.delete(tween);
            if (!this.destroyed) onComplete?.(...args);
        } });
        this.tweens.add(tween);
        if (reward) this.rewardTweens.add(tween);
        return tween;
    }

    later(delay, callback, reward = false) {
        let timer;
        timer = this.scene.time.delayedCall(delay, () => {
            this.timers.delete(timer);
            this.rewardTimers.delete(timer);
            if (!this.destroyed) callback();
        });
        this.timers.add(timer);
        if (reward) this.rewardTimers.add(timer);
        return timer;
    }

    tone(frequency, duration = 0.10, volume = 0.035) {
        if (this.scene.sound?.mute || this.scene.audio?.muted) return;
        this.scene.scoreTone?.(frequency, duration, volume, 'triangle');
    }

    removeSkip() {
        this.scene.input?.off('pointerdown', this.onSkip);
        this.scene.input?.keyboard?.off('keydown', this.onSkip);
    }

    cancelRewards() {
        this.rewardTweens.forEach(tween => { tween.stop?.(); this.tweens.delete(tween); });
        this.rewardTimers.forEach(timer => { timer.remove?.(false); this.timers.delete(timer); });
        this.rewardTweens.clear();
        this.rewardTimers.clear();
        this.removeSkip();
    }

    clear() {
        this.cancelRewards();
        this.scene.input?.keyboard?.off('keydown', this.onReturnKey);
        this.scene.events.off('update', this.onUpdate);
        this.tweens.forEach(tween => tween.stop?.());
        this.timers.forEach(timer => timer.remove?.(false));
        this.tweens.clear();
        this.timers.clear();
        const oldObjects = new Set(this.objects);
        this.scene.hud = (this.scene.hud || []).filter(object => !oldObjects.has(object));
        this.objects.forEach(object => object.destroy());
        this.objects = [];
        this.rows = [];
        this.waitingTotal = null;
        this.waitingTime = null;
        this.returnButton = null;
        this.returnLabel = null;
        this.returnPlate = null;
    }

    background() {
        drawResultsBackdrop(this);
    }

    actualCar(x, y, driver, scale) {
        return this.register(this.scene.add.image(x, y, getCarSkin(driver.skin).texture)
            .setTint(driver.tint ?? 0xffffff).setScale(scale), DEPTH + 5);
    }

    showWaiting() {
        if (this.destroyed || this.state === 'podium' || this.state === 'counting' || this.state === 'settled') return;
        if (this.state === 'waiting') {
            this.updateWaiting();
            return;
        }
        this.clear();
        this.state = 'waiting';
        this.background();
        const s = this.scene, { width, height } = s.scale;
        const compact = height < 440;
        const panelWidth = Math.min(600, width - 32);
        const panelHeight = Math.min(318, height - 40);
        const left = (width - panelWidth) / 2, top = (height - panelHeight) / 2;
        this.plate(left, top, panelWidth, panelHeight, SILVER, { alpha: 0.92, cut: 18 });
        this.arcade(width / 2, top + 24, 'CHEGADA!', compact ? 18 : 24, '#8aeeff',
            { shadow: { color: '#247b9a', blur: 10, fill: true } }).setOrigin(0.5, 0);
        this.arcade(width / 2, top + 62, 'VOCÊ COMPLETOU A CORRIDA', compact ? 6 : 8, '#aebdd4').setOrigin(0.5, 0);
        const carX = left + panelWidth * 0.24, carY = top + panelHeight * 0.52;
        const scale = compact ? 0.65 : 0.85;
        this.register(s.add.ellipse(carX, carY + 50 * scale, 100 * scale, 22 * scale, 0x26d9ed, 0.16), DEPTH + 2);
        const car = this.actualCar(carX, carY, { skin: s.carSkin, tint: s.carTint }, scale);
        this.tween({ targets: car, y: carY - 4, duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        const infoX = left + panelWidth * 0.43;
        this.text(infoX, top + panelHeight * 0.35, 'SEU TEMPO', compact ? 10 : 12, '#8aa3c2');
        this.waitingTime = this.text(infoX, top + panelHeight * 0.35 + 19, '', compact ? 20 : 25);
        this.text(infoX, top + panelHeight * 0.61, 'TIJOLINHOS GANHOS', compact ? 9 : 11, '#e9bd77');
        this.waitingTotal = this.arcade(infoX, top + panelHeight * 0.61 + 20, '', compact ? 20 : 25, '#ffdd8a');
        this.text(width / 2, top + panelHeight - 40, 'AGUARDANDO O ADVERSÁRIO...', compact ? 11 : 13, '#afc3e1').setOrigin(0.5, 0);
        this.text(width / 2, top + panelHeight - 19, 'A classificação e o bônus de vitória chegam em seguida.',
            width < 520 ? 8 : 10, '#6c829f').setOrigin(0.5, 0);
        this.updateWaiting();
    }

    updateWaiting() {
        if (this.state !== 'waiting') return;
        const s = this.scene;
        this.waitingTime?.setText(s.formatRaceTime(s.finishElapsedMs ?? s.raceElapsedMs ?? 0));
        this.waitingTotal?.setText(number(s.computeFinalScore().total));
    }

    showPodium(results) {
        if (this.destroyed || !Array.isArray(results) || results.length < 2) return;
        if (this.state === 'podium' || this.state === 'counting' || this.state === 'settled') {
            this.results = results;
            if (this.state === 'settled') this.settleRewards(false);
            return;
        }
        this.clear();
        this.results = results;
        this.state = 'podium';
        this.layout = resultsLayout(this.scene.scale.width, this.scene.scale.height);
        const l = this.layout;
        this.background();
        this.arcade(l.margin, l.compact ? 11 : 15, 'CYBERLINE / RIVALS', l.compact ? 5 : 6, '#8ba6c5');
        this.arcade(l.width - l.margin, l.compact ? 11 : 15, 'RESULTADO FINAL', l.compact ? 5 : 6,
            '#8ba6c5').setOrigin(1, 0);
        const crest = this.register(this.scene.add.graphics(), DEPTH + 2);
        const cx = l.width / 2, cy = l.compact ? 9 : 12;
        crest.fillStyle(GOLD, 0.9).fillPoints([{ x: cx - 7, y: cy }, { x: cx + 7, y: cy },
            { x: cx + 5, y: cy + 7 }, { x: cx, y: cy + 10 }, { x: cx - 5, y: cy + 7 }], true);
        crest.fillRect(cx - 1, cy + 8, 2, 6).fillRect(cx - 5, cy + 14, 10, 2);
        crest.lineStyle(1, GOLD, 0.75).strokePoints([{ x: cx - 7, y: cy + 2 },
            { x: cx - 11, y: cy + 2 }, { x: cx - 10, y: cy + 6 }, { x: cx - 5, y: cy + 8 }])
            .strokePoints([{ x: cx + 7, y: cy + 2 }, { x: cx + 11, y: cy + 2 },
                { x: cx + 10, y: cy + 6 }, { x: cx + 5, y: cy + 8 }]);
        this.arcade(l.width / 2, l.compact ? 29 : 36, 'CAMPEÃO DA NOITE', l.compact ? 17 : 22,
            '#ffe6a2', { shadow: { color: '#bb752d', blur: 12, fill: true } }).setOrigin(0.5, 0);
        this.subtitle = this.arcade(l.width / 2, l.compact ? 55 : 68,
            'DO ASFALTO PARA O TOPO', l.compact ? 5 : 6, '#acc0dc').setOrigin(0.5, 0);
        this.footer = this.text(l.width / 2, l.height - 65, 'PREPARANDO AS RECOMPENSAS...',
            l.compact ? 9 : 11, '#869cbc').setOrigin(0.5, 0);
        this.rows = results.slice(0, 2).map((driver, index) => this.buildDriver(driver, l.cards[index]));
        this.rows.forEach((row, index) => this.animateCar(row, index));
        this.createReturnButton();
        this.later(650, () => this.confetti(this.rows[0]));
        [660, 880, 1109].forEach((frequency, index) => this.later(420 + index * 130, () => this.tone(frequency)));
    }

    buildDriver(driver, card) {
        const s = this.scene, l = this.layout, compact = l.compact, stacked = l.stacked;
        const winner = driver.place === 1, accent = winner ? GOLD : SILVER;
        const color = winner ? '#ffdd88' : '#b9f0ff';
        const inset = compact || stacked ? 14 : 22;
        const { x, y, width, height } = card;
        // Open showcase above; the rewards have their own inset metal panel.
        this.plate(x, y, width, height * 0.81, accent,
            { fill: winner ? 0x141524 : 0x091725, alpha: 0.56, border: 0.18, cut: 14 });
        this.plate(x + 5, y + 5, width - 10, compact || stacked ? 32 : 37, accent,
            { fill: winner ? 0x31251f : 0x102a3a, alpha: 0.85, border: 0.18, cut: 8 });
        const badgeX = x + inset + 11, badgeY = y + (compact ? 22 : 25);
        const badge = this.register(s.add.graphics(), DEPTH + 2);
        const badgePoints = [{ x: badgeX - 14, y: badgeY - 13 }, { x: badgeX + 14, y: badgeY - 13 },
            { x: badgeX + 14, y: badgeY + 7 }, { x: badgeX, y: badgeY + 16 }, { x: badgeX - 14, y: badgeY + 7 }];
        badge.fillStyle(accent, 0.14).fillPoints(badgePoints, true)
            .lineStyle(1, accent, 0.7).strokePoints(badgePoints, true);
        this.arcade(badgeX, badgeY - 1, winner ? '01' : '02', stacked ? 8 : 9, color).setOrigin(0.5);
        this.arcade(x + inset + 34, y + (compact ? 18 : 21), winner ? 'CAMPEÃO' : stacked ? 'VICE' : 'VICE-CAMPEÃO',
            stacked ? 7 : compact ? 7 : 8, color);
        this.arcade(x + width - inset, y + (compact ? 20 : 24), driver.local ? 'VOCÊ' : 'RIVAL', stacked ? 5 : 6,
            driver.local ? '#ffb4eb' : '#8aabda').setOrigin(1, 0);
        const nameSize = stacked ? 10 : compact ? 11 : 12;
        const maxNameLength = Math.max(6, Math.floor((width - inset * 2) / nameSize));
        const fullName = String(driver.nick || 'PILOTO').replace(/[\r\n]/g, ' ');
        const nick = fullName.length > maxNameLength ? fullName.slice(0, maxNameLength - 1) + '…' : fullName;
        const nameY = y + (stacked ? 44 : compact ? 43 : 55);
        const nickname = this.arcade(x + inset, nameY, nick, nameSize, '#f1f5ff');

        const carX = x + width * (stacked ? 0.5 : 0.235);
        const pedestalTop = y + height * (stacked ? compact ? 0.53 : 0.50 : 0.70);
        const scale = stacked ? Math.min(0.57, height / 760)
            : Math.min(1.25, height / 300, (pedestalTop - nameY - nameSize * 1.2 - 5) / 118);
        const carY = pedestalTop - 56 * scale;
        const pedestalWidth = Math.min(width * (stacked ? 0.45 : 0.37), 142);
        const pedestalHeight = Math.max(8, height * 0.04);
        this.arcade(carX, pedestalTop - 34 * scale, winner ? '01' : '02', Math.round(41 * scale), color)
            .setOrigin(0.5).setAlpha(0.045).setDepth(DEPTH + 2);
        const halo = this.register(s.add.ellipse(carX, pedestalTop - 40 * scale,
            pedestalWidth * 1.08, Math.max(35, 140 * scale), accent, 0.08), DEPTH + 2);
        this.register(s.add.rectangle(carX, pedestalTop - 50 * scale,
            pedestalWidth * 0.66, 115 * scale, accent, 0.035), DEPTH + 2);
        const shadow = this.register(s.add.ellipse(carX, pedestalTop, pedestalWidth * 0.8,
            15, 0x000000, 0.45), DEPTH + 3);
        const pedestal = this.register(s.add.ellipse(carX, pedestalTop + pedestalHeight * 0.5, pedestalWidth, pedestalHeight * 1.4,
            winner ? 0x5b4325 : 0x244457).setStrokeStyle(1, accent, 0.4), DEPTH + 3);
        const ring = this.register(s.add.ellipse(carX, pedestalTop, pedestalWidth, pedestalHeight * 1.5,
            accent, 0.1).setStrokeStyle(2, accent, 0.9), DEPTH + 4);
        const landingRing = this.register(s.add.ellipse(carX, pedestalTop, pedestalWidth, pedestalHeight * 1.5,
            accent, 0).setStrokeStyle(2, accent, 0.8).setAlpha(0), DEPTH + 4);
        const elapsed = this.arcade(stacked ? x + inset : carX,
            stacked ? y + (compact ? 64 : 68) : y + height * 0.755,
            `TEMPO  ${s.formatRaceTime(driver.elapsed)}`, stacked ? 6 : compact ? 6 : 7, '#b1c7df');
        if (!stacked) elapsed.setOrigin(0.5, 0);
        const car = this.actualCar(carX, carY, driver, scale);

        const rewardLeft = stacked ? x + inset : x + width * 0.46;
        const rewardRight = x + width - inset;
        const rewardTop = y + height * (stacked ? compact ? 0.62 : 0.57 : 0.37);
        const spacing = stacked ? height * (compact ? 0.047 : 0.055) : height * 0.085;
        const rewardSize = stacked ? compact ? 8 : 10 : compact ? 10 : 12;
        const lapReward = s.rewardRules?.lap ?? 10;
        const labels = ['Coletados', `Voltas (${amount(driver.laps)} ×${lapReward})`, 'Chegada', 'Vitória'];
        const rewardBottom = rewardTop + spacing * 3 + rewardSize + 7;
        this.plate(rewardLeft - 9, rewardTop - (stacked ? 4 : 14), rewardRight - rewardLeft + 18,
            rewardBottom - rewardTop + (stacked ? 0 : 20), accent,
            { fill: 0x060e1d, alpha: 0.8, border: 0.15, cut: stacked ? 5 : 8 });
        if (!stacked) this.arcade(rewardLeft, rewardTop - 9, 'RECOMPENSAS', compact ? 5 : 6, '#819ab8');
        const highlight = this.register(s.add.rectangle(rewardLeft - 5, rewardTop - 3,
            rewardRight - rewardLeft + 10, rewardSize + 8, accent, 0.12).setOrigin(0).setAlpha(0), DEPTH + 2);
        const rewards = labels.map((label, index) => {
            const labelObject = this.text(rewardLeft, rewardTop + index * spacing, label, rewardSize, '#bdccdf');
            const valueObject = this.arcade(rewardRight, rewardTop + index * spacing, '+0',
                stacked ? compact ? 7 : 8 : compact ? 8 : 10, index === 3 && winner ? '#ffdd88' : '#e2ebf8')
                .setOrigin(1, 0);
            valueObject.setAlpha(0.25);
            return { key: REWARD_KEYS[index], label: labelObject, value: valueObject };
        });
        const dividerY = y + height * 0.825;
        this.plate(x, dividerY + 3, width, height * 0.175 - 3, accent,
            { fill: winner ? 0x251e20 : 0x102334, alpha: 0.98, border: 0.5, cut: 10 });
        this.register(s.add.rectangle(x + 4, dividerY + 13, 2, Math.max(8, height * 0.175 - 24),
            accent, 0.65).setOrigin(0), DEPTH + 2);
        const progressWidth = width - inset * 2;
        const progressY = stacked ? dividerY : dividerY - 6;
        this.register(s.add.rectangle(x + inset, progressY, progressWidth, 3, accent, 0.10)
            .setOrigin(0), DEPTH + 2);
        const progress = this.register(s.add.rectangle(x + inset, progressY, progressWidth, 3,
            accent, 0.9).setOrigin(0), DEPTH + 3);
        progress.scaleX = 0;
        const totalY = y + height * 0.89;
        const brickIcon = this.register(s.add.image(x + inset + 11, totalY + 3, 'tijolinho')
            .setDisplaySize(stacked ? 22 : 27, stacked ? 22 : 27), DEPTH + 3);
        this.arcade(x + inset + (stacked ? 27 : 33), totalY - 1, 'TIJOLINHOS', stacked ? 5 : compact ? 5 : 6, '#e5c990');
        this.text(x + inset + (stacked ? 27 : 33), totalY + 10, 'NESTA CORRIDA', stacked ? 7 : 8, '#98adc6');
        const total = this.arcade(rewardRight, totalY + 5, '0', stacked ? 20 : compact ? 22 : 28, color,
            { shadow: { color: winner ? '#9f6c25' : '#2f768a', blur: 8, fill: true } })
            .setOrigin(1, 0.5).setAlpha(0.35);
        const totalFlash = this.register(s.add.rectangle(x + 10, dividerY + 5, width - 20,
            height * 0.175 - 8, accent, 0.18).setOrigin(0).setAlpha(0), DEPTH + 2);
        const flights = Array.from({ length: 3 }, () => this.register(s.add.image(0, 0, 'tijolinho')
            .setDisplaySize(stacked ? 12 : 17, stacked ? 12 : 17).setVisible(false), DEPTH + 6));
        return { driver, card, car, halo, shadow, pedestal, ring, landingRing, highlight, progress, brickIcon, flights,
            totalFlash, rewards, total, nickname, elapsed, carX, carY, scale, accent };
    }

    createReturnButton() {
        const { width, height } = this.layout;
        const buttonWidth = Math.min(280, width - 32);
        this.returnPlate = this.plate((width - buttonWidth) / 2, height - 50, buttonWidth, 44, SILVER,
            { fill: 0x102735, border: 0.55, cut: 12, depth: DEPTH + 3 }).setVisible(false);
        this.returnButton = this.register(this.scene.add.rectangle(width / 2, height - 28,
            buttonWidth, 44, 0x69e4f2, 0), DEPTH + 3);
        this.returnLabel = this.arcade(width / 2, height - 28, '< VOLTAR AO MENU', 8, '#c8faff')
            .setOrigin(0.5).setDepth(DEPTH + 4);
        this.returnButton.setVisible(false);
        this.returnLabel.setVisible(false);
        this.returnButton.on('pointerdown', () => this.returnToMenu());
        this.returnButton.on('pointerover', () => this.returnButton.setFillStyle(0x69e4f2, 0.1));
        this.returnButton.on('pointerout', () => this.returnButton.setFillStyle(0x69e4f2, 0));
    }

    returnToMenu() {
        if (this.destroyed || this.returning || this.state !== 'settled') return;
        this.returning = true;
        this.scene.returnToMenu();
    }

    animateCar(row, index) {
        const { car, carX, carY, scale, halo, ring, shadow } = row;
        const land = () => {
            car.setAngle(0);
            row.landingRing.setAlpha(0.9).setScale(0.7);
            this.tween({ targets: row.landingRing, scaleX: 1.65, scaleY: 1.65, alpha: 0,
                duration: 650, ease: 'Cubic.easeOut' });
            this.tween({ targets: car, y: carY - (index ? 3 : 6), angle: index ? 2 : -3,
                duration: index ? 1500 : 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
            this.tween({ targets: shadow, scaleX: 0.85, alpha: 0.28,
                duration: index ? 1500 : 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        };
        if (index === 0) {
            // Tween toward a full turn: Phaser normalizes an initial -360 to 0.
            car.setPosition(carX, carY - Math.min(70, row.card.height * 0.2))
                .setAlpha(0).setAngle(0).setScale(scale * 0.6);
            this.tween({ targets: car, y: carY, angle: 360, alpha: 1, scaleX: scale, scaleY: scale,
                duration: 1050, delay: 100, ease: 'Back.easeOut', onComplete: land });
        } else {
            // The vice drifts onto the silver platform, then idles alongside.
            car.setPosition(carX + Math.min(75, row.card.width * 0.25), carY).setAlpha(0).setAngle(-14);
            this.tween({ targets: car, x: carX, angle: 0, alpha: 1, duration: 800,
                delay: 340, ease: 'Cubic.easeOut', onComplete: land });
        }
        this.tween({ targets: halo, alpha: index ? 0.13 : 0.23, scaleX: 1.06, scaleY: 1.04,
            duration: 1600 + index * 300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tween({ targets: ring, alpha: 0.45, duration: 1300 + index * 250,
            yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    confetti(winner) {
        if (this.state === 'hidden') return;
        const { x, width, y, height } = winner.card;
        for (let index = 0; index < 20; index++) {
            const piece = this.register(this.scene.add.rectangle(x + 12 + Math.random() * (width - 24), y + 10,
                3 + index % 3, 6 + index % 4, [GOLD, 0xff87da, 0x88edff, 0xffffff][index % 4])
                .setAlpha(0).setAngle(index * 31), DEPTH + 6);
            this.tween({ targets: piece, y: y + height * 0.70, x: piece.x + (Math.random() - 0.5) * 24,
                angle: piece.angle + 180, alpha: { from: 0.9, to: 0 }, duration: 1200 + index * 30,
                delay: index * 25, ease: 'Quad.easeIn' });
        }
    }

    showResults(results) {
        if (this.destroyed || !Array.isArray(results) || results.length < 2) return;
        if (!this.rows.length) this.showPodium(results);
        this.results = results;
        if (this.state === 'settled') {
            this.settleRewards(false);
            return;
        }
        if (this.state === 'counting') return;
        this.state = 'counting';
        this.subtitle.setText('CADA CONQUISTA VALE TIJOLINHOS');
        this.footer.setText('TOQUE OU PRESSIONE UMA TECLA PARA REVELAR');
        this.scene.input?.on('pointerdown', this.onSkip);
        this.scene.input?.keyboard?.on('keydown', this.onSkip);
        this.rows.forEach((row, index) => {
            row.driver = results[index];
            row.total.setAlpha(1);
        });
        REWARD_KEYS.forEach((key, index) => this.later(index * REWARD_STEP_MS,
            () => this.countReward(index), true));
        this.later(REWARD_KEYS.length * REWARD_STEP_MS + 200, () => this.settleRewards(), true);
    }

    countReward(rewardIndex) {
        const captions = ['COLETA NA PISTA', 'VOLTAS CONCLUÍDAS', 'BÔNUS DE CHEGADA', 'BÔNUS DO CAMPEÃO'];
        this.subtitle.setText(captions[rewardIndex]);
        this.rows.forEach((row, index) => {
            const reward = row.rewards[rewardIndex];
            const target = amount(row.driver.rewards[reward.key]);
            const before = REWARD_KEYS.slice(0, rewardIndex)
                .reduce((sum, key) => sum + amount(row.driver.rewards[key]), 0);
            const counter = { value: 0 };
            let previousTick = -1;
            row.highlight.setPosition(row.highlight.x, reward.value.y - 3).setAlpha(1);
            reward.value.setAlpha(1);
            if (target > 0) this.flyBricks(row, reward);
            this.tween({ targets: counter, value: target, duration: 510, ease: 'Cubic.easeOut',
                onUpdate: tween => {
                    reward.value.setText(`+${number(counter.value)}`);
                    this.updateTotal(row, before + amount(counter.value));
                    const tick = Math.floor(tween.progress * 5);
                    if (!index && target > 0 && tick !== previousTick) {
                        previousTick = tick;
                        this.tone(430 + rewardIndex * 140 + tick * 38, 0.035, 0.014);
                    }
                },
                onComplete: () => {
                    reward.value.setText(`+${number(target)}`);
                    this.updateTotal(row, before + target);
                    this.tween({ targets: row.highlight, alpha: 0, duration: 130 }, true);
                } }, true);
        });
    }

    updateTotal(row, value) {
        row.total.setText(number(value));
        const total = amount(row.driver.rewards.total);
        row.progress.scaleX = total ? Math.min(1, value / total) : 0;
    }

    flyBricks(row, reward) {
        // Three reused icons per car; no per-frame allocations or emitter.
        row.flights.forEach((brick, index) => {
            const startX = reward.value.x - 15 - index * 8, startY = reward.value.y + 5;
            const flight = { progress: 0 };
            brick.setPosition(startX, startY).setAlpha(0).setAngle(-15 + index * 15).setVisible(true);
            this.tween({ targets: flight, progress: 1, delay: index * 65, duration: 340,
                ease: 'Sine.easeInOut', onUpdate: () => {
                    const p = flight.progress;
                    brick.setPosition(startX + (row.brickIcon.x - startX) * p,
                        startY + (row.brickIcon.y - startY) * p - Math.sin(p * Math.PI) * 18);
                    brick.setAlpha(Math.sin(Math.PI * p) * 0.95).setAngle(p * 160);
                }, onComplete: () => brick.setVisible(false) }, true);
        });
        this.tween({ targets: row.totalFlash, alpha: { from: 0.6, to: 0 }, delay: 230,
            duration: 300, ease: 'Quad.easeOut' }, true);
    }

    settleRewards(playTone = true) {
        if (this.destroyed || !this.rows.length) return;
        const wasSettled = this.state === 'settled';
        this.cancelRewards();
        this.state = 'settled';
        this.rows.forEach((row, index) => {
            row.driver = this.results[index];
            row.rewards.forEach(reward => reward.value.setAlpha(1)
                .setText(`+${number(row.driver.rewards[reward.key])}`));
            row.total.setAlpha(1).setText(number(row.driver.rewards.total));
            row.progress.scaleX = 1;
            row.highlight.setAlpha(0);
            row.totalFlash.setAlpha(0);
            row.flights.forEach(brick => brick.setVisible(false));
            row.elapsed.setText(`TEMPO  ${this.scene.formatRaceTime(row.driver.elapsed)}`);
            if (!wasSettled) {
                this.tween({ targets: row.total, scaleX: 1.12, scaleY: 1.12, duration: 160,
                    yoyo: true, ease: 'Sine.easeOut' });
                this.tween({ targets: row.totalFlash, alpha: { from: 0.9, to: 0 }, duration: 650,
                    ease: 'Cubic.easeOut' });
            }
        });
        this.subtitle.setText('TODOS OS GANHOS EM TIJOLINHOS');
        const rules = this.scene.rewardRules || { lap: 10, finish: 20, victory: 50 };
        this.footer.setText(`+${rules.lap} POR VOLTA • +${rules.finish} CHEGADA • +${rules.victory} VITÓRIA`);
        this.returnButton?.setVisible(true).setInteractive({ useHandCursor: true });
        this.returnLabel?.setVisible(true);
        this.returnPlate?.setVisible(true);
        this.scene.input?.keyboard?.off('keydown', this.onReturnKey);
        this.scene.input?.keyboard?.on('keydown', this.onReturnKey);
        this.scene.events.off('update', this.onUpdate);
        this.scene.events.on('update', this.onUpdate);
        if (playTone) this.tone(1175, 0.16);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.clear();
        this.scene.events.off('shutdown', this.onShutdown);
        this.state = 'hidden';
    }
}
