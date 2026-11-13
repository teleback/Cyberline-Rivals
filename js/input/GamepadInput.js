// Lê controles SNES USB/Bluetooth pela Gamepad API do navegador.
// Durante a corrida: D-pad aponta o carro na direção da tela (inclusive
// cima/baixo e diagonais) sem acelerar, como o joystick do celular;
// B = acelerar, Y = turbo (também acelera), A = frear e engatar ré.
// Os quatro sentidos do D-pad continuam disponíveis para navegar nos menus.
// Teclado e comandos de toque são independentes.
//
// O navegador detecta o controle após o primeiro botão ser pressionado.
// Se algum controle reportar botões diferentes, pressione T para calibrar.

// Controle SNES USB genérico já identificado: 0=X, 1=A, 2=B, 3=Y.
export const BUTTONS = {
    acelerar: [2],       // B
    turbo: [3],          // Y
    re: [1],             // A
    confirmar: [0, 1, 2, 3], // menus: X/A/B/Y
};

// Quando o navegador informa mapping='standard', os índices são os da
// posição física do controle (0=baixo/B, 1=direita/A, 2=esquerda/Y).
const STANDARD_BUTTONS = {
    acelerar: [0],
    turbo: [2],
    re: [1],
};

const DEADZONE = 0.5;

// --- Calibração ------------------------------------------------------------
// v4 ignora calibrações antigas de L/R e guarda os botões por controle.
const SAVE_KEY = 'cyberline-pad-buttons-v4';
const STEPS = [
    { name: 'acelerar', texto: 'Aperte o botão B (ACELERAR) no controle...' },
    { name: 'turbo', texto: 'Aperte o botão Y (TURBO) no controle...' },
    { name: 're', texto: 'Aperte o botão A (FREIO/RÉ) no controle...' },
];
const profiles = {};
try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        for (const [key, value] of Object.entries(saved)) {
            if (STEPS.every(({ name }) => Array.isArray(value?.[name])
                    && value[name].length === 1
                    && Number.isInteger(value[name][0]) && value[name][0] >= 0)
                    && new Set(STEPS.map(({ name }) => value[name][0])).size === STEPS.length) {
                profiles[key] = value;
            }
        }
    }
} catch (e) { /* sem localStorage: usa o padrão */ }

function padKey(pad) {
    return `${pad.id}|${pad.mapping}`;
}

function buttonsFor(pad) {
    return profiles[padKey(pad)] || (pad.mapping === 'standard' ? STANDARD_BUTTONS : BUTTONS);
}

let step = -1;          // -1 = não está calibrando
let learnArmed = false; // só aceita depois de soltar todos os botões
let calibratingPad = null;
let learned = {};
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
    calibratingPad = null;
    learned = {};
    say(STEPS[0].texto, 0);
}

export function calibrateIfNeeded() {
    // Padrões SNES/standard já definidos; T inicia a calibração manual.
}

if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
        if (!e.repeat && e.code === 'KeyT') startCalibration();
    });
}

function learnStep(pad) {
    const key = padKey(pad);
    if (calibratingPad === null) calibratingPad = key;
    if (key !== calibratingPad) return;

    const down = pad.buttons.map((b, i) => (b && b.pressed ? i : -1)).filter((i) => i >= 0);
    if (!learnArmed) {
        if (!down.length) learnArmed = true;
        return;
    }
    if (!down.length) return;

    // B, Y e A precisam ser três botões físicos distintos.
    if (Object.values(learned).some((indexes) => indexes.includes(down[0]))) return;

    learned[STEPS[step].name] = [down[0]];
    step += 1;
    learnArmed = false;

    if (step >= STEPS.length) {
        step = -1;
        profiles[key] = learned;
        try { localStorage.setItem(SAVE_KEY, JSON.stringify(profiles)); } catch (e) { /* ok */ }
        say('Pronto! B = botão ' + learned.acelerar[0]
            + ', Y = botão ' + learned.turbo[0]
            + ', A = botão ' + learned.re[0], 2500);
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

// up/down são direções absolutas do D-pad (inclusive nos menus); accelerate/reverse são pedais.
// turbo funciona mesmo sem segurar B, como no botão virtual do celular.
export function readGamepad() {
    const pad = getPad();
    const state = { left: false, right: false, up: false, down: false,
        steering: 0, accelerate: false, reverse: false, turbo: false, any: false };
    if (!pad) return state;

    if (step >= 0) {
        learnStep(pad);
        return state;
    }

    const ax = pad.axes[0] || 0;
    const ay = pad.axes[1] || 0;
    const axisDeadzone = pad.mapping === 'standard' ? 0.14 : DEADZONE;

    // 1) D-pad como eixos 0 e 1 (comum em controle SNES USB genérico)
    state.left = ax < -axisDeadzone;
    state.right = ax > axisDeadzone;
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

    // Botões de corrida independentes das direções do D-pad.
    const buttons = buttonsFor(pad);
    state.turbo = pressed(pad, buttons.turbo);
    state.accelerate = pressed(pad, buttons.acelerar) || state.turbo;
    state.reverse = pressed(pad, buttons.re);
    // Controles padrão mantêm a intensidade do analógico; o D-pad e os
    // controles SNES genéricos continuam com o curso completo do volante.
    const digitalLeft = btn(14) || (state.left && ax >= -axisDeadzone);
    const digitalRight = btn(15) || (state.right && ax <= axisDeadzone);
    if (digitalLeft || digitalRight) state.steering = Number(digitalRight) - Number(digitalLeft);
    else if (pad.mapping === 'standard' && Math.abs(ax) > axisDeadzone) {
        state.steering = Math.sign(ax) * Math.min(1, (Math.abs(ax) - axisDeadzone) / (1 - axisDeadzone));
    } else state.steering = Number(state.right) - Number(state.left);
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
