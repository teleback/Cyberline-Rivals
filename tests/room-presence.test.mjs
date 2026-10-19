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
const { ROOM_COUNT, ROOM_CAPACITY } = await import('../js/objects/Rooms.js');
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
    message(client, 11, 'invalid-room', true);
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

test('rooms with two live racers display an ongoing match and block another entry', () => {
    const scene = Object.create(RoomSelection.prototype);
    const players = new Map([['a', Date.now()], ['b', Date.now()]]);
    let message, destination;
    Object.assign(scene, { playerId: 'viewer', selectedRoom: 2, roomPresenceReady: true, roomPlayers: new Map([[2, players]]),
        statusText: { setText(value) { message = value; } },
        scene: { start(value) { destination = value; } } });
    assert.equal(scene.getRoomDetailText(scene.getRoomOccupancy(2)), 'PARTIDA EM ANDAMENTO');
    scene.confirmSelection();
    assert.equal(destination, undefined);
    assert.equal(message, 'SALA 2: PARTIDA EM ANDAMENTO');
    players.delete('b');
    assert.equal(scene.getRoomDetailText(scene.getRoomOccupancy(2)), '1 JOGADOR');
    scene.confirmSelection();
    assert.equal(destination, 'CarSelection');
});

test('all ten rooms report live occupancy and enforce the same two-player capacity', async () => {
    const scene = Object.create(RoomSelection.prototype), entries = [];
    Object.assign(scene, {
        playerId: 'viewer', selectedRoom: 1, roomPlayers: new Map(), roomPresenceReady: false,
        events: new EventEmitter(), time: { delayedCall: (_delay, callback) => callback() },
        selectRoom() {}, statusText: { setText() {} },
        scene: { start(name, data) { entries.push({ name, ...data }); } },
    });
    scene.startRoomPresence();
    await new Promise(resolve => setImmediate(resolve));
    const client = scene.roomDirectory.client;
    client.emit('connect');
    assert.equal(ROOM_COUNT, 10);
    assert.equal(ROOM_CAPACITY, 2);
    for (let room = 1; room <= ROOM_COUNT; room++) {
        scene.selectedRoom = room;
        message(client, room, 'a', true);
        message(client, room, 'b', true);
        assert.equal(scene.getRoomOccupancy(room), 2);
        assert.equal(scene.getRoomDetailText(2), 'PARTIDA EM ANDAMENTO');
        scene.confirmSelection();
        assert.equal(entries.length, room - 1, `room ${room} blocks a third player`);
        message(client, room, 'b', false);
        scene.enteringRoom = false;
        scene.confirmSelection();
        assert.equal(entries.at(-1).roomId, room);
        assert.equal(entries.at(-1).name, 'CarSelection');
        scene.enteringRoom = false;
    }
    message(client, 0, 'invalid', true);
    message(client, 11, 'invalid', true);
    assert.equal(scene.roomPlayers.has(0), false);
    assert.equal(scene.roomPlayers.has(11), false);
    scene.events.emit('shutdown');
});

test('a room cannot be entered before occupancy is known or while the connection is unavailable', () => {
    for (const status of ['connecting', 'offline']) {
        const scene = Object.create(RoomSelection.prototype);
        let entered = false, message = '';
        Object.assign(scene, { selectedRoom: 10, roomPresenceReady: false, roomPresenceStatus: status,
            statusText: { setText(value) { message = value; } },
            scene: { start() { entered = true; } } });
        scene.confirmSelection();
        assert.equal(entered, false);
        assert.equal(scene.enteringRoom, undefined);
        assert.ok(message.length > 0);
    }
});

test('movement packets refresh presence without repeatedly redrawing the ten room cards', async () => {
    const scene = Object.create(RoomSelection.prototype);
    let redraws = 0;
    Object.assign(scene, {
        playerId: 'viewer', selectedRoom: 1, roomPlayers: new Map(),
        events: new EventEmitter(), time: { delayedCall() {} },
        selectRoom() { redraws++; },
    });
    scene.startRoomPresence();
    await new Promise(resolve => setImmediate(resolve));
    const client = scene.roomDirectory.client;
    message(client, 10, 'a', true);
    const afterJoin = redraws;
    scene.roomPlayers.get(10).set('a', 0);
    for (let packet = 0; packet < 120; packet++) message(client, 10, 'a', true);
    assert.equal(redraws, afterJoin);
    assert.equal(scene.getRoomOccupancy(10), 1, 'live messages keep the slot present');
    message(client, 10, 'a', false);
    assert.equal(redraws, afterJoin + 1);
    scene.events.emit('shutdown');
});

test('room navigation reaches every page and wraps vertically within the same column', () => {
    const scene = Object.create(RoomSelection.prototype);
    scene.roomColumns = 3;
    scene.roomsPerPage = 6;
    scene.pageCount = 2;
    scene.selectRoom = function (id) { this.selectedRoom = id; this.roomPage = Math.floor((id - 1) / this.roomsPerPage); };
    scene.selectRoom(1);
    const visited = new Set();
    for (let step = 0; step < ROOM_COUNT; step++) {
        visited.add(scene.selectedRoom);
        scene.moveSelection(1);
    }
    assert.equal(visited.size, ROOM_COUNT);
    assert.equal(scene.selectedRoom, 1);
    scene.moveSelection(-3);
    assert.equal(scene.selectedRoom, 10);
    assert.equal(scene.roomPage, 1);
    scene.moveSelection(3);
    assert.equal(scene.selectedRoom, 1);
    scene.changePage(1);
    assert.equal(scene.selectedRoom, 7);
    scene.changePage(-1);
    assert.equal(scene.selectedRoom, 1);
    for (const saved of ['5', '10', '11', '0', 'abc']) {
        globalThis.localStorage = { getItem: () => saved };
        assert.equal(scene.getSavedSelectedRoom(), ['5', '10'].includes(saved) ? Number(saved) : 1);
    }
});
