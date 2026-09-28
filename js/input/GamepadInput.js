// Lê o controle USB (Super Nes genérico) direto da Gamepad API do navegador.
// Não precisa de plugin: funciona em Chrome, Edge e Firefox (Windows/Mac/Linux).
//
// Controles no jogo:
//   D-pad esquerda/direita = virar | D-pad cima = frente | D-pad baixo = freio/ré
//   L = acelerar | R = turbo
//
// IMPORTANTE: o navegador só "enxerga" o controle depois que você aperta
// qualquer botão nele pelo menos uma vez com a página aberta.
//
// Controles genéricos não seguem um padrão: o número dos botões L e R muda
// de controle pra controle. Por isso o jogo tem CALIBRAÇÃO: ao começar a
// corrida (ou apertando a tecla T) ele pede "aperte o L" e "aperte o R" e
// guarda a escolha neste navegador.

// Botões confirmados neste controle (Ponto do Nerd / SNES USB):
//   0=X  1=A  2=B  3=Y  4=L  6=R
export const BUTTONS = {
    acelerar: [4],        // L
    turbo: [6],           // R
    confirmar: [0, 1, 2, 3], // menus: X/A/B/Y
};

const DEADZONE = 0.5;

// --- Calibração ------------------------------------------------------------
const SAVE_KEY = 'cyberline-pad-buttons-v3';
const STEPS = [
    { name: 'acelerar', texto: 'Aperte o botão L (ACELERAR) no controle...' },
    { name: 'turbo', texto: 'Aperte o botão R (TURBO) no controle...' },
];
const mapped = { acelerar: BUTTONS.acelerar, turbo: BUTTONS.turbo };
let hasSaved = false;

try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (saved && Array.isArray(saved.acelerar) && Array.isArray(saved.turbo)) {
        mapped.acelerar = saved.acelerar;
        mapped.turbo = saved.turbo;
        hasSaved = true;
    }
} catch (e) { /* sem localStorage: usa o padrão */ }

let step = -1;          // -1 = não está calibrando
let learnArmed = false; // só aceita depois de soltar todos os botões
let overlay = null;

function say(text, ms) {
    if (typeof document === 'undefined') return;
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);'
            + 'background:#000c;color:#0ff;font:16px monospace;padding:8px 14px;'
            + 'border:1px solid #0ff;z-index:9999;pointer-events:none';
        document.body.appendChild(overlay);
    }
    overlay.textContent = text;
    overlay.style.display = 'block';
    clearTimeout(overlay._t);
    if (ms) overlay._t = setTimeout(() => { overlay.style.display = 'none'; }, ms);
}

export function startCalibration() {
    step = 0;
    learnArmed = false;
    say(STEPS[0].texto, 0);
}

// Chamado quando a corrida começa: se ainda não calibrou e há controle
// conectado, já inicia a calibração sozinho.
export function calibrateIfNeeded() {
    // Mapeamento já conhecido (L=4, R=6) — calibração automática desligada.
    // Aperte T a qualquer momento se precisar recalibrar outro controle.
}

if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
        if (!e.repeat && e.code === 'KeyT') startCalibration();
    });
}

function learnStep(pad) {
    const down = pad.buttons.map((b, i) => (b && b.pressed ? i : -1)).filter((i) => i >= 0);
    if (!learnArmed) {
        if (!down.length) learnArmed = true; // espera soltar tudo antes
        return;
    }
    if (!down.length) return;

    const atual = STEPS[step];
    // Não deixa usar o mesmo botão para as duas funções
    if (step === 1 && mapped.acelerar.includes(down[0])) return;

    mapped[atual.name] = [down[0]];
    step += 1;
    learnArmed = false;

    if (step >= STEPS.length) {
        step = -1;
        hasSaved = true;
        try { localStorage.setItem(SAVE_KEY, JSON.stringify(mapped)); } catch (e) { /* ok */ }
        say('Pronto! L = botão ' + mapped.acelerar[0] + ', R = botão ' + mapped.turbo[0], 2500);
    } else {
        say(STEPS[step].texto, 0);
    }
}

// --- Leitura do controle -----------------------------------------------------
function pressed(pad, indexes) {
    return indexes.some((i) => {
        const b = pad.buttons[i];
        return b && (b.pressed || b.value > 0.5);
    });
}

// Devolve o primeiro controle conectado, ou null.
let logged = false;
export function getPad() {
    if (!navigator.getGamepads) return null;
    for (const pad of navigator.getGamepads()) {
        if (pad && pad.connected) {
            if (!logged) {
                logged = true;
                console.log('[Cyberline] Controle detectado:', pad.id, '| botões:', pad.buttons.length, '| eixos:', pad.axes.length);
            }
            return pad;
        }
    }
    return null;
}

// Eixos "hat" (D-pad em forma de eixo único): em repouso valem ~1.29 e, ao
// apertar, pulam para um de 8 valores entre -1 e 1. Guardamos quais eixos
// já vimos com esse valor de repouso.
const hatAxes = new Set([9]);

function decodeHat(v) {
    if (v > 1.1) return null; // repouso
    const idx = Math.round((v + 1) * 3.5); // 0..7
    return [
        { up: true },
        { up: true, right: true },
        { right: true },
        { down: true, right: true },
        { down: true },
        { down: true, left: true },
        { left: true },
        { up: true, left: true },
    ][idx] || null;
}

// Lê o estado atual: { left, right, up, down, turbo, any }
// (up = acelerar, down = freio/ré)
export function readGamepad() {
    const pad = getPad();
    const state = { left: false, right: false, up: false, down: false, turbo: false, any: false };
    if (!pad) return state;

    if (step >= 0) {
        learnStep(pad);
        return state;
    }

    const ax = pad.axes[0] || 0;
    const ay = pad.axes[1] || 0;

    // 1) D-pad como eixos 0 e 1 (comum em controle SNES USB genérico)
    state.left = ax < -DEADZONE;
    state.right = ax > DEADZONE;
    state.up = ay < -DEADZONE;
    state.down = ay > DEADZONE;

    // 2) D-pad como botões 12-15 (cima, baixo, esquerda, direita)
    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    state.up = state.up || btn(12);
    state.down = state.down || btn(13);
    state.left = state.left || btn(14);
    state.right = state.right || btn(15);

    // 3) D-pad como "hat" (um eixo só com 8 direções)
    pad.axes.forEach((v, i) => {
        if (i >= 2 && v > 1.1) hatAxes.add(i);
    });
    hatAxes.forEach((i) => {
        if (pad.axes[i] === undefined) return;
        const d = decodeHat(pad.axes[i]);
        if (!d) return;
        state.up = state.up || !!d.up;
        state.down = state.down || !!d.down;
        state.left = state.left || !!d.left;
        state.right = state.right || !!d.right;
    });

    // Botões: L acelera (além do D-pad para cima), R é o turbo
    state.up = state.up || pressed(pad, mapped.acelerar);
    state.turbo = pressed(pad, mapped.turbo);
    state.any = pressed(pad, BUTTONS.confirmar);
    return state;
}

// Nos menus: chama callback uma vez quando algum botão for apertado.
export function onAnyButton(scene, callback) {
    let done = false;
    const check = () => {
        if (done) return;
        if (readGamepad().any) {
            done = true;
            scene.events.off('update', check);
            callback();
        }
    };
    scene.events.on('update', check);
    scene.events.once('shutdown', () => scene.events.off('update', check));
}
