/**
 * StartCountdown — "3, 2, 1, VAI!" na tela depois que o carro pousa.
 *
 * Os tempos em BEAT_TIMES não são um chute: foram medidos direto na forma
 * de onda do áudio (assets/images/audio/countdown.mp3, já recortado do arquivo
 * original só com a sequência de bips). Cada número aparece no instante
 * exato em que o bip correspondente toca — sem isso, texto e som andam
 * juntos só por sorte e desalinham no primeiro dispositivo mais lento.
 *
 * `onGo` é chamado no mesmo instante em que "VAI!" aparece — é esse
 * callback que a RaceScene usa pra destravar `car.controlsEnabled`.
 */
const BEAT_TIMES = [0.12, 1.12, 2.10, 3.12]; // segundos, medidos no áudio
const LABELS = ['3', '2', '1', 'VAI!'];
const CYAN = 0x42edff;
const PINK = 0xff40c8;
const GREEN = 0x96ffce;
const FONT = '"Orbitron", monospace';

export default class StartCountdown {
    constructor(scene) {
        this.scene = scene;
        this.timers = [];
        this.cancelled = false;
        const { width, height } = scene.scale;
        this.root = scene.add.container(width / 2, height * 0.47)
            .setScrollFactor(0).setDepth(3000).setAlpha(0)
            .setScale(Math.min(1, width / 640, height / 420));
        this.buildFrame();
        this.buildNumber();

        // O conjunto inteiro pertence à uiCam, fora dos filtros do mundo.
        scene.cameras.main.ignore(this.root);
        this.onShutdown = () => this.cancel();
        scene.events.once('shutdown', this.onShutdown);
    }

    add(object) {
        this.root.add(object);
        return object;
    }

    label(y, value, size, color) {
        return this.add(this.scene.add.text(0, y, value, {
            fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold',
            color, resolution: 2,
        }).setOrigin(0.5));
    }

    buildFrame() {
        const g = this.add(this.scene.add.graphics());
        const plate = [
            { x: -154, y: -140 }, { x: 128, y: -140 },
            { x: 154, y: -114 }, { x: 154, y: 119 },
            { x: 133, y: 140 }, { x: -132, y: 140 },
            { x: -154, y: 118 },
        ];
        // Cristal escuro, cantos recortados e um fio de luz nas bordas.
        g.fillStyle(0x030817, 0.88).fillPoints(plate, true);
        g.lineStyle(1, CYAN, 0.22).strokePoints(plate, true);
        g.lineStyle(1, CYAN, 0.13).strokeCircle(0, -7, 91);
        for (let y = -103; y < 90; y += 6) {
            g.lineStyle(1, CYAN, 0.035).lineBetween(-132, y, 132, y);
        }
        for (const side of [-1, 1]) {
            g.lineStyle(3, side < 0 ? CYAN : PINK, 0.85)
                .lineBetween(side * 154, -104, side * 154, -135)
                .lineBetween(side * 154, -140, side * 108, -140)
                .lineBetween(side * 154, 106, side * 154, 119)
                .lineBetween(side * 154, 119, side * 133, 140)
                .lineBetween(side * 133, 140, side * 108, 140);
            for (let j = 0; j < 3; j++) {
                const x = side * (123 + j * 7);
                g.lineStyle(2, side < 0 ? CYAN : PINK, 0.65)
                    .lineBetween(x, 69, x - side * 6, 79);
            }
        }
        // Marcas fixas do mostrador: nenhuma textura ou partícula por quadro.
        for (let tick = 0; tick < 48; tick++) {
            const angle = tick / 48 * Math.PI * 2;
            const inner = tick % 4 === 0 ? 99 : 102;
            g.lineStyle(tick % 4 === 0 ? 2 : 1, tick % 12 < 3 ? PINK : CYAN, 0.48)
                .lineBetween(Math.cos(angle) * inner, Math.sin(angle) * inner - 7,
                    Math.cos(angle) * 106, Math.sin(angle) * 106 - 7);
        }

        this.heading = this.label(-121, 'P R E P A R E - S E', 10, '#b8d8ed');
        this.status = this.label(106, 'AGUARDE O SINAL', 9, '#83a7c4');
        this.ring = this.add(this.scene.add.graphics().setPosition(0, -7));
        this.pulse = this.add(this.scene.add.circle(0, -7, 92, CYAN, 0)
            .setStrokeStyle(2, CYAN, 0.65).setAlpha(0));
        this.lamps = [-52, 0, 52].map(x => this.add(
            this.scene.add.rectangle(x, 126, 40, 4, 0x20334b)
                .setStrokeStyle(1, CYAN, 0.15)));
    }

    buildNumber() {
        this.glyphs = this.add(this.scene.add.container(0, -7));
        const make = (color, stroke, thickness) => {
            const text = this.scene.add.text(0, 0, '', {
                fontFamily: FONT, fontSize: '128px', fontStyle: '900',
                color, stroke, strokeThickness: thickness,
                padding: { left: 20, right: 20, top: 14, bottom: 14 },
                resolution: 2,
            }).setOrigin(0.5);
            this.glyphs.add(text);
            return text;
        };
        this.glow = make('#42edff', '#42edff', 7).setAlpha(0.16)
            .setShadow(0, 0, '#00dfff', 20, true, true);
        this.echoPink = make('#ff40c8', '#ff40c8', 1).setPosition(4, 1);
        this.echoCyan = make('#42edff', '#42edff', 1).setPosition(-4, -1);
        this.text = make('#effeff', '#28788d', 1)
            .setShadow(0, 2, '#20dfff', 9, true, true);
    }

