import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import TurboAudio from '../js/fx/TurboAudio.js';

function context() {
    const nodes = [];
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
    const node = () => {
        const result = { gain: param(), frequency: param(), Q: param(),
            connect() {}, disconnect() { this.disconnected = true; },
            start() { this.started = true; }, stop() { this.stopped = true; } };
        nodes.push(result);
        return result;
    };
    return { nodes, sampleRate: 48000, state: 'running', currentTime: 0, destination: {},
        createGain: node, createBufferSource: node, createOscillator: node, createBiquadFilter: node,
        createBuffer(_channels, frames) { return { getChannelData: () => new Float32Array(frames) }; },
        close() { this.closed = true; return Promise.resolve(); } };
}

globalThis.window = {};

test('prepared turbo audio reuses the game context and releases all nodes and car listeners on exit', () => {
    const car = new EventEmitter(), shared = context();
    const audio = new TurboAudio(car, shared);
    assert.equal(audio.ensure(), true);
    assert.equal(audio.ctx, shared);
    assert.equal(audio.ensure(), true);
    const continuousNodes = shared.nodes.length;
    car.emit('turbo-start');
    assert.equal(shared.nodes.length, continuousNodes + 3, 'only the short burst is created on activation');
    const burst = [...audio.bursts][0];
    burst.src.onended();
    assert.equal(audio.bursts.size, 0);
    assert.ok(burst.src.disconnected && burst.filter.disconnected && burst.gain.disconnected);
    car.emit('turbo-overheat');
    assert.ok(audio.bursts.size > 0);
    audio.destroy();
    audio.destroy();
    assert.equal(audio.ready, false);
    assert.equal(audio.ensure(), false);
    assert.equal(shared.closed, undefined, 'the menu still needs the shared audio context');
    assert.equal(audio.bursts.size, 0);
    assert.ok(shared.nodes.every(node => node.disconnected));
    assert.equal(car.eventNames().length, 0);
});

test('a standalone turbo closes its own context and works without WebAudio support', () => {
    const owned = context();
    window.AudioContext = function () { return owned; };
    const audio = new TurboAudio(new EventEmitter());
    assert.equal(audio.ensure(), true);
    audio.destroy();
    assert.equal(owned.closed, true);
    delete window.AudioContext;
    const silent = new TurboAudio(new EventEmitter());
    assert.equal(silent.ensure(), false);
    silent.destroy();
});
