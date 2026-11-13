import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

let pad = null;
globalThis.window = { location: { search: '?touch=0' }, addEventListener() {},
    matchMedia: () => ({ matches: false }) };
globalThis.localStorage = { getItem: () => null };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });

class Vector {
    constructor(x = 0, y = 0) { this.set(x, y); }
    set(x, y = x) { this.x = x; this.y = y; return this; }
    clone() { return new Vector(this.x, this.y); }
    scale(value) { this.x *= value; this.y *= value; return this; }
    add(v) { this.x += v.x; this.y += v.y; return this; }
    dot(v) { return this.x * v.x + this.y * v.y; }
    length() { return Math.hypot(this.x, this.y); }
}
class Sprite extends EventEmitter {
    constructor(scene, x, y) { super(); Object.assign(this, { scene, x, y, rotation: Math.PI / 2 }); }
    setOrigin() { return this; }
    setCollideWorldBounds() { return this; }
    setBounce(value) { this.bounce = value; return this; }
    setDamping(value) { this.damping = value; return this; }
    setDrag(value) { this.drag = value; return this; }
    setMaxVelocity(value) { this.body.maxVelocity = new Vector(value, value); return this; }
    setVelocity(x, y) { this.body.velocity.set(x, y); return this; }
    setAngularVelocity(value) { this.body.angularVelocity = value; return this; }
}
globalThis.Phaser = { Scene: class {}, Physics: { Arcade: { Sprite } },
    Events: { EventEmitter }, Input: { Keyboard: { KeyCodes: { SHIFT: 16 } } } };
const { default: Car } = await import('../js/objects/Car.js');
const { default: Race } = await import('../js/scenes/RaceScene.js');
const { readGamepad, startCalibration } = await import('../js/input/GamepadInput.js');
const { CollisionIndex, resolveTravel } = await import('../js/objects/TrackCollisions.js');

function setup(speed = 0) {
    const scene = {
        add: { existing() {} },
        physics: { add: { existing(car) {
            car.body = { velocity: new Vector(speed, 0), acceleration: new Vector(),
                setCircle() {}, get speed() { return this.velocity.length(); } };
        } }, velocityFromRotation(angle, magnitude) {
            return new Vector(Math.cos(angle) * magnitude, Math.sin(angle) * magnitude);
        } },
        input: { keyboard: { addKey: () => ({ isDown: false }), createCursorKeys: () =>
            Object.fromEntries(['up', 'down', 'left', 'right'].map(key => [key, { isDown: false }])) } },
    };
    return new Car(scene, 0, 0, 'carro');
}

test('the real car controller uses one physics integrator and freezes every control before GO', () => {
    const car = setup(200);
    assert.equal(car.drag, 0);
    assert.equal(car.damping, false);
    car.keyAccelerate.isDown = true;
    car.controlsEnabled = false;
    car.body.acceleration.set(500, 500);
    car.update(0, 16);
    assert.equal(car.body.velocity.length(), 0);
    assert.equal(car.body.acceleration.length(), 0);
    assert.equal(car.body.angularVelocity, 0);
    assert.equal(car.networkControls.throttle, false);
    car.controlsEnabled = true;
    car.update(16, 16);
    assert.ok(car.body.velocity.length() > 0);
    assert.equal(car.networkControls.throttle, true);
});

test('braking interrupts turbo without draining more fuel, and reverse cannot activate it', () => {
    const car = setup(250);
    let starts = 0, stops = 0;
    car.on('turbo-start', () => starts++);
    car.on('turbo-stop', () => stops++);
    car.keyAccelerate.isDown = true;
    car.keyShift.isDown = true;
    car.update(100, 16);
    assert.equal(starts, 1);
    assert.equal(car.isTurboActive, true);
    const fuel = car.turboFuel;
    car.keyBrake.isDown = true;
    car.update(116, 16);
    assert.equal(car.isTurboActive, false);
    assert.equal(stops, 1);
    assert.equal(car.turboFuel, fuel);
    assert.equal(car.networkControls.throttle, false);
    assert.equal(car.networkControls.braking, true);
    car.keyBrake.isDown = false;
    car.setVelocity(-100, 0);
    car.update(132, 16);
    assert.equal(starts, 1);
});

