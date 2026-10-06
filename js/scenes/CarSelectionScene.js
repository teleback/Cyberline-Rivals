import { readGamepad } from '../input/GamepadInput.js';
import { CAR_SKINS, loadCarSkins, prepareCarSkins } from '../objects/CarSkins.js';

class CarSelectionScene extends Phaser.Scene {
    constructor() {
        super('CarSelection');
        this.cars = CAR_SKINS;
    }

    preload() {
        loadCarSkins(this);
    }

    create(data = {}) {
        prepareCarSkins(this);
        this.playerNick = data.playerNick || 'PILOTO';
        this.playerId = data.playerId || this.getPlayerId();
        this.roomId = Number.isInteger(data.roomId) ? data.roomId : 1;
        this.selected = 0;
        this.transitioning = false;
        this.pendingDirection = 0;
        this.confirmed = false;
        this.swipeStart = null;
        this.padConfirmArmed = false;
        this.padReadyAt = this.time.now + 400;
        this.padNavigationAt = this.padReadyAt;
        this.padDirection = 0;
        const { width, height } = this.scale;
        const compact = width < 600;
        this.centerX = width / 2;
        this.carY = height * 0.47;
        this.spacing = width * 0.235;
        this.focusScale = Math.min(1.65, height / 280, width / 330);
        this.sideScale = this.focusScale * 0.64;
        this.cameras.main.setBackgroundColor('#08051b');

        const background = this.add.graphics();
        background.fillStyle(0x08051b).fillRect(0, 0, width, height);
        for (let radius = width * 0.5; radius > 30; radius -= 24) {
            background.fillStyle(0xa855ff, 0.009).fillCircle(width / 2, height * 0.47, radius);
        }
        background.lineStyle(1, 0x9b55ff, 0.18);
        for (let i = -7; i <= 7; i++) {
            background.lineBetween(width / 2 + i * 15, height * 0.48,
                width / 2 + i * 100, height);
        }
        for (let y = height * 0.5; y < height; y += 24) background.lineBetween(0, y, width, y);
        background.lineStyle(2, 0xff39d4, 0.7);
        background.strokePoints([{ x: width * 0.07, y: 23 }, { x: width * 0.2, y: 23 },
            { x: width * 0.22, y: 33 }, { x: width * 0.93, y: 33 }]);
        background.lineStyle(2, 0x3995ff, 0.65);
        background.lineBetween(width * 0.07, height - 22, width * 0.93, height - 22);

        const text = (x, y, value, size, color, arcade = false) => this.add.text(x, y, value, {
            fontFamily: arcade ? '"Cyber Arcade", monospace' : 'monospace',
            fontSize: `${size}px`, color,
            ...(arcade ? { shadow: { color: '#a855ff', blur: 14, fill: true } } : {}),
        }).setOrigin(0.5);
        text(width / 2, height * 0.115, 'ESCOLHA SEU CARRO', compact ? 17 : 23, '#f8eaff', true);
        text(width / 2, height * 0.18, `${this.playerNick}  /  SALA ${this.roomId}`, compact ? 10 : 12, '#b8a7dc');

        // Plataforma holográfica: camadas suaves e contornos pulsantes.
        this.platformGlow = this.add.ellipse(width / 2, height * 0.665,
            width * 0.36, height * 0.11, 0xb45cff, 0.09);
        this.platformHalo = this.add.ellipse(width / 2, height * 0.665,
            width * 0.29, height * 0.075, 0xb45cff, 0.06).setStrokeStyle(5, 0xb45cff, 0.12);
        this.platform = this.add.ellipse(width / 2, height * 0.665,
            width * 0.27, height * 0.055, 0x160d2c, 0.8).setStrokeStyle(2, 0xb45cff, 0.85);
        this.tweens.add({ targets: this.platformGlow, alpha: 0.4, scaleX: 1.08, scaleY: 1.15,
            duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: this.platformHalo, alpha: 0.45,
            duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.sparks = Array.from({ length: 12 }, (_, i) => this.add.rectangle(
            width / 2 + Math.cos(i * 2.4) * width * 0.14,
            height * (0.25 + (i % 5) * 0.08), 2, 5, 0xb45cff, 0.4));
        this.sparks.forEach((spark, i) => this.tweens.add({ targets: spark,
            y: spark.y - 24, alpha: 0.05, duration: 1100 + i * 90,
            yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));

        this.previews = this.cars.map((car, index) => {
            const sprite = this.add.image(width / 2, this.carY, car.texture);
            sprite.setInteractive({ useHandCursor: true });
            sprite.on('pointerup', pointer => {
                if (Math.abs(pointer.x - pointer.downX) < 12 && Math.abs(pointer.y - pointer.downY) < 12) {
                    this.selectCar(index);
                }
            });
            return { sprite, relative: 0 };
        });
        this.nameLabel = text(width / 2, height * 0.755, '', compact ? 13 : 16, '#ffffff', true);
        this.counter = text(width / 2, height * 0.82, '', 10, '#a79ac4');
        this.dots = this.cars.map((car, index) => {
            const dot = this.add.rectangle(width / 2 + (index - 1.5) * 24,
                height * 0.86, 14, 3, car.neon, 0.35).setInteractive({ useHandCursor: true });
            // Área de toque maior que o traço visível.
            dot.setInteractive(new Phaser.Geom.Rectangle(-6, -10, 26, 23), Phaser.Geom.Rectangle.Contains);
            dot.on('pointerdown', () => this.selectCar(index));
            return dot;
        });
        const arrow = (x, label, direction) => {
            const button = text(x, height * 0.48, label, compact ? 22 : 28, '#ff9cec', true)
                .setPadding(14, 22, 14, 22).setInteractive({ useHandCursor: true });
            button.on('pointerdown', () => this.moveSelection(direction));
            button.on('pointerover', () => button.setColor('#ffffff'));
            button.on('pointerout', () => button.setColor('#ff9cec'));
            return button;
        };
        arrow(width * 0.075, '<', -1);
        arrow(width * 0.925, '>', 1);
        this.confirm = text(width / 2, height * 0.925, 'ESCOLHER  [A / ENTER]', compact ? 10 : 12, '#fff0fc', true)
            .setPadding(22, 10, 22, 10).setBackgroundColor('#27123d').setInteractive({ useHandCursor: true });
        this.confirm.on('pointerdown', () => this.confirmSelection());
        text(width / 2, height * 0.985, 'DESLIZE OU USE O DIRECIONAL PARA TROCAR', compact ? 8 : 9, '#8d81a8');
        this.selectCar(0, false);

        const keys = {
            'keydown-LEFT': () => this.moveSelection(-1),
            'keydown-RIGHT': () => this.moveSelection(1),
            'keydown-ENTER': () => this.confirmSelection(),
            'keydown-SPACE': () => this.confirmSelection(),
        };
        for (const [event, handler] of Object.entries(keys)) this.input.keyboard?.on(event, handler);
        const startSwipe = pointer => {
            if (pointer.y > height * 0.23 && pointer.y < height * 0.72) {
                this.swipeStart = { id: pointer.id, x: pointer.x, y: pointer.y };
            }
        };
        const endSwipe = pointer => {
            const start = this.swipeStart;
            if (!start || start.id !== pointer.id) return;
            this.swipeStart = null;
            const dx = pointer.x - start.x, dy = pointer.y - start.y;
            if (Math.abs(dx) > width * 0.055 && Math.abs(dx) > Math.abs(dy) * 1.3) {
                this.moveSelection(dx < 0 ? 1 : -1);
            }
        };
        this.input.on('pointerdown', startSwipe);
        this.input.on('pointerup', endSwipe);
        this.events.once('shutdown', () => {
            for (const [event, handler] of Object.entries(keys)) this.input.keyboard?.off(event, handler);
            this.input.off('pointerdown', startSwipe);
            this.input.off('pointerup', endSwipe);
            this.swipeStart = null;
        });
    }

    moveSelection(direction) {
        if (this.confirmed) return;
        if (this.transitioning) {
            this.pendingDirection = direction;
            return;
        }
        this.selectCar((this.selected + direction + this.cars.length) % this.cars.length);
    }

    selectCar(index, animate = true) {
        if (this.confirmed || this.transitioning || !Number.isInteger(index) || index < 0 || index >= this.cars.length) return;
        if (animate && index === this.selected) return;
        this.selected = index;
        const car = this.cars[index];
        this.nameLabel.setText(car.name).setShadow(0, 0, car.color, 18, false, true);
        this.counter.setText(`${index + 1} / ${this.cars.length}  •  ${car.style}`);
        this.platformGlow.setFillStyle(car.neon, 0.09);
        this.platformHalo.setFillStyle(car.neon, 0.06).setStrokeStyle(5, car.neon, 0.12);
        this.platform.setStrokeStyle(2, car.neon, 0.85);
        this.confirm.setShadow(0, 0, car.color, 14, false, true);
        this.sparks.forEach(spark => spark.setFillStyle(car.neon));
        this.dots.forEach((dot, i) => dot.setAlpha(i === index ? 1 : 0.35).setScale(i === index ? 1.3 : 1));
        this.transitioning = animate;
        let completed = 0;
        this.previews.forEach((item, i) => {
            let relative = (i - index + this.cars.length) % this.cars.length;
            if (relative > this.cars.length / 2) relative -= this.cars.length;
            const focused = relative === 0;
            const hidden = Math.abs(relative) > 1;
            if (hidden) item.sprite.disableInteractive();
            else item.sprite.setInteractive({ useHandCursor: true });
            // Na volta do carrossel, o sprite entra pela lateral correta.
            if (animate && Math.abs(relative - item.relative) > 1 && !hidden) {
                item.sprite.setPosition(this.centerX + (relative < 0 ? -2 : 2) * this.spacing, this.carY).setAlpha(0);
            }
            const exitLeft = animate && hidden && item.relative === -1;
            const x = this.centerX + (exitLeft ? -2 : relative) * this.spacing;
            const y = this.carY + (focused ? 0 : 10);
            const scale = focused ? this.focusScale : this.sideScale;
            const alpha = hidden ? 0 : focused ? 1 : 0.45;
            item.sprite.setDepth(focused ? 5 : 3);
            item.relative = relative;
            if (!animate) {
                item.sprite.setPosition(x, y).setScale(scale).setAlpha(alpha);
            } else {
                this.tweens.add({ targets: item.sprite, x, y, scaleX: scale, scaleY: scale, alpha,
                    duration: 320, ease: 'Cubic.easeOut', onComplete: () => {
                        if (hidden) item.sprite.setPosition(this.centerX + relative * this.spacing, y);
                        if (++completed === this.previews.length) {
                            this.transitioning = false;
                            const direction = this.pendingDirection;
                            this.pendingDirection = 0;
                            if (direction) this.moveSelection(direction);
                        }
                    } });
            }
        });
    }

    update(time) {
        if (!this.transitioning && !this.confirmed) {
            this.previews[this.selected].sprite.y = this.carY + Math.sin(time / 650) * 3;
        }
        const pad = readGamepad();
        if (!pad.any) this.padConfirmArmed = true;
        if (time < this.padReadyAt || this.confirmed) return;
        const direction = pad.left ? -1 : pad.right ? 1 : 0;
        if (direction && (direction !== this.padDirection || time >= this.padNavigationAt)) {
            this.moveSelection(direction);
            this.padNavigationAt = time + 350;
        }
        this.padDirection = direction;
        if (pad.any && this.padConfirmArmed) {
            this.padConfirmArmed = false;
            this.confirmSelection();
        }
    }

    getPlayerId() {
        try {
            let id = sessionStorage.getItem('cyberlinePlayerId');
            if (!id) {
                id = (window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : '')
                    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
                sessionStorage.setItem('cyberlinePlayerId', id);
            }
            return id;
        } catch (_) {
            return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        }
    }

    confirmSelection() {
        if (this.confirmed) return;
        this.confirmed = true;
        this.pendingDirection = 0;
        const car = this.cars[this.selected];
        const sprite = this.previews[this.selected].sprite;
        this.tweens.add({ targets: sprite, scaleX: this.focusScale * 1.07,
            scaleY: this.focusScale * 1.07, duration: 180, ease: 'Quad.easeOut' });
        this.cameras.main.flash(120, (car.neon >> 16) & 255, (car.neon >> 8) & 255, car.neon & 255);
        this.cameras.main.fadeOut(220, 8, 5, 27);
        // Branco preserva as cores reais dos sprites; os efeitos aplicam o tint.
        this.time.delayedCall(220, () => this.scene.start('Preloader', {
            carSkin: car.id, carTint: 0xffffff,
            playerNick: this.playerNick, playerId: this.playerId, roomId: this.roomId,
        }));
    }
}

export default CarSelectionScene;
