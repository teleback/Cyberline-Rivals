import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import RaceResults, { resultsLayout } from '../js/fx/RaceResults.js';

class Object2D extends EventEmitter {
    constructor(type, x = 0, y = 0, value, extra, color, alpha) {
        super();
        Object.assign(this, { type, x, y, value, originX: type === 'text' ? 0 : 0.5,
            originY: type === 'text' ? 0 : 0.5, alpha: 1, angle: 0, scaleX: 1, scaleY: 1, drawCalls: [] });
        if (type === 'text') this.style = extra;
        else if (type === 'image') Object.assign(this, { texture: value, width: 102, height: 166 });
        else Object.assign(this, { width: value, height: extra, color, fillAlpha: alpha });
    }
    setScrollFactor(value) { this.scrollFactor = value; return this; }
    setDepth(value) { this.depth = value; return this; }
    setOrigin(x, y = x) { this.originX = x; this.originY = y; return this; }
    setAlpha(value) { this.alpha = value; return this; }
    setAngle(value) { this.angle = ((value + 180) % 360 + 360) % 360 - 180; return this; }
    setPosition(x, y) { this.x = x; this.y = y; return this; }
    setScale(value) { this.scaleX = this.scaleY = value; return this; }
    setTint(value) { this.tint = value; return this; }
    setStrokeStyle() { return this; }
    setVisible(value) { this.visible = value; return this; }
    setInteractive() { this.interactive = true; return this; }
    setFillStyle(value) { this.color = value; return this; }
    setDisplaySize(width, height) { Object.assign(this, { width, height }); return this; }
    setText(value) { this.value = value; return this; }
    draw(method, args) { this.drawCalls.push({ method, args }); return this; }
    fillStyle(...args) { return this.draw('fillStyle', args); }
    fillRect(...args) { return this.draw('fillRect', args); }
    fillEllipse(...args) { return this.draw('fillEllipse', args); }
    fillCircle(...args) { return this.draw('fillCircle', args); }
    lineStyle(...args) { return this.draw('lineStyle', args); }
    lineBetween(...args) { return this.draw('lineBetween', args); }
    fillPoints(...args) { return this.draw('fillPoints', args); }
    strokePoints(...args) { return this.draw('strokePoints', args); }
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
    let now = 0;
    const animatedProperties = ['x', 'y', 'alpha', 'angle', 'scaleX', 'scaleY', 'value', 'progress'];
    const scene = {
        scale: { width, height }, hud: [{ depth: 7006 }], events: new EventEmitter(),
        input: Object.assign(new EventEmitter(), { keyboard: new EventEmitter() }),
        add: Object.fromEntries(['text', 'rectangle', 'ellipse', 'image', 'graphics'].map(type => [type, (...args) => {
            const object = new Object2D(type, ...args); drawn.push(object); return object;
        }])),
        cameras: { main: { ignore: object => ignored.push(object) } },
        tweens: { add: config => {
            const targets = Array.isArray(config.targets) ? config.targets : [config.targets];
            const properties = animatedProperties.filter(key => config[key] !== undefined);
            const tween = { config, progress: 0, startsAt: now + (config.delay || 0),
                duration: config.duration || 1000, targets, properties,
                starts: targets.map(target => Object.fromEntries(properties.map(key =>
                    [key, typeof config[key] === 'object' ? config[key].from : target[key]]))),
                stop() { this.stopped = true; } };
            tweenQueue.push(tween); return tween;
        } },
        time: { delayedCall: (delay, callback) => {
            const timer = { delay, callback, dueAt: now + delay, remove() { this.removed = true; } };
            timerQueue.push(timer); return timer;
        } },
        carSkin: 'blue', carTint: 0xeeeeee, finishElapsedMs: 97500, pendingEarned: 69,
        rewardRules: { lap: 10, finish: 20, victory: 50 },
        computeFinalScore() { return { total: this.pendingEarned }; },
        formatRaceTime: value => value === 91000 ? '01:31.00' : '01:37.50',
        scoreTone: (...args) => tones.push(args), sound: { mute: false },
        returnToMenu() { this.returns = (this.returns || 0) + 1; },
    };
    // Sample interpolated values and execute lifecycle callbacks. Easing is
    // deliberately linear here: the assertions concern accumulation and cleanup.
    function updateTweens() {
        for (const tween of [...tweenQueue]) {
            if (tween.stopped || tween.completed || now < tween.startsAt) continue;
            const cycles = (tween.config.repeat || 0) + 1;
            const legs = tween.config.yoyo ? 2 : 1;
            const elapsed = now - tween.startsAt;
            const finished = tween.config.repeat !== -1 && elapsed >= tween.duration * cycles * legs;
            const leg = Math.floor(elapsed / tween.duration);
            let progress = finished ? (tween.config.yoyo ? 0 : 1) : (elapsed % tween.duration) / tween.duration;
            if (!finished && tween.config.yoyo && leg % 2) progress = 1 - progress;
            tween.progress = progress;
            tween.targets.forEach((target, index) => tween.properties.forEach(key => {
                const end = typeof tween.config[key] === 'object' ? tween.config[key].to : tween.config[key];
                target[key] = tween.starts[index][key] + (end - tween.starts[index][key]) * progress;
            }));
            tween.config.onUpdate?.(tween);
            if (finished) {
                tween.completed = true;
                tween.config.onComplete?.(tween);
            }
        }
    }
    function advanceTo(targetTime) {
        assert.ok(targetTime >= now, 'the test clock only moves forward');
        while (true) {
            const timers = timerQueue.filter(timer => !timer.removed && !timer.fired);
            const ends = tweenQueue.filter(tween => !tween.stopped && !tween.completed && tween.config.repeat !== -1)
                .map(tween => tween.startsAt + tween.duration * ((tween.config.repeat || 0) + 1) * (tween.config.yoyo ? 2 : 1));
            const next = Math.min(...timers.map(timer => timer.dueAt), ...ends);
            if (next > targetTime) break;
            now = next;
            updateTweens();
            for (const timer of timers.filter(timer => !timer.removed && timer.dueAt <= now)) {
                timer.fired = true;
                timer.callback();
            }
        }
        now = targetTime;
        updateTweens();
    }
    return { scene, drawn, ignored, tweenQueue, timerQueue, tones, advanceTo, results: new RaceResults(scene) };
}

