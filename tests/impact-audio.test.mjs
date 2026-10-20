import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import ImpactAudio from '../js/fx/ImpactAudio.js';

function setup() {
    const sources = [], gains = [], output = {};
    const node = () => ({ connect(target) { this.target = target; return target; },
        disconnect() { this.disconnected = true; } });
    const ctx = { state: 'running', currentTime: 0, sampleRate: 8000, bufferCount: 0,
        createBuffer(_channels, count) { this.bufferCount++; return { getChannelData: () => new Float32Array(count) }; },
        createGain() { const gain = { ...node(), gain: { value: 1 } }; gains.push(gain); return gain; },
        createBufferSource() { const source = { ...node(), playbackRate: { value: 1 },
            start() { this.started = true; }, stop() { this.stopped = true; } }; sources.push(source); return source; } };
    const scene = { sound: { context: ctx, masterMuteNode: output, volume: 0.5, mute: false }, events: new EventEmitter() };
    return { scene, ctx, sources, gains, audio: new ImpactAudio(scene), output };
}

test('impact audio is quiet, follows master volume/mute and skips resting scrapes', () => {
    const { scene, ctx, audio, sources, gains, output } = setup();
    audio.play(20);
    assert.equal(sources.length, 0);
    scene.sound.mute = true;
    audio.play(390);
    assert.equal(sources.length, 0);
    scene.sound.mute = false;
    audio.play(390, 'car');
    assert.equal(sources.length, 1);
    assert.ok(gains[0].gain.value > 0 && gains[0].gain.value <= 0.11);
    assert.equal(gains[0].target, output);
    assert.equal(sources[0].playbackRate.value, 0.87);
    audio.play(500);
    assert.equal(sources.length, 1, 'same-frame contacts cannot stack sounds');
    ctx.currentTime = 1;
    audio.play(400, 'barrel');
    assert.equal(sources[1].playbackRate.value, 1.3);
});

test('samples are shared, voices are bounded and scene shutdown releases audio nodes', () => {
    const { scene, ctx, audio, sources, gains } = setup();
    new ImpactAudio(scene);
    assert.equal(ctx.bufferCount, 1);
    for (let i = 0; i < 10; i++) { ctx.currentTime = i; audio.play(600); }
    assert.equal(sources.length, 3);
    sources[0].onended();
    assert.equal(audio.voices.size, 2);
    assert.equal(sources[0].disconnected, true);
    ctx.currentTime++;
    audio.play(600);
    assert.equal(audio.voices.size, 3);
    scene.events.emit('shutdown');
    assert.equal(audio.voices.size, 0);
    assert.ok(sources.every(source => source.disconnected));
    assert.ok(gains.every(gain => gain.disconnected));
    audio.play(600);
    assert.equal(sources.length, 4);
});

test('without WebAudio or with a suspended context the race can continue silently', () => {
    const scene = { events: new EventEmitter(), sound: {} };
    const audio = new ImpactAudio(scene);
    assert.doesNotThrow(() => audio.play(500));
    scene.events.emit('shutdown');
    const other = setup(); other.ctx.state = 'suspended';
    other.audio.play(500);
    assert.equal(other.sources.length, 0);
});
