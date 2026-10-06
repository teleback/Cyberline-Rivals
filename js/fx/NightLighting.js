// Sources come from reviewed luminous parts of the art, never layer names.
// Cached static light blocks work on both Canvas and WebGL renderers.
import StaticNightLights from './StaticNightLights.js';
import CarLighting from './CarLighting.js';
import { getCarSkin } from '../objects/CarSkins.js';

export function collectNightSources(map, layers, definitions) {
    const patches = [];
    const groups = new Map();
    const lookup = new Map();
    for (const tileset of map.tilesets) {
        for (const [localId, source] of Object.entries(definitions.tilesets[tileset.name] || {})) {
            lookup.set(tileset.firstgid + Number(localId), source);
        }
    }
    layers.forEach((layer, layerIndex) => {
        if (!layer.visible) return;
        for (const row of layer.layer.data) for (const tile of row) {
            if (!tile || tile.index < 0) continue;
            const source = lookup.get(tile.index);
            if (!source) continue;
            const x = layer.x + tile.pixelX + tile.width / 2;
            const y = layer.y + tile.pixelY + tile.height / 2;
            patches.push({ x, y, frame: source.frame, rotation: tile.rotation,
                flipX: tile.flipX, flipY: tile.flipY, alpha: layer.alpha });
            for (const region of source.regions) {
                const key = `${layerIndex}:${region.id}`;
                if (!groups.has(key)) groups.set(key, { id: region.id, cells: new Map() });
                let dx = (region.x - 32) * (tile.flipX ? -1 : 1);
                let dy = (region.y - 32) * (tile.flipY ? -1 : 1);
                const cos = Math.cos(tile.rotation || 0), sin = Math.sin(tile.rotation || 0);
                groups.get(key).cells.set(`${tile.x},${tile.y}`, {
                    tileX: tile.x, tileY: tile.y, x: x + dx * cos - dy * sin,
                    y: y + dx * sin + dy * cos, weight: region.count,
                });
            }
        }
    });
    const lights = [];
    for (const { id, cells } of groups.values()) {
        // Join neighboring fragments into one light per sign/display/lamp.
        // Separate copies of the same atlas artwork remain separate lights.
        while (cells.size) {
            const first = cells.keys().next().value;
            const queue = [cells.get(first)];
            cells.delete(first);
            let x = 0, y = 0, weight = 0;
            for (let cursor = 0; cursor < queue.length; cursor++) {
                const cell = queue[cursor];
                x += cell.x * cell.weight;
                y += cell.y * cell.weight;
                weight += cell.weight;
                for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                    const key = `${cell.tileX + dx},${cell.tileY + dy}`;
                    if (!cells.has(key)) continue;
                    queue.push(cells.get(key));
                    cells.delete(key);
                }
            }
            lights.push({ id, x: x / weight, y: y / weight, ...definitions.regions[id] });
        }
    }
    return { patches, lights };
}

export default class NightLighting {
    constructor(scene) {
        this.scene = scene;
        this.worldObjects = [];
        this.carLights = new Map();
        const sources = collectNightSources(scene.map, scene.mapLayers, scene.cache.json.get('nightSources'));
        // The night wash covers the world, cars and effects. The separate UI
        // camera ignores it, keeping the HUD and minimap clear.
        this.wash = scene.add.rectangle(0, 0, 1, 1, 0x03091c, 0.18)
            .setScrollFactor(0).setDepth(1700);
        this.worldObjects.push(this.wash);
        this.staticLights = new StaticNightLights(scene, sources, color => this.createGlowTexture(color));
        this.worldObjects.push(this.staticLights.container);
        this.addCar(scene.car, scene.carSkin);
        this.update();
    }

    addCar(car, skin) {
        if (this.carLights.has(car)) return;
        const lights = new CarLighting(this.scene, car, color => this.createGlowTexture(color), getCarSkin(skin).neon);
        this.carLights.set(car, lights);
        this.worldObjects.push(...lights.worldObjects);
        if (this.scene.uiCam) this.scene.uiCam.ignore(lights.worldObjects);
    }

    removeCar(car) {
        const lights = this.carLights.get(car);
        if (!lights) return;
        lights.destroy();
        this.worldObjects = this.worldObjects.filter(sprite => !lights.worldObjects.includes(sprite));
        this.carLights.delete(car);
    }

    createGlowTexture(color = [255, 255, 255]) {
        const textures = this.scene.textures;
        const key = color.every(value => value === 255)
            ? 'night-soft-glow' : `night-soft-glow-${color.join('-')}`;
        if (textures.exists(key)) return key;
        const texture = textures.createCanvas(key, 128, 128);
        const context = texture.getContext();
        const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, `rgba(${color.join(',')},0.9)`);
        gradient.addColorStop(0.15, `rgba(${color.join(',')},0.6)`);
        gradient.addColorStop(0.45, `rgba(${color.join(',')},0.22)`);
        gradient.addColorStop(1, `rgba(${color.join(',')},0)`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, 128, 128);
        texture.refresh();
        return key;
    }

    update() {
        const camera = this.scene.cameras.main;
        this.wash.setPosition(camera.width / 2, camera.height / 2)
            .setDisplaySize(camera.width / camera.zoom + 4, camera.height / camera.zoom + 4);
        this.staticLights.update(camera.worldView);
        for (const lights of this.carLights.values()) lights.update();
    }
}
