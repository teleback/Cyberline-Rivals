// Controles de toque (celular/tablet): joystick virtual + botão TURBO.
//
// Feito em HTML por cima do canvas, e não dentro do Phaser, de propósito:
//  - multitoque de verdade: polegar esquerdo no joystick e o direito no
//    turbo ao mesmo tempo, sem depender de `activePointers` do Phaser;
//  - não entra nas listas de "ignore" das câmeras (splitCameras) do HUD;
//  - fica nos cantos da TELA, mesmo quando o jogo (800x450) tem tarjas
//    pretas nas laterais.
//
// Além dos botões, entrega steering (-1..1) para direção proporcional.
//
// Mapeamento (igual ao teclado):
//   joystick ← →    virar
//   joystick ↑      acelerar
//   joystick ↓      freio / ré      (↓ + lado = drift)
//   botão TURBO     turbo (já acelera junto, não precisa segurar ↑)
//
// Só aparece em aparelho de toque. Para testar no computador, abra o jogo
// com ?touch=1 na URL (e ?touch=0 força desligado).

const state = { left: false, right: false, up: false, down: false, turbo: false, steering: 0 };

// Curva progressiva: pequenas correções não viram o volante inteiro.
const DEAD_X = 0.18;
// Limiares distintos para ligar/soltar evitam oscilar com o tremor do dedo.
// Frear exige um gesto maior, para não entrar em drift sem querer na curva.
const THROTTLE_ON = 0.4;
const THROTTLE_OFF = 0.25;
const BRAKE_ON = 0.65;
const BRAKE_OFF = 0.45;

let touchSeen = false;
let root = null;
let zone = null;
let stick = null;
let knob = null;
let turboBtn = null;
let stickPointer = null;
let turboPointer = null;
let center = { x: 0, y: 0 };
let radius = 60;

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
    stickPointer = null;
    state.left = state.right = state.up = state.down = false;
    state.steering = 0;
    if (knob) knob.style.transform = '';
    if (stick) {
        stick.classList.remove('tc-active');
        // Volta pra posição de descanso definida no CSS.
        stick.style.left = '';
        stick.style.top = '';
        stick.style.bottom = '';
    }
}

function releaseTurbo() {
    turboPointer = null;
    state.turbo = false;
    if (turboBtn) turboBtn.classList.remove('tc-active');
}

function releaseAll() {
    releaseStick();
    releaseTurbo();
}

function updateStick(e) {
    const rawX = e.clientX - center.x;
    const rawY = e.clientY - center.y;
    let dx = rawX;
    let dy = rawY;
    const dist = Math.hypot(dx, dy);
    if (dist > radius) {
        dx *= radius / dist;
        dy *= radius / dist;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;

    // Limita só o desenho ao círculo. Ler os eixos independentemente evita
    // perder aceleração quando o dedo se afasta para fazer uma curva.
    const nx = clamp(rawX / radius, -1, 1);
    const ny = clamp(rawY / radius, -1, 1);
    const amount = Math.max(0, (Math.abs(nx) - DEAD_X) / (1 - DEAD_X));
    state.steering = Math.sign(nx) * Math.pow(amount, 1.5);
    state.left = state.steering < 0;
    state.right = state.steering > 0;
    state.up = ny < -(state.up ? THROTTLE_OFF : THROTTLE_ON);
    state.down = ny > (state.down ? BRAKE_OFF : BRAKE_ON);
}

function build() {
    root = document.createElement('div');
    root.id = 'touch-controls';
    root.hidden = true;
    root.innerHTML = `
        <div class="tc-zone">
            <div class="tc-stick"><div class="tc-knob"></div></div>
        </div>
        <div class="tc-turbo">TURBO</div>
    `;
    document.body.appendChild(root);

    zone = root.querySelector('.tc-zone');
    stick = root.querySelector('.tc-stick');
    knob = root.querySelector('.tc-knob');
    turboBtn = root.querySelector('.tc-turbo');

    // Sem menu de "segurar pra copiar/salvar imagem" no meio da corrida.
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- Joystick "flutuante" ---------------------------------------------
    // A metade esquerda da tela inteira é a área de toque: o joystick nasce
    // embaixo do dedo, onde ele tocar. Ninguém precisa acertar um círculo
    // pequeno no meio da corrida.
    zone.addEventListener('pointerdown', (e) => {
        if (stickPointer !== null) return;
        e.preventDefault();
        stickPointer = e.pointerId;
        zone.setPointerCapture(e.pointerId);

        radius = stick.offsetWidth / 2;
        const bounds = zone.getBoundingClientRect();
        // O ponto inicial é sempre neutro, inclusive junto às bordas.
        // Deslocar o centro para caber o círculo acionava comandos no toque.
        center = {
            x: e.clientX,
            y: e.clientY,
        };
        stick.classList.add('tc-active');
        stick.style.left = `${center.x - radius - bounds.left}px`;
        stick.style.top = `${center.y - radius - bounds.top}px`;
        stick.style.bottom = 'auto';
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

    // --- Turbo -------------------------------------------------------------
    turboBtn.addEventListener('pointerdown', (e) => {
        if (turboPointer !== null) return;
        e.preventDefault();
        turboPointer = e.pointerId;
        turboBtn.setPointerCapture(e.pointerId);
        turboBtn.classList.add('tc-active');
        state.turbo = true;
    });
    const endTurbo = (e) => {
        if (e.pointerId === turboPointer) releaseTurbo();
    };
    turboBtn.addEventListener('pointerup', endTurbo);
    turboBtn.addEventListener('pointercancel', endTurbo);
    turboBtn.addEventListener('lostpointercapture', endTurbo);

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

/** Botões atuais e direção analógica (-1..1). */
export function readTouch() {
    return {
        left: state.left,
        right: state.right,
        steering: state.steering,
        // O botão TURBO já acelera: o Car só liga o turbo com o acelerador
        // apertado, e o polegar direito não deve precisar de dois botões.
        up: (state.up || state.turbo) && !state.down,
        down: state.down,
        turbo: state.turbo,
    };
}
