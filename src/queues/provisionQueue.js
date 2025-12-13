import { Queue } from 'bullmq'
import { redisOptions } from '../utils/redis.js'

export const provisionQueue = new Queue('zpack-provision', {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 10,
    removeOnFail: 5,
  }
})