const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// Keep sender spacing even when several MQTT packets arrive in the same frame.
// The offset is local to this session, so peers do not need matching clocks.
export function pushRemoteMotion(remote, state) {
    const buffer = remote.stateBuffer;
    const sourceTime = Number.isFinite(state.motionTime) ? state.motionTime : state.timestamp;
    if (Number.isFinite(sourceTime)) {
        remote.motionTimeOffset ??= state.time - sourceTime;
        state = { ...state, time: sourceTime + remote.motionTimeOffset };
    }
    if (buffer.length && state.time <= buffer[buffer.length - 1].time) return;
    buffer.push(state);
    if (buffer.length > 64) buffer.shift();
}

export function sampleRemoteMotion(remote, now) {
    const buffer = remote.stateBuffer;
    if (!buffer.length) return null;
    // Increasing the jitter buffer must never play the movement backwards.
    const renderAt = Math.max(remote.motionRenderAt ?? -Infinity, now - remote.interpolationDelay);
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
        const seconds = clamp(renderAt - latest.time, 0, 100) / 1000;
        pose = {
            x: latest.x + (latest.vx || 0) * seconds,
            y: latest.y + (latest.vy || 0) * seconds,
            angle: latest.angle + (latest.angularVelocity || 0) * Math.PI / 180 * seconds,
        };
    }
    const previous = remote.motionPose;
    if (previous) {
        // Ease prediction corrections using elapsed time, independent of FPS.
        const factor = 1 - Math.exp(-Math.max(0, now - remote.motionFrameAt) / 35);
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
    remote.stateBuffer.length = 0;
    delete remote.motionTimeOffset;
    delete remote.motionRenderAt;
    delete remote.motionFrameAt;
    delete remote.motionPose;
}
