import { Redis } from '@upstash/redis'

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

export const sessionCache = {
  get: async (id: string) => await redis.get(`session:${id}`),
  set: async (id: string, token: string, ttl = 86400) => await redis.set(`session:${id}`, token, { ex: ttl }),
  del: async (id: string) => await redis.del(`session:${id}`),
}