function textBounds(object) {
    const size = parseFloat(object.style.fontSize);
    const glyphWidth = object.style.fontFamily.includes('Cyber Arcade') ? 1 : 0.62;
    const width = String(object.value).length * size * glyphWidth;
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
        assert.match(drawn.find(object => object.value === 'CAMPEÃO DA NOITE').style.fontFamily, /Cyber Arcade/);
        assert.ok(drawn.some(object => object.type === 'graphics' && object.drawCalls.some(call =>
            call.method === 'fillPoints' && call.args[0].length === 6 && call.args[0].some((point, index, points) => {
                const next = points[(index + 1) % points.length];
                return point.x !== next.x && point.y !== next.y;
            }))), 'the result panels have clipped corners');
        for (const [index, row] of results.rows.entries()) {
            assert.equal(row.car.texture, index ? 'car-pink-v2' : 'car-green-v2');
            assert.equal(row.car.tint, data[index].tint);
            assert.equal(row.elapsed.value, index ? 'TEMPO  01:37.50' : 'TEMPO  01:31.00');
            assert.equal(row.total.value, String(data[index].rewards.total));
            for (const object of [row.nickname, row.total, ...row.rewards.map(reward => reward.value)]) {
                assert.match(object.style.fontFamily, /Cyber Arcade/, 'driver names and score values use the arcade font');
            }
            const card = row.card;
            const lastReward = row.rewards.at(-1).value;
            assert.ok(textBounds(lastReward).bottom < card.y + card.height * 0.825);
            const visualCarTop = row.carY - 62 * row.scale;
            const visualCarBottom = row.carY + 62 * row.scale;
            assert.ok(visualCarTop >= textBounds(row.nickname).bottom - 1, `${width}x${height}: car clears nickname`);
            if (layout.stacked) {
                assert.ok(visualCarTop >= textBounds(row.elapsed).bottom - 1, `${width}x${height}: car clears elapsed time above stage`);
            } else {
                assert.ok(textBounds(row.elapsed).top >= visualCarBottom, `${width}x${height}: elapsed time clears car below stage`);
                const pedestalBottom = row.pedestal.y + row.pedestal.height * (1 - row.pedestal.originY) * row.pedestal.scaleY;
                const ringBottom = row.ring.y + row.ring.height * (1 - row.ring.originY) * row.ring.scaleY;
                assert.ok(pedestalBottom <= textBounds(row.elapsed).top, `${width}x${height}: pedestal clears elapsed time`);
                assert.ok(ringBottom <= textBounds(row.elapsed).top, `${width}x${height}: stage ring clears elapsed time`);
            }
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

test('return button waits for rewards, supports touch and returns only once', () => {
    const { results, scene } = setup();
    results.showPodium(data);
    assert.equal(results.returnButton.visible, false);
    results.returnButton.emit('pointerdown');
    assert.equal(scene.returns, undefined);
    results.showResults(data);
    const skip = { key: 'Enter' };
    scene.input.keyboard.emit('keydown', skip);
    assert.equal(results.state, 'settled');
    assert.equal(results.returnButton.visible, true);
    assert.equal(results.returnButton.interactive, true);
    assert.equal(scene.returns, undefined, 'revealing results never also exits');
    results.returnButton.emit('pointerdown');
    results.returnButton.emit('pointerdown');
    assert.equal(scene.returns, 1);
    scene.events.emit('shutdown');
    assert.equal(scene.input.keyboard.listenerCount('keydown'), 0);
    assert.equal(scene.events.listenerCount('update'), 0);
});

test('keyboard confirmation exits after results without responding to held or mute keys', () => {
    const { results, scene } = setup();
    results.showPodium(data);
    results.showResults(data);
    results.settleRewards(false);
    scene.input.keyboard.emit('keydown', { key: 'm' });
    scene.input.keyboard.emit('keydown', { key: 'Enter', repeat: true });
    assert.equal(scene.returns, undefined);
    scene.input.keyboard.emit('keydown', { key: 'Enter' });
    assert.equal(scene.returns, 1);
    results.destroy();
});

test('gamepad confirmation requires a fresh press after results settle', () => {
    const pad = { connected: true, id: 'test', mapping: 'standard', axes: [0, 0],
        buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });
    const { results, scene } = setup();
    results.showPodium(data);
    results.showResults(data);
    results.settleRewards(false);
    pad.buttons[1].pressed = true;
    scene.events.emit('update');
    assert.equal(scene.returns, undefined);
    pad.buttons[1].pressed = false;
    scene.events.emit('update');
    pad.buttons[1].pressed = true;
    scene.events.emit('update');
    assert.equal(scene.returns, 1);
    results.destroy();
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
    assert.equal(winner.angle, 0);
    assert.equal(winnerEntrance.angle, 360);
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

test('reward categories accumulate in order, finish naturally, and reuse the flying bricks', () => {
    const { results, drawn, advanceTo } = setup(800, 450);
    results.showPodium(data);
    results.showResults(data);
    const rows = [...results.rows];
    const flights = rows.flatMap(row => row.flights);
    const brickCount = drawn.filter(object => object.texture === 'tijolinho').length;
    const expectedTotals = [[14, 19], [44, 49], [64, 69], [114, 69]];

    advanceTo(0);
    assert.equal(results.subtitle.value, 'COLETA NA PISTA');
    assert.ok(flights.every(brick => brick.visible));
    assert.ok(rows.every(row => row.highlight.alpha === 1));
    assert.equal(results.returnButton.visible, false);
    advanceTo(255);
    assert.equal(rows[0].rewards[0].value.value, '+7');
    assert.equal(rows[0].total.value, '7');
    assert.equal(rows[0].progress.scaleX, 7 / 114);
    assert.ok(rows[0].flights.some(brick => brick.alpha > 0 && brick.y !== rows[0].rewards[0].value.y + 5));

    for (let category = 0; category < 4; category++) {
        advanceTo(category * 680 + 510);
        assert.equal(results.state, 'counting');
        for (const [index, row] of rows.entries()) {
            const total = expectedTotals[category][index];
            assert.equal(row.total.value, String(total));
            assert.equal(row.progress.scaleX, total / data[index].rewards.total);
            assert.equal(row.rewards[category].value.value, `+${data[index].rewards[row.rewards[category].key]}`);
            assert.ok(row.rewards.slice(category + 1).every(reward => reward.value.value === '+0'),
                'later categories wait until their turn');
            assert.ok(row.flights.every(brick => brick.visible === false), 'flights hide after landing');
        }
        if (category === 2) {
            advanceTo(2040);
            assert.ok(rows[0].flights.every(brick => brick.visible));
            assert.ok(rows[1].flights.every(brick => !brick.visible), 'zero victory bonus does not launch bricks');
        }
    }
    advanceTo(2920);
    assert.equal(results.state, 'settled');
    assert.equal(results.returnButton.visible, true);
    assert.equal(results.rewardTweens.size, 0);
    assert.equal(results.rewardTimers.size, 0);
    assert.ok(rows.every(row => row.progress.scaleX === 1 && row.highlight.alpha === 0));
    assert.deepEqual(rows.flatMap(row => row.flights), flights, 'each category uses the same pooled objects');
    assert.equal(drawn.filter(object => object.texture === 'tijolinho').length, brickCount);
    advanceTo(4000);
    assert.ok(rows.every(row => row.totalFlash.alpha === 0 && row.total.scaleX === 1 && row.total.scaleY === 1),
        'the final shine and number pulse settle back to their resting appearance');
    results.destroy();
});

test('skipping during a flight cancels partial counts and keeps the exact final totals', () => {
    const { results, scene, advanceTo } = setup();
    results.showResults(data);
    advanceTo(800);
    const rows = [...results.rows];
    assert.equal(results.subtitle.value, 'VOLTAS CONCLUÍDAS');
    assert.ok(rows[0].flights.some(brick => brick.visible && brick.alpha > 0));
    assert.notEqual(rows[0].total.value, '114');
    const interruptedTweens = [...results.rewardTweens];
    const pendingTimers = [...results.rewardTimers];
    scene.input.emit('pointerdown');
    assert.equal(results.state, 'settled');
    assert.ok(interruptedTweens.every(tween => tween.stopped));
    assert.ok(pendingTimers.every(timer => timer.removed));
    assert.equal(results.rewardTweens.size, 0);
    assert.equal(results.rewardTimers.size, 0);
    assert.ok(rows.every(row => row.highlight.alpha === 0 && row.flights.every(brick => !brick.visible)));
    assert.equal(scene.input.listenerCount('pointerdown'), 0);
    const expected = rows.map(row => ({ total: row.total.value, progress: row.progress.scaleX,
        rewards: row.rewards.map(reward => reward.value.value) }));
    assert.deepEqual(expected.map(row => row.total), ['114', '69']);
    advanceTo(10000);
    assert.deepEqual(rows.map(row => ({ total: row.total.value, progress: row.progress.scaleX,
        rewards: row.rewards.map(reward => reward.value.value) })), expected,
    'canceled callbacks cannot replace final values with an intermediate count');
    assert.ok(rows.every(row => row.highlight.alpha === 0 && row.totalFlash.alpha === 0
        && row.flights.every(brick => !brick.visible)));
    assert.ok(rows.every(row => !row.car.destroyed), 'car celebrations survive revealing rewards');
    results.destroy();
});

test('shutdown during flying rewards destroys owned UI and leaves no scheduled work', () => {
    const { results, scene, drawn, tweenQueue, timerQueue, advanceTo } = setup();
    results.showResults(data);
    advanceTo(255);
    assert.ok(results.rows.some(row => row.flights.some(brick => brick.visible && brick.alpha > 0)));
    const owned = [...results.objects];
    scene.events.emit('shutdown');
    assert.equal(results.state, 'hidden');
    assert.ok(owned.every(object => object.destroyed));
    assert.ok(tweenQueue.every(tween => tween.stopped || tween.completed));
    assert.ok(timerQueue.every(timer => timer.removed || timer.fired));
    assert.equal(results.tweens.size, 0);
    assert.equal(results.timers.size, 0);
    assert.equal(scene.input.listenerCount('pointerdown'), 0);
    assert.equal(scene.input.keyboard.listenerCount('keydown'), 0);
    assert.equal(scene.events.listenerCount('update'), 0);
    assert.equal(scene.events.listenerCount('shutdown'), 0);
    assert.equal(scene.hud.length, 1);
    const drawCount = drawn.length;
    const values = owned.filter(object => object.type === 'text').map(object => object.value);
    advanceTo(10000);
    assert.equal(drawn.length, drawCount, 'shutdown cancels delayed confetti creation');
    assert.deepEqual(owned.filter(object => object.type === 'text').map(object => object.value), values,
        'shutdown cancels counter callbacks against destroyed text');
});
