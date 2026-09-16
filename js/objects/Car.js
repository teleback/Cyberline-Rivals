export default class Car extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, texture) {
        super(scene, x, y, texture);

        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.setOrigin(0.5, 0.5);
        // As paredes da pista vêm da camada "colisao" do Tiled (ver
        // RaceScene), então não usamos o retângulo genérico dos limites do
        // mundo pra colisão do carro.
        this.setCollideWorldBounds(false);
        this.setBounce(0.2);

        // Por padrão o corpo de física usa o frame INTEIRO da imagem
        // (64x64), mas o desenho do carro em si só ocupa ~26x47 no centro
        // do frame — o resto é fundo transparente. Sem ajustar isso, o
        // carro colide com a parede da camada "colisao" bem antes de
        // encostar nela visualmente. Usamos um círculo (em vez de um
        // retângulo) porque o Arcade Physics não rotaciona o corpo de
        // colisão junto com o sprite: um retângulo fixo desalinharia da
        // silhueta real do carro conforme ele vira; um círculo tem a mesma
        // forma em qualquer ângulo.
        this.body.setCircle(14, 18, 20);

        // Modo "damping" simula atrito: o carro perde velocidade aos poucos
        // em vez de parar instantaneamente ao soltar a seta.
        this.setDamping(true);
        this.setDrag(0.92);
        this.setMaxVelocity(340);

        this.acceleration = 460;
        this.turnSpeed = 230; // graus por segundo

        // Aderência dos pneus: fração da velocidade LATERAL (de lado) que
        // sobra depois de 1 segundo. Quanto menor, mais o carro "gruda" na
        // direção em que está apontando em vez de escorregar tipo no gelo.
        this.grip = 0.05;

        // Só vira em velocidade proporcional (parado, quase não vira;
        // em alta velocidade, vira na força total). Evita giro "de pião" parado.
        this.minTurnFactor = 0.35;

        // --- Freio / Ré ---
        // Se o carro está andando pra frente e aperta pra baixo, freia (força
        // de frenagem forte, maior que a aceleração normal). Só quando quase
        // parado é que "baixo" passa a empurrar o carro de ré.
        this.brakeDeceleration = 900;
        this.reverseAcceleration = 260;
        this.reverseMaxSpeed = 140;
        this.stoppedThreshold = 12; // abaixo disso já considera "parado" pra engatar ré

        // --- Drift ---
        // Frear + virar em alta velocidade solta um pouco o pneu de trás:
        // menos aderência (desliza mais de lado) mas vira mais fechado.
        this.normalGrip = this.grip;
        this.driftGrip = 0.35;
        this.driftMinSpeedFactor = 0.45; // % da vel. máx. atual pra poder driftar
        this.driftTurnBoost = 1.35;
        this.isDrifting = false;

        // ------------------------------------------------------------------
        // TURBO
        // ------------------------------------------------------------------
        // A ideia por trás do turbo agora não é só "mais rápido enquanto
        // segura SHIFT". Ele tem uma CURVA, e é essa curva que os efeitos
        // visuais leem. Três valores diferentes, cada um com um trabalho:
        //
        //   turboFuel      -> o recurso (0..100), o que o HUD mostra.
        //   turboSpool     -> o quanto a turbina já "encheu" (0..1). Sobe em
        //                     ~0.9s de uso contínuo. É o que multiplica a
        //                     física, então o empurrão CRESCE enquanto você
        //                     segura, em vez de ligar/desligar num degrau.
        //   turboIntensity -> a mesma coisa, mas suavizada pros efeitos
        //                     (0..1). Sobe rápido e cai devagar, pra imagem
        //                     "escorrer" de volta ao normal no lugar de dar
        //                     um corte seco quando solta o SHIFT.
        //
        // E tem punição: se esvaziar o tanque até o fim, o motor SUPERAQUECE,
        // trava o turbo por um tempo e recarrega mais devagar. Isso é o que
        // transforma o turbo numa decisão ("uso agora ou guardo?") em vez de
        // um botão que se segura o tempo todo.
        this.turboFuel = 100;
        this.turboMax = 100;
        this.turboDrainPerSec = 34;
        this.turboRechargePerSec = 15;
        this.turboRechargeDelay = 550;   // ms de espera antes de voltar a encher
        this.turboMinToActivate = 18;    // precisa de um mínimo pra começar a usar
        this.turboAccelMultiplier = 2.0;
        this.turboMaxVelMultiplier = 1.45;
        this.turboSpoolPerSec = 1.1;     // ~0.9s pra atingir o empurrão total
        this.turboKick = 120;            // "soco" instantâneo ao acionar
        this.overheatDuration = 1800;    // ms travado depois de estourar o tanque

        this.baseAcceleration = this.acceleration;
        this.baseMaxVelocity = 340;

        this.isTurboActive = false;
        this.turboSpool = 0;
        this.turboIntensity = 0;
        this.isOverheated = false;
        this._overheatUntil = 0;
        this._rechargeAfter = 0;

        this.keyShift = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

        this.cursors = scene.input.keyboard.createCursorKeys();
    }

    /** Velocidade em "km/h" só pra leitura no HUD. */
    get speedKmh() {
        return Math.round(this.body.speed * 0.42);
    }

    update(time, delta) {
        const { left, right, up, down } = this.cursors;
        const seconds = delta / 1000;

        // Vetor apontando pra onde o nariz do carro está virado. Serve pro
        // freio/ré, pro drift e pro empurrão do turbo.
        const forward = this.scene.physics.velocityFromRotation(this.rotation - Math.PI / 2, 1);
        const forwardSpeed = this.body.velocity.dot(forward);

        this.updateTurbo(time, seconds, up.isDown, forward);

        this.isDrifting = down.isDown
            && (left.isDown || right.isDown)
            && forwardSpeed > this.body.maxVelocity.x * this.driftMinSpeedFactor;

        const speedFactor = Phaser.Math.Clamp(
            this.body.speed / this.body.maxVelocity.x, 0, 1
        );
        let turnFactor = this.minTurnFactor + (1 - this.minTurnFactor) * speedFactor;
        if (this.isDrifting) turnFactor *= this.driftTurnBoost;
        // Em turbo o carro fica mais "duro" de virar: em alta velocidade você
        // não joga o volante à vontade, e isso faz o turbo PARECER rápido
        // (tem custo) em vez de só andar mais.
        turnFactor *= 1 - 0.28 * this.turboSpool;

        if (left.isDown) {
            this.setAngularVelocity(-this.turnSpeed * turnFactor);
        } else if (right.isDown) {
            this.setAngularVelocity(this.turnSpeed * turnFactor);
        } else {
            this.setAngularVelocity(0);
        }

        if (up.isDown) {
            // A imagem do carro1 aponta "pra cima" por padrão, por isso o
            // ajuste de -90 graus (Math.PI / 2) no ângulo de movimento.
            this.scene.physics.velocityFromRotation(
                this.rotation - Math.PI / 2,
                this.acceleration,
                this.body.acceleration
            );
        } else if (down.isDown) {
            if (forwardSpeed > this.stoppedThreshold) {
                // Ainda andando pra frente: freia (desacelera forte), não
                // engata ré ainda.
                this.scene.physics.velocityFromRotation(
                    this.rotation - Math.PI / 2,
                    -this.brakeDeceleration,
                    this.body.acceleration
                );
            } else if (forwardSpeed > -this.reverseMaxSpeed) {
                // Já parou (ou está de ré abaixo do limite): acelera de ré.
                this.scene.physics.velocityFromRotation(
                    this.rotation - Math.PI / 2,
                    -this.reverseAcceleration,
                    this.body.acceleration
                );
            } else {
                this.body.acceleration.set(0);
            }
        } else {
            this.body.acceleration.set(0);
        }

        // Pneu solta durante o drift (mais deslize lateral); volta ao normal
        // assim que solta o freio ou os direcionais. No turbo o pneu também
        // solta um tiquinho — carro "leve" na frente.
        this.grip = this.isDrifting ? this.driftGrip : this.normalGrip;
        if (this.isTurboActive) this.grip = Math.max(this.grip, 0.12 * this.turboSpool);

        this.applyGrip(delta);
    }

    updateTurbo(time, seconds, throttleDown, forward) {
        // Saiu do superaquecimento?
        if (this.isOverheated && time >= this._overheatUntil) {
            this.isOverheated = false;
            this.emit('turbo-cooled');
        }

        // Pra LIGAR exige um mínimo no tanque; pra MANTER ligado basta ter
        // qualquer coisa. Sem isso o turbo ficaria piscando ligado/desligado
        // exatamente no limiar, e todo o efeito visual piscaria junto.
        const wantsTurbo = this.keyShift.isDown && throttleDown && !this.isOverheated;
        const canStart = this.turboFuel >= this.turboMinToActivate;
        const shouldBeActive = wantsTurbo && (this.isTurboActive ? this.turboFuel > 0 : canStart);

        if (shouldBeActive && !this.isTurboActive) {
            // Acionou agora: dá um soco de velocidade na hora. É esse
            // impulso instantâneo que o jogador SENTE; a rampa vem depois.
            this.body.velocity.add(forward.clone().scale(this.turboKick));
            this.emit('turbo-start');
        } else if (!shouldBeActive && this.isTurboActive) {
            if (this.turboFuel <= 0) {
                this.isOverheated = true;
                this._overheatUntil = time + this.overheatDuration;
                this.emit('turbo-overheat');
            } else {
                this.emit('turbo-stop');
            }
        }

        this.isTurboActive = shouldBeActive;

        if (this.isTurboActive) {
            this.turboFuel = Math.max(0, this.turboFuel - this.turboDrainPerSec * seconds);
            this.turboSpool = Math.min(1, this.turboSpool + this.turboSpoolPerSec * seconds);
            this._rechargeAfter = time + this.turboRechargeDelay;
        } else {
            // Desce a turbina rápido, mas não instantaneamente.
            this.turboSpool = Math.max(0, this.turboSpool - this.turboSpoolPerSec * 1.8 * seconds);
            if (time >= this._rechargeAfter && this.turboFuel < this.turboMax) {
                // Recarrega pela metade enquanto o motor está fervendo.
                const rate = this.isOverheated ? this.turboRechargePerSec * 0.5 : this.turboRechargePerSec;
                this.turboFuel = Math.min(this.turboMax, this.turboFuel + rate * seconds);
            }
        }

        // Intensidade suavizada: é ela (e só ela) que os efeitos consomem.
        // Sobe rápido pra o impacto ser imediato, desce devagar pra sobrar
        // um "rastro" de adrenalina depois que solta.
        const target = this.isTurboActive ? this.turboSpool : 0;
        const rate = target > this.turboIntensity ? 7.0 : 2.6;
        this.turboIntensity += (target - this.turboIntensity) * Math.min(1, rate * seconds);
        if (this.turboIntensity < 0.001) this.turboIntensity = 0;

        this.acceleration = this.baseAcceleration
            * (1 + (this.turboAccelMultiplier - 1) * this.turboSpool);
        this.setMaxVelocity(
            this.baseMaxVelocity * (1 + (this.turboMaxVelMultiplier - 1) * this.turboSpool)
        );
    }

    // Separa a velocidade atual em componente "pra frente" (na direção que
    // o carro está apontando) e "lateral", e derruba a lateral rapidamente.
    // Isso é o que dá a sensação de pneu grudando no chão em vez de deslizar.
    applyGrip(delta) {
        const forward = this.scene.physics.velocityFromRotation(this.rotation - Math.PI / 2, 1);
        const velocity = this.body.velocity;

        const forwardSpeed = velocity.dot(forward);
        const forwardVelocity = forward.clone().scale(forwardSpeed);
        const lateralVelocity = velocity.clone().subtract(forwardVelocity);

        const seconds = delta / 1000;
        lateralVelocity.scale(Math.pow(this.grip, seconds));

        velocity.set(forwardVelocity.x + lateralVelocity.x, forwardVelocity.y + lateralVelocity.y);
    }
}
