/**
 * CarDropIn — o carro "cai" na pista quando a corrida começa, em vez de já
 * aparecer parado em cima da linha de largada.
 *
 * É puramente visual: a física do carro fica DESLIGADA (`body.enable =
 * false`) durante a queda, então não colide com nada no caminho, e os
 * controles ficam travados (`car.controlsEnabled = false`, ver Car.js) pra
 * o jogador não conseguir acelerar enquanto o carro ainda está "no ar".
 * Os dois só voltam no instante do impacto.
 */
export default class CarDropIn {
    constructor(scene, car) {
        this.scene = scene;
        this.car = car;
        this.createTextures();
    }

    // Sombra: elipse preta simples, sem PNG novo — mesma lógica das texturas
    // geradas na mão do TurboFX.
    createTextures() {
        const tex = this.scene.textures;
        if (!tex.exists('fx-shadow')) {
            const g = this.scene.make.graphics({ x: 0, y: 0, add: false });
            g.fillStyle(0x000000, 1);
            g.fillEllipse(40, 16, 80, 32);
            g.generateTexture('fx-shadow', 80, 32);
            g.destroy();
        }
    }

    /**
     * Toca a queda. x/y são a posição final (a linha de largada).
     * `onLand` é chamado no instante do impacto — a RaceScene usa isso pra
     * encadear a contagem regressiva antes de destravar os controles.
     */
    play(x, y, opts = {}) {
        const scene = this.scene;
        const car = this.car;
        const dropHeight = opts.dropHeight ?? 340;
        const duration = opts.duration ?? 580;
        this.onLand = opts.onLand ?? null;

        car.controlsEnabled = false;
        car.body.enable = false;
        car.setPosition(x, y - dropHeight);
        car.setScale(0.4);
        car.setAlpha(0.9);

        // Sombra no chão, no ponto exato de pouso: nasce pequena e clara,
        // cresce e escurece conforme o carro "se aproxima" — é essa dupla
        // (carro encolhido em cima + sombra crescendo embaixo) que vende a
        // sensação de altura sem precisar de uma câmera 3D de verdade.
        const shadow = scene.add.image(x, y, 'fx-shadow')
            .setDepth(car.depth - 1)
            .setAlpha(0)
            .setScale(0.15);
        if (scene.uiCam) scene.uiCam.ignore(shadow);

        scene.tweens.add({
            targets: shadow,
            alpha: 0.5,
            scaleX: 1,
            scaleY: 1,
            duration,
            ease: 'Cubic.easeIn'
        });

        // Queda acelerando (easeIn) — devagar no começo, rápido no fim,
        // igual peso caindo de verdade.
        scene.tweens.add({
            targets: car,
            y,
            scaleX: 1,
            scaleY: 1,
            alpha: 1,
            duration,
            ease: 'Cubic.easeIn',
            onComplete: () => this.land(x, y, shadow)
        });
    }

    land(x, y, shadow) {
        const scene = this.scene;
        const car = this.car;

        // Tudo aqui dentro é só efeito visual (câmera, poeira, "achatada").
        // Um try/catch garante que, se QUALQUER coisa aqui der erro (efeito
        // gráfico não suportado, etc.), o jogo não trava com o carro parado
        // pra sempre — o onLand() do finally sempre dispara.
        try {
            // `body.reset` religa a física já na posição certa e zera
            // qualquer velocidade residual — sem isso o corpo físico ficaria
            // "grudado" no ponto onde foi desligado, lá em cima.
            car.body.enable = true;
            car.body.reset(x, y);

            scene.cameras.main.shake(200, 0.014);

            // "Achatada" de impacto: esparrama de lado e afunda na vertical
            // por um instante antes de voltar ao normal.
            scene.tweens.add({
                targets: car,
                scaleX: 1.22,
                scaleY: 0.76,
                duration: 90,
                yoyo: true,
                ease: 'Quad.easeOut',
                onComplete: () => car.setScale(1)
            });

            shadow.destroy();
            this.spawnDust(x, y);
        } catch (e) {
            console.error('CarDropIn: efeito de pouso falhou', e);
            car.body.enable = true;
            car.setScale(1);
        } finally {
            // Os controles só voltam depois da contagem regressiva — quem
            // decide a hora exata é o callback (ver RaceScene.startCountdown).
            if (this.onLand) this.onLand();
        }
    }

    spawnDust(x, y) {
        const scene = this.scene;
        // Reaproveita a textura de partícula do TurboFX (já existe a essa
        // altura, já que o TurboFX é criado antes do intro na cena).
        if (!scene.textures.exists('fx-dot')) return;

        const dust = scene.add.particles(x, y, 'fx-dot', {
            lifespan: 420,
            speed: { min: 60, max: 200 },
            scale: { start: 0.9, end: 0 },
            alpha: { start: 0.5, end: 0 },
            tint: 0xcfc9b8,
            quantity: 18,
            emitting: false
        }).setDepth(this.car.depth - 1);
        if (scene.uiCam) scene.uiCam.ignore(dust);

        dust.explode(18, x, y);
        scene.time.delayedCall(500, () => dust.destroy());
    }
}
