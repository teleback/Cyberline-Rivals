import { getCarSkin } from '../objects/CarSkins.js';

const FONT = 'monospace';
const GOLD = 0xffd16b;
const SILVER = 0xb5c8e3;
const DEPTH = 8200;
const amount = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
const number = value => amount(value).toLocaleString('pt-BR');

// A narrow screen keeps the rewards below the cars; landscape has room
// for rewards alongside them. All positions stay inside the two cards.
export function resultsLayout(width, height) {
    const compact = height < 440;
    const margin = width < 700 ? 14 : 38;
    const gap = width < 700 ? 12 : 22;
    const top = compact ? 70 : 92;
    const cardWidth = (width - margin * 2 - gap) / 2;
    const cardHeight = height - top - (compact ? 30 : 40);
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
        this.onSkip = event => {
            if (event?.key?.toLowerCase() === 'm') return;
            this.settleRewards();
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
    }

    background() {
        const { width, height } = this.scene.scale;
        this.register(this.scene.add.rectangle(width / 2, height / 2, width, height, 0x030814, 0.95), DEPTH);
        // A few static bands add depth without an expensive screen effect.
        for (let index = 0; index < 3; index++) {
            this.register(this.scene.add.rectangle(width / 2, height * (0.2 + index * 0.3),
                width, 1, 0x334267, 0.35), DEPTH + 1);
        }
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
        this.register(s.add.rectangle(width / 2, height / 2, panelWidth, panelHeight, 0x0b1428)
            .setStrokeStyle(1, 0x58d9ff, 0.65), DEPTH + 1);
        this.text(width / 2, top + 24, 'CHEGADA!', compact ? 25 : 31, '#8aeeff', { fontStyle: 'bold' }).setOrigin(0.5, 0);
        this.text(width / 2, top + 62, 'VOCÊ COMPLETOU A CORRIDA', compact ? 10 : 12, '#aebdd4').setOrigin(0.5, 0);
        const carX = left + panelWidth * 0.24, carY = top + panelHeight * 0.52;
        const scale = compact ? 0.65 : 0.85;
        this.register(s.add.ellipse(carX, carY + 50 * scale, 100 * scale, 22 * scale, 0x26d9ed, 0.16), DEPTH + 2);
        const car = this.actualCar(carX, carY, { skin: s.carSkin, tint: s.carTint }, scale);
        this.tween({ targets: car, y: carY - 4, duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        const infoX = left + panelWidth * 0.43;
        this.text(infoX, top + panelHeight * 0.35, 'SEU TEMPO', compact ? 10 : 12, '#8aa3c2');
        this.waitingTime = this.text(infoX, top + panelHeight * 0.35 + 19, '', compact ? 20 : 25);
        this.text(infoX, top + panelHeight * 0.61, 'TIJOLINHOS GANHOS', compact ? 9 : 11, '#e9bd77');
        this.waitingTotal = this.text(infoX, top + panelHeight * 0.61 + 18, '', compact ? 25 : 30, '#ffdd8a', { fontStyle: 'bold' });
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
        this.text(l.width / 2, l.compact ? 12 : 20, 'RESULTADO DA CORRIDA', l.compact ? 22 : 28,
            '#f5f8ff', { fontStyle: 'bold' }).setOrigin(0.5, 0);
        this.subtitle = this.text(l.width / 2, l.compact ? 44 : 58,
            '1º E 2º LUGAR • TEMPOS E TIJOLINHOS', l.compact ? 10 : 12, '#a2bad9').setOrigin(0.5, 0);
        this.footer = this.text(l.width / 2, l.height - (l.compact ? 18 : 25), 'PREPARANDO AS RECOMPENSAS...',
            l.compact ? 9 : 11, '#869cbc').setOrigin(0.5, 0);
        this.rows = results.slice(0, 2).map((driver, index) => this.buildDriver(driver, l.cards[index]));
        this.rows.forEach((row, index) => this.animateCar(row, index));
        this.later(650, () => this.confetti(this.rows[0]));
        [660, 880, 1109].forEach((frequency, index) => this.later(420 + index * 130, () => this.tone(frequency)));
    }

    buildDriver(driver, card) {
        const s = this.scene, l = this.layout, compact = l.compact, stacked = l.stacked;
        const winner = driver.place === 1, accent = winner ? GOLD : SILVER;
        const color = winner ? '#ffdd88' : '#d1e1f6';
        const inset = compact || stacked ? 14 : 22;
        const { x, y, width, height } = card;
        this.register(s.add.rectangle(x, y, width, height, winner ? 0x171b2b : 0x0e1728)
            .setOrigin(0).setStrokeStyle(1, accent, 0.5), DEPTH + 1);
        this.register(s.add.rectangle(x, y, width, 3, accent).setOrigin(0), DEPTH + 2);
        this.text(x + inset, y + (compact ? 15 : 21), winner ? '1º CAMPEÃO' : '2º LUGAR',
            stacked ? 18 : compact ? 20 : 25, color, { fontStyle: 'bold' });
        this.text(x + width - inset, y + (compact ? 19 : 28), driver.local ? 'VOCÊ' : 'RIVAL', stacked ? 8 : 10,
            driver.local ? '#f9a2e9' : '#8aabda').setOrigin(1, 0);
        const nameSize = stacked ? 15 : compact ? 18 : 22;
        const maxNameLength = Math.max(6, Math.floor((width - inset * 2) / (nameSize * 0.62)));
        const fullName = String(driver.nick || 'PILOTO').replace(/[\r\n]/g, ' ');
        const nick = fullName.length > maxNameLength ? fullName.slice(0, maxNameLength - 1) + '…' : fullName;
        const nickname = this.text(x + inset, y + (stacked ? 44 : compact ? 45 : 62), nick, nameSize, '#f1f5ff', { fontStyle: 'bold' });
        const elapsed = this.text(x + inset, y + (stacked ? compact ? 64 : 68 : compact ? 70 : 88), `TEMPO  ${s.formatRaceTime(driver.elapsed)}`,
            stacked ? 10 : compact ? 11 : 13, '#a7bcd6');

        const carX = x + width * (stacked ? 0.5 : 0.235);
        const pedestalTop = y + height * (stacked ? compact ? 0.50 : 0.48 : 0.70);
        const scale = stacked ? Math.min(0.57, height / 600) : Math.min(1.05, height / 320);
        const carY = pedestalTop - 56 * scale;
        const pedestalWidth = Math.min(width * (stacked ? 0.45 : 0.37), 142);
        const pedestalHeight = Math.max(12, height * 0.065);
        const halo = this.register(s.add.ellipse(carX, pedestalTop - 30 * scale,
            pedestalWidth * 1.05, Math.max(45, 98 * scale), accent, winner ? 0.13 : 0.055), DEPTH + 2);
        const shadow = this.register(s.add.ellipse(carX, pedestalTop, pedestalWidth * 0.8,
            15, 0x000000, 0.45), DEPTH + 3);
        this.register(s.add.rectangle(carX, pedestalTop + pedestalHeight / 2, pedestalWidth, pedestalHeight,
            winner ? 0x9d7130 : 0x3b526f).setStrokeStyle(1, accent, 0.8), DEPTH + 3);
        this.register(s.add.rectangle(carX, pedestalTop + 2, pedestalWidth, 4, accent), DEPTH + 4);
        this.text(carX, pedestalTop + pedestalHeight / 2, String(driver.place), compact ? 11 : 14,
            winner ? '#fff0bf' : '#e3edff', { fontStyle: 'bold' }).setOrigin(0.5);
        const car = this.actualCar(carX, carY, driver, scale);

        const rewardLeft = stacked ? x + inset : x + width * 0.46;
        const rewardRight = x + width - inset;
        const rewardTop = y + height * (stacked ? compact ? 0.61 : 0.55 : 0.385);
        const spacing = stacked ? height * (compact ? 0.053 : 0.058) : height * 0.081;
        const rewardSize = stacked ? compact ? 8 : 10 : compact ? 10 : 12;
        const lapReward = s.rewardRules?.lap ?? 10;
        const labels = ['Coletados', `Voltas (${amount(driver.laps)} ×${lapReward})`, 'Chegada', 'Vitória'];
        const keys = ['collected', 'laps', 'finish', 'victory'];
        const rewards = labels.map((label, index) => {
            const labelObject = this.text(rewardLeft, rewardTop + index * spacing, label, rewardSize, '#a2b4cc');
            const valueObject = this.text(rewardRight, rewardTop + index * spacing, '+0',
                stacked ? compact ? 10 : 12 : compact ? 12 : 16, index === 3 && winner ? '#ffdd88' : '#e2ebf8')
                .setOrigin(1, 0);
            valueObject.setAlpha(0.25);
            return { key: keys[index], label: labelObject, value: valueObject };
        });
        const dividerY = y + height * 0.825;
        this.register(s.add.rectangle(x + inset, dividerY, width - inset * 2, 1, accent, 0.32)
            .setOrigin(0), DEPTH + 2);
        const totalY = y + height * 0.89;
        this.register(s.add.image(x + inset + 11, totalY + 3, 'tijolinho').setDisplaySize(stacked ? 22 : 27, stacked ? 22 : 27), DEPTH + 3);
        this.text(x + inset + (stacked ? 27 : 33), totalY - 4, 'TIJOLINHOS', stacked ? 8 : compact ? 9 : 11, '#d7b888');
        this.text(x + inset + (stacked ? 27 : 33), totalY + 9, 'GANHOS', stacked ? 7 : 8, '#8398b5');
        const total = this.text(rewardRight, totalY + 4, '0', stacked ? 25 : compact ? 29 : 38, color,
            { fontStyle: 'bold' }).setOrigin(1, 0.5).setAlpha(0.35);
        return { driver, card, car, halo, shadow, rewards, total, nickname, elapsed, carX, carY, scale, accent };
    }

    animateCar(row, index) {
        const { car, carX, carY, scale, halo } = row;
        if (index === 0) {
            // Winner drops onto gold, makes a full victory spin and bounces.
            car.setPosition(carX, carY - 90).setAlpha(0).setAngle(-360).setScale(scale * 0.7);
            this.tween({ targets: car, y: carY, angle: 0, alpha: 1, scaleX: scale, scaleY: scale,
                duration: 740, delay: 100, ease: 'Back.easeOut', onComplete: () => {
                    this.tween({ targets: car, y: carY - 10, angle: -7, duration: 190,
                        yoyo: true, repeat: 2, ease: 'Sine.easeOut' });
                } });
            this.tween({ targets: halo, alpha: 0.42, scaleX: 1.08, scaleY: 1.08,
                duration: 700, yoyo: true, repeat: 3, ease: 'Sine.easeInOut' });
        } else {
            // Silver arrives calmly from the side and makes one soft settle.
            car.setPosition(carX + Math.min(75, row.card.width * 0.25), carY).setAlpha(0).setAngle(-14);
            this.tween({ targets: car, x: carX, angle: 0, alpha: 1, duration: 800,
                delay: 320, ease: 'Cubic.easeOut', onComplete: () => {
                    this.tween({ targets: car, y: carY - 3, duration: 180, yoyo: true, ease: 'Sine.easeOut' });
                } });
        }
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
        this.subtitle.setText('TODOS OS GANHOS EM TIJOLINHOS');
        this.footer.setText('TOQUE OU PRESSIONE UMA TECLA PARA REVELAR');
        this.scene.input?.on('pointerdown', this.onSkip);
        this.scene.input?.keyboard?.on('keydown', this.onSkip);
        this.rows.forEach((row, index) => {
            row.driver = results[index];
            row.rewards.forEach((reward, rewardIndex) => this.later(rewardIndex * 150, () => {
                const target = amount(row.driver.rewards[reward.key]);
                const counter = { value: 0 };
                this.tween({ targets: reward.value, alpha: 1, duration: 120 }, true);
                this.tween({ targets: counter, value: target, duration: 520, ease: 'Cubic.easeOut',
                    onUpdate: () => reward.value.setText(`+${number(counter.value)}`),
                    onComplete: () => reward.value.setText(`+${number(target)}`) }, true);
            }, true));
            const counter = { value: 0 };
            let previousTick = -1;
            row.total.setAlpha(1);
            this.tween({ targets: counter, value: amount(row.driver.rewards.total), duration: 1100,
                delay: 200, ease: 'Cubic.easeOut', onUpdate: tween => {
                    row.total.setText(number(counter.value));
                    const tick = Math.floor(tween.progress * 8);
                    if (!index && tick !== previousTick) {
                        previousTick = tick;
                        this.tone(480 + tick * 65, 0.045, 0.02);
                    }
                } }, true);
        });
        this.later(1360, () => this.settleRewards(), true);
    }

    settleRewards(playTone = true) {
        if (this.destroyed || !this.rows.length) return;
        this.cancelRewards();
        this.state = 'settled';
        this.rows.forEach((row, index) => {
            row.driver = this.results[index];
            row.rewards.forEach(reward => reward.value.setAlpha(1)
                .setText(`+${number(row.driver.rewards[reward.key])}`));
            row.total.setAlpha(1).setText(number(row.driver.rewards.total));
            row.elapsed.setText(`TEMPO  ${this.scene.formatRaceTime(row.driver.elapsed)}`);
        });
        this.subtitle.setText('TODOS OS GANHOS EM TIJOLINHOS');
        const rules = this.scene.rewardRules || { lap: 10, finish: 20, victory: 50 };
        this.footer.setText(`+${rules.lap} POR VOLTA • +${rules.finish} CHEGADA • +${rules.victory} VITÓRIA`);
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
