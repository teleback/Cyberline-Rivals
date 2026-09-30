// Tela cheia no celular.
//
// Por que não entra em tela cheia "sozinho" ao abrir a página: o navegador
// PROÍBE. requestFullscreen() só é aceito dentro de um gesto do usuário
// (um toque). O jeito é entrar na tela cheia no PRIMEIRO TOQUE — e o jogo
// já começa pedindo um ("Aperte na tela para começar"), então na prática o
// jogador nem percebe a diferença.
//
// Detalhes que importam:
//  - Escutamos o `pointerup` nativo do DOM, não o `pointerdown` do Phaser.
//    No toque, só o fim do gesto (pointerup/touchend) conta como "ativação
//    do usuário" no Chrome; o toque inicial não.
//  - Só toque de dedo dispara (pointerType === 'touch'). Clique de mouse no
//    computador nunca força tela cheia.
//  - iPhone (Safari) NÃO tem API de tela cheia para páginas. Lá o caminho é
//    "Compartilhar → Adicionar à Tela de Início": o manifest e as metas do
//    index.html fazem o jogo abrir em tela cheia a partir do ícone.
//  - Depois de entrar em tela cheia, travamos em paisagem (Android/Chrome).

const MAX_TRIES = 3;
let tries = 0;

function inFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

async function lockLandscape() {
    try {
        await screen.orientation.lock('landscape');
    } catch (e) {
        // Sem suporte (iOS, desktop): o aviso "gire o celular" cobre o caso.
    }
}

async function tryFullscreen() {
    const el = document.documentElement;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!request) return 'unsupported';
    if (inFullscreen()) return 'ok';
    try {
        await request.call(el, { navigationUI: 'hide' });
    } catch (e) {
        return 'denied';
    }
    lockLandscape();
    return 'ok';
}

export function initMobileSupport() {
    const onTap = async (e) => {
        if (e.pointerType !== 'touch') return;
        const result = await tryFullscreen();
        tries += 1;
        if (result !== 'denied' || tries >= MAX_TRIES) {
            window.removeEventListener('pointerup', onTap, true);
        }
    };
    // `capture: true`: pega o toque antes de qualquer outro tratador.
    window.addEventListener('pointerup', onTap, true);
}
