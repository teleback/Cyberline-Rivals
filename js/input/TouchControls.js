// Controles de toque (celular/tablet): joystick fixo + pedais + botão TURBO.
//
// Feito em HTML por cima do canvas, e não dentro do Phaser, de propósito:
//  - multitoque de verdade: polegar esquerdo no joystick e o direito no
//    turbo ao mesmo tempo, sem depender de `activePointers` do Phaser;
//  - não entra nas listas de "ignore" das câmeras (splitCameras) do HUD;
//  - fica nos cantos da TELA, mesmo quando o jogo (800x450) tem tarjas
//    pretas nas laterais.
//
// O joystick indica uma direção na tela, independente da orientação do carro.
// Qualquer direção acelera; baixo aponta para baixo, sem engatar freio/ré.
// Centralizar ou soltar encerra a aceleração. Os pedais continuam independentes.
//
// Só aparece em aparelho de toque. Para testar no computador, abra o jogo
// com ?touch=1 na URL (e ?touch=0 força desligado).

const state = { left: false, right: false, up: false, down: false,
    turbo: false, accelerate: false, pedalBrake: false, steering: 0, heading: null };

// Zona neutra radial pequena, com histerese para filtrar tremores no centro.
const DIRECTION_ON = 0.25;
const DIRECTION_OFF = 0.16;
// Curso do polegar menor que o círculo visual, sem ficar enorme em tablets.
const MIN_TRAVEL = 48;
const MAX_TRAVEL = 60;

let touchSeen = false;
let root = null;
let zone = null;
let stick = null;
let knob = null;
let turboBtn = null;
let stickPointer = null;
const pedalPointers = new Map();
const pedalButtons = new Map();
const pedalPress = new Map();
let center = { x: 0, y: 0 };
let radius = 60;
let visualTravel = 35;

const params = new URLSearchParams(window.location.search);

export function wantsTouchControls() {
    const forced = params.get('touch');
    if (forced === '1') return true;
    if (forced === '0') return false;
    return touchSeen || window.matchMedia('(pointer: coarse)').matches;
}

// A classe `is-touch` no <html> é o que o CSS usa pra mostrar o aviso
// "gire o celular" e esconder o cursor, por exemplo.
function markTouch() {
    document.documentElement.classList.add('is-touch');
}
if (wantsTouchControls()) markTouch();

// Notebook com tela de toque: só vira "aparelho de toque" quando alguém toca.
window.addEventListener('touchstart', () => {
    touchSeen = true;
    markTouch();
}, { passive: true, once: true });

// ---------------------------------------------------------------------------

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function releaseStick() {
    const pointer = stickPointer;
    stickPointer = null;
    if (pointer !== null && zone?.hasPointerCapture?.(pointer)) zone.releasePointerCapture(pointer);
    state.left = state.right = state.up = state.down = false;
    state.steering = 0;
    state.heading = null;
    if (knob) knob.style.transform = '';
    if (stick) {
        stick.classList.remove('tc-active');
        stick.classList.remove('tc-throttle', 'tc-braking');
    }
    updateFeedback();
}

function releasePedal(field) {
    const pointer = pedalPointers.get(field);
    const button = pedalButtons.get(field);
    pedalPointers.delete(field);
    if (pointer !== undefined && button?.hasPointerCapture?.(pointer)) button.releasePointerCapture(pointer);
    state[field] = false;
    button?.classList.remove('tc-active');
    updateFeedback();
}

function releaseAll() {
    releaseStick();
    for (const field of pedalButtons.keys()) releasePedal(field);
}

function updateFeedback() {
    if (!stick) return;
    const braking = state.down || state.pedalBrake;
    stick.classList.toggle('tc-throttle', (state.up || state.accelerate || state.turbo) && !braking);
    stick.classList.toggle('tc-braking', braking);
}

function bindPedal(button, field) {
    pedalButtons.set(field, button);
    const press = pointer => {
        pedalPointers.set(field, pointer);
        button.setPointerCapture(pointer);
        button.classList.add('tc-active');
        state[field] = true;
        updateFeedback();
    };
    pedalPress.set(field, press);
    button.addEventListener('pointerdown', e => {
        if (root.hidden || pedalPointers.has(field) || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        press(e.pointerId);
    });
    // O polegar direito pode deslizar entre acelerar, frear e turbo sem
    // precisar levantar. A captura continua no pedal que recebeu o gesto.
    button.addEventListener('pointermove', e => {
        if (pedalPointers.get(field) !== e.pointerId) return;
        for (const [otherField, otherButton] of pedalButtons) {
            if (otherField === field || pedalPointers.has(otherField)) continue;
            const rect = otherButton.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right
                && e.clientY >= rect.top && e.clientY <= rect.bottom) {
                releasePedal(field);
                pedalPress.get(otherField)(e.pointerId);
                break;
            }
        }
    });
    const end = e => { if (pedalPointers.get(field) === e.pointerId) releasePedal(field); };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, end);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
}

