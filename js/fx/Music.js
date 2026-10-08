// Uma trilha por gerenciador de som, compartilhada entre as cenas do menu.
export const MUSIC = {
    lobby: {
        key: 'music-lobby',
        path: 'assets/images/audio/skeler. - ＴＥＬ ＡＶＩＶ (Music Video) - TrapMusicHDTV.mp3',
        volume: 0.24,
    },
    race: {
        key: 'music-race',
        path: 'assets/images/audio/DANCE WITH THE DEAD - Riot - dancewiththedead.mp3',
        volume: 0.16,
    },
};

const players = new WeakMap();

export function loadMusic(scene, mode) {
    const track = MUSIC[mode];
    if (!scene.cache.audio.exists(track.key)) {
        scene.load.audio(track.key, encodeURI(track.path));
    }
}

export function playMusic(scene, mode, volume = MUSIC[mode].volume) {
    const manager = scene.sound;
    if (!manager || !scene.cache?.audio?.exists(MUSIC[mode].key)) return;
    let player = players.get(manager);
    if (!player) {
        player = { sound: null, key: null };
        players.set(manager, player);
        // O primeiro toque libera o áudio. Usa sempre a trilha atual, mesmo
        // se o jogador mudar de cena antes de o navegador liberar o som.
        manager.on('unlocked', () => {
            if (player.sound && !player.sound.isPlaying) player.sound.play();
        });
    }
    try {
        const track = MUSIC[mode];
        if (player.key === track.key && player.sound) {
            player.sound.setVolume(volume);
            return;
        }
        player.sound?.destroy();
        player.key = track.key;
        player.sound = manager.add(track.key, { loop: true, volume });
        player.sound.play();
    } catch (error) {
        // Uma falha no áudio não pode impedir a largada ou a navegação.
        console.warn('Música indisponível:', error);
    }
}

export function stopMusic(scene) {
    const player = players.get(scene.sound);
    if (!player) return;
    player.sound?.destroy();
    player.sound = null;
    player.key = null;
}
