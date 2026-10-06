// Centerline in clockwise order, beginning at the finish line. Projection
// onto the course compares drivers on curves and parallel stretches alike.
const ROUTE_TILES = [
    [80.5,54.5],[40.5,54.5],[38.5,53.5],[37.5,51.5],[37.5,43.5],
    [36.5,41.5],[34.5,39.5],[29.5,39.5],[27.5,40.5],[26.5,42.5],
    [26.5,50.5],[25.5,53.5],[23.5,54.5],[10.5,54.5],[8.5,53.5],
    [7.5,51.5],[7.5,46.5],[8.5,44.5],[10.5,44.5],[15.5,44.5],
    [17.5,43.5],[17.5,36.5],[16.5,35.5],[14.5,34.5],[10.5,34.5],
    [8.5,33.5],[7.5,31.5],[7.5,17.5],[8.5,15.5],[10.5,14.5],
    [19.5,14.5],[21.5,15.5],[22.5,17.5],[22.5,27.5],[23.5,29.5],
    [25.5,29.5],[34.5,29.5],[36.5,28.5],[37.5,26.5],[37.5,17.5],
    [38.5,15.5],[40.5,14.5],[59.5,14.5],[61.5,15.5],[62.5,17.5],
    [62.5,30.5],[61.5,32.5],[59.5,34.5],[55.5,34.5],[53.5,35.5],
    [52.5,37.5],[53.5,39.5],[55.5,40.5],[56.5,42.5],[58.5,44.5],
    [69.5,44.5],[71.5,43.5],[72.5,41.5],[72.5,33.5],[73.5,31.5],
    [75.5,30.5],[77.5,30.5],[79.5,31.5],[80.5,33.5],[80.5,41.5],
    [81.5,43.5],[83.5,44.5],[85.5,44.5],[87.5,45.5],[88.5,47.5],
    [88.5,51.5],[87.5,53.5],[85.5,54.5],[80.5,54.5],
];

export function createRaceRoute(tileWidth = 64, tileHeight = 64) {
    const points = ROUTE_TILES.map(([x,y]) => ({ x:x * tileWidth, y:y * tileHeight }));
    let total = 0;
    const segments = points.slice(1).map((end, index) => {
        const start = points[index], dx = end.x - start.x, dy = end.y - start.y;
        const length = Math.hypot(dx, dy), offset = total;
        total += length;
        return { start, dx, dy, length, offset };
    });
    return { segments, total };
}

export function courseDistance(route, driver) {
    let nearest = Infinity, distance = 0;
    for (const segment of route.segments) {
        const dx = driver.x - segment.start.x, dy = driver.y - segment.start.y;
        const t = Math.max(0, Math.min(1, (dx * segment.dx + dy * segment.dy) / (segment.length ** 2)));
        const gap = (dx - t * segment.dx) ** 2 + (dy - t * segment.dy) ** 2;
        if (gap < nearest) { nearest = gap; distance = segment.offset + segment.length * t; }
    }
    // A newly started lap may still be rendered just behind the line due
    // to network interpolation. It must not be counted as another lap.
    if (driver.checkpoints === 0 && distance > route.total * 0.97) distance = 0;
    return (Math.max(1, driver.lap || 1) - 1) * route.total + distance;
}

export function rankDrivers(route, drivers) {
    return drivers.map(driver => ({ ...driver, distance: courseDistance(route, driver) }))
        .sort((a, b) => {
            if (a.finished && b.finished && Number.isFinite(a.elapsed) && Number.isFinite(b.elapsed)) {
                return a.elapsed - b.elapsed || a.id.localeCompare(b.id);
            }
            if (a.finished !== b.finished) return a.finished ? -1 : 1;
            const delta = b.distance - a.distance;
            return Math.abs(delta) > 1 ? delta : a.id.localeCompare(b.id);
        });
}
