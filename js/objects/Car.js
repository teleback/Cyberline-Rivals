import { HANDLING, MOBILE_HANDLING, createHandlingState, stepHandling } from './CarHandling.js';
import { readGamepad, calibrateIfNeeded } from '../input/GamepadInput.js';
import { readTouch } from '../input/TouchControls.js';

export const OIL_SETTINGS = { entryRetention: 0.65, speedRetention: 0.22, minDecel: 160, minSpeed: 70 };

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

        // Por padrão o corpo de física usa o frame INTEIRO da imagem
        // (64x64), mas o desenho do carro em si só ocupa ~26x47 no centro
        // do frame — o resto é fundo transparente. Sem ajustar isso, o
        // carro colide com a parede da camada "colisao" bem antes de
        // encostar nela visualmente. Usamos um círculo (em vez de um
        // retângulo) porque o Arcade Physics não rotaciona o corpo de
        // colisão junto com o sprite: um retângulo fixo desalinharia da
        // silhueta real do carro conforme ele vira; um círculo tem a mesma
        // forma em qualquer ângulo.
        // ATUALIZAÇÃO: o sprite agora é 102x166 (não mais 64x64) e o desenho
        // do carro ocupa x=18..81, y=21..139 do frame (centro em ~49.5, 80).
        // O círculo antigo (raio 14, offset 18/20) ficava ~46px ACIMA e ~17px
        // à ESQUERDA do carro de verdade — por isso o carro "passava por cima"
        // de barril e de óleo: a física estava em outro lugar. Agora o círculo
        // é centrado na silhueta. Ajuste CAR_HITBOX_RADIUS se quiser o carro
        // mais "gordo" (colide antes) ou mais "magro" (folga nas paredes).
        const CAR_HITBOX_RADIUS = 24;
        const CAR_CENTER_X = 49.5, CAR_CENTER_Y = 80;
        this.body.setCircle(
            CAR_HITBOX_RADIUS,
            CAR_CENTER_X - CAR_HITBOX_RADIUS,
            CAR_CENTER_Y - CAR_HITBOX_RADIUS
        );

        // O controlador resolve tração e resistência uma única vez por frame.
        // O Arcade mantém integração da posição, rotação e colisões.
        this.setDamping(false);
        this.setDrag(0);
        this.setMaxVelocity(1400); // segurança; o limite real é circular
        this.setBounce(0.08);
        this.acceleration = HANDLING.acceleration;
        this.turnSpeed = HANDLING.turnSpeed;
        this.stoppedThreshold = HANDLING.stoppedThreshold;
        this.reverseMaxSpeed = HANDLING.reverseMaxSpeed;
        this.handling = createHandlingState();
        this.isDrifting = false;
        this.isBraking = false;
        this.tireSlip = 0;
        this.lastDriveSpeed = 0;
        this.contact = null;

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
        this.turboDrainPerSec = 25;      // tanque cheio agora dura ~4s (era ~2.9s)
        this.turboRechargePerSec = 15;
        this.turboRechargeDelay = 550;   // ms de espera antes de voltar a encher
        this.turboMinToActivate = 18;    // precisa de um mínimo pra começar a usar
        this.turboAccelMultiplier = 2.0;
        this.turboMaxVelMultiplier = 1.45;
        this.turboSpoolPerSec = 1.1;     // ~0.9s pra atingir o empurrão total
        this.turboKick = 65;             // impulso dosado pela velocidade
        this.overheatDuration = 1800;    // ms travado depois de estourar o tanque

        this.baseAcceleration = this.acceleration;
        this.baseMaxVelocity = HANDLING.maxSpeed;
        this.maxDriveSpeed = this.baseMaxVelocity;

        this.isTurboActive = false;
        this.turboSpool = 0;
        this.turboIntensity = 0;
        this.isOverheated = false;
        this._overheatUntil = 0;
        this._rechargeAfter = 0;
        this._turboBlockedUntil = 0;

        // Boosts desenhados na camada "Cyber placa" do tilemap.
        this.trackBoostMultiplier = 1.45;
        this.trackBoostDuration = 1400;
        this.trackBoostUntil = 0;
        this.isTrackBoostActive = false;

        this.keyShift = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

        this.cursors = scene.input.keyboard.createCursorKeys();

        // Primeira vez com controle conectado: pede pra apertar L e R.
        calibrateIfNeeded();

        // Trava geral: usada pelo CarDropIn pra impedir o jogador de acelerar
        // enquanto o carro ainda está "caindo" na animação de entrada.
        this.controlsEnabled = true;
        this.networkControls = {
            throttle: false,
            brake: false,
            left: false,
            right: false,
            turbo: false,
            braking: false,
            drifting: false
        };

        // --- Zona de óleo ---
        // Enquanto o carro está EM CIMA de uma mancha (a RaceScene liga
        // `isOnOil` a cada frame), existe um TETO de velocidade que
        // reduz a velocidade na entrada e vai caindo, mas nunca abaixo
        // de `oilMinSpeed`. Resultado: o carro perde velocidade de forma
        // perceptível, e continua andando. Não existe deslize:
        // grip e direção ficam normais, e o teto só ESCALA o vetor de
        // velocidade (sentido preservado, nunca aumenta). Saiu da mancha
        // -> o teto é descartado no frame seguinte e tudo volta ao normal.
        this.isOnOil = false;
        this._oilSpeedCap = null;
        // Fração do teto que SOBRA após 1s no óleo (perda proporcional).
        this.oilEntryRetention = OIL_SETTINGS.entryRetention;
        this.oilSpeedRetention = OIL_SETTINGS.speedRetention;
        // Perda fixa extra (px/s²): mantém a freada perceptível também
        // em velocidades mais baixas.
        this.oilMinDecel = OIL_SETTINGS.minDecel;
        // Piso do teto (px/s, ~29 km/h no HUD): o óleo nunca para o carro.
        this.oilMinSpeed = OIL_SETTINGS.minSpeed;
    }

    /** Velocidade em "km/h" só pra leitura no HUD. */
    get speedKmh() {
        return Math.round(this.body.speed * 0.42);
    }

    update(time, delta) {
        if (!this.controlsEnabled) {
            const forward = this.scene.physics.velocityFromRotation(this.rotation - Math.PI / 2, 1);
            this.updateTurbo(time, Math.min(delta / 1000, 0.1), false, forward);
            this.handling = createHandlingState();
            this.isDrifting = false;
            this.isBraking = false;
            this.tireSlip = 0;
            this.lastDriveSpeed = 0;
            this.contact = null;
            this.setVelocity(0, 0);
            this.body.acceleration.set(0, 0);
            this.setAngularVelocity(0);
            this.networkControls = {
                throttle: false, brake: false, left: false, right: false,
                turbo: false, drifting: false, braking: false
            };
            return;
        }

        const pad = readGamepad();
        const touch = readTouch();
        const brake = this.cursors.down.isDown || pad.down || touch.down;
        const throttle = (this.cursors.up.isDown || pad.up || touch.up) && !brake;
        const keyboardSteer = Number(this.cursors.right.isDown) - Number(this.cursors.left.isDown);
        const heading = keyboardSteer || pad.steering ? null : touch.heading;
        const steering = keyboardSteer || pad.steering || touch.steering || 0;
        this.padTurbo = pad.turbo || touch.turbo;
        const seconds = Math.min(delta / 1000, 0.1);
        const forward = this.scene.physics.velocityFromRotation(this.rotation - Math.PI / 2, 1);
        const forwardSpeed = this.body.velocity.dot(forward);
        this.updateTurbo(time, seconds, throttle && forwardSpeed >= 0, forward);

        const motion = stepHandling(this.handling, {
            vx: this.body.velocity.x, vy: this.body.velocity.y, rotation: this.rotation,
            acceleration: this.acceleration, maxSpeed: this.maxDriveSpeed,
        }, { steering, throttle, brake, heading }, seconds, touch.mobile ? MOBILE_HANDLING : HANDLING);
        // Depois da batida, não empurra de novo contra a mesma superfície.
        // A ré e a direção para longe dela continuam liberadas.
        if (this.contact && time < this.contact.until) {
            const { x: nx, y: ny } = this.contact;
            // O pneu não cancela o desvio lateral da batida no frame seguinte.
            // Frear libera essa assistência imediatamente para facilitar a ré.
            if (throttle && forwardSpeed >= -this.stoppedThreshold) {
                const tx = -ny, ty = nx;
                const along = this.body.velocity.x * tx + this.body.velocity.y * ty;
                const after = motion.vx * tx + motion.vy * ty;
                const retained = along * Math.exp(-3 * seconds);
                if (after * along >= 0 && Math.abs(retained) > Math.abs(after)) {
                    motion.vx += tx * (retained - after);
                    motion.vy += ty * (retained - after);
                }
            }
            const into = motion.vx * nx + motion.vy * ny;
            if (into < 0) {
                const outward = Math.max(0, this.body.velocity.x * nx + this.body.velocity.y * ny);
                motion.vx += nx * (outward - into);
                motion.vy += ny * (outward - into);
            }
            this.handling.driftAmount = 0;
            this.handling.drifting = false;
            motion.isDrifting = false;
        }
        this.setVelocity(motion.vx, motion.vy);
        this.body.acceleration.set(0, 0);
        this.setAngularVelocity(motion.angularVelocity);
        this.isDrifting = motion.isDrifting;
        this.isBraking = motion.braking;
        this.tireSlip = motion.slip;
        this.networkControls = {
            throttle: motion.throttle, brake, left: this.handling.steering < -0.05,
            right: this.handling.steering > 0.05, turbo: this.isTurboActive,
            drifting: this.isDrifting, braking: this.isBraking,
        };

        if (this.isOnOil) this.applyOilDeceleration(seconds);
        else this._oilSpeedCap = null;
        this.lastDriveSpeed = this.body.velocity.length();
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
        const wantsTurbo = (this.keyShift.isDown || this.padTurbo) && throttleDown && !this.isOverheated
            && time >= this._turboBlockedUntil;
        const canStart = this.turboFuel >= this.turboMinToActivate;
        const shouldBeActive = wantsTurbo && (this.isTurboActive ? this.turboFuel > 0 : canStart);

        if (shouldBeActive && !this.isTurboActive) {
            // Acionou agora: dá um soco de velocidade na hora. É esse
            // impulso instantâneo que o jogador SENTE; a rampa vem depois.
            const launchFactor = 0.35 + 0.65 * Math.min(1, this.body.speed / this.baseMaxVelocity);
            const kickLimit = this.baseMaxVelocity
                * (1 + (this.turboMaxVelMultiplier - 1) * Math.max(0.2, this.turboSpool))
                * (time < this.trackBoostUntil ? this.trackBoostMultiplier : 1);
            const kick = Math.min(this.turboKick * launchFactor,
                Math.max(0, kickLimit - this.body.velocity.length()));
            this.body.velocity.add(forward.clone().scale(kick));
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
        this.isTrackBoostActive = time < this.trackBoostUntil;
        const trackBoostMultiplier = this.isTrackBoostActive
            ? this.trackBoostMultiplier
            : 1;
        this.maxDriveSpeed = this.baseMaxVelocity
            * (1 + (this.turboMaxVelMultiplier - 1) * this.turboSpool)
            * trackBoostMultiplier;
    }

    activateTrackBoost(time) {
        this.trackBoostUntil = time + this.trackBoostDuration;
        this.isTrackBoostActive = true;

        const forward = this.scene.physics.velocityFromRotation(this.rotation - Math.PI / 2, 1);
        const forwardSpeed = this.body.velocity.dot(forward);
        if (forwardSpeed > 0) {
            const limit = this.baseMaxVelocity
                * (1 + (this.turboMaxVelMultiplier - 1) * this.turboSpool) * this.trackBoostMultiplier;
            const kick = Math.min(forwardSpeed * (this.trackBoostMultiplier - 1),
                Math.max(0, limit - this.body.velocity.length()));
            this.body.velocity.add(forward.scale(kick));
        }

        this.emit('track-boost-start');
    }

    /**
     * Desaceleração da zona de óleo, aplicada todo frame em que o carro
     * está sobre a mancha. Mantém um teto de velocidade que já começa
     * reduzido na entrada e cai (proporcional + fixo) até no mínimo
     * `oilMinSpeed`; se o carro estiver acima do teto, o vetor de
     * velocidade é escalado até ele. Como o piso é maior que zero, o
     * carro nunca fica parado (e um carro parado ainda consegue sair do
     * óleo acelerando até o piso). Direção intacta, velocidade nunca
     * sobe além da de entrada.
     */
    applyOilDeceleration(seconds) {
        const speed = this.body.velocity.length();

        if (this._oilSpeedCap === null) {
            this._oilSpeedCap = Math.max(speed * this.oilEntryRetention, this.oilMinSpeed);
        }

        this._oilSpeedCap = Math.max(
            this.oilMinSpeed,
            this._oilSpeedCap * Math.pow(this.oilSpeedRetention, seconds)
                - this.oilMinDecel * seconds
        );

        if (speed > this._oilSpeedCap) {
            this.body.velocity.scale(this._oilSpeedCap / speed);
        }
    }

}
