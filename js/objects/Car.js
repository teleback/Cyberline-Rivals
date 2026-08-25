export default class Car extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, texture) {
        super(scene, x, y, texture);

        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.setOrigin(0.5, 0.5);
        this.setCollideWorldBounds(true);
        this.setBounce(0.2);

        // Modo "damping" simula atrito: o carro perde velocidade aos poucos
        // em vez de parar instantaneamente ao soltar a seta.
        this.setDamping(true);
        this.setDrag(0.89);
        this.setMaxVelocity(220);

        this.acceleration = 320;
        this.turnSpeed = 190; // graus por segundo

        // Aderência dos pneus: fração da velocidade LATERAL (de lado) que
        // sobra depois de 1 segundo. Quanto menor, mais o carro "gruda" na
        // direção em que está apontando em vez de escorregar tipo no gelo.
        this.grip = 0.08;

        this.cursors = scene.input.keyboard.createCursorKeys();
    }

    update(time, delta) {
        const { left, right, up, down } = this.cursors;

        if (left.isDown) {
            this.setAngularVelocity(-this.turnSpeed);
        } else if (right.isDown) {
            this.setAngularVelocity(this.turnSpeed);
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
                -this.acceleration / 1.6,
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
