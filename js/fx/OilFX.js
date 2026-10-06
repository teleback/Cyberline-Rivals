/**
 * OilFX — todo o feedback VISUAL da zona de óleo, num lugar só.
 *
 * REGRA DE OURO: este arquivo é só visual. Ele LÊ `car.isOnOil` (que a
 * RaceScene já calcula todo frame) e a velocidade do carro, e nunca
 * escreve em velocidade, aceleração, grip, direção ou física. A mecânica
 * de desaceleração (Car.applyOilDeceleration) continua exatamente como
 * está; se este arquivo for apagado, o jogo só perde o visual.
 *
 * Camadas:
 *
 *   1. ENTRADA (dispara uma vez quando o carro entra na mancha)
 *      - Respingo de óleo saindo do carro, com faíscas iridescentes.
 *      - A poça "cede": dá uma pulsada de escala e solta um anel de
 *        ondulação que se abre e some.
 *      - Tremidinha de câmera bem leve, proporcional à velocidade.
 *
 *   2. ENQUANTO ESTÁ NA MANCHA
 *      - Gotas roxas espirradas pelas rodas (mais gotas quanto mais
 *        rápido o carro entra).
 *      - Reflexos violetas e uma borda roxa luminosa.
 *
 *   3. DEPOIS DE SAIR (a "película" de óleo escorrendo)
 *      - `coat` (0..1) sobe rápido ao entrar e desce devagar ao sair.
 *        Ela tinge o carro suavemente e controla o rastro violeta que
 *        as rodas traseiras deixam no asfalto. O rastro é por DISTÂNCIA
 *        percorrida, então carro parado não deixa nada.
 *
 * Tudo é criado UMA vez no construtor (emissores e anéis em pool). Nada
 * é criado durante a corrida, porque a câmera de UI só ignora os objetos
 * que já existiam quando as câmeras foram separadas (ver
 * RaceScene.splitCameras) — objeto criado depois apareceria duplicado
 * na tela do HUD.
 */

const TUNING = {
    // Rodas: deslocamento (px) do centro do carro, no eixo do carro.
    wheelLong: 15,
    wheelLat: 11,

    // Película de óleo
    coatRise: 10,        // velocidade com que sobe (por segundo)
    coatFall: 2.2,       // velocidade com que escorre (por segundo, ~1.3s)
    tintStrength: 0.4,
    tintR: 210, tintG: 145, tintB: 255,

    // Emissão enquanto está na mancha (partículas por segundo)
    dropsBase: 14, dropsPerSpeed: 60,
    glintsBase: 6, glintsPerSpeed: 22,

    // Rastro
    trailSpacing: 12,    // px percorridos entre um par de marcas e o próximo
    trailMinSpeed: 25,   // abaixo disso não marca o asfalto

    // Puddle / anel
    puddlePulse: 1.14,
    ringPoolSize: 4,

    // Câmera
    shakeMs: 110,
    shakeBase: 0.0008,
    shakePerSpeed: 0.0014
};

// Apply the game's neon palette once at texture creation. The original
// alpha, holes, droplets and silhouette also keep the existing sensors valid.
export function neonOilPixels(pixels, width, height) {
    const original = new Uint8ClampedArray(pixels);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const alpha = original[offset + 3];
        if (!alpha) continue;
        const brightness = Math.min(1, Math.max(original[offset], original[offset + 1], original[offset + 2]) / 55);
        const edge = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => {
            const nx = x + dx, ny = y + dy;
            return nx < 0 || nx >= width || ny < 0 || ny >= height
                || original[(ny * width + nx) * 4 + 3] < alpha * 0.6;
        });
        pixels[offset] = edge ? 201 : Math.round(88 + brightness * 95);
        pixels[offset + 1] = edge ? 90 : Math.round(15 + brightness * 48);
        pixels[offset + 2] = edge ? 255 : Math.round(155 + brightness * 100);
    }
    return pixels;
}