test('a track boost extends the radial speed limit and expiry eases back to normal', () => {
    const car = setup(390);
    car.keyAccelerate.isDown = true;
    car.activateTrackBoost(100);
    car.update(116, 16);
    assert.ok(car.maxDriveSpeed > car.baseMaxVelocity);
    assert.ok(car.body.speed > 500);
    const before = car.body.speed;
    car.update(1600, 16);
    assert.equal(car.maxDriveSpeed, car.baseMaxVelocity);
    assert.ok(car.body.speed < before && car.body.speed > car.baseMaxVelocity);
});

test('repeated turbo taps and overlapping track boosts cannot stack unlimited speed', () => {
    const car = setup(390);
    car.keyAccelerate.isDown = true;
    for (let frame = 0; frame < 100; frame++) {
        car.keyShift.isDown = frame % 2 === 0;
        car.activateTrackBoost(frame * 16);
        car.update(frame * 16, 16);
        assert.ok(car.body.speed <= car.baseMaxVelocity * car.turboMaxVelMultiplier
            * car.trackBoostMultiplier + 1e-6);
    }
});

test('wall impact cuts turbo once, blocks immediate reactivation, and ignores light scrapes', () => {
    const car = setup(390);
    car.keyAccelerate.isDown = true;
    car.keyShift.isDown = true;
    car.update(100, 16);
    const hits = [], shakes = [];
    const race = { car, time: { now: 110 }, carFX: { crash: speed => hits.push(speed) },
        cameras: { main: { shake: (...args) => shakes.push(args) } } };
    car.setVelocity(20, 0);
    const fuel = car.turboFuel;
    Race.prototype.onCrash.call(race);
    assert.equal(car.isTurboActive, false);
    assert.equal(car.turboFuel, fuel - 12);
    Race.prototype.onCrash.call(race);
    assert.equal(car.turboFuel, fuel - 12);
    assert.equal(hits.length, 1);
    assert.ok(shakes[0][1] <= 0.005);
    car.update(126, 16);
    assert.equal(car.isTurboActive, false);
    race.time.now = 900;
    Race.prototype.onCrash.call(race, 20);
    assert.equal(hits.length, 1);
});

