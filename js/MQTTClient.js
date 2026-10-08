// Cliente MQTT do multiplayer.
// A estrutura segue a ideia do cliente do professor (um wrapper compartilhado
// com eventos, subscribe/publish e um prefixo de tópicos), mas mantém o
// protocolo específico do Cyberline Rivals: salas, presença e estado da corrida.

const MQTT_URL = 'wss://cyberline-rivals.feira-de-jogos.dev.br/mqtt';
const MQTT_CDN = 'https://unpkg.com/mqtt@5.14.1/dist/mqtt.min.js';
const TOPIC_PREFIX = 'cyberline/race';
const CLIENT_ID_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function generateClientId() {
    let id = '';
    for (let i = 0; i < 4; i++) {
        id += CLIENT_ID_LETTERS[Math.floor(Math.random() * CLIENT_ID_LETTERS.length)];
    }
    return id;
}

function makePlayerId() {
    // sessionStorage evita que duas abas do mesmo navegador sejam confundidas
    // como o mesmo piloto. O ID continua estável durante todas as cenas da aba.
    const key = 'cyberlinePlayerId';
    try {
        let id = sessionStorage.getItem(key);
        if (id) return id;
        id = (window.crypto && typeof window.crypto.randomUUID === 'function')
            ? window.crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(key, id);
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

export default class MQTTClient extends Phaser.Events.EventEmitter {
    constructor(playerId = null) {
        super();
        this.brokerUrl = MQTT_URL;
        this.topicPrefix = TOPIC_PREFIX;
        this.playerId = playerId || makePlayerId();
        this.sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        this.clientId = `${generateClientId()}-${this.sessionId.slice(-6)}`;
        this.client = null;
        this.roomId = null;
        this.roomTopic = null;
        this.playerTopic = null;
        this.player = null;
        this.connected = false;
        this.connectPromise = null;
        this.lastMessageAt = 0;
        this.networkSequence = 0;
    }

    async connect(roomId, player) {
        await this.loadLibrary();
        this.roomId = Number(roomId) || 1;
        this.player = player || {};
        this.roomTopic = `${this.topicPrefix}/room/${this.roomId}/player/+`;
        this.playerTopic = `${this.topicPrefix}/room/${this.roomId}/player/${this.playerId}`;

        if (this.connected && this.client) return;
        if (this.connectPromise) return this.connectPromise;

        this.connectPromise = new Promise((resolve, reject) => {
            if (!window.mqtt) {
                reject(new Error('mqtt.js não foi carregado.'));
                return;
            }

            // Um clientId novo por conexão evita colisão quando o mesmo piloto
            // abre duas abas/dispositivos ao mesmo tempo.
            const clientId = `cyberline_${this.playerId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)}_${this.clientId}`;

            this.client = window.mqtt.connect(this.brokerUrl, {
                clientId,
                clean: true,
                reconnectPeriod: 1000,
                connectTimeout: 8000,
                keepalive: 20,
                resubscribe: true,
                queueQoSZero: false,
                will: {
                    topic: this.playerTopic,
                    qos: 1,
                    retain: true,
                    payload: JSON.stringify({
                        id: this.playerId,
                        sessionId: this.sessionId,
                        online: false,
                        ts: Date.now()
                    })
                }
            });

            this.client.on('connect', () => {
                this.connected = true;
                this.emit('connect');

                this.client.subscribe(this.roomTopic, { qos: 0 }, (err) => {
                    if (err) {
                        this.emit('error', err);
                        reject(err);
                        return;
                    }

                    // Presença é retida; movimento nunca é retido.
                    this.publish({
                        ...this.player,
                        id: this.playerId,
                        sessionId: this.sessionId,
                        online: true,
                        ts: Date.now()
                    }, { retain: true, qos: 1 });

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
                this.emit('error', err);
                this.emit('status', 'ERRO DE REDE');
                // Se a conexão inicial falhar, deixa a cena tratar o erro;
                // reconexões posteriores continuam automáticas.
                if (!this.connected) reject(err);
            });

            this.client.on('close', () => {
                this.connected = false;
                this.emit('close');
            });

            this.client.on('message', (topic, buffer, packet) => {
                this.lastMessageAt = performance.now();

                if (topic === this.playerTopic) return;

                let data;
                try {
                    data = JSON.parse(buffer.toString());
                } catch (_) {
                    data = buffer.toString();
                }

                const shortTopic = topic.startsWith(`${this.topicPrefix}/`)
                    ? topic.slice(this.topicPrefix.length + 1)
                    : topic;

                // Presença retida é útil para descobrir quem já está na sala,
                // mas um estado antigo de corrida não deve reposicionar o rival.
                if (packet?.retain && data?.online === true && !data?.ready) return;

                this.emit('message', shortTopic, data);
                this.emit(`message:${shortTopic}`, data);

                if (data && typeof data === 'object' && data.id && data.id !== this.playerId) {
                    // O RaceScene recebe somente estados de jogadores da sala.
                    this.emit('player', data);
                }
            });
        }).finally(() => {
            this.connectPromise = null;
        });

        return this.connectPromise;
    }

    loadLibrary() {
        if (window.mqtt) return Promise.resolve();

        return new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-cyberline-mqtt]');
            if (existing) {
                existing.addEventListener('load', () => window.mqtt
                    ? resolve()
                    : reject(new Error('mqtt.js carregou sem expor window.mqtt.')), { once: true });
                existing.addEventListener('error', () => reject(new Error('Não foi possível carregar mqtt.js.')), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = MQTT_CDN;
            script.async = true;
            script.dataset.cyberlineMqtt = '1';
            script.onload = () => window.mqtt
                ? resolve()
                : reject(new Error('mqtt.js carregou sem expor window.mqtt.'));
            script.onerror = () => reject(new Error('Não foi possível carregar mqtt.js.'));
            document.head.appendChild(script);
        });
    }

    subscribe(topic) {
        const fullTopic = topic.startsWith(`${this.topicPrefix}/`)
            ? topic
            : `${this.topicPrefix}/${topic}`;
        this.client?.subscribe(fullTopic, { qos: 0 }, (err) => {
            if (err) console.error(`[MQTT] Falha ao assinar ${fullTopic}:`, err);
        });
    }

    publish(state, options = {}) {
        if (!this.client || !this.connected || !this.playerTopic) return false;

        const qos = options.qos === 1 ? 1 : 0;
        const retain = options.retain === true;
        const payload = JSON.stringify({
            ...(state && typeof state === 'object' ? state : { data: state }),
            clientId: this.clientId,
            seq: ++this.networkSequence
        });

        this.client.publish(this.playerTopic, payload, { qos, retain });
        return true;
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
                }, { retain: true, qos: 1 });
            }
            this.client.end(false);
        } catch (_) {}

        this.client = null;
        this.connected = false;
        this.connectPromise = null;
    }

    static slotFor(id) {
        return hashId(id) % 2;
    }
}
