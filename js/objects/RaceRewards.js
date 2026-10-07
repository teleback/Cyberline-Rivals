export const BRICK_REWARD_RULES = Object.freeze({ lap: 10, finish: 20, victory: 50 });

const whole = value => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

// Every reward is currency. Race time determines the podium, never a multiplier.
export function computeBrickRewards({ collected = 0, laps = 0, finished = false, place = null },
    rules = BRICK_REWARD_RULES) {
    const rewards = {
        collected: whole(collected),
        laps: whole(laps) * rules.lap,
        finish: finished ? rules.finish : 0,
        victory: finished && place === 1 ? rules.victory : 0,
    };
    return { ...rewards, total: rewards.collected + rewards.laps + rewards.finish + rewards.victory };
}
