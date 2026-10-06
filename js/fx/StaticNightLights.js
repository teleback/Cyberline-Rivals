const CHUNK_SIZE = 512;
const CACHE_LIMIT = 24;

// Index once. Only nearby blocks are drawn; a bounded LRU avoids allocating
// a full-map texture or keeping hundreds of separate light sprites alive.
export function indexLightChunks(sources) {
    const chunks = new Map();
    const add = (item, radius) => {
        for (let y = Math.floor((item.y - radius) / CHUNK_SIZE); y <= Math.floor((item.y + radius) / CHUNK_SIZE); y++) {
            for (let x = Math.floor((item.x - radius) / CHUNK_SIZE); x <= Math.floor((item.x + radius) / CHUNK_SIZE); x++) {
                const key = `${x},${y}`;
                if (!chunks.has(key)) chunks.set(key, { x: x * CHUNK_SIZE, y: y * CHUNK_SIZE, lights: [], patches: [] });
                chunks.get(key)[item.frame === undefined ? 'lights' : 'patches'].push(item);
            }
        }
    };
    for (const light of sources.lights) add(light, light.radius);
    for (const patch of sources.patches) add(patch, 46);
    return chunks;
}

export default class StaticNightLights {
    constructor(scene, sources, glowTexture) {
        this.scene = scene;
        this.chunks = indexLightChunks(sources);
        this.cache = new Map();
        this.glowTexture = glowTexture;
        this.container = scene.add.container(0, 0).setDepth(1701);
        scene.events.once('shutdown', () => this.destroy());
    }

    bake(key, chunk) {
        const textureKey = `night-block-${key}`;
        const texture = this.scene.textures.createCanvas(textureKey, CHUNK_SIZE, CHUNK_SIZE);
        const context = texture.getContext();
        context.globalCompositeOperation = 'lighter';
        for (const light of chunk.lights) {
            const image = this.scene.textures.get(this.glowTexture(light.color)).getSourceImage();
            context.globalAlpha = 0.26;
            context.drawImage(image, light.x - light.radius - chunk.x, light.y - light.radius - chunk.y,
                light.radius * 2, light.radius * 2);
        }
        context.imageSmoothingEnabled = false;
        for (const patch of chunk.patches) {
            const frame = this.scene.textures.getFrame('night-emissive', patch.frame);
            context.save();
            context.globalAlpha = patch.alpha * 0.68;
            context.translate(patch.x - chunk.x, patch.y - chunk.y);
            context.rotate(patch.rotation || 0);
            context.scale(patch.flipX ? -1 : 1, patch.flipY ? -1 : 1);
            context.drawImage(frame.source.image, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight,
                -32, -32, 64, 64);
            context.restore();
        }
        texture.refresh();
        const image = this.scene.add.image(chunk.x, chunk.y, textureKey)
            .setOrigin(0).setBlendMode(Phaser.BlendModes.ADD);
        this.container.add(image);
        return { image, textureKey };
    }

    update(view) {
        const visible = new Set();
        // A small margin prewarms blocks before they enter the viewport.
        for (let y = Math.floor((view.y - 96) / CHUNK_SIZE); y <= Math.floor((view.bottom + 96) / CHUNK_SIZE); y++) {
            for (let x = Math.floor((view.x - 96) / CHUNK_SIZE); x <= Math.floor((view.right + 96) / CHUNK_SIZE); x++) {
                const key = `${x},${y}`;
                const chunk = this.chunks.get(key);
                if (!chunk) continue;
                visible.add(key);
                const entry = this.cache.get(key) || this.bake(key, chunk);
                this.cache.delete(key);
                this.cache.set(key, entry);
                entry.image.setVisible(chunk.x < view.right && chunk.x + CHUNK_SIZE > view.x
                    && chunk.y < view.bottom && chunk.y + CHUNK_SIZE > view.y);
            }
        }
        for (const [key, entry] of this.cache) {
            if (visible.has(key)) continue;
            entry.image.setVisible(false);
            if (this.cache.size > CACHE_LIMIT) {
                entry.image.destroy();
                this.scene.textures.remove(entry.textureKey);
                this.cache.delete(key);
            }
        }
    }

    destroy() {
        this.container.destroy();
        for (const entry of this.cache.values()) this.scene.textures.remove(entry.textureKey);
        this.cache.clear();
    }
}
