"""Build luminous tile masks from visually reviewed atlas regions.

Run: python3 tools/generate-night-lighting.py (requires Pillow).
Coordinates refer to source PNGs, so Tiled layer names are irrelevant.
Glass, paint, vehicle bodies, roofs and ordinary walls are deliberately excluded.
"""
import colorsys
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "assets/images/tiles/tiles novos"
OUT = ROOT / "assets/images/lighting"

# name, bounds (x, y, width, height), light spread in world pixels.
REGIONS = {
    "objetos": [
        ("vending-blue", (194, 8, 66, 100), 110),
        ("vending-pink", (278, 8, 62, 100), 110),
        ("vending-orange", (362, 8, 62, 100), 110),
        ("vending-green", (442, 8, 62, 100), 110),
        ("terminal", (15, 149, 42, 70), 90),
        ("billboard-blue", (586, 208, 167, 97), 215),
        ("hologram-tree", (821, 65, 140, 142), 135),
        ("cyber-sign", (1094, 48, 175, 42), 170),
        ("strip-lights", (1010, 505, 179, 35), 125),
        ("billboard-green", (546, 594, 190, 104), 215),
        ("buy-terminal", (806, 615, 49, 82), 95),
        ("hologram-ad", (2148, 345, 77, 138), 180),
        ("billboard-pink", (2002, 807, 141, 70), 200),
        ("cyberbar-sign", (2000, 1070, 194, 37), 185),
        ("lamp-right", (1869, 1019, 45, 23), 235),
        ("lamp-left", (1816, 1290, 45, 23), 235),
    ],
    "predios": [
        ("cafe-sign", (110, 262, 255, 45), 195),
        ("cafe-open", (118, 323, 90, 25), 100),
        ("cafe-side", (454, 316, 42, 75), 110),
        ("cybernet-sign", (730, 310, 77, 434), 220),
        ("hotel-sign", (1633, 786, 152, 32), 130),
        ("cafe-purple", (2735, 173, 246, 85), 200),
        ("cafe-purple-side", (3082, 204, 38, 127), 120),
        ("cafe-purple-open", (2768, 365, 111, 32), 110),
        ("cafe-purple-door", (2940, 391, 34, 35), 85),
        ("corner-front", (3400, 361, 98, 157), 150),
        ("corner-side", (3547, 321, 110, 103), 155),
        ("corner-small", (3295, 314, 64, 68), 95),
        ("shops-sign", (2715, 714, 289, 65), 200),
        ("shops-side", (3091, 720, 27, 173), 120),
        ("shops-display", (2860, 881, 147, 95), 135),
        ("tower-terminal", (96, 1848, 45, 59), 95),
        ("blue-vertical", (837, 1368, 78, 106), 130),
        ("blue-billboard", (616, 1598, 299, 107), 210),
        ("blue-door-left", (603, 1798, 41, 67), 90),
        ("blue-door-right", (879, 1798, 42, 67), 90),
        ("favela-green-sign", (1738, 1607, 213, 76), 175),
        ("favela-blue-ad", (2159, 1898, 224, 104), 190),
        ("favela-pink-side", (2740, 1768, 52, 193), 145),
        ("snacks-sign", (3790, 1450, 320, 39), 185),
        ("snacks-display-left", (3798, 1512, 155, 71), 140),
        ("snacks-display-right", (4005, 1512, 86, 64), 125),
        ("snacks-strips", (3735, 1486, 25, 209), 110),
        ("ramen-snacks", (3810, 1750, 285, 53), 190),
        ("ramen-sign", (28, 2218, 321, 93), 210),
        ("ramen-side", (402, 2240, 43, 162), 140),
        ("ramen-menu", (37, 2327, 307, 46), 135),
        ("small-shop-sign", (729, 2365, 86, 25), 90),
        ("stall-hologram", (1212, 2480, 64, 100), 115),
        ("stall-sign", (1239, 2627, 143, 27), 115),
        ("car-wash-sign", (2843, 2640, 212, 30), 160),
    ],
    "placas": [("cafe-yellow", (11, 8, 57, 153), 175)],
}
TILESETS = {"objetos": ("objetos", 40), "predios": ("Prédios", 68), "placas": ("placas", 8)}


def build():
    frames, definitions, region_info = [], {}, {}
    for atlas, regions in REGIONS.items():
        original = Image.open(ART / f"{atlas}.png").convert("RGBA")
        mask = Image.new("RGBA", original.size)
        tiles = {}
        tileset, columns = TILESETS[atlas]
        for name, (left, top, width, height), radius in regions:
            region_id = f"{atlas}/{name}"
            buckets = {}
            for y in range(top, top + height):
                for x in range(left, left + width):
                    r, g, b, a = original.getpixel((x, y))
                    high, low = max(r, g, b), min(r, g, b)
                    lamp = name.startswith("lamp-")
                    if a < 80 or high < (85 if lamp else 135):
                        continue
                    if not lamp and high - low < 35 and high < 205:
                        continue
                    # Lamp housings are neutral grey in the art: brighten only
                    # the reviewed lens, preserving its cool original hue.
                    if lamp:
                        r, g, b = [min(255, round(v * 2.1)) for v in (r, g, b)]
                    mask.putpixel((x, y), (r, g, b, a))
                    local_id = (y // 64) * columns + x // 64
                    stats = tiles.setdefault(local_id, {}).setdefault(region_id, [0, 0, 0])
                    stats[0] += 1
                    stats[1] += x % 64
                    stats[2] += y % 64
                    hue = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[0]
                    bucket = buckets.setdefault(int(hue * 12), [0, 0, 0, 0])
                    bucket[0] += 1
                    for i, v in enumerate((r, g, b)): bucket[i + 1] += v
            if not buckets:
                raise ValueError(f"Empty luminous region: {region_id}")
            dominant = max(buckets.values(), key=lambda bucket: bucket[0])
            color = [round(v / dominant[0]) for v in dominant[1:]]
            # Normalize the sampled hue so the soft halo stays visible at night.
            color = [min(255, round(v * 255 / max(color))) for v in color]
            region_info[region_id] = {"color": color, "radius": radius}
        definitions[tileset] = {}
        for local_id, regions in sorted(tiles.items()):
            x, y = (local_id % columns) * 64, (local_id // columns) * 64
            definitions[tileset][local_id] = {"frame": len(frames), "regions": [
                {"id": region, "count": count, "x": sx / count, "y": sy / count}
                for region, (count, sx, sy) in regions.items()
            ]}
            frames.append(mask.crop((x, y, x + 64, y + 64)))
    sheet = Image.new("RGBA", (1024, ((len(frames) + 15) // 16) * 64))
    for index, frame in enumerate(frames): sheet.paste(frame, ((index % 16) * 64, (index // 16) * 64))
    OUT.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT / "emissive.png", optimize=True)
    (OUT / "sources.json").write_text(json.dumps({"tilesets": definitions, "regions": region_info}, separators=(",", ":")) + "\n")
    print(f"Built {len(frames)} luminous tiles from {len(region_info)} reviewed regions.")


if __name__ == "__main__":
    build()
