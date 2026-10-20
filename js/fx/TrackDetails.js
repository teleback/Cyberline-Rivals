const SIZE = 512;

// Refletores e pequenas reflexões são pintados uma vez em blocos de textura.
// Sem shaders, partículas de ambiente ou redesenho do circuito a cada frame.
export default class TrackDetails {
    constructor(scene, shapes) {
        this.scene = scene;
        const chunks = new Map();
        let count = 0;
        const mark = (x, y, angle) => {
            const cx = Math.floor(x / SIZE), cy = Math.floor(y / SIZE), key = `${cx},${cy}`;
            if (!chunks.has(key)) chunks.set(key, { cx, cy, marks: [] });
            chunks.get(key).marks.push({ x: x - cx * SIZE, y: y - cy * SIZE, angle,
                color: count++ % 4 === 0 ? '#be79ff' : '#66cfdf' });
        };
        shapes.forEach((shape, index) => {
            if (shape.type === 'rect') {
                const horizontal = shape.width > shape.height;
                const length = horizontal ? shape.width : shape.height;
                for (let offset = 48; offset < length - 24; offset += 128) {
                    mark(shape.x + (horizontal ? offset : shape.width / 2),
                        shape.y + (horizontal ? shape.height / 2 : offset), horizontal ? 0 : Math.PI / 2);
                }
            } else if (shape.type === 'segment' && index % 5 === 0) {
                mark((shape.ax + shape.bx) / 2, (shape.ay + shape.by) / 2,
                    Math.atan2(shape.by - shape.ay, shape.bx - shape.ax));
            }
        });
        this.worldObjects = [...chunks.values()].map(({ cx, cy, marks }) => {
            const key = `track-reflectors-${cx}-${cy}`;
            if (!scene.textures.exists(key)) {
                // Meia resolução: cada linha de 2 px ocupa um texel. Reduz
                // o uso de memória destas texturas em 75%, inclusive no celular.
                const texture = scene.textures.createCanvas(key, SIZE / 2, SIZE / 2), ctx = texture.getContext();
                ctx.scale(0.5, 0.5);
                for (const { x, y, angle, color } of marks) {
                    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
                    ctx.fillStyle = '#07111d'; ctx.fillRect(-11, -4, 22, 8);
                    ctx.globalAlpha = 0.15; ctx.fillStyle = color;
                    ctx.fillRect(-16, -9, 32, 18);
                    ctx.globalAlpha = 0.7; ctx.fillRect(-8, -1, 16, 2);
                    ctx.globalAlpha = 0.85; ctx.fillStyle = '#d5eff8'; ctx.fillRect(-7, -1, 3, 1);
                    ctx.restore();
                }
                texture.refresh();
            }
            return scene.add.image(cx * SIZE, cy * SIZE, key).setOrigin(0).setScale(2).setDepth(470).setVisible(false);
        });
        this.update();
    }
    update() {
        const view = this.scene.cameras.main.worldView;
        const left = Math.floor(view.x / SIZE) - 1, top = Math.floor(view.y / SIZE) - 1;
        const right = Math.floor(view.right / SIZE) + 1, bottom = Math.floor(view.bottom / SIZE) + 1;
        const key = `${left},${top},${right},${bottom}`;
        if (key === this.viewKey) return;
        this.viewKey = key;
        for (const image of this.worldObjects) {
            const x = image.x / SIZE, y = image.y / SIZE;
            image.setVisible(x >= left && x <= right && y >= top && y <= bottom);
        }
    }
}
