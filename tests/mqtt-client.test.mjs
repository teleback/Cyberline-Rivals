// Run with Node 22+: node --test tests/mqtt-client.test.mjs
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

const connections = [];
class Connection extends EventEmitter {
    constructor(url, options) {
        super();
        Object.assign(this, { url, options, connected: false, published: [], subscriptions: [] });
    }
    subscribe(topic, options, callback) {
        this.subscriptions.push({ topic, options });
        callback(null);
    }
    publish(topic, payload, options) {
        this.published.push({ topic, state: JSON.parse(payload), options });
    }
    end(force) { this.ended = force; }
}
globalThis.Phaser = { Events: { EventEmitter } };
globalThis.window = {
    mqtt: { connect(url, options) {
        const connection = new Connection(url, options);
        connections.push(connection);
        return connection;
    } },
};

const { default: MQTTClient } = await import('../js/MQTTClient.js');
async function connect(room = 2) {
    const multiplayer = new MQTTClient('local-player');
    const pending = multiplayer.connect(room, { nick: 'LOCAL', skin: 'blue' });
    await new Promise(resolve => setImmediate(resolve));
    const client = connections.at(-1);
    client.connected = true;
    client.emit('connect');
    await pending;
    return { multiplayer, client };
}
function message(client, id, state, { room = 2, retain = false, topic } = {}) {
    client.emit('message', topic || `cyberline/race/room/${room}/player/${id}`,
        Buffer.from(JSON.stringify(state)), { retain });
}

test('retained ready racers never create ghosts; live players and retained departures are delivered', async () => {
    const { multiplayer, client } = await connect();
    const players = [];
    const messages = [];
    multiplayer.on('player', state => players.push(state));
    multiplayer.on('message', (...args) => messages.push(args));
    message(client, 'old-ready', { id: 'old-ready', online: true, ready: true, x: 800, y: 900 }, { retain: true });
    message(client, 'old-unready', { id: 'old-unready', online: true, ready: false }, { retain: true });
    assert.equal(players.length, 0);
    assert.equal(messages.length, 0);
    assert.equal(multiplayer.lastMessageAt, 0);

    const live = { id: 'rival', online: true, ready: true, x: 100, y: 180 };
    message(client, 'rival', live);
    assert.deepEqual(players, [live]);
    assert.deepEqual(messages[0], ['room/2/player/rival', live]);
    assert.ok(multiplayer.lastMessageAt > 0);
    message(client, 'rival', { id: 'rival', online: false }, { retain: true });
    assert.equal(players.at(-1).online, false);
    multiplayer.disconnect();
});

test('only a valid player payload matching its room and topic reaches the race', async () => {
    const { multiplayer, client } = await connect();
    const received = [];
    multiplayer.on('player', state => received.push(state));
    multiplayer.on('message', state => received.push(state));
    for (const state of [null, [], true, 'text', {}, { id: 'rival' }, { id: 'rival', online: 'true' }]) {
        message(client, 'rival', state);
    }
    message(client, 'rival', { id: 'different', online: true });
    message(client, 'rival', { id: 'rival', online: true }, { room: 3 });
    message(client, 'rival', { id: 'rival', online: true }, { topic: 'other/room/2/player/rival' });
    message(client, 'rival', { id: 'rival', online: true }, { topic: 'cyberline/race/room/2/player/rival/pose' });
    message(client, '', { id: '', online: true });
    message(client, 'local-player', { id: 'local-player', online: true });
    client.emit('message', 'cyberline/race/room/2/player/rival', Buffer.from('invalid JSON'), {});
    assert.equal(received.length, 0);
    assert.equal(multiplayer.lastMessageAt, 0);
    multiplayer.disconnect();
});

test('movement is dropped during disconnect; reconnect announces current presence without an old pose', async () => {
    const { multiplayer, client } = await connect();
    assert.equal(client.options.queueQoSZero, false);
    assert.equal(client.options.clean, true);
    const firstPresence = client.published[0];
    assert.equal(firstPresence.state.online, true);
    assert.deepEqual(firstPresence.options, { qos: 1, retain: true });
    assert.deepEqual(client.subscriptions[0], {
        topic: 'cyberline/race/room/2/player/+', options: { qos: 0 },
    });
    assert.equal(JSON.parse(client.options.will.payload).online, false);

    assert.equal(multiplayer.publish({ id: 'local-player', online: true, x: 120, y: 200 }), true);
    const sentBeforeDisconnect = client.published.length;
    const sequence = multiplayer.networkSequence;
    // MQTT marks the socket disconnected before its offline event arrives.
    client.connected = false;
    assert.equal(multiplayer.publish({ x: 999 }, { qos: 1 }), false);
    client.emit('offline');
    for (const event of ['reconnect', 'close']) {
        client.emit(event);
        assert.equal(multiplayer.publish({ x: 888 }), false);
    }
    assert.equal(client.published.length, sentBeforeDisconnect);
    assert.equal(multiplayer.networkSequence, sequence);

    client.connected = true;
    client.emit('connect');
    assert.equal(client.published.length, sentBeforeDisconnect + 1);
    const presence = client.published.at(-1).state;
    assert.equal(presence.online, true);
    assert.equal(presence.x, undefined);
    assert.equal(presence.y, undefined);
    assert.equal(presence.ready, undefined);
    assert.equal(presence.sessionId, firstPresence.state.sessionId);
    assert.equal(presence.seq, sequence + 1);
    multiplayer.disconnect();
});

test('reliable finish and brick packets retain QoS1 and a monotonic sequence alongside movement', async () => {
    const { multiplayer, client } = await connect();
    const finish = { id: 'local-player', online: true, finished: true, roundId: 'round', finishElapsedMs: 12000 };
    const brick = { id: 'local-player', online: true, brickState: { revision: 2, collected: ['a'] } };
    multiplayer.publish({ id: 'local-player', online: true, x: 20, y: 30 });
    multiplayer.publish(finish, { qos: 1, retain: true });
    multiplayer.publish(brick, { qos: 1 });
    assert.deepEqual(client.published.map(packet => packet.state.seq), [1, 2, 3, 4]);
    assert.deepEqual(client.published[1].options, { qos: 0, retain: false });
    assert.deepEqual(client.published[2].options, { qos: 1, retain: true });
    assert.deepEqual(client.published[3].options, { qos: 1, retain: false });
    assert.equal(client.published[2].state.finishElapsedMs, finish.finishElapsedMs);
    assert.deepEqual(client.published[3].state.brickState, brick.brickState);

    multiplayer.disconnect();
    assert.deepEqual(client.published.at(-1).options, { qos: 1, retain: true });
    assert.equal(client.published.at(-1).state.online, false);
    assert.equal(client.published.at(-1).state.seq, 5);
});

test('a departed connection cannot deliver late players or revive itself', async () => {
    const { multiplayer, client } = await connect();
    const received = [];
    multiplayer.on('player', state => received.push(state));
    multiplayer.disconnect();
    const sent = client.published.length;
    message(client, 'late-rival', { id: 'late-rival', online: true, ready: true });
    client.emit('connect');
    assert.equal(received.length, 0);
    assert.equal(client.published.length, sent);
    assert.equal(multiplayer.connected, false);
    assert.equal(multiplayer.client, null);
});
