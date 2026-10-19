import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import CarDropIn from '../js/fx/CarDropIn.js';

function object(x, y) {
    return {
        x, y, depth: 1000, scaleX: 1, scaleY: 1,
        setPosition(x, y) { Object.assign(this, { x, y }); return this; },
        setScale(x, y = x) { this.scaleX = x; this.scaleY = y; return this; },
        setAlpha(alpha) { this.alpha = alpha; return this; },
        setDepth(depth) { this.depth = depth; return this; },
        setStrokeStyle() { return this; },
        destroy() { this.destroyed = true; },
    };
}

function setup() {
    const tweens = [], timers = [], ignored = [], resets = [];
    const car = object(5152, 3404);
    car.body = { enable: true, reset: (x, y) => resets.push([x, y]) };
    const scene = {
        events: new EventEmitter(),
        add: { ellipse: object, rectangle: object },
        textures: { exists: () => false },
        cameras: { main: { shake() {} } },
        uiCam: { ignore: object => ignored.push(object) },
        tweens: { add(config) {
            const tween = { config, stop() { this.stopped = true; } };
            tweens.push(tween);
            return tween;
        } },
        time: { delayedCall(delay, callback) {
            const timer = { delay, callback, remove() { this.removed = true; } };
            timers.push(timer);
            return timer;
        } },
    };
    const entrance = new CarDropIn(scene, car);
    return { scene, car, entrance, tweens, timers, ignored, resets };
}

test('the entrance blocks controls and collision until the landing settles, then reports ready once', () => {
    const { car, entrance, tweens, timers, ignored, resets } = setup();
    let ready = 0;
    entrance.play(5152, 3404, { onLand: () => ready++ });
    assert.equal(car.controlsEnabled, false);
    assert.equal(car.body.enable, false);
    assert.equal(car.alpha, 0);
    assert.ok(car.y < 3404);
    assert.equal(ignored.length, 4, 'every hologram object is excluded from the UI camera');
    tweens.find(tween => tween.config.targets === car).config.onComplete();
    assert.equal(ready, 0);
    assert.equal(car.body.enable, false);
    tweens.find(tween => tween.config.yoyo).config.onComplete();
    assert.equal(ready, 1);
    assert.equal(car.body.enable, true);
    assert.equal(car.controlsEnabled, false, 'the countdown owns control release');
    assert.deepEqual(resets, [[5152, 3404]]);
    assert.equal(car.scaleX, 1);
    timers[0].callback();
    assert.ok(ignored.every(object => object.destroyed));
    assert.ok(tweens.every(tween => tween.stopped));
    assert.equal(car.destroyed, undefined);
});

test('leaving during the entrance cancels effects and cannot report readiness afterwards', () => {
    const { scene, car, entrance, tweens, ignored } = setup();
    let ready = 0;
    entrance.play(5152, 3404, { onLand: () => ready++ });
    const falling = tweens.find(tween => tween.config.targets === car);
    scene.events.emit('shutdown');
    falling.config.onComplete();
    assert.equal(ready, 0);
    assert.ok(tweens.every(tween => tween.stopped));
    assert.ok(ignored.every(object => object.destroyed));
    assert.equal(entrance.objects.length, 0);
});
