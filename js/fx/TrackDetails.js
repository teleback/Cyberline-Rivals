const SIZE = 512;
const GLOW_RADIUS = 56;
const COLORS = ['#36e7ff', '#36e7ff', '#bd72ff', '#ff4bce'];
const SPACING = 128;
const MIN_SPACING = GLOW_RADIUS * 2;

export function buildTrackReflectors(shapes) {
    const candidates = [];
    const add = (x, y, angle, priority) => candidates.push({
        // Align the fixtures to the half-resolution texture's pixel grid.
        x: Math.round(x / 2) * 2, y: Math.round(y / 2) * 2,
        angle: ((angle % Math.PI) + Math.PI) % Math.PI, priority,
    });
    for (const shape of shapes) {
        if (shape.type === 'rect') {
            const horizontal = shape.width >= shape.height;
            const start = horizontal ? shape.x : shape.y;
            const length = horizontal ? shape.width : shape.height;
            // A shared world-space interval lines up opposite curbs, even
            // when the collision rectangles begin at different positions.
            const first = Math.ceil((start + 24 - SPACING / 2) / SPACING) * SPACING + SPACING / 2;
            for (let position = first; position <= start + length - 24; position += SPACING) {
                add(horizontal ? position : shape.x + shape.width / 2,
                    horizontal ? shape.y + shape.height / 2 : position, horizontal ? 0 : Math.PI / 2, 0);
            }
        } else if (shape.type === 'segment') {
            add((shape.ax + shape.bx) / 2, (shape.ay + shape.by) / 2,
                Math.atan2(shape.by - shape.ay, shape.bx - shape.ax), 1);
        }
    }
    // Prefer straight sections at joins. Collision data contains overlapping
    // segments, so its order and number must not decide visual density.
    candidates.sort((a, b) => a.priority - b.priority || a.y - b.y || a.x - b.x || a.angle - b.angle);
    const marks = [];
    for (const candidate of candidates) {
        if (marks.some(mark => Math.hypot(mark.x - candidate.x, mark.y - candidate.y) < MIN_SPACING)) continue;
        const { priority, ...mark } = candidate;
        marks.push(mark);
    }
    return marks.sort((a, b) => a.y - b.y || a.x - b.x).map(mark => {
        const along = Math.abs(Math.cos(mark.angle)) >= Math.abs(Math.sin(mark.angle)) ? mark.x : mark.y;
        return { ...mark, color: COLORS[Math.abs(Math.floor(along / SPACING)) % COLORS.length] };
    });
}

// Refletores e pequenas reflexões são pintados uma vez em blocos de textura.
// Sem shaders, partículas de ambiente ou redesenho do circuito a cada frame.
export default class TrackDetails {
    constructor(scene, shapes) {
        this.scene = scene;
        const chunks = new Map();
        const mark = (x, y, angle, color) => {
            // Paint the same spill into adjacent blocks so a neon near a
            // texture edge has no visible seam.
            for (let cy = Math.floor((y - GLOW_RADIUS) / SIZE); cy <= Math.floor((y + GLOW_RADIUS) / SIZE); cy++) {
                for (let cx = Math.floor((x - GLOW_RADIUS) / SIZE); cx <= Math.floor((x + GLOW_RADIUS) / SIZE); cx++) {
                    const key = `${cx},${cy}`;
                    if (!chunks.has(key)) chunks.set(key, { cx, cy, marks: [] });
                    chunks.get(key).marks.push({ x: x - cx * SIZE, y: y - cy * SIZE, angle, color });
                }
            }
        };
        for (const { x, y, angle, color } of buildTrackReflectors(shapes)) mark(x, y, angle, color);
        this.worldObjects = [...chunks.values()].map(({ cx, cy, marks }) => {
            const key = `track-reflectors-${cx}-${cy}`;
            if (!scene.textures.exists(key)) {
                // Meia resolução: cada linha de 2 px ocupa um texel. Reduz
                // o uso de memória destas texturas em 75%, inclusive no celular.
                const texture = scene.textures.createCanvas(key, SIZE / 2, SIZE / 2), ctx = texture.getContext();
                ctx.scale(0.5, 0.5);
                for (const { x, y, angle, color } of marks) {
                    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
                    ctx.save(); ctx.scale(1, 0.55);
                    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, GLOW_RADIUS);
                    glow.addColorStop(0, `${color}8c`);
                    glow.addColorStop(0.3, `${color}38`);
                    glow.addColorStop(1, `${color}00`);
                    ctx.fillStyle = glow;
                    ctx.fillRect(-GLOW_RADIUS, -GLOW_RADIUS, GLOW_RADIUS * 2, GLOW_RADIUS * 2);
                    ctx.restore();
                    ctx.fillStyle = '#07111d'; ctx.fillRect(-16, -4, 32, 8);
                    ctx.globalAlpha = 0.3; ctx.fillStyle = color;
                    ctx.fillRect(-19, -6, 38, 12);
                    ctx.globalAlpha = 1; ctx.fillRect(-13, -2, 26, 4);
                    ctx.globalAlpha = 0.9; ctx.fillStyle = '#dcfbff'; ctx.fillRect(-10, -1, 20, 2);
                    ctx.restore();
                }
                texture.refresh();
                // Power-of-two canvases repeat by default in WebGL. Sampling
                // their opposite edge leaks neon into a thin line on the road.
                texture.setWrap(Phaser.Textures.WrapMode.CLAMP_TO_EDGE);
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
