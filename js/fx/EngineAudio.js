import SAMPLES from './EngineSamples.js';

/**
 * Som do motor e do freio do carro.
 *
 *  MOTOR   Três loops reais (rotação baixa / média / alta) tirados do mp3
 *          que você mandou. Cada um toca com `playbackRate` ajustado pro tom
 *          alvo e os três se misturam conforme a rotação. O tom segue a
 *          velocidade do carro, com troca de marcha (o tom cai e volta a
 *          subir, igual na gravação original).
 *
 *  FREIO   O mp3 não tem freada, então esta parte é sintetizada em tempo
 *          real: chiado da pastilha no começo da freada + canto de pneu
 *          (ruído filtrado + um apito) que fica mais agudo com a velocidade e
 *          some conforme o carro para. Derrapar (drift) também chia.
 *
 * Só LÊ o carro (body.velocity, body.acceleration, isDrifting, turboSpool);
 * não altera nada da física. Usa o AudioContext do Phaser e passa pelo
 * `masterMuteNode`, então a tecla [M] (this.sound.mute) continua valendo.
 */

// ----- AJUSTES (mexa à vontade) ---------------------------------------------
const CONFIG = {
    volume: 0.55,          // volume geral do motor (0..1)
    skidVolume: 0.5,       // volume geral de freio/derrapagem (0..1)
    gears: true,           // false = tom sobe suave, sem trocas de marcha
    // limites de velocidade (fração da velocidade máxima) de cada marcha
    gearEdges: [0, 0.30, 0.62, 1.6],
    // tom (Hz) no começo e no fim de cada marcha
    gearFreqMin: [56, 84, 92],
    gearFreqMax: [124, 132, 178],
};
// -----------------------------------------------------------------------------

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (e0, e1, v) => {
    const t = clamp((v - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
};

// Cache dos buffers por AudioContext (evita redecodificar quando a cena reinicia).
const bufferCache = new WeakMap();

function decodeSamples(ctx) {
    if (bufferCache.has(ctx)) return bufferCache.get(ctx);
    const out = {};
    for (const [name, s] of Object.entries(SAMPLES)) {
        const bin = atob(s.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const pcm = new Int16Array(bytes.buffer);
        const buf = ctx.createBuffer(1, pcm.length, s.sampleRate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
        out[name] = { buffer: buf, f0: s.f0 };
    }
    // Ruído branco de 2 s (pro chiado do freio e do pneu).
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    out.noise = { buffer: nb };
    bufferCache.set(ctx, out);
    return out;
}

export default class EngineAudio {
    constructor(scene, car) {
        this.scene = scene;
        this.car = car;
        this.ready = false;
        this.dead = false;

        const ctx = scene.sound && scene.sound.context;
        if (!ctx) return; // sem WebAudio: o jogo segue sem este som
        this.ctx = ctx;

        try {
            this._build();
            this.ready = true;
        } catch (e) {
            console.warn('EngineAudio desativado:', e);
        }
    }

    // ------------------------------------------------------------------
    _build() {
        const ctx = this.ctx;
        const bank = decodeSamples(ctx);
        const dest = this.scene.sound.masterMuteNode || ctx.destination;

        this.vRef = this.car.baseMaxVelocity || 390;

        // Saída geral (permite fade-out ao terminar a corrida).
        this.out = ctx.createGain();
        this.out.gain.value = 0;
        this.out.connect(dest);

        // ---- Motor ----
        this.engineFilter = ctx.createBiquadFilter();
        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.value = 2500;
        this.engineFilter.Q.value = 0.4;

        this.engineGain = ctx.createGain();
        this.engineGain.gain.value = 0.4;
        this.engineFilter.connect(this.engineGain).connect(this.out);

        this.layers = [];
        for (const name of ['low', 'mid', 'high']) {
            const src = ctx.createBufferSource();
            src.buffer = bank[name].buffer;
            src.loop = true;
            const g = ctx.createGain();
            g.gain.value = 0;
            src.connect(g).connect(this.engineFilter);
            src.start(0, Math.random() * 0.5);
            this.layers.push({ src, g, f0: bank[name].f0 });
        }

        // ---- Freio / pneu ----
        this.skidOut = ctx.createGain();
        this.skidOut.gain.value = CONFIG.skidVolume;
        this.skidOut.connect(this.out);

        const mkNoise = () => {
            const n = ctx.createBufferSource();
            n.buffer = bank.noise.buffer;
            n.loop = true;
            n.start(0, Math.random());
            return n;
        };

        // Canto do pneu: ruído com filtro ressonante...
        this.squealNoise = mkNoise();
        this.squealBP = ctx.createBiquadFilter();
        this.squealBP.type = 'bandpass';
        this.squealBP.frequency.value = 1800;
        this.squealBP.Q.value = 9;
        this.squealNoiseGain = ctx.createGain();
        this.squealNoiseGain.gain.value = 0.9;
        this.squealNoise.connect(this.squealBP).connect(this.squealNoiseGain);

        // ...mais um apito agudo com vibrato (o "iiiiii" da freada).
        this.whistle = ctx.createOscillator();
        this.whistle.type = 'sawtooth';
        this.whistle.frequency.value = 1100;
        this.vibrato = ctx.createOscillator();
        this.vibrato.frequency.value = 7;
        this.vibratoDepth = ctx.createGain();
        this.vibratoDepth.gain.value = 22;
        this.vibrato.connect(this.vibratoDepth).connect(this.whistle.frequency);
        this.whistleBP = ctx.createBiquadFilter();
        this.whistleBP.type = 'bandpass';
        this.whistleBP.frequency.value = 1500;
        this.whistleBP.Q.value = 5;
        this.whistleGain = ctx.createGain();
        this.whistleGain.gain.value = 0.16;
        this.whistle.connect(this.whistleBP).connect(this.whistleGain);

        this.squealGain = ctx.createGain();
        this.squealGain.gain.value = 0;
        this.squealNoiseGain.connect(this.squealGain);
        this.whistleGain.connect(this.squealGain);
        this.squealGain.connect(this.skidOut);
        this.whistle.start();
        this.vibrato.start();

        // Chiado da pastilha / ar (grave-médio, curto, no início da freada).
        this.hissNoise = mkNoise();
        this.hissLP = ctx.createBiquadFilter();
        this.hissLP.type = 'lowpass';
        this.hissLP.frequency.value = 900;
        this.hissGain = ctx.createGain();
        this.hissGain.gain.value = 0;
        this.hissNoise.connect(this.hissLP).connect(this.hissGain).connect(this.skidOut);

        // ---- Estado ----
        this.freq = CONFIG.gearFreqMin[0];  // tom atual do motor (Hz)
        this.gear = 0;
        this.shiftTimer = 0;
        this.brake = 0;
        this.drift = 0;
        this.load = 0;
        this.wasBraking = false;
        this.lastTime = ctx.currentTime;
        this.lastResume = 0;
        this.fadingOut = false;

        this.out.gain.setTargetAtTime(1, ctx.currentTime, 0.25); // fade-in
    }

    // ------------------------------------------------------------------
    /** Chame uma vez por frame (no update da cena). */
    update() {
        if (!this.ready || this.dead) return;
        const ctx = this.ctx;

        // O navegador só libera áudio depois de um clique/tecla.
        if (ctx.state === 'suspended') {
            const now = performance.now();
            if (now - this.lastResume > 500) {
                this.lastResume = now;
                ctx.resume().catch(() => {});
            }
            return;
        }

        const now = ctx.currentTime;
        const dt = clamp(now - this.lastTime, 0.001, 0.1);
        this.lastTime = now;

        const car = this.car;
        const body = car.body;
        if (!body) return;

        // --- ler o carro ---
        const fx = Math.cos(car.rotation - Math.PI / 2);
        const fy = Math.sin(car.rotation - Math.PI / 2);
        const fwd = body.velocity.x * fx + body.velocity.y * fy;      // + frente / - ré
        const accProj = body.acceleration.x * fx + body.acceleration.y * fy;
        const enabled = car.controlsEnabled !== false;
        const speedRatio = clamp(body.speed / this.vRef, 0, 1.6);
        const fwdRatio = clamp(fwd / this.vRef, 0, 1.6);

        const throttle = enabled && (car.networkControls?.throttle ?? accProj > 40);
        const braking = enabled && (car.isBraking ?? (accProj < -40 && fwd > (car.stoppedThreshold || 12)));
        const drifting = enabled && !!car.isDrifting;

        // Carga: suaviza 0..1 (acelerando = motor mais cheio e brilhante).
        this.load += ((throttle ? 1 : 0) - this.load) * (1 - Math.exp(-dt / 0.12));

        // --- marcha ---
        const E = CONFIG.gearEdges;
        if (CONFIG.gears) {
            const hyst = 0.04;
            if (this.gear < 2 && speedRatio > E[this.gear + 1]) {
                this.gear++;
                this.shiftTimer = 0.14;
            } else if (this.gear > 0 && speedRatio < E[this.gear] - hyst) {
                this.gear--;
                this.shiftTimer = 0.10;
            }
        }
        let target;
        if (CONFIG.gears) {
            const g = this.gear;
            const u = clamp((speedRatio - E[g]) / (E[g + 1] - E[g]), 0, 1);
            target = CONFIG.gearFreqMin[g] + (CONFIG.gearFreqMax[g] - CONFIG.gearFreqMin[g]) * u;
        } else {
            target = 56 + 120 * Math.pow(Math.min(speedRatio, 1.5), 0.85);
        }
        // Pisando no acelerador parado/devagar o motor "sobe" um pouco antes do carro.
        target += this.load * 10 * (1 - smooth(0, 0.4, speedRatio));
        // Turbo enche: leve subida extra no tom.
        target *= 1 + 0.05 * (car.turboSpool || 0);
        // Fora de controle (largada/fim): marcha lenta.
        if (!enabled) target = CONFIG.gearFreqMin[0];

        // Sobe suave, cai um pouco mais rápido (e bem rápido na troca de marcha).
        const shifting = this.shiftTimer > 0;
        if (shifting) this.shiftTimer -= dt;
        const tau = target > this.freq ? 0.09 : (shifting ? 0.05 : 0.16);
        this.freq += (target - this.freq) * (1 - Math.exp(-dt / tau));

        // --- misturar os 3 loops pelo tom ---
        const F = this.freq;
        const w = [
            1 - smooth(70, 92, F),                                    // low
            smooth(70, 92, F) * (1 - smooth(118, 142, F)),            // mid
            smooth(118, 142, F),                                      // high
        ];
        for (let i = 0; i < 3; i++) {
            const L = this.layers[i];
            L.src.playbackRate.setTargetAtTime(F / L.f0, now, 0.02);
            L.g.gain.setTargetAtTime(w[i], now, 0.04);
        }

        // Volume/brilho do motor: acelerando fica cheio; soltando, abafa
        // (freio-motor). Na troca de marcha dá uma "tossida" rápida.
        const vol = (0.32 + 0.5 * this.load + 0.18 * Math.min(speedRatio, 1)) * (shifting ? 0.55 : 1);
        this.engineGain.gain.setTargetAtTime(vol * CONFIG.volume * 1.9, now, 0.04);
        this.engineFilter.frequency.setTargetAtTime(
            braking ? 900 : 1100 + 2600 * this.load + 900 * Math.min(speedRatio, 1), now, 0.08
        );

        // --- freio / pneu ---
        const k = (v, target2, up, down) =>
            v + (target2 - v) * (1 - Math.exp(-dt / (target2 > v ? up : down)));
        this.brake = k(this.brake, braking ? 1 : 0, 0.04, 0.12);
        this.drift = k(this.drift, drifting ? 1 : 0, 0.08, 0.20);

        // Começo da freada em velocidade: estalo de chiado da pastilha.
        if (braking && !this.wasBraking && fwdRatio > 0.2) {
            const a = clamp(0.25 + fwdRatio * 0.5, 0, 0.7);
            this.hissGain.gain.cancelScheduledValues(now);
            this.hissGain.gain.setValueAtTime(this.hissGain.gain.value, now);
            this.hissGain.gain.linearRampToValueAtTime(a, now + 0.02);
            this.hissGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
        }
        this.wasBraking = braking;

        // Canto de pneu: só em velocidade, e some conforme o carro para.
        const fast = smooth(0.16, 0.55, fwdRatio);
        const tireLoad = clamp((car.tireSlip || 0) * 1.8, 0, 0.8);
        const squeal = Math.max(this.brake * 0.65 * fast,
            this.drift * 0.95 * smooth(0.12, 0.45, speedRatio), tireLoad * fast * 0.55);
        this.squealGain.gain.setTargetAtTime(squeal, now, 0.03);
        // O tom do canto cai junto com a velocidade.
        const sq = 760 + 1100 * clamp(speedRatio, 0, 1);
        this.whistle.frequency.setTargetAtTime(sq, now, 0.05);
        this.whistleBP.frequency.setTargetAtTime(sq * 1.25, now, 0.05);
        this.squealBP.frequency.setTargetAtTime(sq * 1.8, now, 0.05);
    }

    // ------------------------------------------------------------------
    /** Corrida acabou: motor e pneu vão sumindo. */
    fadeOut(seconds = 0.9) {
        if (!this.ready || this.dead || this.fadingOut) return;
        this.fadingOut = true;
        const now = this.ctx.currentTime;
        this.out.gain.cancelScheduledValues(now);
        this.out.gain.setTargetAtTime(0, now, seconds / 4);
        this.squealGain.gain.setTargetAtTime(0, now, 0.05);
        // Depois do fade, o update() continua mas sem efeito audível.
        this._stopTimer = setTimeout(() => this.destroy(), seconds * 1000 + 300);
    }

    destroy() {
        if (this.dead) return;
        this.dead = true;
        clearTimeout(this._stopTimer);
        if (!this.ready) return;
        const stop = (n) => { try { n.stop(); } catch (e) { /* já parado */ } };
        this.layers.forEach((L) => stop(L.src));
        [this.squealNoise, this.whistle, this.vibrato, this.hissNoise].forEach(stop);
        try { this.out.disconnect(); } catch (e) { /* ok */ }
    }
}
