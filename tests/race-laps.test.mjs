import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

globalThis.window = {
    location: { search: '?touch=0' }, addEventListener() {},
    matchMedia: () => ({ matches: false }),
};
globalThis.Phaser = {
    Scene: class {}, Physics: { Arcade: { Sprite: class {} } },
    Events: { EventEmitter }, BlendModes: { ADD: 1 },
    Math: { Clamp: (value, min, max) => Math.max(min, Math.min(max, value)) },
};
const { default: Race, CHECKPOINT_GATES } = await import('../js/scenes/RaceScene.js');

function raceFixture() {
    const race = new Race();
    const events = { resets: [], finishes: 0, checkpoints: [], warnings: [] };
    const gates = CHECKPOINT_GATES.map((shape, index) => ({
        ...shape, width: shape.w, height: shape.h, checkpointCooldownUntil: 0,
        getData(name) { return name === 'index' ? index : shape.name; },
    }));
    Object.assign(race, {
        car: { x: 5152, y: 3488, width: 102, height: 166,
            body: { velocity: { x: 0, y: 0 } } },
        previousCarX: 5152, previousCarY: 3488,
        time: { now: 1000 },
        lapArmed: false, currentLap: 1, completedLaps: 0, totalLaps: 3,
        checkpointIndex: 0, checkpointCount: gates.length, checkpoints: gates,
        finishLineX: 5152, finishLineYMin: 3308, finishLineYMax: 3668,
        raceFinished: false,
        lapLabel: { setText(text) { this.text = text; return this; } },
        tweens: { add() {} },
        brickCollectibles: { resetForLap(lap) { events.resets.push(lap); } },
        updateCheckpointHud(message) { if (message) events.warnings.push(message); },
        playCheckpointFeedback(index) { events.checkpoints.push(index); },
        finishRace() { events.finishes++; this.raceFinished = true; },
    });
    return { race, events };
}

function move(race, x, y) {
    // Simula os frames de aproximação da pista antes da posição a testar.
    race.car.x = race.previousCarX = x;
    race.car.y = race.previousCarY = y;
    race.time.now += 1000;
}
function crossFinish(race, y = 3488, from = 5180, to = 5138) {
    race.previousCarX = from;
    race.previousCarY = y;
    race.car.x = to;
    race.car.y = y;
    race.updateLapSystem();
}

test('the checkpoints are centered across both lanes of the actual track', () => {
    assert.equal(CHECKPOINT_GATES.length, 4);
    assert.deepEqual(CHECKPOINT_GATES.map(cp => cp.name), ['CP1', 'CP2', 'CP3', 'CP4']);
    assert.equal(CHECKPOINT_GATES[0].y, 54.5 * 64, 'the bottom straight is y=3488, not its lower edge');
    assert.equal(CHECKPOINT_GATES[3].x, 80.5 * 64, 'CP4 must lie on the right-hand stretch of track');

    for (const lane of [-140, 140]) {
        const { race, events } = raceFixture();
        const positions = [
            [3872, 3488 + lane],
            [544 + lane, 1824],
            [3872, 928 + lane],
            [5152 + lane, 2208],
        ];
        positions.forEach(([x, y], index) => {
            move(race, x, y);
            race.checkCheckpointFallback();
            assert.equal(race.checkpointIndex, index + 1,
                `checkpoint ${index + 1} missed lane offset ${lane}`);
        });
        assert.deepEqual(events.checkpoints, [0, 1, 2, 3]);
    }
});

test('fallback registers a gate crossed between frames without landing inside it', () => {
    const { race } = raceFixture();
    const cp1 = CHECKPOINT_GATES[0];
    race.previousCarX = cp1.x + 600;
    race.previousCarY = cp1.y - 120;
    race.car.x = cp1.x - 600;
    race.car.y = cp1.y - 120;
    race.checkCheckpointFallback();
    assert.equal(race.checkpointIndex, 1);

    // A diagonal passing well outside the gate must not be credited.
    move(race, 544 + 700, 1824 + 800);
    race.previousCarX = 544 + 700;
    race.previousCarY = 1824 + 1000;
    race.checkCheckpointFallback();
    assert.equal(race.checkpointIndex, 1);
});

test('a finish-line crossing is measured at its intersection, not the frame endpoint', () => {
    const { race } = raceFixture();
    race.checkpointIndex = 4;
    race.lapArmed = true;
    race.previousCarX = 5180;
    race.previousCarY = 3488;
    race.car.x = 5110;
    race.car.y = 3800; // outside finish bounds, but within bounds at crossing
    race.car.body.velocity.x = 0;
    race.updateLapSystem();
    assert.equal(race.completedLaps, 1);
});

test('each player completes exactly three laps, in either lane, without a fourth', () => {
    for (const lane of [-120, 120]) {
        const { race, events } = raceFixture();
        for (let lap = 1; lap <= 3; lap++) {
            const positions = [
                [3872, 3488 + lane],
                [544 + lane, 1824],
                [3872, 928 + lane],
                [5152 + lane, 2208],
            ];
            for (let index = 0; index < positions.length; index++) {
                move(race, ...positions[index]);
                race.checkCheckpointFallback();
                race.updateLapSystem();
                assert.equal(race.checkpointIndex, index + 1);
            }
            assert.equal(race.lapArmed, true);
            crossFinish(race, 3488 + lane);
            assert.equal(race.completedLaps, lap);
            assert.equal(race.currentLap, Math.min(lap + 1, 3));
            assert.equal(events.finishes, lap === 3 ? 1 : 0);
            assert.equal(events.resets.length, Math.min(lap, 2));
        }
        crossFinish(race);
        assert.equal(events.finishes, 1, 'a finished race may not count another lap');
        assert.equal(events.checkpoints.length, 12);
    }
});

test('missing a checkpoint, racing backward, or idling on the line never gives a lap', () => {
    const { race, events } = raceFixture();
    race.lapArmed = true;
    race.checkpointIndex = 3;
    crossFinish(race);
    assert.equal(race.completedLaps, 0);
    assert.equal(race.checkpointIndex, 3);
    assert.equal(events.warnings.length, 1);

    race.checkpointIndex = 4;
    crossFinish(race, 3488, 5130, 5180); // wrong direction
    assert.equal(race.completedLaps, 0);
    race.previousCarX = 5150;
    race.previousCarY = 3488;
    race.car.x = 5150;
    race.updateLapSystem();
    assert.equal(race.completedLaps, 0);
});
