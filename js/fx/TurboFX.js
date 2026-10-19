import { wantsTouchControls } from '../input/TouchControls.js';

// Turbo feedback uses camera anticipation, exhaust, pooled trails and a
// restrained color filter. Full-screen blur and distortion hide upcoming
// curves and require extra render targets, so the race keeps a clear image.
const TUNING = {
    // Leitura da pista.
    streakAlpha: 0.26,   // opacidade dos riscos de velocidade

    // Câmera e efeitos do carro.
    zoomOut: 0.085,      // afasta a câmera (na verdade AUMENTA o campo de visão)
    saturation: 0.18,
    brightness: 0.04,
    rumble: 1.3,         // tremor em pixels
    glow: 3,             // brilho no carro
    ghostAlpha: 0.38     // opacidade do rastro
};

export default class TurboFX {
    constructor(scene, car) {
        this.scene = scene;
        this.car = car;
        this.cam = scene.cameras.main;
        this.lite = wantsTouchControls();

        this.baseZoom = this.cam.zoom;
        this.k = 0;          // intensidade atual, copiada do carro
        this.flashAlpha = 0; // decaimento do flash de acionamento
        this.heatShake = 0;  // decaimento do tranco de superaquecimento
        this._ghostTimer = 0;
        this._angleTimer = 0;
        this._ghostIndex = 0;
        this._cssTurbo = '';
        this.lookX = 0;
        this.lookY = 0;

        this.worldObjects = [];
        this.uiObjects = [];

        this.createTextures();
        this.createFilters();
        this.createExhaust();
        this.createGhosts();
        this.createScreenFX();

        car.on('turbo-start', () => this.onStart());
        car.on('turbo-stop', () => this.onStop());
        car.on('turbo-overheat', () => this.onOverheat());

        scene.events.once('shutdown', () => this.destroy());
    }

    // ------------------------------------------------------------------
    // Texturas geradas na mão — o projeto não tem sprite de partícula, e
    // não faz sentido pedir um PNG novo pra desenhar um borrão redondo.
    // Círculos concêntricos com alpha baixo = degradê suave o bastante.
    // ------------------------------------------------------------------
    createTextures() {
        const tex = this.scene.textures;

        if (!tex.exists('fx-dot')) {
            const g = this.scene.make.graphics({ x: 0, y: 0, add: false });
            for (let i = 16; i > 0; i--) {
                g.fillStyle(0xffffff, 0.055);
                g.fillCircle(16, 16, i);
            }
            g.generateTexture('fx-dot', 32, 32);
            g.destroy();
        }

        if (!tex.exists('fx-streak')) {
            const g = this.scene.make.graphics({ x: 0, y: 0, add: false });
            // Risco que nasce fino, engrossa no meio e some — lê como rastro
            // de luz, não como um retângulo voando pela tela.
            for (let i = 0; i < 48; i++) {
                const a = Math.sin((i / 47) * Math.PI) * 0.9;
                g.fillStyle(0xffffff, a);
                g.fillRect(i, 1, 1, 2);
            }
            g.generateTexture('fx-streak', 48, 4);
            g.destroy();
        }
    }

    // ------------------------------------------------------------------
    // 1. Pós-processamento
    // ------------------------------------------------------------------
    createFilters() {
        this.filters = null;
        // Full-screen render targets and blur passes cause the activation
        // hitch on mobile GPUs. Keep the camera and exhaust feedback there.
        if (this.lite || !this.scene.renderer || !this.scene.renderer.gl) return;

        this.fColor = this.cam.filters.internal.addColorMatrix();
        this.fColor.active = false;
        this.filters = [this.fColor];
        this.lastColorStep = -1;
    }

