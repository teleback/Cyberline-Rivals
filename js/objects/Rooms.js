export const ROOM_COUNT = 10;
export const ROOM_CAPACITY = 2;

const THEMES = [
    { tint: 0xff39d4, color: '#ff39d4' },
    { tint: 0xa855ff, color: '#a855ff' },
    { tint: 0x3995ff, color: '#3995ff' },
];

export const ROOMS = Array.from({ length: ROOM_COUNT }, (_, index) => ({
    id: index + 1, ...THEMES[index % THEMES.length],
}));
