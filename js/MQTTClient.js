// Cliente MQTT do multiplayer.
// Para trocar o broker, altere MQTT_URL neste arquivo.
const MQTT_URL = 'wss://broker.emqx.io:8084/mqtt';
const MQTT_CDN = 'https://unpkg.com/mqtt@5.14.1/dist/mqtt.min.js';
const TOPIC_ROOT = 'cyberline/race';

function makeId() {
    const key = 'cyberlinePlayerId';
    try {
        let id = localStorage.getItem(key);
        if (id) return id;
        id = ((window.crypto && typeof window.crypto.randomUUID === 'function') ? window.crypto.randomUUID() : '') || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(key, id);
        return id;
    } catch (_) {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
}

function hashId(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
    return Math.abs(h);
}

export default class MQTTClient {
    constructor(scene, playerId = null) {
        this.scene = scene;
        this.playerId = playerId || makeId();
        this.sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        this.client = null;
        this.roomId = null;
        this.roomTopic = null;
        this.playerTopic = null;
        this.handlers = {};
        this.connected = false;
        this.lastStateAt = 0;
    }

    async connect(roomId, player) {
        await this.loadLibrary();
        this.roomId = roomId;
        this.player = player;
        this.roomTopic = `${TOPIC_ROOT}/room/${roomId}/player/+`;
        this.playerTopic = `${TOPIC_ROOT}/room/${roomId}/player/${this.playerId}`;

        return new Promise((resolve, reject) => {
            if (!window.mqtt) {
                reject(new Error('mqtt.js não foi carregado.'));
                return;
            }

            const clientId = `cyberline_${this.playerId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 30)}_${Math.random().toString(36).slice(2, 7)}`;

            this.client = window.mqtt.connect(MQTT_URL, {
                clientId,
                clean: true,
                reconnectPeriod: 1500,
                connectTimeout: 10000,
                keepalive: 20,
                will: {
                    topic: this.playerTopic,
                    qos: 0,
                    retain: true,
                    payload: JSON.stringify({ id: this.playerId, sessionId: this.sessionId, online: false })
                }
            });

            this.client.on('connect', () => {
                this.connected = true;
                this.client.subscribe(this.roomTopic, { qos: 0 }, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    this.publish({
                        ...this.player,
                        id: this.playerId,
                        sessionId: this.sessionId,
                        online: true,
                        ts: Date.now()
                    }, { retain: true });
                    this.emit('status', 'CONECTADO');
                    resolve();
                });
            });

            this.client.on('reconnect', () => {
                this.connected = false;
                this.emit('status', 'RECONECTANDO...');
            });

            this.client.on('offline', () => {
                this.connected = false;
                this.emit('status', 'OFFLINE');
            });

            this.client.on('error', (err) => {
                console.error('[MQTT]', err);
                this.emit('status', 'ERRO DE REDE');
            });

            this.client.on('message', (topic, buffer) => {
                if (topic === this.playerTopic) return;
                try {
                    const state = JSON.parse(buffer.toString());
                    if (!state || state.id === this.playerId) return;
                    this.emit('player', state);
                } catch (err) {
                    console.warn('[MQTT] pacote inválido:', err);
                }
            });
        });
    }


    loadLibrary() {
        if (window.mqtt) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-cyberline-mqtt]');
            if (existing) {
                existing.addEventListener('load', () => window.mqtt ? resolve() : reject(new Error('mqtt.js carregou sem expor window.mqtt.')), { once: true });
                existing.addEventListener('error', () => reject(new Error('Não foi possível carregar mqtt.js.')), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = MQTT_CDN;
            script.async = true;
            script.dataset.cyberlineMqtt = '1';
            script.onload = () => window.mqtt ? resolve() : reject(new Error('mqtt.js carregou sem expor window.mqtt.'));
            script.onerror = () => reject(new Error('Não foi possível carregar mqtt.js.'));
            document.head.appendChild(script);
        });
    }

    on(event, callback) {
        if (!this.handlers[event]) this.handlers[event] = new Set();
        this.handlers[event].add(callback);
        return () => this.handlers[event]?.delete(callback);
    }

    emit(event, data) {
        this.handlers[event]?.forEach(fn => fn(data));
    }

    publish(state, options = {}) {
        if (!this.client || !this.connected || !this.playerTopic) return;
        this.client.publish(this.playerTopic, JSON.stringify(state), {
            qos: 0,
            retain: options.retain === true
        });
    }

    disconnect() {
        if (!this.client) return;
        try {
            if (this.connected) {
                this.publish({
                    id: this.playerId,
                    sessionId: this.sessionId,
                    online: false,
                    ts: Date.now()
                }, { retain: true });
            }
            this.client.end(true);
        } catch (_) {}
        this.client = null;
        this.connected = false;
    }

    static slotFor(id) {
        return hashId(id) % 2;
    }
}