    // ------------------------------------------------------------------
    // 3. Escapamento
    // ------------------------------------------------------------------
    createExhaust() {
        // Chama: bolinhas grandes, vida curta, blend aditivo. Nasce ciano e
        // morre magenta, que é a paleta do jogo.
        this.flame = this.scene.add.particles(0, 0, 'fx-dot', {
            lifespan: 260,
            speed: { min: 40, max: 140 },
            scale: { start: 0.9, end: 0 },
            alpha: { start: 0.85, end: 0 },
            tint: [0x29cfff, 0x9eefff, 0xff39d4],
            blendMode: 'ADD',
            frequency: this.lite ? 36 : 14,
            quantity: 1,
            maxAliveParticles: this.lite ? 16 : 80,
            emitting: false
        }).setDepth(990);

        // Faíscas: pequenas, rápidas, vida longa. São elas que dão a
        // impressão de que tem alguma coisa sofrendo lá dentro do motor.
        this.sparks = this.scene.add.particles(0, 0, 'fx-dot', {
            lifespan: { min: 300, max: 620 },
            speed: { min: 120, max: 340 },
            scale: { start: 0.28, end: 0 },
            alpha: { start: 1, end: 0 },
            tint: [0x29cfff, 0xffffff, 0xff39d4],
            blendMode: 'ADD',
            frequency: this.lite ? 90 : 26,
            quantity: 1,
            maxAliveParticles: this.lite ? 12 : 40,
            emitting: false
        }).setDepth(991);

        this.worldObjects.push(this.flame, this.sparks);
    }

    createGhosts() {
        // Pool fixo de fantasmas. Criar e destruir um sprite a cada 45ms em
        // velocidade máxima geraria lixo suficiente pra dar engasgo.
        this.ghosts = [];
        for (let i = 0; i < (this.lite ? 4 : 12); i++) {
            const g = this.scene.add.image(0, 0, this.car.texture.key)
                .setVisible(false)
                .setDepth(980)
                .setBlendMode(Phaser.BlendModes.ADD);
            this.ghosts.push(g);
            this.worldObjects.push(g);
        }

        // Glow no carro. `setPaddingOverride(null)` é obrigatório: sem
        // padding o brilho é cortado na borda do frame de 64x64 e sobra um
        // quadrado luminoso em volta do carro.
        this.carGlow = null;
        if (!this.lite && this.scene.renderer && this.scene.renderer.gl && this.car.enableFilters) {
            this.carGlow = this.car.enableFilters()
                .filters.internal.addGlow(0x00e5ff, 0, 0, 1.2, false, 4, 12);
            if (this.carGlow.setPaddingOverride) this.carGlow.setPaddingOverride(null);
            this.carGlow.active = false;
        }
    }

    // ------------------------------------------------------------------
    // 4. Tela (câmera de UI, sem filtros)
    // ------------------------------------------------------------------
    createScreenFX() {
        const { width, height } = this.scene.scale;

        // `angle` e `rotate` ficam como números constantes no config de
        // propósito: assim dá pra atualizá-los em tempo real via onChange.
        // Se fossem {min,max}, a op mudaria de modo e o onChange quebraria.
        this.streaks = this.scene.add.particles(0, 0, 'fx-streak', {
            lifespan: 340,
            speed: { min: 700, max: 1300 },
            scale: { start: 1.4, end: 0.4 },
            alpha: { start: TUNING.streakAlpha, end: 0 },
            tint: [0xffffff, 0x9be9ff],
            blendMode: 'ADD',
            frequency: this.lite ? 100 : 24,
            quantity: this.lite ? 1 : 2,
            maxAliveParticles: this.lite ? 6 : 40,
            angle: 0,
            rotate: 0,
            emitZone: {
                type: 'random',
                source: new Phaser.Geom.Rectangle(-80, -80, width + 160, height + 160)
            },
            emitting: false
        }).setScrollFactor(0).setDepth(1800);

        this.flash = this.scene.add.rectangle(0, 0, width, height, 0xffffff)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(1900)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setAlpha(0);

        this.uiObjects.push(this.streaks, this.flash);

        this.container = document.getElementById('game-container');
    }

    // ------------------------------------------------------------------
    // Eventos pontuais
    // ------------------------------------------------------------------
    onStart() {
        this.flashAlpha = 0.20;
        this.cam.shake(140, 0.005);
        this.sparks.explode(this.lite ? 5 : 14, this.exhaustX(), this.exhaustY());
    }

