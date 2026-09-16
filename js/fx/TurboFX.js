/**
 * TurboFX — todo o "feedback" do turbo num lugar só.
 *
 * REGRA DE OURO DESTE ARQUIVO: nada aqui liga ou desliga. Tudo é uma função
 * contínua de `car.turboIntensity` (0..1). Efeito que dá degrau denuncia que
 * é efeito; efeito que sobe e escorre junto com a turbina vira sensação.
 *
 * As camadas, de fora pra dentro:
 *
 *   1. PÓS-PROCESSAMENTO DE CÂMERA (Filters do Phaser 4)
 *      - Barrel: a imagem "estufa" nas bordas. É o velho truque de FOV dos
 *        jogos de corrida — a periferia corre mais que o centro.
 *      - Blur direcional: borrão no eixo do movimento. Entra tarde e fraco;
 *        borrão demais vira sujeira, não velocidade.
 *      - ColorMatrix: satura e clareia. O mundo "acende".
 *      - Vignette: tinge as bordas de magenta. Colore, quase não fecha.
 *
 * O bloco TUNING logo abaixo separa os efeitos que custam visão dos que não
 * custam. Se algo aqui ficar no caminho do jogador, é lá que se mexe.
 *
 *   2. CÂMERA (movimento, não shader)
 *      - Afasta o zoom (mais mundo na tela = mais rápido).
 *      - Micro-tremor contínuo via followOffset, proporcional à intensidade.
 *      - Solavanco de shake só no instante do acionamento.
 *
 *   3. MUNDO
 *      - Chamas e faíscas saindo do escapamento.
 *      - Rastro de "fantasmas" do carro (afterimage).
 *      - Glow no próprio sprite do carro.
 *
 *   4. TELA
 *      - Riscos de velocidade no eixo do movimento.
 *      - Flash no acionamento, piscada vermelha no superaquecimento.
 *      - Brilho do container HTML pulsando junto (ver style.css).
 *
 * Os filtros exigem WebGL. Se o renderer cair pra Canvas, a camada 1 é
 * simplesmente pulada e todo o resto continua funcionando.
 *
 * `worldObjects` e `uiObjects` existem porque o HUD vive numa câmera
 * separada: se o HUD passasse pelos mesmos filtros, o texto entortaria
 * junto com o mundo e ficaria ilegível justamente na hora em que você mais
 * precisa dele (olhando o tanque de turbo acabando).
 */
/**
 * Painel de ajuste.
 *
 * Os quatro primeiros valores mexem em QUANTO DA PISTA VOCÊ ENXERGA, e são os
 * únicos aqui que podem atrapalhar o jogo de verdade. Efeito que tira visão
 * numa curva não é estilo, é bug de design — então eles ficam separados dos
 * outros, com o teto baixo de propósito.
 *
 * Todos são o valor do efeito quando a intensidade está em 1 (turbo cheio).
 * Zerar qualquer um desliga aquele efeito sem quebrar nada.
 */
const TUNING = {
    // --- mexem na visão: subir com parcimônia ---
    barrel: 0.06,        // deformação nas bordas
    blur: 0.45,          // borrão direcional
    vignetteClose: 0.14, // o quanto a vinheta fecha
    streakAlpha: 0.26,   // opacidade dos riscos de velocidade

    // --- não atrapalham a leitura: pode exagerar à vontade ---
    zoomOut: 0.085,      // afasta a câmera (na verdade AUMENTA o campo de visão)
    saturation: 0.42,
    brightness: 0.12,
    hueShift: -7,
    rumble: 1.3,         // tremor em pixels
    glow: 6,             // brilho no carro
    ghostAlpha: 0.38     // opacidade do rastro
};

