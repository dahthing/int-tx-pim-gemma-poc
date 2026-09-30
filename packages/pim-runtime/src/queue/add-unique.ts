import type { Queue } from 'bullmq';

/**
 * Idempotent enqueue. BullMQ ignores an `add` whose jobId already exists, and keeps failed (and, with retention,
 * completed) jobs forever: a plain `add` with a stable jobId would silently drop every later run. So finished jobs with
 * the same id are removed first, while a waiting / active / delayed one is left alone (that is the dedupe).
 */
export async function addUnique<T extends object>(
  queue: Queue,
  name: string,
  data: T,
  jobId: string,
): Promise<void> {
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'failed' || state === 'completed') await existing.remove();
  }
  await queue.add(name, data, { jobId });
}
