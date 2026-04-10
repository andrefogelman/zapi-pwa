import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const sessionCache = {
  async get(instanceId: string): Promise<string | null> {
    return await redis.get<string>(`session:${instanceId}`);
  },
  async set(instanceId: string, token: string, ttl = 86400): Promise<void> {
    await redis.set(`session:${instanceId}`, token, { ex: ttl });
  },
  async del(instanceId: string): Promise<void> {
    await redis.del(`session:${instanceId}`);
  },
};
