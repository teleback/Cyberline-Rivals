/**
 * TurboAudio — o som do turbo, sintetizado na hora com WebAudio.
 *
 * Por que sintetizar em vez de carregar um .ogg: o projeto não tem nenhum
 * asset de áudio, e um turbo é justamente o tipo de som que fica RUIM em
 * sample. Sample tem duração fixa; o turbo aqui tem duração variável e
 * intensidade contínua. Com síntese, a frequência e o volume acompanham
 * `turboIntensity` no mesmo frame em que a imagem acompanha — som e imagem
 * respirando juntos é metade da sensação de peso.
 *
 * São três vozes somadas:
 *   1. Ruído branco passando por um bandpass que sobe de 300Hz a ~2.8kHz.
 *      É o "shhhhh" do ar sendo empurrado.
 *   2. Uma serra (sawtooth) filtrada, de 110Hz a ~820Hz. É o assobio da
 *      turbina girando, e é ela que dá a informação de "está enchendo".
 *   3. Estalos pontuais: o blow-off ao soltar e o estouro do superaquecimento.
 *
 * Tudo é criado só no primeiro acionamento do turbo (o navegador exige um
 * gesto do usuário antes de deixar tocar áudio — o clique da tela inicial já
 * serviu) e o arquivo inteiro é à prova de falha: se o WebAudio não existir
 * ou der erro, o jogo segue mudo sem reclamar.
 */
export default class TurboAudio {
    constructor(car) {
        this.car = car;
        this.ctx = null;
        this.ready = false;
        this.muted = false;

        car.on('turbo-start', () => this.onStart());
        car.on('turbo-stop', () => this.blowOff(0.5));
        car.on('turbo-overheat', () => this.onOverheat());
    }