export default class OilFX {
    /**
     * @param scene      RaceScene
     * @param car        Car
     * @param spots      [{ sensor, puddle }] — um por zona de óleo
     * @param container  container de mundo das poças (oilVisuals)
     */
    constructor(scene, car, spots, container) {
        this.scene = scene;
        this.car = car;
        this.spots = spots;
        this.container = container;

        // Objetos que precisam ser ignorados pela câmera de UI.
        this.worldObjects = [];

        this.enabled = true;
        this.wasOn = false;
        this.coat = 0;
        this.dropAcc = 0;
        this.glintAcc = 0;
        this.trailDist = 0;
        this.ringIndex = 0;

        if (!this.enabled) return;

        this.createTextures();
        this.createEmitters();
        this.createRings();

        // Guarda a escala base de cada poça pra pulsar sem "acumular".
        this.spots.forEach((spot, index) => {
            spot.puddle.setTexture(`oil-neon-${spot.puddle.texture.key}`);
            spot.baseScaleX = spot.puddle.scaleX;
            spot.baseScaleY = spot.puddle.scaleY;
            spot.phase = index * 0.63;
            spot.aura = scene.add.image(spot.puddle.x, spot.puddle.y, 'oil-aura')
                .setDisplaySize(126, 90).setBlendMode('ADD').setAlpha(0.55);
            this.container.addAt(spot.aura, 0);
            spot.sheen = scene.add.image(spot.puddle.x, spot.puddle.y, spot.puddle.texture.key)
                .setScale(spot.baseScaleX, spot.baseScaleY).setBlendMode('ADD').setAlpha(0.16);
            this.container.add(spot.sheen);
        });
    }

    createTextures() {
        const tex = this.scene.textures;
        for (const key of ['zonaoleo', 'zonaoleo2']) {
            const neonKey = `oil-neon-${key}`;
            if (tex.exists(neonKey)) continue;
            const source = tex.get(key).getSourceImage();
            const texture = tex.createCanvas(neonKey, source.width, source.height);
            const context = texture.getContext();
            context.drawImage(source, 0, 0);
            const image = context.getImageData(0, 0, source.width, source.height);
            neonOilPixels(image.data, source.width, source.height);
            context.putImageData(image, 0, 0);
            texture.refresh();
        }
        for (const [key, size, inner, outer] of [
            ['oil-aura', 128, 'rgba(163,53,255,0.38)', 'rgba(163,53,255,0)'],
            ['oil-particle', 16, 'rgba(224,155,255,1)', 'rgba(163,53,255,0)'],
        ]) {
            if (tex.exists(key)) continue;
            const texture = tex.createCanvas(key, size, size);
            const context = texture.getContext();
            const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
            gradient.addColorStop(0, inner);
            gradient.addColorStop(1, outer);
            context.fillStyle = gradient;
            context.fillRect(0, 0, size, size);
            texture.refresh();
        }
        if (tex.exists('oil-ring')) return;

        const g = this.scene.make.graphics({ x: 0, y: 0, add: false });
        g.lineStyle(6, 0xa335ff, 0.25);
        g.strokeCircle(32, 32, 27);
        g.lineStyle(3, 0xdca2ff, 1);
        g.strokeCircle(32, 32, 27);
        g.generateTexture('oil-ring', 64, 64);
        g.destroy();
    }

    createEmitters() {
        const add = this.scene.add;
        const purples = [0xffffff, 0xd2a4ff, 0xe6bfff];

        // Gotas violeta espirradas pelas rodas.
        this.spray = add.particles(0, 0, 'oil-particle', {
            lifespan: { min: 320, max: 720 },
            speed: { min: 30, max: 150 },
            scale: { start: 0.34, end: 0.04 },
            alpha: { start: 0.95, end: 0 },
            tint: purples,
            blendMode: 'ADD', maxAliveParticles: 64,
            emitting: false
        }).setDepth(1001);

        // Respingo maior, só na entrada.
        this.splash = add.particles(0, 0, 'oil-particle', {
            lifespan: { min: 380, max: 820 },
            speed: { min: 90, max: 280 },
            scale: { start: 0.5, end: 0.05 },
            alpha: { start: 0.95, end: 0 },
            tint: purples,
            blendMode: 'ADD', maxAliveParticles: 40,
            emitting: false
        }).setDepth(1001);

        // Reflexos iridescentes (óleo brilha em cor).
        this.glint = add.particles(0, 0, 'oil-particle', {
            lifespan: { min: 200, max: 440 },
            speed: { min: 50, max: 190 },
            scale: { start: 0.14, end: 0 },
            alpha: { start: 1, end: 0 },
            tint: purples,
            maxAliveParticles: 40,
            blendMode: 'ADD',
            emitting: false
        }).setDepth(1002);

        // Marcas violetas deixadas no asfalto pelas rodas traseiras.
        // Abaixo do carro (depth 1000) e acima das poças (480).
        this.trail = add.particles(0, 0, 'oil-particle', {
            lifespan: 1300,
            speed: 0,
            scale: { start: 0.3, end: 0.2 },
            alpha: { start: 0.32, end: 0 },
            tint: purples, blendMode: 'ADD', maxAliveParticles: 80,
            emitting: false
        }).setDepth(700);

        this.worldObjects.push(this.spray, this.splash, this.glint, this.trail);
    }

