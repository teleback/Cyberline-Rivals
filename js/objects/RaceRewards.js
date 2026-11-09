export const BRICK_REWARD_RULES = Object.freeze({ lap: 0, finish: 0, victory: 25 });

const whole = value => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const MAX_COLLECTION_REWARD = 25;

export function getCollectionMultiplier(totalAvailable) {
    const available = whole(totalAvailable);
    return available > 0 ? MAX_COLLECTION_REWARD / available : 0;
}

// Every reward is currency. Race time determines the podium, never a multiplier.
export function computeBrickRewards({ collected = 0, totalAvailable = 0, laps = 0, finished = false, place = null },
    rules = BRICK_REWARD_RULES) {
    const multiplier = getCollectionMultiplier(totalAvailable);
    const collectionReward = multiplier > 0
        ? Math.min(MAX_COLLECTION_REWARD, Math.round(whole(collected) * multiplier))
        : 0;
    const rewards = {
        collected: collectionReward,
        laps: whole(laps) * rules.lap,
        finish: finished ? rules.finish : 0,
        victory: finished && place === 1 ? rules.victory : 0,
    };
    return { ...rewards, total: rewards.collected + rewards.laps + rewards.finish + rewards.victory };
}
