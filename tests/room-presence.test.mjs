// Run with Node 22+: node tests/room-presence.test.mjs
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

const connections = [];
class Connection extends EventEmitter {
    subscribe(topic, options, callback) { this.topic = topic; callback(null); }
    end(force) { this.ended = force; }
}
globalThis.Phaser = { Scene: class {}, Events: { EventEmitter } };
globalThis.window = {
    addEventListener() {},
    mqtt: { connect(url, options) {
        const client = new Connection();
        Object.assign(client, { url, options });
        connections.push(client);
        return client;
    } },
};
// Legacy reservations must never count as connected players.
globalThis.localStorage = { getItem: key => key === 'cyberlineRoomState'
    ? JSON.stringify({ 4: { players: { ghost: Date.now() } } }) : null };

const { default: RoomPresence, PRESENCE_TIMEOUT } = await import('../js/input/RoomPresence.js');
const { default: RoomSelection } = await import('../js/scenes/RoomSelectionScene.js');
function message(client, room, id, online, retain = false) {
    client.emit('message', `cyberline/race/room/${room}/player/${id}`,
        Buffer.from(JSON.stringify({ id, online })), { retain });
}

test('directory observes all rooms without occupying a slot and ignores old retained players', async () => {
    const received = [];
    const status = [];
    const directory = new RoomPresence('viewer', (...args) => received.push(args), value => status.push(value));
    await directory.start();
    const client = directory.client;
    assert.equal(client.options.will, undefined);
    client.emit('connect');
    assert.equal(client.topic, 'cyberline/race/room/+/player/+');
    assert.equal(status.at(-1), 'connected');
    message(client, 4, 'old-player', true, true);
    assert.equal(received.length, 0);
    message(client, 4, 'live-player', true);
    assert.deepEqual(received[0], [4, { id: 'live-player', online: true }]);
    message(client, 5, 'invalid-room', true);
    client.emit('message', 'cyberline/race/room/4/player/mismatch',
        Buffer.from('{"id":"other","online":true}'), {});
    client.emit('message', 'cyberline/race/room/4/player/bad', Buffer.from('invalid'), {});
    assert.equal(received.length, 1);
    message(client, 4, 'live-player', false, true);
    assert.equal(received[1][1].online, false);
    directory.destroy();
    assert.equal(client.ended, true);
    message(client, 4, 'late-player', true);
    assert.equal(received.length, 2);
});

test('scene ignores saved ghosts, counts live players and removes departures and expired presence', async () => {
    const scene = Object.create(RoomSelection.prototype);
    const pending = [];
    Object.assign(scene, {
        playerId: 'viewer', selectedRoom: 4, roomPlayers: new Map(),
        events: new EventEmitter(), time: { delayedCall: (_delay, callback) => pending.push(callback) },
        selectRoom() {},
    });
    scene.startRoomPresence();
    await new Promise(resolve => setImmediate(resolve));
    const client = scene.roomDirectory.client;
    assert.equal(scene.getRoomOccupancy(4), 0);
    client.emit('connect');
    message(client, 4, 'ghost', true, true);
    pending.shift()();
    assert.equal(scene.roomPresenceReady, true);
    assert.equal(scene.getRoomOccupancy(4), 0);
    message(client, 4, 'a', true);
    message(client, 4, 'b', true);
    assert.equal(scene.getRoomOccupancy(4), 2);
    message(client, 4, 'a', false);
    assert.equal(scene.getRoomOccupancy(4), 1);
    scene.roomPlayers.get(4).set('b', Date.now() - PRESENCE_TIMEOUT - 1);
    assert.equal(scene.getRoomOccupancy(4), 0);
    message(client, 4, 'c', true);
    client.emit('offline');
    assert.equal(scene.roomPresenceReady, false);
    assert.equal(scene.roomPresenceStatus, 'offline');
    assert.equal(scene.getRoomOccupancy(4), 0);
    client.emit('connect');
    client.emit('close');
    pending.shift()();
    assert.equal(scene.roomPresenceReady, false);
    scene.events.emit('shutdown');
    assert.equal(client.ended, true);
});

test('library failure reports unknown occupancy and leaving before loading opens no connection', async () => {
    const statuses = [];
    const failed = new RoomPresence('viewer', () => {}, status => statuses.push(status));
    failed.info.loadLibrary = () => Promise.reject(new Error('network failure'));
    await failed.start();
    assert.equal(statuses.at(-1), 'offline');
    const cancelled = new RoomPresence('viewer', () => {}, () => {});
    let finishLoading;
    cancelled.info.loadLibrary = () => new Promise(resolve => { finishLoading = resolve; });
    const before = connections.length;
    const loading = cancelled.start();
    cancelled.destroy();
    finishLoading();
    await loading;
    assert.equal(connections.length, before);
});