    createRings() {
        // Pool fixo de anéis de ondulação, filhos do container das poças
        // (que a câmera de UI já ignora).
        this.rings = [];
        for (let i = 0; i < TUNING.ringPoolSize; i++) {
            const ring = this.scene.add.image(0, 0, 'oil-ring');
            ring.setVisible(false);
            ring.setBlendMode('ADD');
            this.container.add(ring);
            this.rings.push(ring);
        }
    }

    // ------------------------------------------------------------------
    // Posição das rodas, no eixo do carro.
    // ------------------------------------------------------------------
    wheelPos(long, lat) {
        const car = this.car;
        const rot = car.rotation;
        // frente = (sin, -cos); direita = (cos, sin)
        return {
            x: car.x + Math.sin(rot) * long + Math.cos(rot) * lat,
            y: car.y - Math.cos(rot) * long + Math.sin(rot) * lat
        };
    }

    randomWheel() {
        const long = Math.random() < 0.5 ? TUNING.wheelLong : -TUNING.wheelLong;
        const lat = Math.random() < 0.5 ? TUNING.wheelLat : -TUNING.wheelLat;
        return this.wheelPos(long, lat);
    }

    // ------------------------------------------------------------------
    // Entrada na mancha
    // ------------------------------------------------------------------
    onEnter(speedFactor) {
        const car = this.car;

        this.splash.explode(10 + Math.round(16 * speedFactor), car.x, car.y);
        this.glint.explode(8, car.x, car.y);

        // Qual poça foi? Só olhamos aqui, na entrada (10 checagens, uma vez).
        const physics = this.scene.physics;
        const spot = this.spots.find((s) => physics.overlap(car, s.sensor));
        if (spot) {
            this.pulsePuddle(spot);
            this.ripple(spot.puddle.x, spot.puddle.y);
        }

        const cam = this.scene.cameras.main;
        if (cam && cam.shake) {
            cam.shake(TUNING.shakeMs, TUNING.shakeBase + TUNING.shakePerSpeed * speedFactor);
        }
    }

    pulsePuddle(spot) {
        const tweens = this.scene.tweens;
        tweens.killTweensOf(spot.puddle);
        // Volta à escala base antes de pulsar: se o tween anterior foi
        // interrompido no meio, o yoyo devolveria a poça num tamanho errado.
        spot.puddle.setScale(spot.baseScaleX, spot.baseScaleY);
        tweens.add({
            targets: spot.puddle,
            scaleX: spot.baseScaleX * TUNING.puddlePulse,
            scaleY: spot.baseScaleY * TUNING.puddlePulse,
            duration: 150,
            yoyo: true,
            ease: 'Sine.easeOut',
            onComplete: () => spot.puddle.setScale(spot.baseScaleX, spot.baseScaleY)
        });
    }

    ripple(x, y) {
        const ring = this.rings[this.ringIndex];
        this.ringIndex = (this.ringIndex + 1) % this.rings.length;

        const tweens = this.scene.tweens;
        tweens.killTweensOf(ring);
        ring.setPosition(x, y);
        ring.setScale(0.55);
        ring.setAlpha(0.75);
        ring.setVisible(true);
        tweens.add({
            targets: ring,
            scaleX: 1.9,
            scaleY: 1.9,
            alpha: 0,
            duration: 560,
            ease: 'Quad.easeOut',
            onComplete: () => ring.setVisible(false)
        });
    }

