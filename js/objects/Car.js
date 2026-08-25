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
        this.setDrag(0.985);
        this.setMaxVelocity(260);

        this.acceleration = 300;
        this.turnSpeed = 200; // graus por segundo

        this.cursors = scene.input.keyboard.createCursorKeys();
    }

    update() {
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
    }
}
