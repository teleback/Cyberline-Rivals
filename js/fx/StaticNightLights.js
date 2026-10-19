const CHUNK_SIZE = 512;
const CACHE_LIMIT = 24;
const VIEW_MARGIN = 96;

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
        // Keep map lights under the night wash so no patch bypasses its tint.
        this.container = scene.add.container(0, 0).setDepth(1699);
        scene.events.once('shutdown', () => this.destroy());
    }

    bake(key, chunk) {
        const textureKey = `night-block-${key}`;
        const texture = this.scene.textures.createCanvas(textureKey, CHUNK_SIZE, CHUNK_SIZE);
        const context = texture.getContext();
        // Alpha blending preserves artwork hues instead of adding the same
        // bright pixels twice and bleaching signs or overlapping halos.
        context.globalCompositeOperation = 'source-over';
        for (const light of chunk.lights) {
            const image = this.scene.textures.get(this.glowTexture(light.color)).getSourceImage();
            context.globalAlpha = 0.18;
            context.drawImage(image, light.x - light.radius - chunk.x, light.y - light.radius - chunk.y,
                light.radius * 2, light.radius * 2);
        }
        context.imageSmoothingEnabled = false;
        for (const patch of chunk.patches) {
            const frame = this.scene.textures.getFrame('night-emissive', patch.frame);
            context.save();
            context.globalAlpha = patch.alpha * 0.52;
            context.translate(patch.x - chunk.x, patch.y - chunk.y);
            context.rotate(patch.rotation || 0);
            context.scale(patch.flipX ? -1 : 1, patch.flipY ? -1 : 1);
            context.drawImage(frame.source.image, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight,
                -32, -32, 64, 64);
            context.restore();
        }
        texture.refresh();
        const image = this.scene.add.image(chunk.x, chunk.y, textureKey)
            .setOrigin(0).setBlendMode(Phaser.BlendModes.NORMAL);
        this.container.add(image);
        return { image, textureKey };
    }

    update(view) {
        const minX = Math.floor((view.x - VIEW_MARGIN) / CHUNK_SIZE);
        const minY = Math.floor((view.y - VIEW_MARGIN) / CHUNK_SIZE);
        const maxX = Math.floor((view.right + VIEW_MARGIN) / CHUNK_SIZE);
        const maxY = Math.floor((view.bottom + VIEW_MARGIN) / CHUNK_SIZE);
        const range = this.range;
        if (range && range.minX === minX && range.minY === minY
            && range.maxX === maxX && range.maxY === maxY) return;
        this.range = { minX, minY, maxX, maxY };
        const nearby = new Set();
        // worldView is finalized during rendering, after the scene update.
        // Keep the margin visible too, so movement and turbo zoom cannot
        // expose a prewarmed block that was hidden using last frame's view.
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const key = `${x},${y}`;
                const chunk = this.chunks.get(key);
                if (!chunk) continue;
                nearby.add(key);
                const entry = this.cache.get(key) || this.bake(key, chunk);
                this.cache.delete(key);
                this.cache.set(key, entry);
                entry.image.setVisible(true);
            }
        }
        for (const [key, entry] of this.cache) {
            if (nearby.has(key)) continue;
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