    // ------------------------------------------------------------------
    // Todo frame (chamado DEPOIS de TurboFX.update, ver RaceScene.update)
    // ------------------------------------------------------------------
    update(time, delta) {
        if (!this.enabled) return;
        const view = this.scene.cameras.main.worldView;
        for (const spot of this.spots) {
            const visible = spot.puddle.x > view.x - 100 && spot.puddle.x < view.right + 100
                && spot.puddle.y > view.y - 100 && spot.puddle.y < view.bottom + 100;
            spot.aura.setVisible(visible); spot.sheen.setVisible(visible);
            if (!visible) continue;
            const pulse = 0.5 + 0.5 * Math.sin(time / 450 + spot.phase);
            spot.aura.setAlpha(0.42 + pulse * 0.22);
            spot.sheen.setAlpha(0.1 + pulse * 0.13)
                .setScale(spot.puddle.scaleX, spot.puddle.scaleY);
        }

        const car = this.car;
        const dt = Math.min(delta, 50) / 1000;
        const on = !!car.isOnOil && car.controlsEnabled !== false;
        const speed = car.body.speed;
        const speedFactor = Phaser.Math.Clamp(speed / car.baseMaxVelocity, 0, 1);

        if (on && !this.wasOn) this.onEnter(speedFactor);
        this.wasOn = on;

        // Película: sobe rápido, escorre devagar.
        const target = on ? 1 : 0;
        const rate = target > this.coat ? TUNING.coatRise : TUNING.coatFall;
        this.coat += (target - this.coat) * Math.min(1, rate * dt);
        if (this.coat < 0.005) this.coat = 0;

        if (on) this.emitOnOil(dt, speedFactor);
        this.emitTrail(speed, dt);
        this.applyCarTint();
    }

    emitOnOil(dt, speedFactor) {
        this.dropAcc += (TUNING.dropsBase + TUNING.dropsPerSpeed * speedFactor) * dt;
        this.glintAcc += (TUNING.glintsBase + TUNING.glintsPerSpeed * speedFactor) * dt;

        let n = 0;
        while (this.dropAcc >= 1 && n++ < 6) {
            this.dropAcc -= 1;
            const p = this.randomWheel();
            this.spray.explode(1, p.x, p.y);
        }
        this.dropAcc = Math.min(this.dropAcc, 1);

        n = 0;
        while (this.glintAcc >= 1 && n++ < 4) {
            this.glintAcc -= 1;
            const p = this.randomWheel();
            this.glint.explode(1, p.x, p.y);
        }
        this.glintAcc = Math.min(this.glintAcc, 1);
    }

    emitTrail(speed, dt) {
        if (this.coat <= 0.05 || speed < TUNING.trailMinSpeed) {
            this.trailDist = 0;
            return;
        }

        this.trailDist += speed * dt;
        let n = 0;
        while (this.trailDist >= TUNING.trailSpacing && n++ < 4) {
            this.trailDist -= TUNING.trailSpacing;
            // A película some aos poucos: menos marcas conforme `coat` cai.
            if (Math.random() > this.coat) continue;
            const left = this.wheelPos(-TUNING.wheelLong, -TUNING.wheelLat);
            const right = this.wheelPos(-TUNING.wheelLong, TUNING.wheelLat);
            this.trail.explode(1, left.x, left.y);
            this.trail.explode(1, right.x, right.y);
        }
        this.trailDist = Math.min(this.trailDist, TUNING.trailSpacing);
    }

    /**
     * Tinge o carro de violeta com a película de óleo. O canal de tint é
     * do TurboFX (ele limpa o tint todo frame quando nada está ativo), então
     * aqui só entramos quando turbo, drift e superaquecimento estão de fora:
     * as cores deles têm prioridade e nada é sobrescrito.
     */
    applyCarTint() {
        const car = this.car;
        if (this.coat <= 0.01) return;
        if (car.turboIntensity > 0.45 || car.isDrifting || car.isOverheated) return;

        const c = Math.min(1, this.coat * TUNING.tintStrength);
        const r = Math.round(255 + (TUNING.tintR - 255) * c);
        const g = Math.round(255 + (TUNING.tintG - 255) * c);
        const b = Math.round(255 + (TUNING.tintB - 255) * c);
        car.setTint(Phaser.Display.Color.GetColor(r, g, b));
    }
}
