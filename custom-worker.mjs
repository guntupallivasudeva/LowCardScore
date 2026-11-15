import openNextWorker, {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from './.open-next/worker.js';
import { cleanupNonEssentialDatabaseData } from './src/lib/dbCleanup';

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge };

const worker = {
  async fetch(request, env, ctx) {
    return openNextWorker.fetch(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    if (env?.DB) {
      ctx.waitUntil(
        cleanupNonEssentialDatabaseData(env.DB).catch((err) => {
          console.error('Scheduled LowScore D1 cleanup failed:', err);
        })
      );
    }
  },
};

export default worker;
