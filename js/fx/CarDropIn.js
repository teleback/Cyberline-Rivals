// Entrada holográfica. A física só volta depois da animação de pouso.
export default class CarDropIn {
    constructor(scene, car) {
        this.scene = scene;
        this.car = car;
        this.objects = [];
        this.tweens = [];
        this.timers = [];
        this.destroyed = false;
        scene.events.once('shutdown', () => this.destroy());
    }

    world(object) {
        this.objects.push(object);
        this.scene.uiCam?.ignore(object);
        return object;
    }

    tween(config) {
        const tween = this.scene.tweens.add(config);
        this.tweens.push(tween);
        return tween;
    }

    play(x, y, opts = {}) {
        const { scene, car } = this;
        const color = opts.color ?? 0x5ceaff;
        const duration = opts.duration ?? 620;
        const delay = opts.delay ?? 160;
        this.onLand = opts.onLand;
        this.shake = opts.shake !== false;
        car.controlsEnabled = false;
        car.body.enable = false;
        car.setPosition(x, y - (opts.dropHeight ?? 280)).setScale(0.55).setAlpha(0);

        this.shadow = this.world(scene.add.ellipse(x, y, 100, 42, 0x000000, 0.5)
            .setDepth(car.depth - 1).setScale(0.3).setAlpha(0));
        this.pad = this.world(scene.add.ellipse(x, y, 150, 84, color, 0.06)
            .setStrokeStyle(2, color, 0.85).setDepth(car.depth - 2).setScale(0.45).setAlpha(0));
        this.ring = this.world(scene.add.ellipse(x, y, 175, 102, color, 0)
            .setStrokeStyle(1, color, 0.65).setDepth(car.depth - 2).setAlpha(0));
        this.beam = this.world(scene.add.rectangle(x, y - 155, 102, 330, color, 0.07)
            .setDepth(car.depth - 1).setAlpha(0));
        this.tween({ targets: [this.pad, this.ring, this.beam], alpha: 1,
            duration: 180, ease: 'Sine.easeOut' });
        this.tween({ targets: this.pad, scaleX: 1, scaleY: 1,
            duration: duration + delay, ease: 'Cubic.easeOut' });
        this.tween({ targets: this.ring, angle: 90, scaleX: 0.8, scaleY: 0.8,
            duration: duration + delay, ease: 'Sine.easeInOut' });
        this.tween({ targets: this.shadow, alpha: 0.65, scaleX: 1, scaleY: 1,
            delay, duration, ease: 'Cubic.easeIn' });
        this.tween({ targets: car, y, scaleX: 1, scaleY: 1, alpha: 1,
            delay, duration, ease: 'Cubic.easeIn', onComplete: () => this.land(x, y, color) });
    }

    land(x, y, color) {
        if (this.destroyed) return;
        const { scene, car } = this;
        car.setPosition(x, y).setAlpha(1);
        if (this.shake) scene.cameras.main.shake(130, 0.004);
        this.tween({ targets: car, scaleX: 1.15, scaleY: 0.86, duration: 85,
            yoyo: true, ease: 'Quad.easeOut', onComplete: () => {
                if (this.destroyed) return;
                car.setScale(1);
                car.body.reset(x, y);
                car.body.enable = true;
                const onLand = this.onLand;
                this.onLand = null;
                onLand?.();
            } });
        this.tween({ targets: this.ring, scaleX: 1.9, scaleY: 1.9, alpha: 0,
            duration: 420, ease: 'Cubic.easeOut' });
        this.tween({ targets: [this.pad, this.beam, this.shadow], alpha: 0,
            duration: 280, ease: 'Quad.easeOut' });
        this.spawnSparks(x, y, color);
        this.timers.push(scene.time.delayedCall(600, () => this.destroy()));
    }

    spawnSparks(x, y, color) {
        if (!this.scene.textures.exists('fx-dot')) return;
        const sparks = this.world(this.scene.add.particles(x, y, 'fx-dot', {
            lifespan: 360, speed: { min: 65, max: 160 },
            scale: { start: 0.45, end: 0 }, alpha: { start: 0.7, end: 0 },
            tint: [color, 0xffffff], quantity: 12, emitting: false,
        }).setDepth(this.car.depth + 1));
        sparks.explode(12, x, y);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.onLand = null;
        for (const tween of this.tweens) tween.stop();
        for (const timer of this.timers) timer.remove(false);
        for (const object of this.objects) object.destroy();
        this.objects.length = this.tweens.length = this.timers.length = 0;
    }
}
