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

        // --- Turbo ---
        // Tanque de turbo de 0 a 100. Segurando SHIFT, o carro acelera mais
        // e ganha mais velocidade máxima, mas consome o tanque. Sem apertar,
        // o tanque recarrega sozinho aos poucos.
        this.turboFuel = 100;
        this.turboMax = 100;
        this.turboDrainPerSec = 40;   // esvazia em 2.5s de uso contínuo
        this.turboRechargePerSec = 12; // recarrega em ~8.3s parado de turbo
        this.turboMinToActivate = 15; // precisa de um mínimo pra começar a usar
        this.turboAccelMultiplier = 1.8;
        this.turboMaxVelMultiplier = 1.4;
        this.baseAcceleration = this.acceleration;
        this.baseMaxVelocity = 340;
        this.isTurboActive = false;

        this.keyShift = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

        this.cursors = scene.input.keyboard.createCursorKeys();
    }

    update(time, delta) {
        const { left, right, up, down } = this.cursors;
        const seconds = delta / 1000;

        // Ativa turbo só se estiver acelerando pra frente, com combustível
        // suficiente, e soltando o turbo automaticamente ao esvaziar.
        const wantsTurbo = this.keyShift.isDown && up.isDown;
        this.isTurboActive = wantsTurbo && this.turboFuel > 0;

        if (this.isTurboActive) {
            this.turboFuel = Math.max(0, this.turboFuel - this.turboDrainPerSec * seconds);
        } else if (this.turboFuel < this.turboMax) {
            this.turboFuel = Math.min(this.turboMax, this.turboFuel + this.turboRechargePerSec * seconds);
        }

        const turboOn = this.isTurboActive && this.turboFuel > 0;
        this.acceleration = turboOn ? this.baseAcceleration * this.turboAccelMultiplier : this.baseAcceleration;
        const maxVel = turboOn ? this.baseMaxVelocity * this.turboMaxVelMultiplier : this.baseMaxVelocity;
        this.setMaxVelocity(maxVel);

        const speedFactor = Phaser.Math.Clamp(
            this.body.speed / this.body.maxVelocity.x, 0, 1
        );
        const turnFactor = this.minTurnFactor + (1 - this.minTurnFactor) * speedFactor;

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
            this.scene.physics.velocityFromRotation(
                this.rotation - Math.PI / 2,
                -this.baseAcceleration / 1.6,
                this.body.acceleration
            );
        } else {
            this.body.acceleration.set(0);
        }

        this.applyGrip(delta);
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
