// Física arcade em unidades do mundo (px/s). A carroceria gira no Arcade;
// aqui controlamos tração, freio e pneus no referencial do próprio carro.
export const HANDLING = Object.freeze({
    acceleration: 560,
    maxSpeed: 390,
    turnSpeed: 225,
    steeringResponse: 20,
    normalGripRate: 13,
    driftGripRate: 5.5,
    driftEntrySpeed: 165,
    driftExitSpeed: 105,
    brakeDeceleration: 980,
    driftBrakeDeceleration: 180,
    reverseAcceleration: 260,
    reverseMaxSpeed: 140,
    reverseDelay: 0.22,
    stoppedThreshold: 10,
    coastDrag: 0.55,
    rollingResistance: 24,
    overspeedDeceleration: 280,
    allowDrift: true,
    lowSpeedTurn: 0,
    cornerSlowdown: 0,
});

// Assistência para polegares: menos rotação, pneus mais firmes e redução
// progressiva de velocidade em curvas fechadas. Frear não inicia um drift.
export const MOBILE_HANDLING = Object.freeze({ ...HANDLING,
    turnSpeed: 170, steeringResponse: 12, normalGripRate: 24,
    reverseAcceleration: 320, reverseMaxSpeed: 115, reverseDelay: 0.08,
    allowDrift: false, lowSpeedTurn: 0.48, cornerSlowdown: 0.34,
    headingResponse: 16, headingTurnSpeed: 540,
    overspeedDeceleration: 460,
});

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const approachZero = (value, amount) => Math.sign(value) * Math.max(0, Math.abs(value) - amount);
const smooth = (start, end, value) => {
    const t = clamp((value - start) / (end - start), 0, 1);
    return t * t * (3 - 2 * t);
};

export function createHandlingState() {
    return { steering: 0, driftAmount: 0, drifting: false, reverseHold: 0 };
}

export function stepHandling(state, motion, input, seconds, tuning = HANDLING) {
    // Não acumula um salto de física depois de trocar de aba.
    const dt = clamp(seconds, 0, 0.1);
    const fx = Math.cos(motion.rotation - Math.PI / 2);
    const fy = Math.sin(motion.rotation - Math.PI / 2);
    let forward = motion.vx * fx + motion.vy * fy;
    let lateral = -motion.vx * fy + motion.vy * fx;
    const speed = Math.hypot(motion.vx, motion.vy);
    const followsHeading = Number.isFinite(input.heading) && tuning.headingResponse > 0;
    const headingError = followsHeading
        ? Math.atan2(Math.sin(input.heading - motion.rotation), Math.cos(input.heading - motion.rotation)) : 0;
    const steer = followsHeading ? clamp(headingError / (Math.PI / 2), -1, 1)
        : clamp(input.steering, -1, 1);
    const brake = !!input.brake;
    const throttle = !!input.throttle && !brake;

    // Soltar o direcional encerra o giro imediatamente. A entrada tem uma
    // rampa curta, igual no teclado, joystick e controle analógico.
    state.steering = steer === 0 ? 0 : state.steering
        + (steer - state.steering) * (1 - Math.exp(-tuning.steeringResponse * dt));
    const canDrift = state.drifting ? speed > tuning.driftExitSpeed && forward > 35
        : forward > tuning.driftEntrySpeed;
    state.drifting = tuning.allowDrift && brake && Math.abs(steer) > 0.16 && canDrift;
    const driftTarget = state.drifting ? 1 : 0;
    state.driftAmount += (driftTarget - state.driftAmount)
        * (1 - Math.exp(-(state.drifting ? 12 : 7) * dt));

    let braking = false;
    if (brake) {
        if (forward > tuning.stoppedThreshold) {
            braking = true;
            state.reverseHold = 0;
            const force = tuning.brakeDeceleration
                + (tuning.driftBrakeDeceleration - tuning.brakeDeceleration) * state.driftAmount;
            forward = Math.max(0, forward - force * dt);
        } else {
            // Uma freada curta termina em zero. Manter o freio engata a ré.
            state.reverseHold += dt;
            if (forward < -tuning.stoppedThreshold || state.reverseHold >= tuning.reverseDelay) {
                forward = Math.max(-tuning.reverseMaxSpeed, forward - tuning.reverseAcceleration * dt);
            } else {
                forward = approachZero(forward, tuning.brakeDeceleration * dt);
            }
        }
    } else {
        state.reverseHold = 0;
        if (throttle) {
            if (forward < -tuning.stoppedThreshold) {
                braking = true;
                forward = Math.min(0, forward + tuning.brakeDeceleration * dt);
            } else {
                const torque = 1 - 0.32 * smooth(0.55, 1, Math.max(0, forward) / motion.maxSpeed);
                forward += motion.acceleration * torque * dt;
            }
        } else {
            forward = approachZero(forward * Math.exp(-tuning.coastDrag * dt), tuning.rollingResistance * dt);
        }
    }

    const gripRate = tuning.normalGripRate
        + (tuning.driftGripRate - tuning.normalGripRate) * state.driftAmount;
    lateral *= Math.exp(-gripRate * dt);
    let vx = fx * forward - fy * lateral;
    let vy = fy * forward + fx * lateral;
    const resultSpeed = Math.hypot(vx, vy);
    // Limite circular: a diagonal tem a mesma máxima da horizontal.
    // Ao acabar um boost, perde o excesso aos poucos em vez de dar um tranco.
    const curveLimit = motion.maxSpeed * (1 - tuning.cornerSlowdown * Math.abs(state.steering));
    const limit = Math.max(curveLimit, speed - tuning.overspeedDeceleration * dt);
    if (resultSpeed > limit) {
        vx *= limit / resultSpeed;
        vy *= limit / resultSpeed;
    }

    const rolling = Math.max(smooth(3, 85, Math.abs(forward)),
        throttle || brake ? tuning.lowSpeedTurn : 0);
    const highSpeed = smooth(180, 650, speed);
    const reverse = forward < -tuning.stoppedThreshold;
    const turnRate = reverse ? tuning.turnSpeed * 0.62
        : tuning.turnSpeed * (1 - 0.36 * highSpeed) * (1 + 0.22 * state.driftAmount);
    let angularVelocity = state.steering * turnRate * rolling * (reverse ? -1 : 1);
    if (followsHeading) {
        // Converge para o alvo pelo caminho mais curto, inclusive parado e em ré.
        // Limitar o passo evita passar do alvo e ficar oscilando ao segurá-lo.
        const headingStep = headingError * (1 - Math.exp(-tuning.headingResponse * dt));
        angularVelocity = dt > 0 ? clamp(headingStep / dt * 180 / Math.PI,
            -tuning.headingTurnSpeed, tuning.headingTurnSpeed) : 0;
    }
    const slip = speed > 60 ? clamp(Math.abs(lateral) / Math.max(80, Math.abs(forward)), 0, 1) : 0;
    return { vx, vy, angularVelocity, braking, throttle, slip,
        isDrifting: state.drifting || (state.driftAmount > 0.16 && slip > 0.08) };
}
