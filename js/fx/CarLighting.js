export function carLightPose(car) {
    return { x: car.x + Math.sin(car.rotation) * 48 * car.scaleY,
        y: car.y - Math.cos(car.rotation) * 48 * car.scaleY, rotation: car.rotation };
}

// Luzes reutilizadas por carro, abaixo dos elementos de primeiro plano.
export default class CarLighting {
    constructor(scene, car, glowTexture, color) {
        this.car = car;
        this.createHeadlights(scene);
        const rgb = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
        this.underglow = scene.add.image(car.x, car.y, glowTexture(rgb))
            .setDepth(car.depth - 2).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.2);
        this.headlights = scene.add.image(car.x, car.y, 'car-headlights')
            .setOrigin(0.5, 1).setDepth(car.depth - 3)
            .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.62);
        this.highlight = scene.add.image(car.x, car.y, car.texture.key, car.frame.name)
            .setDepth(car.depth + 0.1).setBlendMode(Phaser.BlendModes.ADD);
        this.tailLights = [-1, 1].map(() => scene.add.image(car.x, car.y, glowTexture([255, 46, 58]))
            .setDepth(car.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD));
        this.worldObjects = [this.headlights, this.underglow, this.highlight, ...this.tailLights];
        this.update();
    }

    createHeadlights(scene) {
        if (scene.textures.exists('car-headlights')) return;
        const texture = scene.textures.createCanvas('car-headlights', 192, 240);
        const context = texture.getContext();
        const pixels = context.createImageData(192, 240);
        const centers = [78, 114];
        // Soft edges and a fading reach, calculated once rather than using
        // blur shaders or redrawing the beams as the cars turn.
        for (let y = 0; y < 240; y++) {
            const distance = (239 - y) / 239;
            const width = 7 + 65 * distance;
            for (let x = 0; x < 192; x++) {
                let intensity = 0;
                for (const center of centers) {
                    const edge = Math.max(0, 1 - Math.abs(x - center) / width);
                    intensity += edge * edge * (1 - distance) ** 1.5 * 0.65;
                }
                const offset = (y * 192 + x) * 4;
                pixels.data[offset] = 210;
                pixels.data[offset + 1] = 230;
                pixels.data[offset + 2] = 255;
                pixels.data[offset + 3] = Math.round(Math.min(1, intensity) * 255);
            }
        }
        context.putImageData(pixels, 0, 0);
        texture.refresh();
    }

    update() {
        const car = this.car;
        const visible = car.active && car.visible && car.alpha > 0;
        for (const sprite of this.worldObjects) sprite.setVisible(visible);
        if (!visible) return;
        const pose = carLightPose(car);
        this.headlights.setPosition(pose.x, pose.y).setRotation(pose.rotation)
            .setScale(car.scaleX, car.scaleY).setAlpha(car.alpha * 0.62);
        this.underglow.setPosition(car.x, car.y).setRotation(car.rotation)
            .setDisplaySize(115 * car.scaleX, 165 * car.scaleY).setAlpha(car.alpha * 0.2);
        if (this.highlight.texture.key !== car.texture.key || this.highlight.frame.name !== car.frame.name) {
            this.highlight.setTexture(car.texture.key, car.frame.name);
        }
        this.highlight.setPosition(car.x, car.y).setRotation(car.rotation)
            .setScale(car.scaleX, car.scaleY).setFlip(car.flipX, car.flipY)
            .setTint(car.tintTopLeft).setAlpha(car.alpha * 0.12);
        const braking = car.isBraking ?? car.networkControls?.braking;
        const sin = Math.sin(car.rotation), cos = Math.cos(car.rotation);
        this.tailLights.forEach((light, index) => {
            const side = index === 0 ? -21 : 21;
            light.setPosition(car.x - sin * 50 * car.scaleY + cos * side * car.scaleX,
                car.y + cos * 50 * car.scaleY + sin * side * car.scaleX)
                .setDisplaySize((braking ? 34 : 20) * car.scaleX, (braking ? 34 : 20) * car.scaleY)
                .setAlpha(car.alpha * (braking ? 0.78 : 0.24));
        });
    }

    destroy() {
        for (const sprite of this.worldObjects) sprite.destroy();
    }
}
