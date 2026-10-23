const DEPTH = 8200;
const GOLD = 0xffc968;
const CYAN = 0x69dcf5;

/** A quiet, code-drawn night city behind the victory ceremony. */
export default function drawResultsBackdrop(owner) {
    const { scene } = owner;
    const { width: w, height: h } = scene.scale;
    const sky = owner.register(scene.add.graphics(), DEPTH);
    const stage = owner.register(scene.add.graphics(), DEPTH + 1);
    const horizon = h * 0.49;
    const unit = Math.min(w / 800, h / 450);

    const polygon = (graphics, color, alpha, points) => {
        graphics.fillStyle(color, alpha);
        graphics.fillPoints(points.map(([x, y]) => ({ x, y })), true);
    };
    const line = (graphics, color, alpha, x1, y1, x2, y2, thickness = 1) => {
        graphics.lineStyle(Math.max(0.5, thickness * unit), color, alpha);
        graphics.lineBetween(x1, y1, x2, y2);
    };
    // Nested translucent ellipses work in both Canvas and WebGL renderers.
    const glow = (graphics, color, x, y, width, height, alpha) => {
        for (let layer = 12; layer > 0; layer--) {
            const radius = layer / 12;
            graphics.fillStyle(color, alpha * (1 - radius * 0.55));
            graphics.fillEllipse(x, y, width * radius, height * radius);
        }
    };

    sky.fillStyle(0x060a18, 1);
    sky.fillRect(0, 0, w, h);
    // Faint horizontal atmospheric bands give the skyline a violet horizon.
    for (let band = 0; band < 30; band++) {
        const t = band / 29;
        sky.fillStyle(0x29213f, 0.07 + t * t * 0.26);
        sky.fillRect(0, h * 0.06 + band * h * 0.015, w, h * 0.015 + 1);
    }
    glow(sky, 0x665594, w * 0.53, h * 0.39, w * 0.85, h * 0.64, 0.018);
    glow(sky, GOLD, w * 0.19, h * 0.43, w * 0.52, h * 0.57, 0.006);
    glow(sky, CYAN, w * 0.87, h * 0.42, w * 0.56, h * 0.68, 0.007);

    // Deterministic placement avoids a different city each time results open.
    for (let star = 0; star < 38; star++) {
        const x = ((star * 173 + 41) % 997) / 997 * w;
        const y = ((star * 67 + 13) % 193) / 193 * h * 0.3;
        sky.fillStyle(star % 7 === 0 ? GOLD : 0xc4d5f2, star % 5 === 0 ? 0.28 : 0.11);
        sky.fillCircle(x, y, star % 7 === 0 ? 0.9 * unit : 0.55 * unit);
    }

    const distantBuildings = [
        [0.00, 0.045, 0.092], [0.043, 0.033, 0.14], [0.079, 0.052, 0.086],
        [0.135, 0.031, 0.18], [0.170, 0.06, 0.115], [0.238, 0.026, 0.21],
        [0.267, 0.038, 0.14], [0.310, 0.052, 0.075], [0.369, 0.035, 0.13],
        [0.414, 0.046, 0.087], [0.469, 0.035, 0.15], [0.511, 0.05, 0.10],
        [0.568, 0.028, 0.19], [0.604, 0.045, 0.12], [0.658, 0.031, 0.15],
        [0.696, 0.056, 0.08], [0.760, 0.031, 0.18], [0.800, 0.05, 0.11],
        [0.860, 0.035, 0.15], [0.902, 0.045, 0.08], [0.953, 0.047, 0.17],
    ];
    distantBuildings.forEach(([left, breadth, rise], index) => {
        const x = left * w, bw = breadth * w, top = horizon - rise * h;
        sky.fillStyle(index % 3 === 0 ? 0x151c31 : 0x11182b, 1);
        sky.fillRect(x, top, bw, horizon - top);
        if (index % 3 === 0) {
            sky.fillRect(x + bw * 0.26, top - h * 0.012, bw * 0.48, h * 0.014);
            line(sky, 0x59617c, 0.32, x + bw * 0.5, top - h * 0.04,
                x + bw * 0.5, top - h * 0.012);
        }
        // Sparse lit offices give the buildings detail without a noisy texture.
        for (let row = 0; row < 7; row++) {
            for (let column = 0; column < 3; column++) {
                if ((index * 5 + row * 3 + column * 7) % 5 > 1) continue;
                sky.fillStyle(index % 4 === 0 ? GOLD : 0x88a9cc, 0.11 + (row % 2) * 0.05);
                sky.fillRect(x + bw * (0.16 + column * 0.25), top + h * 0.018 + row * h * 0.014,
                    Math.max(1, bw * 0.075), Math.max(1, h * 0.005));
            }
        }
    });

    // A pair of signature towers frames the ceremony, with inset rooftop crowns.
    [
        { x: w * 0.075, width: w * 0.055, top: h * 0.20, color: GOLD },
        { x: w * 0.87, width: w * 0.065, top: h * 0.17, color: CYAN },
    ].forEach(tower => {
        const { x, width, top, color } = tower;
        polygon(sky, 0x0b1223, 1, [
            [x, horizon], [x, top + h * 0.035], [x + width * 0.23, top + h * 0.035],
            [x + width * 0.23, top], [x + width * 0.74, top],
            [x + width * 0.74, top + h * 0.035], [x + width, top + h * 0.035], [x + width, horizon],
        ]);
        line(sky, color, 0.22, x + width * 0.23, top, x + width * 0.74, top);
        line(sky, color, 0.16, x + width * 0.74, top, x + width * 0.74, horizon);
        line(sky, color, 0.25, x + width * 0.49, top - h * 0.042, x + width * 0.49, top);
        sky.fillStyle(color, 0.5);
        sky.fillCircle(x + width * 0.49, top - h * 0.042, Math.max(0.7, unit));
        for (let row = 0; row < 9; row++) {
            const y = top + h * 0.055 + row * h * 0.02;
            line(sky, color, row % 3 === 0 ? 0.24 : 0.08, x + width * 0.2, y, x + width * 0.59, y);
        }
    });

    // Elevated expressway, piers and suspended cables at the city edge.
    const deckY = horizon - h * 0.025;
    sky.fillStyle(0x0a1120, 1);
    sky.fillRect(0, deckY, w, h * 0.019);
    line(sky, 0x7094bc, 0.26, 0, deckY, w, deckY);
    for (let pier = 0; pier < 12; pier++) {
        const x = w * (pier + 0.45) / 12;
        sky.fillStyle(0x080f1d, 1);
        sky.fillRect(x, deckY, Math.max(2, w * 0.005), h * 0.06);
        line(sky, pier < 6 ? GOLD : CYAN, 0.24, x, deckY - 2 * unit,
            x + w * 0.023, deckY - 2 * unit);
    }
    [w * 0.18, w * 0.82].forEach(x => {
        const top = deckY - h * 0.095;
        line(sky, 0x31405b, 0.55, x, top, x, deckY, 2);
        for (let cable = -3; cable <= 3; cable++) {
            line(sky, 0x4f6284, 0.14, x, top, x + cable * w * 0.022, deckY);
        }
    });

    // The polished apron gives the podium a real ground plane.
    stage.fillStyle(0x080e1c, 1);
    stage.fillRect(0, horizon, w, h - horizon);
    glow(stage, 0x3d426c, w * 0.5, horizon, w * 1.1, h * 0.28, 0.018);
    const vanishX = w * 0.5, vanishY = horizon - h * 0.07;
    for (let ray = -8; ray <= 8; ray++) {
        const bottomX = vanishX + ray * w * 0.12;
        const horizonX = vanishX + (bottomX - vanishX) * (horizon - vanishY) / (h - vanishY);
        line(stage, 0x506784, ray % 2 === 0 ? 0.19 : 0.095,
            horizonX, horizon, bottomX, h);
    }
    for (let row = 0; row < 10; row++) {
        const distance = ((row + 1) / 10) ** 2.05;
        const y = horizon + distance * (h - horizon);
        line(stage, 0x506784, 0.10 + distance * 0.07, 0, y, w, y);
    }
    // Recessed runway lights lead into the two display platforms.
    [
        { x: w * 0.24, color: GOLD },
        { x: w * 0.76, color: CYAN },
    ].forEach(({ x, color }) => {
        const bottomLeft = x - w * 0.10, bottomRight = x + w * 0.10;
        [bottomLeft, bottomRight].forEach(bottomX => {
            const startX = vanishX + (bottomX - vanishX) * 0.1;
            line(stage, color, 0.035, startX, horizon, bottomX, h, 7);
            line(stage, color, 0.21, startX, horizon, bottomX, h);
        });
        glow(stage, color, x, h * 0.74, w * 0.43, h * 0.25, 0.012);

        // Wide light cones are kept behind the foreground panels.
        polygon(stage, color, 0.022, [
            [x - w * 0.075, h * 0.70], [x + w * 0.075, h * 0.70],
            [x + w * 0.22, h * 0.08], [x - w * 0.15, h * 0.08],
        ]);
        polygon(stage, color, 0.023, [
            [x - w * 0.035, h * 0.70], [x + w * 0.035, h * 0.70],
            [x + w * 0.12, h * 0.13], [x - w * 0.065, h * 0.13],
        ]);
    });

    // Dark framing and fine illuminated trim keep attention on the winners.
    stage.fillStyle(0x030712, 0.52);
    stage.fillRect(0, 0, w, h * 0.018);
    stage.fillRect(0, h * 0.955, w, h * 0.045);
    line(stage, GOLD, 0.46, 0, h * 0.019, w * 0.21, h * 0.019);
    line(stage, CYAN, 0.46, w * 0.79, h * 0.019, w, h * 0.019);
    line(stage, 0x42516e, 0.28, 0, h * 0.955, w, h * 0.955);
    return { sky, stage };
}
