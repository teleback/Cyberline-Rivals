import { wantsTouchControls } from '../input/TouchControls.js';

const BLUE = 0x29cfff;
const PINK = 0xff40c8;

export default class BoostFX {
    constructor(scene) {
        this.scene = scene;
        this.lite = scene.fx?.lite ?? wantsTouchControls();
        this.pads = [];
        this.waveCursor = 0;
        this.ghostCursor = 0;
        this.trailUntil = 0;
        this.nextGhostAt = 0;
        this.trailDuration = this.lite ? 480 : 650;
        this.createTextures();
        this.effects = scene.add.container(0, 0).setDepth(1090);
        this.ground = scene.add.container(0, 0).setDepth(980);
        this.worldObjects = [this.ground, this.effects];
        this.wake = scene.add.image(0, 0, 'boost-wake').setOrigin(0.5, 0)
            .setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
        this.ground.add(this.wake);
        this.burst = scene.add.particles(0, 0, 'boost-dot', {
            lifespan: { min: 180, max: 400 }, speed: { min: 65, max: 180 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.65, end: 0 }, alpha: { start: 0.85, end: 0 },
            tint: [BLUE, 0xb281ff, 0xc9ffff], blendMode: Phaser.BlendModes.ADD,
            emitting: false, maxAliveParticles: this.lite ? 16 : 32,
        });
        this.sparks = scene.add.particles(0, 0, 'boost-spark', {
            lifespan: { min: 160, max: 320 }, speed: { min: 150, max: 340 },
            rotate: { min: 0, max: 180 }, scale: { start: 0.65, end: 0 },
            alpha: { start: 0.9, end: 0 }, tint: [BLUE, 0xb281ff, 0xd8f7ff],
            blendMode: Phaser.BlendModes.ADD, emitting: false, maxAliveParticles: this.lite ? 14 : 28,
        });
        this.effects.add([this.burst, this.sparks]);
        this.waves = Array.from({ length: this.lite ? 2 : 4 }, () => {
            const image = scene.add.image(0, 0, 'boost-wave')
                .setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
            this.ground.add(image);
            return { image, born: -Infinity };
        });
        this.ghosts = Array.from({ length: this.lite ? 4 : 8 }, () => {
            const image = scene.add.image(0, 0, scene.car.texture.key)
                .setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
            this.ground.add(image);
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
            for (const [x, color] of [[46, '41,207,255'], [82, '170,112,255']]) {
                const gradient = context.createRadialGradient(x, 64, 0, x, 64, 60);
                gradient.addColorStop(0, `rgba(${color},0.3)`);
                gradient.addColorStop(1, `rgba(${color},0)`);
                context.fillStyle = gradient;
                context.fillRect(0, 0, 128, 128);
            }
        });
        canvas('boost-chevron', 64, 24, context => {
            const gradient = context.createLinearGradient(0, 0, 0, 24);
            gradient.addColorStop(0, '#ffffff');
            gradient.addColorStop(0.5, '#adffff');
            gradient.addColorStop(1, '#39d8ff');
            context.strokeStyle = gradient;
            context.lineWidth = 4;
            context.beginPath();
            context.moveTo(5, 21); context.lineTo(32, 4); context.lineTo(59, 21);
            context.stroke();
        });
        canvas('boost-scanline', 96, 16, context => {
            const gradient = context.createLinearGradient(0, 0, 96, 0);
            gradient.addColorStop(0, 'rgba(99,245,255,0)');
            gradient.addColorStop(0.5, '#b9ffff');
            gradient.addColorStop(1, 'rgba(99,245,255,0)');
            context.fillStyle = gradient;
            context.globalAlpha = 0.13; context.fillRect(0, 0, 96, 16);
            context.globalAlpha = 0.8; context.fillRect(0, 7, 96, 2);
            context.globalAlpha = 1;
        });
        canvas('boost-wake', 128, 256, context => {
            // O brilho e os filamentos são gravados na textura uma vez.
            // O rastro só acompanha a traseira; não há filtros por quadro.
            for (const side of [-1, 1]) {
                const gradient = context.createLinearGradient(0, 0, 0, 256);
                const rgb = side < 0 ? '64,224,255' : '176,120,255';
                gradient.addColorStop(0, `rgba(${rgb},0.8)`);
                gradient.addColorStop(0.25, `rgba(${rgb},0.45)`);
                gradient.addColorStop(1, `rgba(${rgb},0)`);
                const x = 64 + side * 29;
                context.strokeStyle = gradient;
                for (const [width, alpha] of [[22, 0.08], [10, 0.18], [3, 0.95]]) {
                    context.lineWidth = width; context.globalAlpha = alpha;
                    context.beginPath(); context.moveTo(x, 2);
                    context.lineTo(x + side * 3, 30); context.lineTo(x - side * 5, 48);
                    context.lineTo(x + side * 1, 73); context.lineTo(x - side * 9, 104);
                    context.lineTo(x - side * 6, 146); context.lineTo(x - side * 17, 215);
                    context.lineTo(x - side * 22, 250); context.stroke();
                }
                context.globalAlpha = 0.8;
                context.fillStyle = gradient;
                for (let i = 0; i < 5; i++) context.fillRect(x + side * (8 + i), 18 + i * 40, 2, 14 + i * 2);
            }
            context.globalAlpha = 1;
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
            .setDisplaySize(112, 148).setRotation(plate.rotation)
            .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.4);
        this.scene.boostVisuals.addAt(aura, 0);
        const flash = this.scene.add.image(plate.x, plate.y, 'placaboost')
            .setDisplaySize(64, 96).setRotation(plate.rotation)
            .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
        const arrows = Array.from({ length: 3 }, () => this.scene.add.image(plate.x, plate.y, 'boost-chevron')
            .setDisplaySize(38, 17).setRotation(plate.rotation).setAlpha(0)
            .setBlendMode(Phaser.BlendModes.ADD));
        const scan = this.scene.add.image(plate.x, plate.y, 'boost-scanline')
            .setDisplaySize(40, 6).setRotation(plate.rotation).setAlpha(0)
            .setBlendMode(Phaser.BlendModes.ADD);
        this.scene.boostVisuals.add([flash, scan, ...arrows]);
        this.pads.push({ plate, aura, flash, scan, arrows, phase: index * 0.17, activatedAt: -Infinity,
            sin: Math.sin(plate.rotation), cos: Math.cos(plate.rotation) });
    }

    activate(boost, car, time) {
        const pad = this.pads[boost.sensor.boostIndex];
        pad.activatedAt = time;
        for (let layer = 0; layer < (this.lite ? 1 : 2); layer++) {
            const wave = this.waves[this.waveCursor];
            this.waveCursor = (this.waveCursor + 1) % this.waves.length;
            wave.born = time + layer * 85;
            wave.rotation = boost.rotation + layer * Math.PI / 4;
            wave.image.setPosition(boost.x, boost.y).setRotation(wave.rotation)
                .setTint(layer ? 0xb78aff : 0x9cffff).setScale(0.3).setAlpha(0.8).setVisible(layer === 0);
        }
        this.burst.explode(this.lite ? 10 : 18, boost.x, boost.y);
        const direction = (car.rotation - Math.PI / 2) * 180 / Math.PI;
        this.sparks.setEmitterAngle({ min: direction - 24, max: direction + 24 });
        this.sparks.explode(this.lite ? 8 : 12, car.x, car.y);
        this.trailUntil = time + this.trailDuration;
        this.nextGhostAt = time;
    }

    update(time) {
        const view = this.scene.cameras.main.worldView;
        for (const pad of this.pads) {
            const nearby = pad.plate.x > view.x - 100 && pad.plate.x < view.right + 100
                && pad.plate.y > view.y - 100 && pad.plate.y < view.bottom + 100;
            if (nearby !== pad.nearby) {
                pad.nearby = nearby;
                for (const image of [pad.aura, pad.scan, pad.flash, ...pad.arrows]) image.setVisible(nearby);
            }
            if (!nearby) continue;
            const phase = (time / 1050 + pad.phase) % 1;
            const localY = 31 - phase * 62;
            pad.scan.setPosition(pad.plate.x - localY * pad.sin, pad.plate.y + localY * pad.cos)
                .setAlpha(Math.sin(phase * Math.PI) * 0.38);
            const hit = Math.max(0, 1 - (time - pad.activatedAt) / 460);
            pad.flash.setAlpha(hit * 0.48);
            pad.aura.setAlpha(0.32 + Math.sin(phase * Math.PI) * 0.12 + hit * 0.4);
            for (let i = 0; i < pad.arrows.length; i++) {
                const y = 18 - i * 19;
                const pulse = Math.max(0, Math.cos((phase - i * 0.19) * Math.PI * 2)) ** 4;
                pad.arrows[i].setPosition(pad.plate.x - y * pad.sin, pad.plate.y + y * pad.cos)
                    .setAlpha(0.08 + pulse * 0.65 + hit * 0.25);
            }
        }
        for (const wave of this.waves) {
            const age = (time - wave.born) / 500;
            if (age < 0 || age >= 1) { wave.image.setVisible(false); continue; }
            const eased = 1 - (1 - age) ** 3;
            wave.image.setVisible(true).setRotation(wave.rotation + age * 0.3)
                .setScale(0.3 + eased * 1.9, 0.3 + eased * 1.45).setAlpha((1 - age) ** 1.5 * 0.8);
        }
        const car = this.scene.car;
        const remaining = Math.max(0, Math.min(1, (this.trailUntil - time) / this.trailDuration));
        const visible = remaining > 0 && car.visible !== false && car.active !== false;
        this.wake.setVisible(visible);
        if (visible) this.wake.setPosition(car.x - Math.sin(car.rotation) * 32,
            car.y + Math.cos(car.rotation) * 32).setRotation(car.rotation)
            .setDisplaySize(this.lite ? 78 : 90, 135 + (1 - remaining) * 85).setAlpha(remaining * 0.8);
        if (visible && time >= this.nextGhostAt) {
            this.nextGhostAt = time + (this.lite ? 110 : 65);
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
            ghost.image.setAlpha((1 - age) * (this.lite ? 0.12 : 0.18))
                .setScale(ghost.scaleX * (1 + age * 0.06), ghost.scaleY * (1 + age * 0.06));
        }
    }
}
