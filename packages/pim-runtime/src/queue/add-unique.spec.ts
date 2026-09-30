import { addUnique } from './add-unique';

const queueWith = (job: unknown) => ({
  getJob: jest.fn().mockResolvedValue(job),
  add: jest.fn().mockResolvedValue({}),
});

describe('addUnique', () => {
  it('adds when no job has that id', async () => {
    const q = queueWith(undefined);
    await addUnique(q as never, 'n', { a: 1 }, 'id-1');
    expect(q.add).toHaveBeenCalledWith('n', { a: 1 }, { jobId: 'id-1' });
  });

  it.each(['failed', 'completed'])('replaces a %s job', async (state) => {
    const job = {
      getState: jest.fn().mockResolvedValue(state),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const q = queueWith(job);
    await addUnique(q as never, 'n', {}, 'id-1');
    expect(job.remove).toHaveBeenCalled();
    expect(q.add).toHaveBeenCalled();
  });

  it.each(['waiting', 'active', 'delayed'])(
    'leaves a %s job (BullMQ dedupes the add)',
    async (state) => {
      const job = {
        getState: jest.fn().mockResolvedValue(state),
        remove: jest.fn(),
      };
      const q = queueWith(job);
      await addUnique(q as never, 'n', {}, 'id-1');
      expect(job.remove).not.toHaveBeenCalled();
      expect(q.add).toHaveBeenCalledWith('n', {}, { jobId: 'id-1' });
    },
  );
});