    ensure() {
        if (this.ready) return true;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return false;
            const ctx = new AC();
            this.ctx = ctx;

            this.master = ctx.createGain();
            this.master.gain.value = 0.9;
            this.master.connect(ctx.destination);

            // --- Voz 1: ar ---
            const frames = ctx.sampleRate * 2;
            const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

            this.noise = ctx.createBufferSource();
            this.noise.buffer = buffer;
            this.noise.loop = true;

            this.noiseFilter = ctx.createBiquadFilter();
            this.noiseFilter.type = 'bandpass';
            this.noiseFilter.frequency.value = 300;
            this.noiseFilter.Q.value = 0.9;

            this.noiseGain = ctx.createGain();
            this.noiseGain.gain.value = 0;

            this.noise.connect(this.noiseFilter);
            this.noiseFilter.connect(this.noiseGain);
            this.noiseGain.connect(this.master);
            this.noise.start();

            // --- Voz 2: turbina ---
            this.whine = ctx.createOscillator();
            this.whine.type = 'sawtooth';
            this.whine.frequency.value = 110;

            this.whineFilter = ctx.createBiquadFilter();
            this.whineFilter.type = 'lowpass';
            this.whineFilter.frequency.value = 1400;

            this.whineGain = ctx.createGain();
            this.whineGain.gain.value = 0;

            this.whine.connect(this.whineFilter);
            this.whineFilter.connect(this.whineGain);
            this.whineGain.connect(this.master);
            this.whine.start();

            this.engine = ctx.createOscillator();
            this.engine.type = 'sawtooth';
            this.engine.frequency.value = 55;

            this.engineFilter = ctx.createBiquadFilter();
            this.engineFilter.type = 'lowpass';
            this.engineFilter.frequency.value = 700;

            this.engineGain = ctx.createGain();
            this.engineGain.gain.value = 0;

            this.engine.connect(this.engineFilter);
            this.engineFilter.connect(this.engineGain);
            this.engineGain.connect(this.master);
            this.engine.start();

            this.driftFilter = ctx.createBiquadFilter();
            this.driftFilter.type = 'bandpass';
            this.driftFilter.frequency.value = 1500;
            this.driftFilter.Q.value = 0.8;

            this.driftGain = ctx.createGain();
            this.driftGain.gain.value = 0;

            this.noise.connect(this.driftFilter);
            this.driftFilter.connect(this.driftGain);
            this.driftGain.connect(this.master);

            this.noiseBuffer = buffer;
            this.ready = true;
            return true;
        } catch (e) {
            this.ready = false;
            return false;
        }
    }

    onStart() {
        if (!this.ensure()) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        // Chiado seco no instante do acionamento, antes da turbina encher.
        this.burst(0.35, 900, 0.18);
    }

    onOverheat() {
        if (!this.ready) return;
        // Estouro: corpo grave e longo, o oposto do blow-off (que é agudo
        // e curto). Dá pra saber que estourou sem olhar pro HUD.
        this.burst(0.5, 220, 0.55);
        this.blowOff(1);
    }

    /** "Pshhh" da válvula ao soltar o turbo. */
    blowOff(strength) {
        if (!this.ready || this.muted) return;
        this.burst(0.3 * strength, 2600, 0.22);
    }

    /** Rajada curta de ruído filtrado, com decaimento exponencial. */
    burst(gain, freq, seconds) {
        if (!this.ready || this.muted) return;
        try {
            const ctx = this.ctx;
            const now = ctx.currentTime;

            const src = ctx.createBufferSource();
            src.buffer = this.noiseBuffer;

            const filter = ctx.createBiquadFilter();
            filter.type = freq > 1500 ? 'highpass' : 'bandpass';
            filter.frequency.setValueAtTime(freq, now);
            filter.frequency.exponentialRampToValueAtTime(
                Math.max(90, freq * 0.35), now + seconds
            );

            const g = ctx.createGain();
            g.gain.setValueAtTime(gain, now);
            g.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

            src.connect(filter);
            filter.connect(g);
            g.connect(this.master);
            src.start(now);
            src.stop(now + seconds + 0.05);
        } catch (e) { /* som é enfeite, nunca derruba o jogo */ }
    }

    /**
     * Chamado todo frame. Usa rampas curtas (setTargetAtTime) em vez de
     * atribuir `.value` direto: atribuição direta em 60fps produz cliques
     * audíveis, porque o valor salta entre blocos de processamento.
     */
    update() {
        const speed = this.car.body.speed;
        if (!this.ready && (speed > 8 || this.car.isDrifting)) this.ensure();
        if (!this.ready) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const k = this.muted ? 0 : this.car.turboIntensity;
        const speedFactor = Phaser.Math.Clamp(speed / this.car.baseMaxVelocity, 0, 1);
        const engineLoad = this.car.cursors.up.isDown ? 1 : 0.35;
        const driftAmount = this.car.isDrifting ? speedFactor : 0;
        const now = this.ctx.currentTime;
        const t = 0.04;

        this.noiseGain.gain.setTargetAtTime(0.085 * k, now, t);
        this.noiseFilter.frequency.setTargetAtTime(300 + 2500 * k, now, t);

        this.whineGain.gain.setTargetAtTime(0.030 * k * k, now, t);
        this.whine.frequency.setTargetAtTime(110 + 710 * k, now, t);
        this.whineFilter.frequency.setTargetAtTime(700 + 2200 * k, now, t);

        this.engineGain.gain.setTargetAtTime(
            this.muted ? 0 : 0.045 * speedFactor * (0.55 + 0.45 * engineLoad), now, t
        );
        this.engine.frequency.setTargetAtTime(55 + 95 * speedFactor + 28 * engineLoad, now, t);
        this.engineFilter.frequency.setTargetAtTime(450 + 850 * speedFactor, now, t);

        this.driftGain.gain.setTargetAtTime(this.muted ? 0 : 0.16 * driftAmount, now, t);
        this.driftFilter.frequency.setTargetAtTime(1100 + 1800 * speedFactor, now, t);
    }

    toggleMute() {
        this.muted = !this.muted;
        return this.muted;
    }
}
