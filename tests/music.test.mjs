import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { MUSIC, loadMusic, playMusic, stopMusic } from '../js/fx/Music.js';

function setup() {
    const sounds = [];
    const manager = new EventEmitter();
    manager.locked = false;
    manager.add = (key, config) => {
        const sound = { key, ...config, isPlaying: false, plays: 0,
            play() { this.plays++; this.isPlaying = !manager.locked; },
            setVolume(value) { this.volume = value; },
            destroy() { this.destroyed = true; this.isPlaying = false; },
        };
        sounds.push(sound);
        return sound;
    };
    const scene = { sound: manager, cache: { audio: { exists: () => true } } };
    return { scene, manager, sounds };
}

test('menu navigation preserves playback; countdown ducks it; race replaces it with a quieter loop', () => {
    const { scene, sounds } = setup();
    playMusic(scene, 'lobby');
    playMusic({ ...scene }, 'lobby');
    assert.equal(sounds.length, 1);
    assert.equal(sounds[0].plays, 1);
    assert.equal(sounds[0].loop, true);
    playMusic(scene, 'lobby', 0.07);
    assert.equal(sounds[0].volume, 0.07);
    playMusic(scene, 'lobby');
    assert.equal(sounds[0].volume, MUSIC.lobby.volume);
    playMusic(scene, 'race');
    assert.equal(sounds[0].destroyed, true);
    assert.equal(sounds[1].key, MUSIC.race.key);
    assert.equal(sounds[1].loop, true);
    assert.ok(sounds[1].volume < MUSIC.lobby.volume);
    stopMusic(scene);
    assert.equal(sounds[1].destroyed, true);
    playMusic(scene, 'lobby');
    assert.equal(sounds[2].key, MUSIC.lobby.key);
});

test('unlock starts only the current track and cannot restart music after finishing', () => {
    const { scene, manager, sounds } = setup();
    manager.locked = true;
    playMusic(scene, 'lobby');
    playMusic(scene, 'race');
    manager.locked = false;
    manager.emit('unlocked');
    assert.equal(sounds[0].plays, 1);
    assert.equal(sounds[1].isPlaying, true);
    manager.emit('unlocked');
    assert.equal(sounds[1].plays, 2);
    stopMusic(scene);
    manager.emit('unlocked');
    assert.equal(sounds[1].plays, 2);
});

test('both supplied MP3 paths exist and loading encodes spaces and Unicode', () => {
    const loads = [];
    const scene = { cache: { audio: { exists: () => false } },
        load: { audio: (...args) => loads.push(args) } };
    for (const [mode, track] of Object.entries(MUSIC)) {
        assert.ok(existsSync(track.path));
        loadMusic(scene, mode);
        assert.deepEqual(loads.at(-1), [track.key, encodeURI(track.path)]);
    }
    scene.cache.audio.exists = () => true;
    loadMusic(scene, 'lobby');
    assert.equal(loads.length, 2);
});
