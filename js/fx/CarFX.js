// Efeitos de aderencia do carro: fumaça, poeira e marcas de pneu.
export default class CarFX {
    constructor(scene, car) {
        this.scene = scene;
        this.car = car;
        this.marks = [];
        this.markCursor = 0;
        this.markDistance = 0;
        this.lastMarkX = car.x;
        this.lastMarkY = car.y;
        this.previousSpeed = 0;
        this.launchUntil = 0;
        this.markDuration = 2800;

        this.createTexture();
        this.createEmitters();

        scene.events.once('shutdown', () => this.destroy());
    }

    createTexture() {
        if (this.scene.textures.exists('fx-tire-mark')) return;

        const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });
        graphics.fillStyle(0x050812, 0.92);
        graphics.fillRoundedRect(0, 0, 8, 28, 3);
        graphics.generateTexture('fx-tire-mark', 8, 28);
        graphics.destroy();
    }

    createEmitters() {
        this.smoke = this.scene.add.particles(0, 0, 'fx-dot', {
            lifespan: { min: 360, max: 700 },
            speed: { min: 24, max: 82 },
            angle: { min: -20, max: 20 },
            scale: { start: 0.85, end: 1.45 },
            alpha: { start: 0.52, end: 0 },
            tint: [0xb9c3cf, 0x6e7885, 0xffffff],
            frequency: 24,
            quantity: 1,
            emitting: false
        }).setDepth(985);

        this.dust = this.scene.add.particles(0, 0, 'fx-dot', {
            lifespan: { min: 220, max: 480 },
            speed: { min: 35, max: 150 },
            angle: { min: -35, max: 35 },
            scale: { start: 0.46, end: 0 },
            alpha: { start: 0.82, end: 0 },
            tint: [0xc49b72, 0xf0c28a, 0x8b6a52],
            frequency: 34,
            quantity: 2,
            emitting: false
        }).setDepth(984);

        for (let i = 0; i < 64; i++) {
            const mark = this.scene.add.image(0, 0, 'fx-tire-mark')
                .setVisible(false)
                .setAlpha(0.88)
                .setDepth(700);
            mark.expiresAt = 0;
            this.marks.push(mark);
        }
    }

    update(delta) {
        const now = this.scene.time.now;
        const speed = this.car.body.speed;
        const braking = this.car.cursors.down.isDown && speed > 110;
        const sliding = this.car.isDrifting && speed > 85;
        const launching = this.car.cursors.up.isDown
            && speed > 55
            && this.previousSpeed < 25;
        if (launching) this.launchUntil = now + 650;
        this.previousSpeed = speed;

        const sharpTurn = Math.abs(this.car.body.angularVelocity) > 125 && speed > 105;
        const marking = now < this.launchUntil || sharpTurn || sliding || braking;

        for (let i = 0; i < this.marks.length; i++) {
            const mark = this.marks[i];
            if (mark.visible && now >= mark.expiresAt) mark.setVisible(false);
        }

        const forward = this.scene.physics.velocityFromRotation(
            this.car.rotation - Math.PI / 2,
            1
        );
        const rear = forward.clone().scale(-1);
        const side = new Phaser.Math.Vector2(-forward.y, forward.x);
        const rearX = this.car.x + rear.x * 19;
        const rearY = this.car.y + rear.y * 19;
        const rearAngle = Phaser.Math.RadToDeg(Math.atan2(rear.y, rear.x));

        if (marking) {
            this.smoke.setPosition(rearX, rearY);
            this.dust.setPosition(rearX, rearY);
            // A velocidade inicial aponta para a traseira do carro.
            this.smoke.setEmitterAngle(rearAngle - 22, rearAngle + 22);
            this.dust.setEmitterAngle(rearAngle - 38, rearAngle + 38);
        }
        this.smoke.emitting = marking;
        this.smoke.frequency = sliding || braking ? 16 : 24;
        this.dust.emitting = sliding || braking;
        this.dust.frequency = sliding ? 16 : 38;

        if (!marking) {
            this.markDistance = 0;
            this.lastMarkX = rearX;
            this.lastMarkY = rearY;
            return;
        }

        const distance = Phaser.Math.Distance.Between(
            this.lastMarkX,
            this.lastMarkY,
            rearX,
            rearY
        );
        this.markDistance += distance;
        this.lastMarkX = rearX;
        this.lastMarkY = rearY;

        if (this.markDistance < 12) return;
        this.markDistance = 0;

        const markLength = sliding || braking ? 20 : 15;
        const wheelLong = 5;
        const wheelLat = 11;
        const leftX = rearX + rear.x * wheelLong + side.x * wheelLat;
        const leftY = rearY + rear.y * wheelLong + side.y * wheelLat;
        const rightX = rearX + rear.x * wheelLong - side.x * wheelLat;
        const rightY = rearY + rear.y * wheelLong - side.y * wheelLat;
        this.placeMark(leftX, leftY, markLength);
        this.placeMark(rightX, rightY, markLength);
    }

    placeMark(x, y, length) {
        const mark = this.marks[this.markCursor];
        this.markCursor = (this.markCursor + 1) % this.marks.length;
        mark.setPosition(x, y);
        mark.setRotation(this.car.rotation);
        mark.setDisplaySize(8, length);
        mark.expiresAt = this.scene.time.now + this.markDuration;
        mark.setVisible(true);
    }

    destroy() {
        this.smoke.destroy();
        this.dust.destroy();
        this.marks.forEach((mark) => mark.destroy());
    }
}