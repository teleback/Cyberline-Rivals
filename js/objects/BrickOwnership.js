const PROTOCOL_VERSION = 1;

const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200;

// The starting-grid coordinator is the only writer. The ledger is append-only
// for one race: repeated requests and older snapshots can never award a pickup
// twice, replace its winner, or erase an award from an earlier lap.
export default class BrickOwnership {
    constructor({ playerId, brickIds, maxLap = 3 }) {
        this.playerId = playerId;
        this.brickIds = new Set(brickIds);
        this.maxLap = Math.max(1, Math.floor(maxLap));
        this.roundId = null;
        this.coordinatorId = null;
        this.participantIds = new Set();
        this.owners = new Map();
        this.pending = new Map();
    }

    startRace({ roundId, coordinatorId, participantIds } = {}) {
        if (!validId(roundId) || !Array.isArray(participantIds)
            || !participantIds.length || participantIds.length > 8
            || participantIds.some(id => !validId(id))) return false;
        const participants = [...new Set(participantIds)].sort((a, b) => a.localeCompare(b));
        if (!participants.includes(this.playerId) || coordinatorId !== participants[0]) return false;
        if (this.roundId === roundId) {
            return this.coordinatorId === coordinatorId
                && participants.length === this.participantIds.size
                && participants.every(id => this.participantIds.has(id));
        }
        this.roundId = roundId;
        this.coordinatorId = coordinatorId;
        this.participantIds = new Set(participants);
        this.owners.clear();
        this.pending.clear();
        return true;
    }

    get active() { return this.roundId !== null; }
    get isCoordinator() { return this.playerId === this.coordinatorId; }
    key(lap, brickId) { return `${lap}:${brickId}`; }

    validPickup(pickup) {
        return pickup && Number.isInteger(pickup.lap) && pickup.lap >= 1
            && pickup.lap <= this.maxLap && this.brickIds.has(pickup.brickId);
    }

    ownerFor(lap, brickId) { return this.owners.get(this.key(lap, brickId))?.playerId ?? null; }
    isPending(lap, brickId) { return this.pending.has(this.key(lap, brickId)); }
    hasPendingClaims() { return this.pending.size > 0; }

    countFor(playerId) {
        let count = 0;
        for (const pickup of this.owners.values()) if (pickup.playerId === playerId) count++;
        return count;
    }

    request(lap, brickId) {
        const pickup = { lap, brickId }, key = this.key(lap, brickId);
        if (!this.active || !this.validPickup(pickup) || this.owners.has(key) || this.pending.has(key)) {
            return { changed: false, grants: [] };
        }
        if (this.isCoordinator) {
            const grant = { ...pickup, playerId: this.playerId };
            this.owners.set(key, grant);
            return { changed: true, grants: [grant] };
        }
        this.pending.set(key, pickup);
        return { changed: true, grants: [] };
    }

    getNetworkState() {
        if (!this.active) return null;
        const groups = new Map();
        if (this.isCoordinator) {
            for (const pickup of this.owners.values()) {
                const key = this.key(pickup.lap, pickup.playerId);
                if (!groups.has(key)) groups.set(key, [pickup.lap, pickup.playerId, []]);
                groups.get(key)[2].push(pickup.brickId);
            }
        }
        return {
            version: PROTOCOL_VERSION,
            roundId: this.roundId,
            coordinatorId: this.coordinatorId,
            // Requests: [lap, brickId]. Owner groups: [lap, playerId,
            // brickIds]. Reusing the owner once per lap keeps late-race
            // movement packets small without losing the full award history.
            requests: [...this.pending.values()].map(pickup => [pickup.lap, pickup.brickId]),
            ownership: [...groups.values()],
        };
    }

    receiveNetworkState({ id, brickState, lap } = {}) {
        const result = { changed: false, grants: [], shouldPublish: false };
        if (!this.active || !this.participantIds.has(id) || id === this.playerId
            || !brickState || brickState.version !== PROTOCOL_VERSION
            || brickState.roundId !== this.roundId
            || brickState.coordinatorId !== this.coordinatorId) return result;

        const limit = this.brickIds.size * this.maxLap;
        if (this.isCoordinator) {
            if (!Array.isArray(brickState.requests) || brickState.requests.length > limit) return result;
            if (lap !== undefined && !Number.isInteger(lap)) return result;
            for (const entry of brickState.requests) {
                const pickup = Array.isArray(entry) ? { lap: entry[0], brickId: entry[1] } : entry;
                if (!this.validPickup(pickup)
                    || (Number.isInteger(lap) && pickup.lap > lap)) continue;
                // Answer retries even when their award already exists. This
                // settles claims whose first confirmation was lost in transit.
                result.shouldPublish = true;
                const key = this.key(pickup.lap, pickup.brickId);
                if (this.owners.has(key)) continue;
                const grant = { lap: pickup.lap, brickId: pickup.brickId, playerId: id };
                this.owners.set(key, grant);
                result.changed = true;
                result.grants.push(grant);
            }
        } else if (id === this.coordinatorId) {
            if (!Array.isArray(brickState.ownership) || brickState.ownership.length > limit) return result;
            const entries = [];
            for (const entry of brickState.ownership) {
                if (Array.isArray(entry) && Array.isArray(entry[2])) {
                    if (entry[2].length > this.brickIds.size || entries.length + entry[2].length > limit) return result;
                    for (const brickId of entry[2]) {
                        entries.push({ lap: entry[0], playerId: entry[1], brickId });
                    }
                } else entries.push(entry); // Accept earlier object snapshots.
                if (entries.length > limit) return result;
            }
            for (const pickup of entries) {
                if (!this.validPickup(pickup) || !this.participantIds.has(pickup.playerId)) continue;
                const key = this.key(pickup.lap, pickup.brickId);
                if (!this.owners.has(key)) {
                    const grant = { lap: pickup.lap, brickId: pickup.brickId, playerId: pickup.playerId };
                    this.owners.set(key, grant);
                    result.changed = true;
                    result.grants.push(grant);
                }
                if (this.pending.delete(key)) result.changed = true;
            }
        }
        return result;
    }
}