function updateStick(e) {
    // O centro é sempre o do anel fixo, inclusive em arrastos para fora.
    const rawX = e.clientX - center.x;
    const rawY = e.clientY - center.y;
    let dx = rawX;
    let dy = rawY;
    const dist = Math.hypot(dx, dy);
    if (dist > radius) {
        dx *= radius / dist;
        dy *= radius / dist;
    }
    // O desenho fica dentro do anel; o curso lógico continua independente
    // por eixo para acelerar e virar ao mesmo tempo.
    const visualScale = visualTravel / radius;
    knob.style.transform = `translate(${dx * visualScale}px, ${dy * visualScale}px)`;

    const active = dist / radius > (state.heading === null ? DIRECTION_ON : DIRECTION_OFF);
    // Sprite do carro aponta para cima em rotation=0.
    state.heading = active ? Math.atan2(rawX, -rawY) : null;
    state.steering = active ? clamp(rawX / radius, -1, 1) : 0;
    state.left = active && rawX < 0;
    state.right = active && rawX > 0;
    state.up = active;
    state.down = false;
    updateFeedback();
}

function build() {
    root = document.createElement('div');
    root.id = 'touch-controls';
    root.hidden = true;
    root.innerHTML = `
        <div class="tc-zone" role="group" aria-label="Direção: aponte o joystick para onde quer ir; solte para parar de acelerar">
            <div class="tc-stick"><span class="tc-arrow tc-arrow-left" aria-hidden="true">←</span><span class="tc-arrow tc-arrow-right" aria-hidden="true">→</span><div class="tc-knob"></div></div>
        </div>
        <div class="tc-pedals">
            <button class="tc-pedal tc-turbo" type="button" aria-label="Turbo e aceleração">TURBO</button>
            <button class="tc-pedal tc-brake" type="button" aria-label="Frear e manter para dar ré">FREIO<br>RÉ</button>
            <button class="tc-pedal tc-accelerate" type="button" aria-label="Acelerar">ACELERAR</button>
        </div>
    `;
    document.body.appendChild(root);

    zone = root.querySelector('.tc-zone');
    stick = root.querySelector('.tc-stick');
    knob = root.querySelector('.tc-knob');
    turboBtn = root.querySelector('.tc-turbo');

    // Sem menu de "segurar pra copiar/salvar imagem" no meio da corrida.
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- Joystick fixo -----------------------------------------------------
    // O gesto começa no círculo visível. A captura mantém o controle mesmo
    // se o polegar sair dele; voltar ao centro sempre neutraliza a direção.
    zone.addEventListener('pointerdown', (e) => {
        if (root.hidden || stickPointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const bounds = stick.getBoundingClientRect();
        const size = bounds.width;
        const fixedCenter = { x: bounds.left + size / 2, y: bounds.top + bounds.height / 2 };
        if (Math.hypot(e.clientX - fixedCenter.x, e.clientY - fixedCenter.y) > size / 2) return;
        e.preventDefault();
        stickPointer = e.pointerId;
        zone.setPointerCapture(e.pointerId);

        radius = clamp(size * 0.4, MIN_TRAVEL, MAX_TRAVEL);
        visualTravel = size * 0.29;
        center = fixedCenter;
        stick.classList.add('tc-active');
        updateStick(e);
    });
    zone.addEventListener('pointermove', (e) => {
        if (e.pointerId === stickPointer) updateStick(e);
    });
    const endStick = (e) => {
        if (e.pointerId === stickPointer) releaseStick();
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);
    zone.addEventListener('lostpointercapture', endStick);
    window.addEventListener('pointerup', endStick);
    window.addEventListener('pointercancel', endStick);

    bindPedal(turboBtn, 'turbo');
    bindPedal(root.querySelector('.tc-accelerate'), 'accelerate');
    bindPedal(root.querySelector('.tc-brake'), 'pedalBrake');

    // Trocou de app/aba com o dedo apertado: solta tudo, senão o carro
    // ficaria acelerando sozinho quando o jogo voltasse.
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) releaseAll();
    });
    // Mudou a orientação/tamanho: as coordenadas do gesto deixam de valer.
    window.addEventListener('resize', releaseAll);
}

// ---------------------------------------------------------------------------
// API pública

/** Mostra os controles (só em aparelho de toque). Chamar ao começar a corrida. */
export function showTouchControls() {
    if (!wantsTouchControls()) return;
    if (!root) build();
    root.hidden = false;
}

/** Esconde e solta tudo. Chamar ao terminar a corrida ou sair da cena. */
export function hideTouchControls() {
    releaseAll();
    if (root) root.hidden = true;
}

/** Botões atuais e orientação desejada na tela (radianos, null no centro). */
export function readTouch() {
    return {
        left: state.left,
        right: state.right,
        steering: state.steering,
        heading: state.heading,
        // O botão TURBO já acelera: o Car só liga o turbo com o acelerador
        // apertado, e o polegar direito não deve precisar de dois botões.
        up: (state.up || state.accelerate || state.turbo) && !(state.down || state.pedalBrake),
        down: state.down || state.pedalBrake,
        turbo: state.turbo,
        mobile: !!root && !root.hidden,
    };
}
