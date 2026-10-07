import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import RaceResults, { resultsLayout } from '../js/fx/RaceResults.js';

class Object2D {
    constructor(type, x, y, value, extra, color, alpha) {
        Object.assign(this, { type, x, y, value, originX: type === 'text' ? 0 : 0.5,
            originY: type === 'text' ? 0 : 0.5, alpha: 1, angle: 0, scaleX: 1, scaleY: 1 });
        if (type === 'text') this.style = extra;
        else if (type === 'image') Object.assign(this, { texture: value, width: 102, height: 166 });
        else Object.assign(this, { width: value, height: extra, color, fillAlpha: alpha });
    }
    setScrollFactor(value) { this.scrollFactor = value; return this; }
    setDepth(value) { this.depth = value; return this; }
    setOrigin(x, y = x) { this.originX = x; this.originY = y; return this; }
    setAlpha(value) { this.alpha = value; return this; }
    setAngle(value) { this.angle = value; return this; }
    setPosition(x, y) { this.x = x; this.y = y; return this; }
    setScale(value) { this.scaleX = this.scaleY = value; return this; }
    setTint(value) { this.tint = value; return this; }
    setStrokeStyle() { return this; }
    setDisplaySize(width, height) { Object.assign(this, { width, height }); return this; }
    setText(value) { this.value = value; return this; }
    destroy() { this.destroyed = true; }
}

const data = [
    { id: 'a', nick: 'A Vencedora', skin: 'green', tint: 0x88ccff, elapsed: 91000, place: 1,
        collected: 14, laps: 3, rewards: { collected: 14, laps: 30, finish: 20, victory: 50, total: 114 }, local: false },
    { id: 'b', nick: 'Eu em Segundo', skin: 'pink', tint: 0xffffff, elapsed: 97500, place: 2,
        collected: 19, laps: 3, rewards: { collected: 19, laps: 30, finish: 20, victory: 0, total: 69 }, local: true },
];

function setup(width = 960, height = 540) {
    const drawn = [], ignored = [], tweenQueue = [], timerQueue = [], tones = [];
    const scene = {
        scale: { width, height }, hud: [{ depth: 7006 }], events: new EventEmitter(),
        input: Object.assign(new EventEmitter(), { keyboard: new EventEmitter() }),
        add: Object.fromEntries(['text', 'rectangle', 'ellipse', 'image'].map(type => [type, (...args) => {
            const object = new Object2D(type, ...args); drawn.push(object); return object;
        }])),
        cameras: { main: { ignore: object => ignored.push(object) } },
        tweens: { add: config => {
            const tween = { config, progress: 1, stop() { this.stopped = true; } };
            tweenQueue.push(tween); return tween;
        } },
        time: { delayedCall: (delay, callback) => {
            const timer = { delay, callback, remove() { this.removed = true; } };
            timerQueue.push(timer); return timer;
        } },
        carSkin: 'blue', carTint: 0xeeeeee, finishElapsedMs: 97500, pendingEarned: 69,
        rewardRules: { lap: 10, finish: 20, victory: 50 },
        computeFinalScore() { return { total: this.pendingEarned }; },
        formatRaceTime: value => value === 91000 ? '01:31.00' : '01:37.50',
        scoreTone: (...args) => tones.push(args), sound: { mute: false },
    };
    return { scene, drawn, ignored, tweenQueue, timerQueue, tones, results: new RaceResults(scene) };
}

function textBounds(object) {
    const size = parseFloat(object.style.fontSize), width = String(object.value).length * size * 0.62;
    const height = size * 1.2;
    return { left: object.x - width * object.originX, right: object.x + width * (1 - object.originX),
        top: object.y - height * object.originY, bottom: object.y + height * (1 - object.originY) };
}

