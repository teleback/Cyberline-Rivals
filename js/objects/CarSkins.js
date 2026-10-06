// As mesmas texturas são usadas na garagem, na corrida e pelos rivais.
export const CAR_SKINS = [
    { id: 'original', name: 'ROXO NEON', style: 'CLÁSSICO CYBER', texture: 'carro', source: 'carro',
        path: 'assets/images/tiles/tiles novos/carro.png', neon: 0xb45cff, color: '#b45cff' },
    { id: 'pink', name: 'ROSA NEON', style: 'AERODINÂMICO', texture: 'car-pink-v2', source: 'car-source-pink-v2',
        path: 'assets/images/cars/carro-rosa-neon-v2.png', neon: 0xff39d4, color: '#ff39d4' },
    { id: 'blue', name: 'AZUL ESCURO NEON', style: 'BLINDADO', texture: 'car-blue-v2', source: 'car-source-blue-v2',
        path: 'assets/images/cars/carro-azul-escuro-neon-v2.png', neon: 0x3995ff, color: '#3995ff' },
    { id: 'green', name: 'VERDE ESCURO NEON', style: 'BUGGY URBANO', texture: 'car-green-v2', source: 'car-source-green-v2',
        path: 'assets/images/cars/carro-verde-escuro-neon-v2.png', neon: 0x39ff88, color: '#39ff88' },
];

export function getCarSkin(id) {
    const legacy = { cyan: 'original', red: 'pink', lime: 'green', gold: 'original' };
    return CAR_SKINS.find(car => car.id === (legacy[id] || id)) || CAR_SKINS[0];
}

export function loadCarSkins(scene, suffix = '') {
    for (const car of CAR_SKINS) {
        if (!scene.textures.exists(car.source)) scene.load.image(car.source, car.path + suffix);
    }
}

export function prepareCarSkins(scene) {
    for (const car of CAR_SKINS.slice(1)) {
        if (scene.textures.exists(car.texture)) continue;
        const image = scene.textures.get(car.source).getSourceImage();
        const source = document.createElement('canvas');
        source.width = image.width;
        source.height = image.height;
        const context = source.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, source.width, source.height);
        let left = source.width, top = source.height, right = -1, bottom = -1;
        for (let y = 0; y < source.height; y++) {
            for (let x = 0; x < source.width; x++) {
                if (data[(y * source.width + x) * 4 + 3] < 16) continue;
                left = Math.min(left, x); right = Math.max(right, x);
                top = Math.min(top, y); bottom = Math.max(bottom, y);
            }
        }
        if (right < left) throw new Error(`Sprite de carro vazio: ${car.id}`);
        // Mantém o frame 102x166 e a silhueta na posição do carro original,
        // para preservar a escala, os pontos de efeitos e o corpo de colisão.
        const canvas = scene.textures.createCanvas(car.texture, 102, 166);
        const target = canvas.getContext();
        target.imageSmoothingEnabled = false;
        const width = right - left + 1, height = bottom - top + 1;
        const scale = Math.min(64 / width, 119 / height);
        const drawWidth = Math.round(width * scale), drawHeight = Math.round(height * scale);
        target.drawImage(source, left, top, width, height,
            Math.round(49.5 - drawWidth / 2), Math.round(80 - drawHeight / 2), drawWidth, drawHeight);
        canvas.refresh();
    }
}
