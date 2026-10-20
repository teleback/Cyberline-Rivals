import { getCarSkin } from '../objects/CarSkins.js';

// Desenhado uma vez por nome/cor. Só a posição muda durante a corrida.
export default class PlayerNameplate {
    constructor(scene, nick, skin, local = false) {
        this.scene = scene;
        this.local = local;
        this.plate = scene.add.graphics();
        this.label = scene.add.text(0, -1, '', {
            fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold',
            color: '#f2f5ff', stroke: '#060c1a', strokeThickness: 2,
            resolution: 2,
        }).setOrigin(0.5);
        this.root = scene.add.container(0, 0, [this.plate, this.label]).setDepth(1720);
        this.setIdentity(nick, skin);
    }
    setIdentity(nick, skin) {
        const name = String(nick || (this.local ? 'PILOTO' : 'RIVAL')).replace(/[\r\n\t]/g, ' ').slice(0, 18);
        const color = getCarSkin(skin).neon;
        if (name === this.text && color === this.color) return this;
        this.text = name; this.color = color; this.skin = skin;
        this.label.setText(name);
        const width = Math.ceil(this.label.width) + 18, left = -width / 2;
        const g = this.plate;
        g.clear();
        g.fillStyle(0x040815, 0.28).fillRoundedRect(left - 2, -12, width + 4, 25, 6);
        g.fillStyle(0x0b1428, 0.94).fillRoundedRect(left, -12, width, 21, 4);
        g.lineStyle(1, color, 0.42).strokeRoundedRect(left, -12, width, 21, 4);
        g.fillStyle(color, 0.95).fillRoundedRect(-Math.min(width - 14, 30) / 2, 8,
            Math.min(width - 14, 30), 2, 1);
        return this;
    }
    setText(text) { return this.setIdentity(text, this.skin); }
    setPosition(x, y) { this.root.setPosition(x, y); return this; }
    setVisible(value) { this.root.setVisible(value); return this; }
    destroy() { this.root.destroy(); }
}