export default class TurboFX {
    constructor(scene, car) {
        this.scene = scene;
        this.car = car;
        this.cam = scene.cameras.main;

        this.baseZoom = this.cam.zoom;
        this.k = 0;          // intensidade atual, copiada do carro
        this.flashAlpha = 0; // decaimento do flash de acionamento
        this.heatShake = 0;  // decaimento do tranco de superaquecimento
        this._ghostTimer = 0;
        this._angleTimer = 0;
        this._ghostIndex = 0;

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
        if (!this.scene.renderer || !this.scene.renderer.gl) return;

        const list = this.cam.filters.internal;

        // Ordem importa: deforma -> borra -> colore -> escurece as bordas.
        this.fBarrel = list.addBarrel(1);
        this.fBlur = list.addBlur(1, 1, 0, 0, 0xffffff, 2);
        this.fColor = list.addColorMatrix();
        this.fVignette = list.addVignette(0.5, 0.5, 0.85, 0.35);

        this.filters = [this.fBarrel, this.fBlur, this.fColor, this.fVignette];

        // Custam GPU mesmo sem efeito nenhum aplicado, então ficam desligados
        // até o turbo encostar neles. A vinheta é a única sempre viva: um
        // pouco de escurecimento nas bordas ajuda a leitura o tempo todo.
        this.fBarrel.active = false;
        this.fBlur.active = false;
        this.fColor.active = false;

        this.colFrom = new Phaser.Display.Color(10, 12, 20);
        this.colTo = new Phaser.Display.Color(255, 45, 85);
        this.fVignette.setColor(0x0a0c14);
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
            tint: [0x00e5ff, 0x64f0ff, 0xff2d55],
            blendMode: 'ADD',
            frequency: 14,
            quantity: 2,
            emitting: false
        }).setDepth(990);

        // Faíscas: pequenas, rápidas, vida longa. São elas que dão a
        // impressão de que tem alguma coisa sofrendo lá dentro do motor.
        this.sparks = this.scene.add.particles(0, 0, 'fx-dot', {
            lifespan: { min: 300, max: 620 },
            speed: { min: 120, max: 340 },
            scale: { start: 0.28, end: 0 },
            alpha: { start: 1, end: 0 },
            tint: [0xffe066, 0xffffff, 0xff8a3d],
            blendMode: 'ADD',
            frequency: 26,
            quantity: 1,
            emitting: false
        }).setDepth(991);

        this.worldObjects.push(this.flame, this.sparks);
    }

    createGhosts() {
        // Pool fixo de fantasmas. Criar e destruir um sprite a cada 45ms em
        // velocidade máxima geraria lixo suficiente pra dar engasgo.
        this.ghosts = [];
        for (let i = 0; i < 12; i++) {
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
        if (this.scene.renderer && this.scene.renderer.gl && this.car.enableFilters) {
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
            frequency: 24,
            quantity: 2,
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
        this.sparks.explode(14, this.exhaustX(), this.exhaustY());
    }

    onStop() {
        // Alívio de pressão: uma cusparada de faísca ao soltar.
        this.sparks.explode(6, this.exhaustX(), this.exhaustY());
    }

    onOverheat() {
        // Estourou o tanque: tranco mais feio, faísca pra caramba, tela
        // pisca vermelho. Tem que doer um pouco pra você aprender a dosar.
        this.heatShake = 1;
        this.flashAlpha = 0.30;
        this.flash.fillColor = 0xff2d55;
        this.cam.shake(320, 0.010);
        this.sparks.explode(34, this.exhaustX(), this.exhaustY());
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
        const dt = delta / 1000;

        // --- Pós-processamento ---
        if (this.filters) {
            if (k > 0.004) {
                this.fBarrel.active = true;
                this.fBlur.active = true;
                this.fColor.active = true;

                // Estufa a imagem — mas de leve. Acima de ~1.10 as bordas
                // começam a esconder o que vem chegando, e num jogo em que
                // você vê a pista de cima isso é informação perdida.
                this.fBarrel.amount = 1 + TUNING.barrel * k;

                // Borrão no eixo do movimento, reaproveitando a direção pra
                // onde o carro já aponta.
                const dir = car.rotation - Math.PI / 2;
                this.fBlur.x = Math.abs(Math.cos(dir)) + 0.15;
                this.fBlur.y = Math.abs(Math.sin(dir)) + 0.15;
                // Cúbico, não quadrático: assim o borrão fica praticamente
                // invisível até uns 70% de turbo e só marca presença no pico.
                // O blur é o efeito que mais suja a imagem por unidade de
                // "sensação", então ele é o primeiro a levar corte.
                this.fBlur.strength = TUNING.blur * k * k * k;

                // Atenção: os helpers (saturate/brightness/hue) ficam em
                // `.colorMatrix`, não no controller — o controller só carrega
                // a matriz. `false` no primeiro reseta a matriz, `true` nos
                // seguintes acumula em cima dela.
                const cm = this.fColor.colorMatrix;
                cm.saturate(TUNING.saturation * k, false);
                cm.brightness(1 + TUNING.brightness * k, true);
                cm.hue(TUNING.hueShift * k, true);
            } else {
                this.fBarrel.active = false;
                this.fBlur.active = false;
                this.fColor.active = false;
            }

            // Vinheta: antes ela fechava de 0.85 pra 0.45, o que comia um
            // pedaço grande dos cantos — e é nos cantos que aparece a curva
            // seguinte. Agora ela quase não fecha; o trabalho dela passou a
            // ser COLORIR a borda de magenta em vez de escondê-la. Dá o mesmo
            // recado de "túnel" sem cobrar visão por isso.
            this.fVignette.radius = 0.88 - TUNING.vignetteClose * k;
            this.fVignette.strength = 0.30 + 0.32 * k;
            this.fVignette.setColor(
                Phaser.Display.Color.Interpolate.ColorWithColor(
                    this.colFrom, this.colTo, 100, Math.round(k * 100)
                )
            );
        }

        // --- Câmera ---
        // Zoom pra trás = mais mundo entrando na tela. Note que este é o
        // único efeito da lista que AUMENTA o que você enxerga, então ele
        // subiu um pouco justamente pra compensar os outros que desceram.
        const targetZoom = this.baseZoom - TUNING.zoomOut * k;
        this.cam.zoom += (targetZoom - this.cam.zoom) * Math.min(1, 6 * dt);

        // Tremor menor: sacudir a tela enquanto o jogador está mirando uma
        // curva é o tipo de "juice" que atrapalha mais do que entrega.
        const rumble = TUNING.rumble * k + 5 * this.heatShake;
        if (rumble > 0.05) {
            this.cam.setFollowOffset(
                Phaser.Math.FloatBetween(-rumble, rumble),
                Phaser.Math.FloatBetween(-rumble, rumble)
            );
        } else {
            this.cam.setFollowOffset(0, 0);
        }
        this.heatShake = Math.max(0, this.heatShake - dt * 2.4);

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
            this.flame.frequency = 22 - 16 * k;
            this.flame.setParticleLifespan(180 + 220 * k);
        }

        // --- Fantasmas ---
        this._ghostTimer -= delta;
        if (k > 0.3 && this._ghostTimer <= 0) {
            this._ghostTimer = 42;
            const g = this.ghosts[this._ghostIndex];
            this._ghostIndex = (this._ghostIndex + 1) % this.ghosts.length;

            this.scene.tweens.killTweensOf(g);
            g.setPosition(car.x, car.y)
                .setRotation(car.rotation)
                .setScale(1)
                .setTint(0x00e5ff)
                .setAlpha(TUNING.ghostAlpha * k)
                .setVisible(true);

            this.scene.tweens.add({
                targets: g,
                alpha: 0,
                scaleX: 1.12,
                scaleY: 1.12,
                duration: 260,
                onComplete: () => g.setVisible(false)
            });
        }

        // --- Glow do carro ---
        if (this.carGlow) {
            this.carGlow.active = k > 0.01;
            if (this.carGlow.active) {
                // Pulsa: brilho constante vira adesivo; brilho que respira
                // vira motor.
                const pulse = 0.82 + 0.18 * Math.sin(time * 0.028);
                this.carGlow.outerStrength = TUNING.glow * k * pulse;
                this.carGlow.color = k > 0.6 ? 0xff2d55 : 0x00e5ff;
            } else {
                this.carGlow.outerStrength = 0;
            }
        }

        // Tint do carro: drift e turbo disputavam o mesmo canal, então a
        // prioridade é resolvida aqui, num lugar só.
        if (k > 0.45) {
            car.setTint(0xfff0a8);
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
            this.streaks.frequency = 42 - 24 * k;

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
        if (this.container) {
            this.container.style.setProperty('--turbo', k.toFixed(3));
        }
    }

    destroy() {
        if (this.container) this.container.style.setProperty('--turbo', '0');
        if (this.cam) {
            this.cam.setFollowOffset(0, 0);
            this.cam.zoom = this.baseZoom;
        }
    }
}
