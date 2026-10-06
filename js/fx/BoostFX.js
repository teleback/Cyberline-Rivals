const BLUE = 0x29cfff;
const PINK = 0xff40c8;

export default class BoostFX {
    constructor(scene) {
        this.scene = scene;
        this.pads = [];
        this.waveCursor = 0;
        this.ghostCursor = 0;
        this.trailUntil = 0;
        this.nextGhostAt = 0;
        this.createTextures();
        this.effects = scene.add.container(0, 0).setDepth(1090);
        this.worldObjects = [this.effects];
        this.burst = scene.add.particles(0, 0, 'boost-dot', {
            lifespan: { min: 220, max: 480 }, speed: { min: 65, max: 190 },
            scale: { start: 0.8, end: 0 }, alpha: { start: 0.85, end: 0 },
            tint: [BLUE, PINK, 0x9eefff], blendMode: Phaser.BlendModes.ADD,
            emitting: false, maxAliveParticles: 48,
        });
        this.sparks = scene.add.particles(0, 0, 'boost-spark', {
            lifespan: { min: 160, max: 320 }, speed: { min: 150, max: 340 },
            rotate: { min: 0, max: 180 }, scale: { start: 0.65, end: 0 },
            alpha: { start: 0.9, end: 0 }, tint: [BLUE, PINK, 0xd8f7ff],
            blendMode: Phaser.BlendModes.ADD, emitting: false, maxAliveParticles: 40,
        });
        this.effects.add([this.burst, this.sparks]);
        this.waves = Array.from({ length: 4 }, () => {
            const image = scene.add.image(0, 0, 'boost-wave')
                .setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
            this.effects.add(image);
            return { image, born: -Infinity };
        });
        this.ghosts = Array.from({ length: 8 }, () => {
            const image = scene.add.image(0, 0, scene.car.texture.key)
                .setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
            this.effects.add(image);
            return { image, born: -Infinity, scaleX: 1, scaleY: 1 };
        });
    }

    createTextures() {
        const textures = this.scene.textures;
        const canvas = (key, width, height, draw) => {
            if (textures.exists(key)) return;
            const texture = textures.createCanvas(key, width, height);
            draw(texture.getContext());
            texture.refresh();
        };
        canvas('boost-dot', 16, 16, context => {
            const gradient = context.createRadialGradient(8, 8, 0, 8, 8, 8);
            gradient.addColorStop(0, '#ffffff');
            gradient.addColorStop(0.3, 'rgba(255,255,255,0.8)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            context.fillStyle = gradient;
            context.fillRect(0, 0, 16, 16);
        });
        canvas('boost-spark', 24, 4, context => {
            const gradient = context.createLinearGradient(0, 0, 24, 0);
            gradient.addColorStop(0, 'rgba(255,255,255,0)');
            gradient.addColorStop(0.65, '#ffffff');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            context.fillStyle = gradient;
            context.fillRect(0, 0, 24, 4);
        });
        canvas('boost-aura', 128, 128, context => {
            for (const [x, color] of [[46, '41,207,255'], [82, '255,64,200']]) {
                const gradient = context.createRadialGradient(x, 64, 0, x, 64, 60);
                gradient.addColorStop(0, `rgba(${color},0.3)`);
                gradient.addColorStop(1, `rgba(${color},0)`);
                context.fillStyle = gradient;
                context.fillRect(0, 0, 128, 128);
            }
        });
        canvas('boost-chevron', 64, 24, context => {
            const gradient = context.createLinearGradient(0, 0, 64, 0);
            gradient.addColorStop(0, '#29cfff');
            gradient.addColorStop(1, '#ff40c8');
            context.strokeStyle = gradient;
            context.lineWidth = 4;
            context.beginPath();
            context.moveTo(5, 21); context.lineTo(32, 4); context.lineTo(59, 21);
            context.stroke();
        });
        canvas('boost-wave', 128, 128, context => {
            const gradient = context.createLinearGradient(0, 0, 128, 128);
            gradient.addColorStop(0, '#29cfff');
            gradient.addColorStop(1, '#ff40c8');
            context.strokeStyle = gradient;
            context.lineWidth = 3;
            for (let segment = 0; segment < 4; segment++) {
                const start = segment * Math.PI / 2;
                context.beginPath();
                context.arc(64, 64, 44, start + 0.08, start + Math.PI / 2 - 0.08);
                context.stroke();
            }
            context.lineWidth = 1;
            context.beginPath(); context.arc(64, 64, 37, 0, Math.PI * 2); context.stroke();
            for (let segment = 0; segment < 8; segment++) {
                const angle = segment * Math.PI / 4;
                context.beginPath();
                context.moveTo(64 + Math.cos(angle) * 48, 64 + Math.sin(angle) * 48);
                context.lineTo(64 + Math.cos(angle) * 54, 64 + Math.sin(angle) * 54);
                context.stroke();
            }
        });
    }

    addPlate(plate, index) {
        const aura = this.scene.add.image(plate.x, plate.y, 'boost-aura')
            .setDisplaySize(120, 155).setRotation(plate.rotation)
            .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.5);
        this.scene.boostVisuals.addAt(aura, 0);
        const flash = this.scene.add.image(plate.x, plate.y, 'placaboost')
            .setDisplaySize(64, 96).setRotation(plate.rotation)
            .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
        const scan = this.scene.add.image(plate.x, plate.y, 'boost-chevron')
            .setDisplaySize(36, 14).setRotation(plate.rotation).setAlpha(0)
            .setBlendMode(Phaser.BlendModes.ADD);
        this.scene.boostVisuals.add([flash, scan]);
        this.pads.push({ plate, aura, flash, scan, phase: index * 0.17, activatedAt: -Infinity,
            sin: Math.sin(plate.rotation), cos: Math.cos(plate.rotation) });
    }

