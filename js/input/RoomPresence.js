import MQTTClient from '../MQTTClient.js';

// A corrida publica continuamente. Sem novas mensagens, o piloto deixa de
// contar como presente, inclusive se o navegador fechou sem avisar ao broker.
export const PRESENCE_TIMEOUT = 5000;

export default class RoomPresence {
    constructor(playerId, onPlayer, onStatus) {
        this.info = new MQTTClient(playerId);
        this.onPlayer = onPlayer;
        this.onStatus = onStatus;
        this.client = null;
        this.destroyed = false;
    }

    async start() {
        this.onStatus('connecting');
        try {
            await this.info.loadLibrary();
            if (this.destroyed) return;
            // Esta conexão só observa as salas: abrir o menu não ocupa vaga.
            this.client = window.mqtt.connect(this.info.brokerUrl, {
                clientId: `cyberline_lobby_${this.info.sessionId}_${this.info.clientId}`,
                clean: true, reconnectPeriod: 1000, connectTimeout: 8000, keepalive: 20,
            });
            this.client.on('connect', () => {
                if (this.destroyed || !this.client) return;
                this.onStatus('connecting');
                this.client.subscribe(`${this.info.topicPrefix}/room/+/player/+`, { qos: 0 }, error => {
                    if (this.destroyed || this.client?.connected === false) return;
                    this.onStatus(error ? 'offline' : 'connected');
                });
            });
            for (const event of ['reconnect', 'offline', 'close', 'error']) {
                this.client.on(event, () => {
                    if (!this.destroyed) this.onStatus('offline');
                });
            }
            this.client.on('message', (topic, buffer, packet) => {
                if (this.destroyed) return;
                const prefix = `${this.info.topicPrefix}/room/`;
                if (!topic.startsWith(prefix)) return;
                const match = /^(\d+)\/player\/([^/]+)$/.exec(topic.slice(prefix.length));
                if (!match) return;
                const roomId = Number(match[1]);
                if (roomId < 1 || roomId > 4) return;
                let state;
                try { state = JSON.parse(buffer.toString()); } catch (_) { return; }
                if (!state || state.id !== match[2] || typeof state.online !== 'boolean') return;
                // Um pacote retido pode vir de uma corrida que já acabou.
                // Só mensagens ao vivo confirmam que há alguém conectado.
                if (packet?.retain && state.online) return;
                this.onPlayer(roomId, state);
            });
        } catch (_) {
            if (!this.destroyed) this.onStatus('offline');
        }
    }

    destroy() {
        this.destroyed = true;
        this.client?.end(true);
        this.client = null;
    }
}