    onStop() {
        // Alívio de pressão: uma cusparada de faísca ao soltar.
        this.sparks.explode(this.lite ? 3 : 6, this.exhaustX(), this.exhaustY());
    }

    onOverheat() {
        // Estourou o tanque: tranco mais feio, faísca pra caramba, tela
        // pisca vermelho. Tem que doer um pouco pra você aprender a dosar.
        this.heatShake = 1;
        this.flashAlpha = 0.30;
        this.flash.fillColor = 0xff2d55;
        this.cam.shake(320, 0.010);
        this.sparks.explode(this.lite ? 10 : 34, this.exhaustX(), this.exhaustY());
    }

    /** Posição do escapamento: 22px atrás do centro, no eixo do carro. */
    exhaustX() {
        return this.car.x - Math.cos(this.car.rotation - Math.PI / 2) * 22;
    }

    exhaustY() {
        return this.car.y - Math.sin(this.car.rotation - Math.PI / 2) * 22;
    }

    // ------------------------------------------------------------------
    update(time, delta) {
        const car = this.car;
        const k = car.turboIntensity;
        this.k = k;
        const dt = Math.min(delta / 1000, 0.1);

        // A small color change needs one pass, without blur, distortion
        // or a dark vignette. Rebuild its matrix only when it changes.
        if (this.filters) {
            const step = Math.round(k * 32);
            this.fColor.active = step > 0;
            if (step > 0 && step !== this.lastColorStep) {
                const amount = step / 32;
                const cm = this.fColor.colorMatrix;
                cm.saturate(TUNING.saturation * amount, false);
                cm.brightness(1 + TUNING.brightness * amount, true);
            }
            this.lastColorStep = step;
        }

        this.updateCamera(dt, k);

        // --- Escapamento ---
        const ex = this.exhaustX();
        const ey = this.exhaustY();
        this.flame.setPosition(ex, ey);
        this.sparks.setPosition(ex, ey);

        const burning = k > 0.02;
        this.flame.emitting = burning;
        this.sparks.emitting = k > 0.35;
        if (burning) {
            // Mais turbo = jato mais denso e mais comprido.
            this.flame.frequency = this.lite ? 46 - 16 * k : 22 - 16 * k;
            this.flame.setParticleLifespan(180 + (this.lite ? 80 : 220) * k);
        }

        // --- Fantasmas ---
        this._ghostTimer -= delta;
        if (k > 0.3 && this._ghostTimer <= 0) {
            this._ghostTimer = this.lite ? 95 : 42;
            const g = this.ghosts[this._ghostIndex];
            this._ghostIndex = (this._ghostIndex + 1) % this.ghosts.length;

            g.setPosition(car.x, car.y)
                .setRotation(car.rotation)
                .setScale(1)
                .setTint(0x00e5ff)
                .setAlpha(TUNING.ghostAlpha * k)
                .setVisible(true);

            g.turboBornAt = time;
            g.turboAlpha = TUNING.ghostAlpha * k;
        }
        // Fade the fixed pool directly: no new tween or callback per trail.
        for (const ghost of this.ghosts) {
            if (!ghost.visible) continue;
            const age = Math.min(1, (time - ghost.turboBornAt) / 260);
            ghost.setAlpha(ghost.turboAlpha * (1 - age)).setScale(1 + 0.12 * age);
            if (age >= 1) ghost.setVisible(false);
        }

        // --- Glow do carro ---
        if (this.carGlow) {
            this.carGlow.active = k > 0.01;
            if (this.carGlow.active) {
                // Pulsa: brilho constante vira adesivo; brilho que respira
                // vira motor.
                const pulse = 0.82 + 0.18 * Math.sin(time * 0.028);
                this.carGlow.outerStrength = TUNING.glow * k * pulse;
                this.carGlow.color = k > 0.6 ? 0xff39d4 : 0x29cfff;
            } else {
                this.carGlow.outerStrength = 0;
            }
        }

        // Tint do carro: drift e turbo disputavam o mesmo canal, então a
        // prioridade é resolvida aqui, num lugar só.
        if (k > 0.45) {
            car.setTint(0xe8e0ff);
        } else if (car.isDrifting) {
            car.setTint(0xff5fa8);
        } else if (car.isOverheated) {
            car.setTint(0xff9aa8);
        } else {
            car.clearTint();
        }

        // --- Riscos de velocidade ---
        // Riscos só a partir de 45% de turbo (era 25%) e em menor densidade:
        // eles cruzam a tela inteira, então são o efeito que mais rouba
        // atenção do que importa, que é a pista.
        const streaking = k > 0.45;
        this.streaks.emitting = streaking;
        if (streaking) {
            this.streaks.frequency = this.lite ? 110 - 30 * k : 42 - 24 * k;

            // Direção dos riscos = contrário do carro, porque na tela é o
            // mundo que corre pra trás. Recalcula a cada ~70ms; a cada frame
            // seria desperdício e ninguém veria a diferença.
            this._angleTimer -= delta;
            if (this._angleTimer <= 0) {
                this._angleTimer = 70;
                const deg = car.angle + 90;
                this.streaks.setEmitterAngle(deg);
                this.streaks.ops.rotate.onChange(deg);
            }
        }

        // --- Flash ---
        this.flashAlpha = Math.max(0, this.flashAlpha - dt * 2.2);
        this.flash.setAlpha(this.flashAlpha);
        if (this.flashAlpha <= 0) this.flash.fillColor = 0xffffff;

        // --- Brilho do container HTML (ver style.css) ---
        if (this.container && !this.lite) {
            const value = (Math.round(k * 20) / 20).toFixed(2);
            if (value !== this._cssTurbo) {
                this.container.style.setProperty('--turbo', value);
                this._cssTurbo = value;
            }
        }
    }

