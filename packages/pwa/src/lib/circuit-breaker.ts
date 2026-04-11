import { redis } from "./redis";

const CIRCUIT_KEY = "circuit:zapi";
const FAILURE_THRESHOLD = 5;
const COOLDOWN_SECONDS = 300; // 5 minutes

export const circuitBreaker = {
  async isOpen(): Promise<boolean> {
    const state = await redis.get<string>(CIRCUIT_KEY);
    return state === "open";
  },

  async recordFailure(): Promise<void> {
    const key = `${CIRCUIT_KEY}:failures`;
    const count = await redis.incr(key);
    await redis.expire(key, 60); // failures expire after 1 minute

    if (count >= FAILURE_THRESHOLD) {
      await redis.set(CIRCUIT_KEY, "open", { ex: COOLDOWN_SECONDS });
      await redis.del(key);
      console.error("Circuit breaker OPEN: Z-API failures exceeded threshold");
    }
  },

  async recordSuccess(): Promise<void> {
    await redis.del(`${CIRCUIT_KEY}:failures`);
    await redis.del(CIRCUIT_KEY);
  },
};
