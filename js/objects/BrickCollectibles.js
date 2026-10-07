import { createBrickLayout } from './BrickLayout.js';
import BrickOwnership from './BrickOwnership.js';

const BRICK_RADIUS = 18;
const MAX_SWEEP = 256;

// Pickup checks follow the car's movement between frames, including turbo
// at 15 FPS. Decorations float, but the pickup area stays on the asphalt.
export default class BrickCollectibles {
    constructor(scene) {
        this.scene = scene;
        this.lap = scene.currentLap;
        this.previousX = null;
        this.previousY = null;
        this.lastSoundAt = -Infinity;
        this.lastClaimSendAt = -Infinity;
        this.playerId = scene.playerId ?? scene.multiplayer?.playerId ?? 'solo';
        scene.brickCount = 0;

        const avoid = [
            ...(scene.oilSensors?.getChildren() || []).map(sensor => ({
                x: sensor.x, y: sensor.y, width: sensor.width + 100, height: sensor.height + 100,
            })),
            ...(scene.obstacles?.getChildren() || []).map(obstacle => ({
                x: obstacle.x, y: obstacle.y, radius: 80,
            })),
            ...(scene.boostData || []).map(boost => ({
                x: boost.x, y: boost.y, width: boost.halfX * 2 + 80,
                height: boost.halfY * 2 + 80, rotation: boost.rotation,
            })),
        ];
        this.createTextures();
        this.visuals = scene.add.container(0, 0).setDepth(950);
        this.bricks = createBrickLayout(scene.map, { avoid }).map((spot, index) => {
            const glow = scene.add.image(spot.x, spot.y + 9, 'brick-glow')
                .setDisplaySize(62, 38).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.5);
            const sprite = scene.add.image(spot.x, spot.y, 'tijolinho').setDisplaySize(42, 42);
            this.visuals.add([glow, sprite]);
            return { ...spot, glow, sprite, phase: index * 0.73, collected: false };
        });
        this.burst = scene.add.particles(0, 0, 'brick-spark', {
            lifespan: { min: 200, max: 420 }, speed: { min: 40, max: 120 },
            scale: { start: 1, end: 0 }, alpha: { start: 0.9, end: 0 },
            tint: [0xffc86c, 0xffe7ad, 0x7ceaff], blendMode: Phaser.BlendModes.ADD,
            emitting: false, maxAliveParticles: 48,
        }).setDepth(1050);
        this.worldObjects = [this.visuals, this.burst];
        this.ownership = new BrickOwnership({
            playerId: this.playerId, brickIds: this.bricks.map(brick => brick.id),
            maxLap: scene.totalLaps ?? 3,
        });
        // Lightweight standalone scenes have no transport. The game itself
        // always supplies a transport and starts this ledger at its shared start.
        if (!scene.multiplayer && !scene.playerId) {
            this.startRace({ roundId: 'solo', coordinatorId: 'solo', participantIds: ['solo'] });
        }
    }

    createTextures() {
        const textures = this.scene.textures;
        if (!textures.exists('brick-glow')) {
            const texture = textures.createCanvas('brick-glow', 64, 64);
            const context = texture.getContext();
            const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 32);
            gradient.addColorStop(0, 'rgba(255,190,75,0.65)');
            gradient.addColorStop(0.45, 'rgba(255,163,47,0.2)');
            gradient.addColorStop(1, 'rgba(255,163,47,0)');
            context.fillStyle = gradient;
            context.fillRect(0, 0, 64, 64);
            texture.refresh();
        }
        if (!textures.exists('brick-spark')) {
            const texture = textures.createCanvas('brick-spark', 4, 4);
            const context = texture.getContext();
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, 4, 4);
            texture.refresh();
        }
    }

    // Called only when the checkpoint system accepts a new lap. Waiting on
    // a pickup or recrossing the finish line cannot farm the same brick.
    resetForLap(lap) {
        if (lap <= this.lap) return;
        this.lap = lap;
        this.previousX = this.previousY = null;
        this.syncOwnership();
    }

    startRace(configuration) {
        if (!this.ownership.startRace(configuration)) return false;
        this.lap = this.scene.currentLap;
        this.previousX = this.previousY = null;
        this.syncOwnership();
        return true;
    }

    getNetworkState() { return this.ownership.getNetworkState(); }
    countFor(playerId) { return this.ownership.countFor(playerId); }
    hasPendingClaims() { return this.ownership.hasPendingClaims(); }

    syncOwnership() {
        this.scene.brickCount = this.countFor(this.playerId);
        for (const brick of this.bricks) {
            brick.collected = this.ownership.ownerFor(this.lap, brick.id) !== null;
            brick.pending = this.ownership.isPending(this.lap, brick.id);
            if (brick.collected || brick.pending) {
                brick.sprite.setVisible(false);
                brick.glow.setVisible(false);
            }
        }
    }

    receiveNetworkState(state) {
        const result = this.ownership.receiveNetworkState(state);
        if (result.changed) {
            this.syncOwnership();
            const time = this.scene.time?.now ?? performance.now();
            for (const grant of result.grants) {
                if (grant.playerId !== this.playerId || grant.lap !== this.lap) continue;
                const brick = this.bricks.find(item => item.id === grant.brickId);
                if (brick) this.animatePickup(brick, time);
            }
        }
        if (result.shouldPublish || result.changed) this.scene.publishNetworkState?.(true);
        return result.changed;
    }

    animatePickup(brick, time) {
        this.burst.explode(8, brick.x, brick.y);
        if (time - this.lastSoundAt >= 90) {
            this.lastSoundAt = time;
            // Uses the existing audio context and honors the sound toggle.
            if (!this.scene.sound?.mute) this.scene.scoreTone(1046, 0.075, 0.025, 'triangle', 1568);
        }
    }

    collect(brick, time) {
        const scene = this.scene;
        if (!scene.raceTimerStarted || scene.raceFinished || scene.car?.controlsEnabled === false
            || (scene.multiplayer && !scene.multiplayer.connected)) return;
        const result = this.ownership.request(this.lap, brick.id);
        if (!result.changed) return;
        this.syncOwnership();
        for (const grant of result.grants) if (grant.playerId === this.playerId) this.animatePickup(brick, time);
        this.lastClaimSendAt = time;
        this.scene.publishNetworkState?.(true);
    }

    update(time) {
        const scene = this.scene, car = scene.car;
        if (!car) return;
        const view = scene.cameras.main.worldView;
        const online = !scene.multiplayer || scene.multiplayer.connected;
        const canCollect = this.ownership.active && online && scene.raceTimerStarted
            && !scene.raceFinished && car.controlsEnabled !== false;
        // The final pickup can still be awaiting confirmation after crossing
        // the finish line. Resend until an authoritative owner settles it.
        if (online && this.hasPendingClaims() && time - this.lastClaimSendAt >= 300) {
            this.lastClaimSendAt = time;
            scene.publishNetworkState?.(true);
        }
        const x = car.body?.center?.x ?? car.x, y = car.body?.center?.y ?? car.y;
        let startX = this.previousX ?? x, startY = this.previousY ?? y;
        if (!canCollect || Math.hypot(x - startX, y - startY) > MAX_SWEEP) {
            startX = x; startY = y;
        }
        const dx = x - startX, dy = y - startY, lengthSquared = dx * dx + dy * dy;
        const radius = BRICK_RADIUS + (car.body?.halfWidth || 24);

        for (const brick of this.bricks) {
            if (brick.collected || brick.pending) continue;
            if (canCollect) {
                const t = lengthSquared ? Math.max(0, Math.min(1,
                    ((brick.x - startX) * dx + (brick.y - startY) * dy) / lengthSquared)) : 0;
                const gapX = brick.x - startX - t * dx, gapY = brick.y - startY - t * dy;
                if (gapX * gapX + gapY * gapY <= radius * radius) {
                    this.collect(brick, time);
                    continue;
                }
            }
            const visible = brick.x > view.x - 70 && brick.x < view.right + 70
                && brick.y > view.y - 70 && brick.y < view.bottom + 70;
            brick.sprite.setVisible(visible); brick.glow.setVisible(visible);
            if (!visible) continue;
            const pulse = Math.sin(time / 280 + brick.phase);
            brick.sprite.setPosition(brick.x, brick.y - 3 - pulse * 3);
            brick.glow.setAlpha(0.4 + (pulse + 1) * 0.1);
        }
        this.previousX = x; this.previousY = y;
    }
}
