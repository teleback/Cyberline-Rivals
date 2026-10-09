import { playMusic } from '../fx/Music.js';
import { onAnyButton } from '../input/GamepadInput.js';

class MenuJogar extends Phaser.Scene {
    constructor() {
        super('MenuJogar');
    }

    preload() {
        this.load.image('bgMenuJogar', 'assets/images/ui/menujogar.png');
    }

    create() {
        playMusic(this, 'lobby');
        const { width, height } = this.scale;
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

        this.add.image(width / 2, height / 2, 'bgMenuJogar')
            .setDisplaySize(width, height);

        // Fonte arcade já carregada no boot; neon acompanha a arte do menu.
        const button = this.add.container(width * 0.15, height * 0.28);
        const textStyle = {
            fontFamily: '"Cyber Arcade", monospace',
            fontSize: `${Math.max(18, Math.round(height * 0.053))}px`,
            color: '#b9faff',
            stroke: '#071329',
            strokeThickness: 3,
            padding: { x: 10, y: 10 },
        };
        const colorEcho = this.add.text(2, 2, 'JOGAR', {
            ...textStyle, color: '#ff2bd6', strokeThickness: 0,
        }).setOrigin(0.5).setAlpha(0.45);
        const jogarBtn = this.add.text(0, 0, 'JOGAR', textStyle)
            .setOrigin(0.5)
            .setShadow(0, 0, '#00e5ff', 9, false, true)
            .setInteractive({ useHandCursor: true });
        const lineWidth = jogarBtn.width - 20;
        const underline = this.add.rectangle(0, jogarBtn.height / 2 + 3, lineWidth, 2, 0x00e5ff)
            .setAlpha(0.65);
        button.add([colorEcho, jogarBtn, underline]);

        if (!reducedMotion) {
            this.tweens.add({
                targets: jogarBtn, alpha: { from: 0.85, to: 1 },
                duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
            });
            this.tweens.add({
                targets: underline, scaleX: { from: 0.55, to: 1 },
                alpha: { from: 0.35, to: 0.8 },
                duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
            });
        }

        const highlight = (active) => {
            jogarBtn.setColor(active ? '#ffffff' : '#b9faff');
            jogarBtn.setShadow(0, 0, '#00e5ff', active ? 16 : 9, false, true);
            colorEcho.setAlpha(active ? 0.7 : 0.45);
            underline.setFillStyle(active ? 0xff2bd6 : 0x00e5ff);
            if (!reducedMotion) {
                this.tweens.killTweensOf(button);
                this.tweens.add({
                    targets: button, scale: active ? 1.04 : 1,
                    duration: 160, ease: 'Sine.easeOut',
                });
            }
        };

        jogarBtn.on('pointerover', () => highlight(true));
        jogarBtn.on('pointerout', () => highlight(false));
        jogarBtn.on('pointerdown', () => {
            this.scene.start('Nickname');
        });
        // Controle: um pequeno atraso evita que o mesmo aperto da tela
        // anterior já dispare o JOGAR.
        this.time.delayedCall(400, () => {
            onAnyButton(this, () => this.scene.start('Nickname'));
        });
    }
}

export default MenuJogar;