    drawRing(beat, go) {
        const g = this.ring, turn = Math.PI * 2, start = -Math.PI / 2;
        g.clear();
        // Três arcos se completam nos bips; o sinal verde fecha o anel.
        for (let segment = 0; segment < 3; segment++) {
            const from = start + segment * turn / 3 + 0.07;
            const to = start + (segment + 1) * turn / 3 - 0.07;
            g.lineStyle(4, go ? GREEN : segment === 2 ? PINK : CYAN,
                go || segment <= beat ? 0.9 : 0.12);
            g.beginPath().arc(0, 0, 91, from, to).strokePath();
        }
    }

    /** Agenda as batidas no horário absoluto de largada compartilhado. */
    play(onGo, goAt = Date.now() + BEAT_TIMES[BEAT_TIMES.length - 1] * 1000) {
        if (this.cancelled || this.playing) return;
        this.playing = true;
        const scene = this.scene;
        const goTime = BEAT_TIMES[BEAT_TIMES.length - 1];
        const now = Date.now();
        const sequenceStartsAt = goAt - goTime * 1000;
        const lateness = now - sequenceStartsAt;

        try {
            if (lateness < 120 && scene.cache.audio.exists('countdown')) {
                this.sound = scene.sound.add('countdown');
                this.sound.play();
            }
        } catch (e) {
            // Som é enfeite: se falhar (autoplay bloqueado, decode etc.), a
            // contagem visual e a liberação dos controles seguem normais.
            console.error('StartCountdown: falha ao tocar o áudio', e);
        }

        let currentBeat = -1;
        BEAT_TIMES.forEach((beatTime, i) => {
            const beatAt = goAt - (goTime - beatTime) * 1000;
            const delay = beatAt - now;
            if (delay <= 0) {
                currentBeat = i;
                return;
            }
            this.timers.push(scene.time.delayedCall(delay, () => {
                if (!this.cancelled) this.showBeat(i);
            }));
        });
        if (currentBeat >= 0) this.showBeat(currentBeat);

        const goDelay = goAt - Date.now();
        if (goDelay <= 0) {
            if (!this.cancelled && onGo) onGo();
        } else {
            this.timers.push(scene.time.delayedCall(goDelay, () => {
                if (!this.cancelled && onGo) onGo();
            }));
        }
        this.timers.push(scene.time.delayedCall(Math.max(0, goAt + 900 - Date.now()), () => this.hide()));
    }

    showBeat(i) {
        if (this.cancelled || !this.root.active) return;
        try {
            const label = LABELS[i];
            const go = i === LABELS.length - 1;
            const layers = [this.glow, this.echoPink, this.echoCyan, this.text];
            this.scene.tweens.killTweensOf([this.glyphs, this.echoPink, this.echoCyan,
                this.ring, this.pulse]);
            this.root.setAlpha(1);
            layers.forEach(text => text.setText(label).setFontSize(go ? 84 : 128));
            this.text.setColor(go ? '#d9ffed' : '#effeff');
            this.glow.setColor(go ? '#96ffce' : '#42edff');
            this.heading.setText(go ? 'S I N A L   V E R D E' : 'P R E P A R E - S E')
                .setColor(go ? '#96ffce' : '#b8d8ed');
            this.status.setText(go ? 'PÉ NO ACELERADOR' : 'AGUARDE O SINAL')
                .setColor(go ? '#d9ffed' : '#83a7c4');
            this.lamps.forEach((lamp, index) => lamp.setFillStyle(go ? GREEN : CYAN,
                go || index <= i ? 1 : 0.12));
            this.drawRing(i, go);

            this.glyphs.setScale(go ? 0.88 : 1.16);
            this.scene.tweens.add({
                targets: this.glyphs, scaleX: 1, scaleY: 1,
                duration: 240, ease: 'Cubic.easeOut',
            });
            // Breve separação cromática, sem piscar a tela inteira.
            this.echoPink.setAlpha(0.7);
            this.echoCyan.setAlpha(0.6);
            this.scene.tweens.add({
                targets: [this.echoPink, this.echoCyan], alpha: 0,
                duration: 160, ease: 'Quad.easeOut',
            });
            this.pulse.setScale(0.93).setAlpha(0.65)
                .setStrokeStyle(2, go ? GREEN : CYAN, 0.65);
            this.scene.tweens.add({
                targets: this.pulse, scaleX: go ? 1.48 : 1.25,
                scaleY: go ? 1.48 : 1.25, alpha: 0,
                duration: go ? 600 : 460, ease: 'Cubic.easeOut',
            });
            this.ring.setAngle(-7);
            this.scene.tweens.add({
                targets: this.ring, angle: 0, duration: 380, ease: 'Cubic.easeOut',
            });
        } catch (e) {
            console.error('StartCountdown: falha ao mostrar número', e);
        }
    }

    hide() {
        if (this.cancelled || !this.root.active || this.hiding) return;
        this.hiding = true;
        this.scene.tweens.add({
            targets: this.root,
            alpha: 0,
            duration: 280,
            onComplete: () => this.cancel()
        });
    }

    cancel() {
        if (this.cancelled) return;
        this.cancelled = true;
        this.timers.forEach(timer => timer.remove(false));
        this.timers = [];
        if (this.sound?.isPlaying) this.sound.stop();
        this.sound?.destroy();
        this.scene.events.off('shutdown', this.onShutdown);
        this.scene.tweens.killTweensOf([this.root, ...this.root.list, ...this.glyphs.list]);
        if (this.root.active) this.root.destroy();
    }
}