    updateCamera(dt, k = this.car.turboIntensity) {
        const car = this.car;
        // --- Câmera ---
        // Zoom pra trás = mais mundo entrando na tela. Note que este é o
        // único efeito da lista que AUMENTA o que você enxerga, então ele
        // subiu um pouco justamente pra compensar os outros que desceram.
        const roadSpeed = Phaser.Math.Clamp((car.body.speed - 100) / 400, 0, 1);
        const targetZoom = this.baseZoom - 0.035 * roadSpeed - TUNING.zoomOut * k;
        this.cam.zoom += (targetZoom - this.cam.zoom) * (1 - Math.exp(-5 * dt));

        // Antecipação pela velocidade real: abre espaço para enxergar a
        // próxima curva, inclusive quando o carro está deslizando de lado.
        const lookFactor = car.controlsEnabled ? Math.min(0.16, 70 / Math.max(1, car.body.speed)) : 0;
        const cameraResponse = 1 - Math.exp(-4 * dt);
        this.lookX += (-car.body.velocity.x * lookFactor - this.lookX) * cameraResponse;
        this.lookY += (-car.body.velocity.y * lookFactor - this.lookY) * cameraResponse;

        // Tremor menor: sacudir a tela enquanto o jogador está mirando uma
        // curva é o tipo de "juice" que atrapalha mais do que entrega.
        const rumble = TUNING.rumble * k + 5 * this.heatShake;
        if (rumble > 0.05) {
            this.cam.setFollowOffset(
                this.lookX + Phaser.Math.FloatBetween(-rumble, rumble),
                this.lookY + Phaser.Math.FloatBetween(-rumble, rumble)
            );
        } else {
            this.cam.setFollowOffset(this.lookX, this.lookY);
        }
        this.heatShake = Math.max(0, this.heatShake - dt * 2.4);
    }

    destroy() {
        if (this.container) this.container.style.setProperty('--turbo', '0');
        if (this.cam) {
            this.cam.setFollowOffset(0, 0);
            this.cam.zoom = this.baseZoom;
        }
    }
}
