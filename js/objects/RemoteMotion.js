const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const MAX_STATES = 64;
const MAX_PREDICTION_MS = 100;
const CLOCK_RESET_GAP_MS = 1000;
const CORRECTION_MS = 35;

function clearMotionClock(remote) {
    remote.stateBuffer.length = 0;
    delete remote.motionClockKind;
    delete remote.motionTimeOffset;
    delete remote.motionTargetOffset;
    delete remote.motionOffsetAt;
    delete remote.motionReceivedAt;
    delete remote.motionRenderAt;
}

function advanceMotionClock(remote, now) {
    const elapsed = Math.max(0, now - remote.motionOffsetAt);
    // Lower transit times reveal a better clock offset. Catch up gradually so
    // a delayed first packet cannot leave every later snapshot in the future.
    // Several packets delivered in one frame consume no extra correction time.
    remote.motionTimeOffset = Math.max(remote.motionTargetOffset,
        remote.motionTimeOffset - elapsed);
    remote.motionOffsetAt = Math.max(remote.motionOffsetAt, now);
}

// Keep sender spacing even when several MQTT packets arrive in the same frame.
// The offset is local to this session, so peers do not need matching clocks.
export function pushRemoteMotion(remote, state) {
    if (!state || ![state.time, state.x, state.y, state.angle].every(Number.isFinite)) return false;
    const buffer = remote.stateBuffer;
    const clockKind = Number.isFinite(state.motionTime) ? 'motion'
        : Number.isFinite(state.timestamp) ? 'timestamp' : 'arrival';
    const sourceTime = clockKind === 'motion' ? state.motionTime
        : clockKind === 'timestamp' ? state.timestamp : state.time;
    const receivedAt = state.time;
    const measuredOffset = receivedAt - sourceTime;
    // Presence packets may use a wall clock while movement uses performance.now.
    // Those two clocks must never share an offset or a render cursor. A long
    // pause also needs a fresh mapping, including when a platform pauses its
    // monotonic clock while the application is suspended.
    if ((remote.motionClockKind && remote.motionClockKind !== clockKind)
        || (Number.isFinite(remote.motionReceivedAt)
            && receivedAt - remote.motionReceivedAt > CLOCK_RESET_GAP_MS)
        || (Number.isFinite(remote.motionTargetOffset)
            && remote.motionTargetOffset - measuredOffset > CLOCK_RESET_GAP_MS)) {
        clearMotionClock(remote);
    }
    if (buffer.length && sourceTime < buffer[buffer.length - 1].time) return false;
    remote.motionClockKind = clockKind;
    if (!Number.isFinite(remote.motionTimeOffset)) {
        remote.motionTimeOffset = measuredOffset;
        remote.motionTargetOffset = measuredOffset;
        remote.motionOffsetAt = receivedAt;
    } else {
        remote.motionTargetOffset = Math.min(remote.motionTargetOffset, measuredOffset);
        advanceMotionClock(remote, receivedAt);
    }
    remote.motionReceivedAt = receivedAt;
    // Store samples in the sender clock; changing the offset then preserves
    // both ordering and spacing throughout the whole buffer.
    state = { ...state, time: sourceTime,
        vx: Number.isFinite(state.vx) ? state.vx : 0,
        vy: Number.isFinite(state.vy) ? state.vy : 0,
        angularVelocity: Number.isFinite(state.angularVelocity) ? state.angularVelocity : 0 };
    if (buffer.length && sourceTime === buffer[buffer.length - 1].time) {
        buffer[buffer.length - 1] = state;
        return true;
    }
    buffer.push(state);
    if (buffer.length > MAX_STATES) buffer.shift();
    return true;
}

export function sampleRemoteMotion(remote, now) {
    const buffer = remote.stateBuffer;
    if (!buffer.length || !Number.isFinite(now)) return null;
    advanceMotionClock(remote, now);
    const delay = Number.isFinite(remote.interpolationDelay) ? Math.max(0, remote.interpolationDelay) : 80;
    // Increasing the jitter buffer must never play the movement backwards.
    const renderAt = Math.max(remote.motionRenderAt ?? -Infinity, now - remote.motionTimeOffset - delay);
    remote.motionRenderAt = renderAt;
    while (buffer.length > 2 && buffer[1].time <= renderAt) buffer.shift();
    const first = buffer[0], second = buffer[1], latest = buffer[buffer.length - 1];
    let pose;
    if (renderAt <= first.time) {
        pose = { x: first.x, y: first.y, angle: first.angle };
    } else if (second && renderAt <= second.time) {
        const factor = clamp((renderAt - first.time) / (second.time - first.time), 0, 1);
        // Linear interpolation cannot overshoot after braking or a collision.
        pose = {
            x: first.x + (second.x - first.x) * factor,
            y: first.y + (second.y - first.y) * factor,
            angle: first.angle + wrap(second.angle - first.angle) * factor,
        };
    } else {
        // Freeze at the predicted endpoint on loss, without snapping backwards.
        const seconds = clamp(renderAt - latest.time, 0, MAX_PREDICTION_MS) / 1000;
        pose = {
            x: latest.x + (latest.vx || 0) * seconds,
            y: latest.y + (latest.vy || 0) * seconds,
            angle: latest.angle + (latest.angularVelocity || 0) * Math.PI / 180 * seconds,
        };
    }
    const previous = remote.motionPose;
    if (previous) {
        // Ease prediction corrections using elapsed time, independent of FPS.
        const factor = 1 - Math.exp(-Math.max(0, now - remote.motionFrameAt) / CORRECTION_MS);
        pose = {
            x: previous.x + (pose.x - previous.x) * factor,
            y: previous.y + (pose.y - previous.y) * factor,
            angle: previous.angle + wrap(pose.angle - previous.angle) * factor,
        };
    }
    remote.motionFrameAt = now;
    remote.motionPose = pose;
    return pose;
}

export function resetRemoteMotion(remote) {
    clearMotionClock(remote);
    delete remote.motionFrameAt;
    delete remote.motionPose;
}