test('standard analog steering preserves small movements; D-pad and SNES keep full travel', () => {
    pad = { connected: true, id: 'test', mapping: 'standard', axes: [0.10, 0],
        buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
    assert.equal(readGamepad().steering, 0);
    pad.axes[0] = 0.35;
    assert.ok(readGamepad().steering > 0 && readGamepad().steering < 0.3);
    pad.axes[0] = -1;
    assert.equal(readGamepad().steering, -1);
    pad.axes[0] = 0;
    pad.buttons[15].pressed = true;
    assert.equal(readGamepad().steering, 1);
    pad.buttons[14].pressed = true;
    assert.equal(readGamepad().steering, 0);
    pad.buttons[14].pressed = pad.buttons[15].pressed = false;
    pad.mapping = '';
    pad.axes[0] = 0.75;
    assert.equal(readGamepad().steering, 1);
    pad = null;
});

test('after contact the controller avoids pushing into the curb while reverse remains available', () => {
    const car = setup(0);
    car.contact = { x: -1, y: 0, until: 300 };
    car.keyAccelerate.isDown = true;
    car.update(100, 16);
    assert.equal(car.body.velocity.x, 0);
    car.keyAccelerate.isDown = false;
    car.keyBrake.isDown = true;
    for (let i = 0; i < 20; i++) car.update(116 + i * 16, 16);
    assert.ok(car.body.velocity.x < -10);
});

test('short collision recovery preserves a barrel deflection instead of cancelling it with tire grip', () => {
    const car = setup(0);
    car.setVelocity(0, 150);
    car.contact = { x: -1, y: 0, barrel: true, until: 360 };
    car.keyAccelerate.isDown = true;
    car.update(100, 16);
    assert.equal(car.body.velocity.x, 0);
    assert.ok(car.body.velocity.y > 135 && car.body.velocity.y < 150);
    car.keyAccelerate.isDown = false;
    car.keyBrake.isDown = true;
    const before = car.body.velocity.y;
    car.update(116, 16);
    assert.ok(car.body.velocity.y < before * 0.85, 'braking restores full grip for maneuvering');
});

test('holding the accelerator after a frontal wall hit still moves the car away at different frame rates', () => {
    const wall = { type: 'rect', x: 0, y: -1000, width: 10, height: 2000 };
    const index = new CollisionIndex([wall]);
    for (const fps of [30, 60, 120]) {
        const car = setup(390), seconds = 1 / fps;
        car.keyAccelerate.isDown = true;
        let pose = resolveTravel(index, { x: -40, y: 0 }, { x: -20, y: 0 }, car.body.velocity, 24);
        car.setVelocity(pose.vx, pose.vy);
        car.contact = { ...pose.normal, until: 260 };
        const impactX = pose.x;
        for (let frame = 1; frame <= Math.floor(fps * 0.25); frame++) {
            car.update(frame * 1000 / fps, seconds * 1000);
            pose = resolveTravel(index, pose,
                { x: pose.x + car.body.velocity.x * seconds, y: pose.y + car.body.velocity.y * seconds },
                car.body.velocity, 24);
            car.setVelocity(pose.vx, pose.vy);
            assert.ok(pose.hits.length === 0, 'the same impact cannot pin the car every frame');
            assert.ok(pose.vx < 0, 'throttle cannot cancel the brief rebound');
        }
        assert.ok(pose.x < impactX - 20, `${fps} FPS: the car visibly backs away from the wall`);
        car.cursors.up.isDown = true;
        car.update(250, seconds * 1000);
        assert.ok(Math.abs(car.body.angularVelocity) > 1, 'screen-facing steering remains available during recovery');
    }
});

test('collision recovery allows braking into reverse and accelerating away from the wall', () => {
    const car = setup(-120);
    car.contact = { x: -1, y: 0, rebound: true, until: 260 };
    car.keyBrake.isDown = true;
    car.update(16, 16);
    assert.ok(car.body.velocity.x < -120, 'reverse takes over immediately from the rebound');
    car.keyBrake.isDown = false;
    car.keyAccelerate.isDown = true;
    car.rotation = -Math.PI / 2;
    const before = car.body.velocity.x;
    car.update(32, 16);
    assert.ok(car.body.velocity.x < before, 'recovery never caps acceleration away from the wall');
    car.rotation = Math.PI / 2;
    car.update(500, 16);
    assert.ok(car.body.velocity.x > before, 'normal throttle resumes when recovery ends');
});

test('holding throttle after hitting a barrel preserves visible recoil at 30, 60 and 120 FPS', () => {
    const barrel = { type: 'circle', x: 0, y: 0, radius: 20, obstacle: {} };
    for (const fps of [30, 60, 120]) {
        const car = setup(390), seconds = 1 / fps;
        const hit = resolveTravel(new CollisionIndex([barrel]), { x: -80, y: 0 },
            { x: -30, y: 0 }, car.body.velocity, 24);
        car.setVelocity(hit.vx, hit.vy);
        car.contact = { ...hit.normal, until: 260 };
        car.keyAccelerate.isDown = true;
        let x = hit.x;
        for (let frame = 1; frame <= Math.floor(fps * 0.24); frame++) {
            car.update(frame * 1000 / fps, seconds * 1000);
            x += car.body.velocity.x * seconds;
            assert.ok(car.body.velocity.x < 0);
        }
        assert.ok(x < hit.x - 20, `${fps} FPS: a held accelerator cannot cancel the recoil`);
    }
});

function setPadButton(index, pressed = true) {
    pad.buttons[index].pressed = pressed;
    pad.buttons[index].value = pressed ? 1 : 0;
}

function createPad(mapping = '') {
    pad = { connected: true, id: `snes-${mapping || 'usb'}`, mapping, axes: [0, 0],
        buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
}

test('keyboard arrows aim without throttle, including down and diagonals', () => {
    const directions = [
        [['up'], 0], [['right'], Math.PI / 2],
        [['down'], Math.PI], [['left'], -Math.PI / 2],
        [['up', 'right'], Math.PI / 4], [['up', 'left'], -Math.PI / 4],
        [['down', 'right'], 3 * Math.PI / 4],
        [['down', 'left'], -3 * Math.PI / 4],
    ];
    for (const [arrows, expectedHeading] of directions) {
        const car = setup();
        car.rotation = expectedHeading;
        for (const arrow of arrows) car.cursors[arrow].isDown = true;
        car.update(100, 16);
        assert.equal(car.networkControls.throttle, false, `${arrows} must not accelerate`);
        assert.equal(car.networkControls.brake, false, `${arrows} must never brake`);
        assert.ok(Math.abs(car.body.angularVelocity) < 1e-9, `${arrows}: aligned car cannot spin`);
        assert.equal(car.body.speed, 0, `${arrows}: direction alone must not move the car`);
        car.keyAccelerate.isDown = true;
        car.update(116, 16);
        assert.ok(car.body.speed > 0, `${arrows}: W + direction must move the car`);
        assert.equal(car.networkControls.throttle, true);
        car.keyAccelerate.isDown = false;
        for (const arrow of arrows) car.cursors[arrow].isDown = false;
        car.update(132, 16);
        assert.equal(car.networkControls.throttle, false, `${arrows}: releasing W stops accelerating`);
        assert.equal(car.body.angularVelocity, 0, `${arrows}: releasing direction stops turning`);
    }
});

test('keyboard direction overrides a held touch direction and independent brake wins', () => {
    const car = setup();
    car.rotation = 0;
    car.cursors.right.isDown = true;
    car.update(100, 16);
    assert.ok(car.body.angularVelocity > 0, 'right arrow steers toward screen right');
    car.rotation = Math.PI / 2;
    car.update(116, 16);
    assert.equal(car.body.angularVelocity, 0, 'holding the same direction cannot cause endless spin');
    car.keyBrake.isDown = true;
    car.update(132, 16);
    assert.equal(car.networkControls.brake, true);
    assert.equal(car.networkControls.throttle, false);
    car.keyBrake.isDown = false;
    car.keyBrakeS.isDown = true;
    car.update(148, 16);
    assert.equal(car.networkControls.brake, true, 'S is an alternative brake key');
    car.keyBrakeS.isDown = false;
    car.cursors.right.isDown = false;
    car.keyAccelerate.isDown = true;
    car.update(164, 16);
    assert.equal(car.networkControls.throttle, true, 'W accelerates without a direction key');
});

test('SNES D-pad reads direction as an absolute target with buttons, axes and hat', () => {
    createPad();
    const car = setup();
    for (const [button, rotation] of [[12, 0], [13, Math.PI],
        [14, -Math.PI / 2], [15, Math.PI / 2]]) {
        car.rotation = rotation;
        setPadButton(button);
        car.update(200, 16);
        assert.equal(car.networkControls.throttle, false, `D-pad button ${button} only steers`);
        assert.equal(car.body.speed, 0, `D-pad button ${button} cannot move an idle car`);
        assert.equal(car.networkControls.brake, false, `D-pad button ${button} doesn't brake`);
        assert.equal(car.body.angularVelocity, 0, `D-pad button ${button} faces exact heading`);
        setPadButton(button, false);
    }
    setPadButton(12);
    setPadButton(15);
    car.rotation = Math.PI / 4;
    car.update(216, 16);
    assert.equal(car.body.angularVelocity, 0, 'D-pad diagonal points to a diagonal');
    setPadButton(12, false);
    setPadButton(15, false);
    pad.axes = [-1, -1];
    car.rotation = -Math.PI / 4;
    car.update(232, 16);
    assert.equal(car.body.angularVelocity, 0, 'axis-based SNES D-pad diagonal works');
    pad.axes = [0, 0, ...Array(7).fill(0), 1]; // eixo hat 9 = cima + esquerda
    car.update(248, 16);
    assert.equal(car.body.angularVelocity, 0, 'hat-based SNES D-pad diagonal works');
    pad.axes = [0, 0];
    car.update(264, 16);
    assert.equal(car.networkControls.throttle, false, 'neutral D-pad releases acceleration');
    pad = null;
});

test('SNES USB B accelerates, Y activates turbo, A brakes/reverses; D-pad only aims', () => {
    createPad();
    const car = setup();
    setPadButton(2); // B
    assert.equal(readGamepad().accelerate, true);
    assert.equal(readGamepad().turbo, false);
    car.update(100, 16);
    assert.equal(car.networkControls.throttle, true);
    assert.equal(car.networkControls.brake, false);

    setPadButton(2, false);
    setPadButton(3); // Y: turbo também pressiona o acelerador
    car.update(116, 16);
    assert.equal(readGamepad().accelerate, true);
    assert.equal(car.networkControls.turbo, true);
    assert.equal(car.networkControls.throttle, true);

    setPadButton(1); // A tem prioridade mesmo com Y pressionado
    car.update(132, 16);
    assert.equal(car.networkControls.throttle, false);
    assert.equal(car.networkControls.brake, true);
    assert.equal(car.networkControls.turbo, false);
    setPadButton(3, false);
    const reverseCar = setup();
    for (let frame = 0; frame < 40; frame++) reverseCar.update(150 + frame * 16, 16);
    assert.ok(reverseCar.body.velocity.x < -10, 'segurar A engata a ré após parar');
    setPadButton(1, false);

    setPadButton(12); // D-pad para cima apenas aponta para cima
    assert.equal(readGamepad().up, true);
    car.update(148, 16);
    assert.equal(car.networkControls.throttle, false);
    setPadButton(12, false);
    setPadButton(13); // D-pad para baixo aponta para baixo, não engata ré
    assert.equal(readGamepad().down, true);
    car.update(164, 16);
    assert.equal(car.networkControls.throttle, false);
    assert.equal(car.networkControls.brake, false);
    setPadButton(13, false);
    setPadButton(15);
    assert.equal(readGamepad().steering, 1);
    car.update(180, 16);
    assert.equal(car.networkControls.throttle, false);
    setPadButton(15, false);
    pad = null;
});

test('arrow keys, neutral and D-pad cannot propel a stopped car without B/Y', () => {
    for (const fps of [30, 60, 120]) {
        const car = setup();
        car.cursors.left.isDown = true;
        for (let i = 0; i < fps; i++) car.update(i * 1000 / fps, 1000 / fps);
        assert.equal(car.body.speed, 0, `keyboard at ${fps} FPS`);
        assert.equal(car.networkControls.throttle, false);
        car.cursors.left.isDown = false;
    }
    for (const mapping of ['', 'standard']) {
        createPad(mapping);
        const car = setup();
        setPadButton(15);
        for (let i = 0; i < 30; i++) car.update(i * 16, 16);
        assert.equal(car.body.speed, 0, `${mapping || 'USB'} D-pad`);
        assert.equal(car.networkControls.throttle, false);
        setPadButton(15, false);
        pad = null;
    }
});

test('turbo on Shift alone accelerates with no W, and brake still wins', () => {
    const car = setup();
    car.keyShift.isDown = true;
    car.update(100, 16);
    assert.equal(car.networkControls.throttle, true);
    assert.equal(car.isTurboActive, true);
    assert.ok(car.body.speed > 0);
    car.keyBrake.isDown = true;
    car.update(116, 16);
    assert.equal(car.networkControls.throttle, false);
    assert.equal(car.isTurboActive, false);
});

test('normal and track boost speed increases are mild and the limiter remains consistent', () => {
    const car = setup();
    assert.equal(car.baseMaxVelocity, 420);
    assert.equal(car.trackBoostMultiplier, 1.52);
    car.keyAccelerate.isDown = true;
    for (let i = 0; i < 180; i++) car.update(i * 16, 16);
    assert.ok(Math.abs(car.body.speed - 420) < 1e-6);
    car.activateTrackBoost(3000);
    assert.ok(car.body.speed > 420);
    assert.ok(car.body.speed <= 420 * 1.52 + 1e-6);
    car.update(3016, 16);
    assert.ok(Math.abs(car.maxDriveSpeed - 420 * 1.52) < 1e-6);
    car.update(4600, 16);
    assert.equal(car.maxDriveSpeed, 420);
});

test('standard-mapped SNES uses physical B (0), Y (2), A (1) with same racing behavior', () => {
    createPad('standard');
    const car = setup();
    setPadButton(0);
    assert.equal(readGamepad().accelerate, true);
    car.update(100, 16);
    assert.equal(car.networkControls.throttle, true);
    setPadButton(0, false);
    setPadButton(2);
    car.update(116, 16);
    assert.equal(car.networkControls.turbo, true);
    setPadButton(2, false);
    setPadButton(1);
    car.update(132, 16);
    assert.equal(car.networkControls.brake, true);
    assert.equal(car.networkControls.throttle, false);
    setPadButton(1, false);
    setPadButton(3); // X (posição superior) não ativa nenhuma função de corrida
    assert.equal(readGamepad().accelerate, false);
    assert.equal(readGamepad().reverse, false);
    assert.equal(readGamepad().turbo, false);
    assert.equal(readGamepad().any, true); // mas confirma nos menus
    pad = null;
});

test('manual SNES calibration remaps B/Y/A without altering other pad layouts', () => {
    createPad();
    startCalibration();
    for (const index of [5, 7, 6]) {
        readGamepad(); // com todos soltos, calibração pronta para capturar
        setPadButton(index);
        readGamepad();
        setPadButton(index, false);
    }
    setPadButton(5);
    assert.equal(readGamepad().accelerate, true);
    setPadButton(5, false);
    setPadButton(7);
    assert.equal(readGamepad().turbo, true);
    setPadButton(7, false);
    setPadButton(6);
    assert.equal(readGamepad().reverse, true);
    setPadButton(6, false);
    pad = null;
});

function simulateTurn(car, fps, duration = 0.75) {
    const dt = 1000 / fps;
    let firstAngular = null;
    for (let frame = 0; frame < Math.round(duration * fps); frame++) {
        car.update(frame * dt, dt);
        if (firstAngular === null) firstAngular = car.body.angularVelocity;
        // A rotação é integrada pelo Phaser após o update em cada frame.
        car.rotation += car.body.angularVelocity * Math.PI / 180 / fps;
    }
    return { rotation: car.rotation, firstAngular };
}

const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

test('keyboard and SNES D-pad start a 90 degree turn progressively instead of a sharp snap', () => {
    pad = null;
    const keyboardCar = setup();
    keyboardCar.rotation = 0;
    keyboardCar.cursors.right.isDown = true;
    const keyboardTurn = simulateTurn(keyboardCar, 60);
    assert.ok(keyboardTurn.firstAngular > 0 && keyboardTurn.firstAngular < 300,
        `keyboard should ease into the turn, got ${keyboardTurn.firstAngular} degrees/s`);
    assert.ok(Math.abs(angleDifference(keyboardTurn.rotation, Math.PI / 2)) < 0.06,
        'a held right arrow must still converge to the exact right-facing direction');

    createPad();
    const dpadCar = setup();
    dpadCar.rotation = 0;
    setPadButton(15); // SNES D-pad direita
    const dpadTurn = simulateTurn(dpadCar, 60);
    assert.ok(Math.abs(dpadTurn.firstAngular - keyboardTurn.firstAngular) < 1e-8,
        'SNES and keyboard must have the same easing curve');
    assert.ok(Math.abs(angleDifference(dpadTurn.rotation, keyboardTurn.rotation)) < 1e-8);
    setPadButton(15, false);
    pad = null;
});

test('D-pad turn is smooth at 30, 60 and 120 FPS, including diagonal and opposite turns', () => {
    const results = [];
    for (const fps of [30, 60, 120]) {
        pad = null;
        const car = setup();
        car.rotation = 0;
        car.cursors.up.isDown = true;
        car.cursors.right.isDown = true;
        simulateTurn(car, fps, 0.7);
        assert.ok(Math.abs(angleDifference(car.rotation, Math.PI / 4)) < 0.07,
            `${fps} FPS: diagonal reaches a natural 45-degree direction`);
        car.cursors.up.isDown = false;
        car.cursors.right.isDown = false;
        car.cursors.down.isDown = true;
        car.cursors.left.isDown = true;
        const flipped = simulateTurn(car, fps, 0.8);
        assert.ok(Math.abs(angleDifference(car.rotation, -3 * Math.PI / 4)) < 0.07,
            `${fps} FPS: diagonal turnaround reaches opposite direction`);
        results.push(flipped.rotation);
        car.cursors.down.isDown = false;
        car.cursors.left.isDown = false;
        car.update(1000, 1000 / fps);
        assert.equal(car.body.angularVelocity, 0, 'releasing the direction stops turning');
        assert.equal(car.digitalHeading, null, 'releasing clears the eased direction');
    }
    for (const a of results) for (const b of results) {
        assert.ok(Math.abs(angleDifference(a, b)) < 0.07, 'turn feels consistent across FPS');
    }
});

test('releasing a direction mid-turn does not leave momentum in the steering target', () => {
    pad = null;
    const car = setup();
    car.rotation = 0;
    car.cursors.left.isDown = true;
    car.update(0, 16);
    assert.ok(car.body.angularVelocity < 0, 'left begins a gradual left turn');
    car.cursors.left.isDown = false;
    car.update(16, 16);
    assert.equal(car.body.angularVelocity, 0);
    assert.equal(car.digitalHeading, null);
    car.cursors.right.isDown = true;
    car.update(32, 16);
    assert.ok(car.body.angularVelocity > 0, 'next input starts turning in new direction');
    car.controlsEnabled = false;
    car.update(48, 16);
    assert.equal(car.digitalHeading, null, 'lockout also resets smoothed direction');
});
