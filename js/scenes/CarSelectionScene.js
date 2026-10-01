import { onAnyButton } from '../input/GamepadInput.js';

class CarSelectionScene extends Phaser.Scene {
    constructor() {
        super('CarSelection');
        this.cars = [
            { id: 'cyan',  name: 'CYAN',  tint: 0x00e5ff },
            { id: 'red',   name: 'RED',   tint: 0xff3355 },
            { id: 'lime',  name: 'LIME',  tint: 0x9cff33 },
            { id: 'gold',  name: 'GOLD',  tint: 0xffc533 }
        ];
        this.selected = 0;
    }

    preload() {
        this.load.image('carSelectPreview', 'assets/images/tiles/tiles novos/carro.png');
    }

    create(data = {}) {
        this.playerNick = data.playerNick || 'PILOTO';
        const { width, height } = this.scale;

        this.cameras.main.setBackgroundColor('#05060a');
        this.add.rectangle(width / 2, height / 2, width, height, 0x05060a);
        this.add.rectangle(width / 2, height * 0.16, width * 0.72, 2, 0x00e5ff, 0.75);
        this.add.rectangle(width / 2, height * 0.84, width * 0.72, 2, 0xff3355, 0.45);

        this.add.text(width / 2, height * 0.10, 'ESCOLHA SEU CARRO', {
            fontFamily: 'monospace',
            fontSize: '30px',
            fontStyle: 'bold',
            color: '#ffffff',
            stroke: '#00e5ff',
            strokeThickness: 1
        }).setOrigin(0.5);

        this.add.text(width / 2, height * 0.145, `PILOTO: ${this.playerNick}`, {
            fontFamily: 'monospace',
            fontSize: '13px',
            color: '#00e5ff'
        }).setOrigin(0.5);

        this.add.text(width / 2, height * 0.19, 'SELECIONE UMA COR PARA CORRER', {
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#8ea0b5'
        }).setOrigin(0.5);

        this.previewGlow = this.add.circle(width / 2, height * 0.43, 72, 0x00e5ff, 0.05);
        this.preview = this.add.image(width / 2, height * 0.43, 'carSelectPreview')
            .setScale(0.72)
            .setDepth(2);

        this.nameLabel = this.add.text(width / 2, height * 0.64, '', {
            fontFamily: 'monospace',
            fontSize: '20px',
            fontStyle: 'bold',
            color: '#00e5ff'
        }).setOrigin(0.5);

        this.cards = [];
        const spacing = 110;
        const startX = width / 2 - ((this.cars.length - 1) * spacing) / 2;

        this.cars.forEach((car, index) => {
            const x = startX + index * spacing;
            const y = height * 0.75;
            const card = this.add.rectangle(x, y, 82, 54, 0x101722, 1)
                .setStrokeStyle(2, 0x334355, 1)
                .setInteractive({ useHandCursor: true });
            const dot = this.add.circle(x, y, 13, car.tint, 1);
            const label = this.add.text(x, y + 30, car.name, {
                fontFamily: 'monospace',
                fontSize: '10px',
                color: '#aab7c7'
            }).setOrigin(0.5);

            card.on('pointerdown', () => this.selectCar(index));
            card.on('pointerover', () => {
                if (this.selected !== index) card.setStrokeStyle(2, 0x607080, 1);
            });
            card.on('pointerout', () => {
                if (this.selected !== index) card.setStrokeStyle(2, 0x334355, 1);
            });

            this.cards.push({ card, dot, label });
        });

        this.confirm = this.add.text(width / 2, height * 0.91, 'CONFIRMAR  [ENTER / A]', {
            fontFamily: 'monospace',
            fontSize: '17px',
            fontStyle: 'bold',
            color: '#ffffff',
            backgroundColor: '#101722',
            padding: { left: 18, right: 18, top: 9, bottom: 9 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        this.confirm.on('pointerdown', () => this.confirmSelection());

        this.selectCar(0);

        this.input.keyboard.on('keydown-LEFT', () => this.selectCar((this.selected - 1 + this.cars.length) % this.cars.length));
        this.input.keyboard.on('keydown-RIGHT', () => this.selectCar((this.selected + 1) % this.cars.length));
        this.input.keyboard.on('keydown-ENTER', () => this.confirmSelection());
        this.input.keyboard.on('keydown-SPACE', () => this.confirmSelection());

        // Controle/gamepad: esquerda/direita troca o carro; qualquer botão
        // confirma quando o usuário já está parado nesta tela.
        this.time.delayedCall(500, () => {
            onAnyButton(this, () => this.confirmSelection());
        });
    }

    selectCar(index) {
        this.selected = index;
        const car = this.cars[index];
        this.preview.setTint(car.tint);
        this.previewGlow.setFillStyle(car.tint, 0.08);
        this.nameLabel.setText(car.name);

        this.cards.forEach((item, i) => {
            const active = i === index;
            item.card.setStrokeStyle(2, active ? car.tint : 0x334355, active ? 1 : 1);
            item.card.setFillStyle(active ? 0x182330 : 0x101722, 1);
            item.label.setColor(active ? '#ffffff' : '#aab7c7');
        });
    }

    confirmSelection() {
        const car = this.cars[this.selected];
        this.scene.start('Preloader', { carSkin: car.id, carTint: car.tint, playerNick: this.playerNick });
    }
}

export default CarSelectionScene;