test('both cars, standings and reward text fit desktop and small landscape cards', () => {
    for (const [width, height] of [[960, 540], [800, 450], [640, 360], [480, 360], [480, 450]]) {
        const { results, scene, drawn, ignored } = setup(width, height);
        results.showPodium(data);
        results.showResults(data);
        results.settleRewards(false);
        assert.equal(results.rows.length, 2);
        const layout = resultsLayout(width, height);
        assert.ok(layout.cards[0].x + layout.cardWidth < layout.cards[1].x);
        for (const [index, row] of results.rows.entries()) {
            assert.equal(row.car.texture, index ? 'car-pink-v2' : 'car-green-v2');
            assert.equal(row.car.tint, data[index].tint);
            assert.equal(row.elapsed.value, index ? 'TEMPO  01:37.50' : 'TEMPO  01:31.00');
            assert.equal(row.total.value, String(data[index].rewards.total));
            const card = row.card;
            const lastReward = row.rewards.at(-1).value;
            assert.ok(textBounds(lastReward).bottom < card.y + card.height * 0.825);
            const visualCarTop = row.carY - 62 * row.scale;
            assert.ok(visualCarTop >= textBounds(row.elapsed).bottom - 1, `${width}x${height}: car clears elapsed time`);
            for (const object of [row.nickname, row.elapsed, row.total,
                ...row.rewards.flatMap(reward => [reward.label, reward.value])]) {
                const bounds = textBounds(object);
                assert.ok(bounds.left >= card.x && bounds.right <= card.x + card.width, `${width}x${height}: ${object.value} fits horizontally`);
                assert.ok(bounds.top >= card.y && bounds.bottom <= card.y + card.height, `${width}x${height}: ${object.value} fits vertically`);
            }
        }
        for (const object of drawn.filter(object => object.type === 'text')) {
            const bounds = textBounds(object);
            assert.ok(bounds.left >= 0 && bounds.right <= width, `${width}x${height}: ${object.value} fits screen`);
        }
        assert.deepEqual(ignored, results.objects, 'lazy objects are routed solely to the UI camera');
        assert.ok(results.objects.every(object => object.depth > 7006 && object.scrollFactor === 0));
        assert.equal(scene.hud.length, results.objects.length + 1);
        results.destroy();
    }
});

test('pending pickups refresh earned currency while awaiting the rival without rebuilding the car', () => {
    const { results, scene, drawn } = setup(640, 360);
    results.showWaiting();
    const count = drawn.length;
    assert.equal(results.waitingTime.value, '01:37.50');
    assert.equal(results.waitingTotal.value, '69');
    assert.equal(drawn.find(object => object.type === 'image').texture, 'car-blue-v2');
    scene.pendingEarned = 71;
    results.showWaiting();
    assert.equal(results.waitingTotal.value, '71');
    assert.equal(drawn.length, count);
    results.showPodium(data);
    results.showWaiting();
    assert.equal(results.state, 'podium');
});

test('winner celebrates and second place arrives differently; skipping settles rewards and preserves both cars', () => {
    const { results, scene, tweenQueue, timerQueue, tones } = setup();
    results.showPodium(data);
    const winner = results.rows[0].car, runner = results.rows[1].car;
    const winnerEntrance = tweenQueue.find(tween => tween.config.targets === winner).config;
    const runnerEntrance = tweenQueue.find(tween => tween.config.targets === runner).config;
    assert.equal(winner.angle, -360);
    assert.equal(winnerEntrance.angle, 0);
    assert.equal(winnerEntrance.ease, 'Back.easeOut');
    assert.equal(runnerEntrance.ease, 'Cubic.easeOut');
    assert.ok(runner.x > results.rows[1].carX);
    results.showResults(data);
    assert.equal(results.state, 'counting');
    scene.sound.mute = true;
    scene.input.emit('pointerdown');
    assert.equal(results.state, 'settled');
    assert.equal(results.rows[0].rewards.at(-1).value.value, '+50');
    assert.equal(results.rows[1].rewards.at(-1).value.value, '+0');
    assert.equal(results.rows[0].total.value, '114');
    assert.equal(results.rows[1].total.value, '69');
    assert.equal(tones.length, 0, 'muting also covers reward feedback');
    assert.equal(winner.destroyed, undefined);
    assert.equal(runner.destroyed, undefined);
    assert.equal(scene.input.listenerCount('pointerdown'), 0);
    const corrected = structuredClone(data);
    corrected[1].rewards.collected = 18;
    corrected[1].rewards.total = 68;
    results.showResults(corrected);
    assert.equal(results.rows[1].total.value, '68');
    scene.events.emit('shutdown');
    assert.equal(scene.input.keyboard.listenerCount('keydown'), 0);
    assert.ok(tweenQueue.every(tween => tween.stopped));
    assert.ok(timerQueue.every(timer => timer.removed));
    assert.equal(winner.destroyed, true);
    assert.equal(scene.hud.length, 1, 'shutdown removes owned UI without touching the race HUD');
});