    activate(boost, car, time) {
        const pad = this.pads[boost.sensor.boostIndex];
        pad.activatedAt = time;
        const wave = this.waves[this.waveCursor];
        this.waveCursor = (this.waveCursor + 1) % this.waves.length;
        wave.born = time;
        wave.image.setPosition(boost.x, boost.y).setRotation(boost.rotation)
            .setScale(0.35).setAlpha(0.85).setVisible(true);
        this.burst.explode(22, boost.x, boost.y);
        const direction = (car.rotation - Math.PI / 2) * 180 / Math.PI;
        this.sparks.setEmitterAngle({ min: direction - 24, max: direction + 24 });
        this.sparks.explode(16, car.x, car.y);
        this.trailUntil = time + 440;
        this.nextGhostAt = time;
    }

    update(time) {
        const view = this.scene.cameras.main.worldView;
        for (const pad of this.pads) {
            const nearby = pad.plate.x > view.x - 100 && pad.plate.x < view.right + 100
                && pad.plate.y > view.y - 100 && pad.plate.y < view.bottom + 100;
            pad.aura.setVisible(nearby); pad.scan.setVisible(nearby); pad.flash.setVisible(nearby);
            if (!nearby) continue;
            const phase = (time / 1100 + pad.phase) % 1;
            const localY = 31 - phase * 62;
            pad.scan.setPosition(pad.plate.x - localY * pad.sin, pad.plate.y + localY * pad.cos)
                .setAlpha(Math.sin(phase * Math.PI) * 0.3);
            const hit = Math.max(0, 1 - (time - pad.activatedAt) / 380);
            pad.flash.setAlpha(hit * 0.6);
            pad.aura.setAlpha(0.45 + Math.sin(phase * Math.PI) * 0.1 + hit * 0.45);
        }
        for (const wave of this.waves) {
            const age = (time - wave.born) / 420;
            if (age >= 1) { wave.image.setVisible(false); continue; }
            const eased = 1 - (1 - age) ** 3;
            wave.image.setScale(0.35 + eased * 1.7).setAlpha((1 - age) * 0.85);
        }
        if (time < this.trailUntil && time >= this.nextGhostAt) {
            this.nextGhostAt = time + 48;
            const car = this.scene.car;
            const ghost = this.ghosts[this.ghostCursor];
            ghost.born = time; ghost.scaleX = car.scaleX; ghost.scaleY = car.scaleY;
            ghost.image.setTexture(car.texture.key, car.frame.name).setPosition(car.x, car.y)
                .setRotation(car.rotation).setFlip(car.flipX, car.flipY)
                .setTint(this.ghostCursor % 2 ? PINK : BLUE).setVisible(true);
            this.ghostCursor = (this.ghostCursor + 1) % this.ghosts.length;
        }
        for (const ghost of this.ghosts) {
            const age = (time - ghost.born) / 280;
            if (age >= 1) { ghost.image.setVisible(false); continue; }
            ghost.image.setAlpha((1 - age) * 0.22)
                .setScale(ghost.scaleX * (1 + age * 0.06), ghost.scaleY * (1 + age * 0.06));
        }
    }
}
