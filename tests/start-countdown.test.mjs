import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import StartCountdown from '../js/fx/StartCountdown.js';

function displayObject() {
    const object = { active: true, list: [], text: '' };
    for (const method of ['setScrollFactor', 'setDepth', 'setAlpha', 'setScale',
        'setPosition', 'setOrigin', 'setShadow', 'setStrokeStyle', 'setFillStyle',
        'setColor', 'setFontSize', 'setAngle', 'fillStyle', 'fillPoints',
        'lineStyle', 'strokePoints', 'strokeCircle', 'lineBetween', 'clear',
        'beginPath', 'arc', 'strokePath']) {
        object[method] = () => object;
    }
    object.add = child => { object.list.push(child); return object; };
    object.setText = value => { object.text = value; return object; };
    object.destroy = () => {
        object.active = false;
        object.list.forEach(child => child.destroy());
        object.list = [];
    };
    return object;
}

function setup(context) {
    const epoch = 1000000, timers = [], tweens = [], ignored = [];
    let elapsed = 0;
    context.mock.method(Date, 'now', () => epoch + elapsed);
    const sound = {
        isPlaying: false, plays: 0, destroyed: false,
        play() { this.plays++; this.isPlaying = true; },
        stop() { this.isPlaying = false; },
        destroy() { this.destroyed = true; },
    };
    const scene = {
        scale: { width: 800, height: 450 },
        add: Object.fromEntries(['container', 'graphics', 'text', 'circle', 'rectangle']
            .map(type => [type, displayObject])),
        events: new EventEmitter(),
        cameras: { main: { ignore: object => ignored.push(object) } },
        cache: { audio: { exists: () => true } },
        sound: { add: () => sound },
        tweens: {
            add: config => { tweens.push(config); },
            killTweensOf() {},
        },
        time: { delayedCall(delay, callback) {
            const timer = { at: elapsed + delay, callback,
                remove() { this.removed = true; } };
            timers.push(timer);
            return timer;
        } },
    };
    const countdown = new StartCountdown(scene);
    function advance(to) {
        elapsed = to;
        timers.sort((a, b) => a.at - b.at).forEach(timer => {
            if (!timer.removed && !timer.fired && timer.at <= elapsed) {
                timer.fired = true;
                timer.callback();
            }
        });
    }
    return { countdown, scene, epoch, sound, timers, tweens, ignored, advance };
}

test('the holographic countdown stays in the UI camera and releases controls on the shared GO beat', context => {
    const { countdown, epoch, ignored, sound, advance } = setup(context);
    let starts = 0;
    countdown.play(() => {
        starts++;
        assert.equal(countdown.text.text, 'VAI!');
    }, epoch + 3120);
    assert.deepEqual(ignored, [countdown.root]);
    assert.equal(sound.plays, 1);
    for (const [at, label] of [[120, '3'], [1120, '2'], [2100, '1'], [3119, '1']]) {
        advance(at);
        assert.equal(countdown.text.text, label);
        assert.equal(starts, 0);
    }
    advance(3120);
    assert.equal(starts, 1);
    countdown.play(() => starts++);
    advance(3900);
    assert.equal(starts, 1, 'playing twice cannot schedule another start');
});

test('joining an existing countdown catches up without replaying old numbers or audio', context => {
    const { countdown, epoch, sound, advance } = setup(context);
    let starts = 0;
    countdown.play(() => starts++, epoch + 600);
    assert.equal(countdown.text.text, '1');
    assert.equal(sound.plays, 0);
    advance(599);
    assert.equal(starts, 0);
    advance(600);
    assert.equal(countdown.text.text, 'VAI!');
    assert.equal(starts, 1);
});

test('leaving the scene cancels the start and destroys all countdown layers and audio', context => {
    const { countdown, scene, sound, timers, advance } = setup(context);
    let starts = 0;
    countdown.play(() => starts++);
    advance(120);
    const layers = [...countdown.root.list, ...countdown.glyphs.list];
    scene.events.emit('shutdown');
    countdown.cancel();
    advance(10000);
    assert.equal(starts, 0);
    assert.equal(countdown.root.active, false);
    assert.ok(layers.every(layer => !layer.active));
    assert.ok(timers.every(timer => timer.removed));
    assert.equal(sound.isPlaying, false);
    assert.equal(sound.destroyed, true);
    assert.equal(scene.events.listenerCount('shutdown'), 0);
});

test('the final fade removes the whole panel after GO', context => {
    const { countdown, scene, tweens, sound, advance } = setup(context);
    countdown.play();
    advance(4020);
    const fade = tweens.find(tween => tween.targets === countdown.root);
    assert.equal(fade.alpha, 0);
    fade.onComplete();
    assert.equal(countdown.root.active, false);
    assert.equal(sound.destroyed, true);
    assert.equal(scene.events.listenerCount('shutdown'), 0);
});
