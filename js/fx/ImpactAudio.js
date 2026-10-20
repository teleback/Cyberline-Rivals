const buffers = new WeakMap();

// Um único sample curto por contexto, sem downloads nem osciladores contínuos.
export default class ImpactAudio {
    constructor(scene) {
        this.scene = scene;
        this.ctx = scene.sound?.context;
        this.voices = new Set();
        this.after = 0;
        scene.events.once('shutdown', () => this.destroy());
        if (!this.ctx) return;
        try {
            if (!buffers.has(this.ctx)) {
                const ctx = this.ctx, count = Math.ceil(ctx.sampleRate * 0.25);
                const buffer = ctx.createBuffer(1, count, ctx.sampleRate), data = buffer.getChannelData(0);
                let low = 0;
                for (let i = 0; i < count; i++) {
                    const t = i / ctx.sampleRate, noise = Math.random() * 2 - 1;
                    low += (noise - low) * 0.18;
                    data[i] = (low * 0.75 + Math.sin(2 * Math.PI * (104 * t - 90 * t * t)) * 0.45)
                        * Math.exp(-t * 25) + noise * 0.22 * Math.exp(-t * 95);
                }
                buffers.set(ctx, buffer);
            }
            this.buffer = buffers.get(this.ctx);
        } catch { this.ctx = null; }
    }
    play(speed, kind = 'wall') {
        const ctx = this.ctx;
        if (!ctx || !this.buffer || ctx.state !== 'running' || this.scene.sound.mute
            || speed < 50 || ctx.currentTime < this.after || this.voices.size >= 3) return;
        this.after = ctx.currentTime + 0.1;
        const source = ctx.createBufferSource(), gain = ctx.createGain();
        source.buffer = this.buffer;
        source.playbackRate.value = kind === 'barrel' ? 1.3 : kind === 'car' ? 0.87 : 1;
        gain.gain.value = (0.10 + Math.min(1, speed / 650) * 0.12)
            * Math.max(0, Math.min(1, this.scene.sound.volume ?? 1));
        source.connect(gain).connect(this.scene.sound.masterMuteNode || ctx.destination);
        const voice = { source, gain };
        this.voices.add(voice);
        source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(voice); };
        source.start();
    }
    destroy() {
        for (const { source, gain } of this.voices) {
            source.onended = null;
            source.stop(); source.disconnect(); gain.disconnect();
        }
        this.voices.clear();
        this.ctx = null;
    }
}
