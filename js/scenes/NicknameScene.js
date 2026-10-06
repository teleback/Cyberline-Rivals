// Identificação automática antes da seleção de sala, sem teclado ou formulário.
// Mantém playerNick para os rótulos e mensagens existentes do multiplayer.
const GAMERTAG_NAMES = [
    'Lobo', 'Falcao', 'Tigre', 'Cometa', 'Dragao', 'Corvo', 'Condor', 'Gato',
    'Urso', 'Lince', 'Puma', 'Gaviao', 'Touro', 'Leao', 'Coiote', 'Jaguar',
    'Raio', 'Meteoro', 'Foguete', 'Vento', 'Trovao', 'Vulcao', 'Tornado', 'Ciclone',
    'Ninja', 'Samurai', 'Pirata', 'Piloto', 'Robo', 'Titan', 'Fantasma', 'Guardiao',
    'Fenix', 'Besouro', 'Tubarao', 'Bufalo', 'Texugo', 'Dino', 'Gigante', 'Pinguim',
];
const GAMERTAG_TRAITS = [
    'Neon', 'Veloz', 'Turbo', 'Cosmico', 'Eletrico', 'Solar', 'Lunar', 'Astral',
    'Dourado', 'Prateado', 'Azul', 'Vermelho', 'Verde', 'Roxo', 'Ciano', 'Rubro',
    'Feroz', 'Audaz', 'Valente', 'Supremo', 'Lendario', 'Epico', 'Radical', 'Bravo',
    'Digital', 'Quantum', 'Cyber', 'Pixel', 'Nitro', 'Arcano', 'Mistico', 'Secreto',
    'Noturno', 'Gelado', 'Igneo', 'Estelar', 'Infinito', 'Sombra', 'Sonico', 'Rebelde',
];

class NicknameScene extends Phaser.Scene {
    constructor() {
        super('Nickname');
        this.playerId = null;
    }

    create() {
        const playerId = this.getPlayerId();
        const playerNick = this.getGamertag(playerId);
        try { localStorage.setItem('cyberlinePlayerNick', playerNick); } catch (_) {}
        this.scene.start('RoomSelection', { playerNick, playerId });
    }

    getGamertag(playerId) {
        // O ID aleatório escolhe as palavras e mantém a mesma tag na sessão,
        // inclusive ao voltar ao menu ou quando o storage está bloqueado.
        let hash = 2166136261;
        for (const character of playerId) {
            hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
        }
        const name = GAMERTAG_NAMES[(hash >>> 0) % GAMERTAG_NAMES.length];
        const trait = GAMERTAG_TRAITS[(hash >>> 16) % GAMERTAG_TRAITS.length];
        return `${name}${trait}`;
    }

    getPlayerId() {
        // Também preserva a identidade quando o navegador bloqueia o storage.
        if (this.playerId) return this.playerId;
        try { this.playerId = sessionStorage.getItem('cyberlinePlayerId'); } catch (_) {}
        if (!this.playerId) {
            this.playerId = (window.crypto && typeof window.crypto.randomUUID === 'function'
                ? window.crypto.randomUUID()
                : '') || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
            try { sessionStorage.setItem('cyberlinePlayerId', this.playerId); } catch (_) {}
        }
        return this.playerId;
    }
}

export default NicknameScene;
