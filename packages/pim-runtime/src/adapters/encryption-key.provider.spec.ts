import { ConfigEncryptionKeyProvider } from './encryption-key.provider';

const cfg = (value?: string) => ({
  getOrThrow: jest.fn(() => {
    if (value === undefined) throw new Error('missing');
    return value;
  }),
});

describe('ConfigEncryptionKeyProvider', () => {
  it('decodes the base64 key and caches it', async () => {
    const config = cfg(Buffer.alloc(32, 9).toString('base64'));
    const p = new ConfigEncryptionKeyProvider(config as never);
    const a = await p.getKey('t');
    const b = await p.getKey('t2');
    expect(a.equals(Buffer.alloc(32, 9))).toBe(true);
    expect(b).toBe(a);
    expect(config.getOrThrow).toHaveBeenCalledTimes(1);
  });

  it('rejects keys that are not 32 bytes', async () => {
    const p = new ConfigEncryptionKeyProvider(
      cfg(Buffer.alloc(16).toString('base64')) as never,
    );
    await expect(p.getKey('t')).rejects.toThrow(/32 bytes/);
  });

  it('propagates a missing key', async () => {
    await expect(
      new ConfigEncryptionKeyProvider(cfg() as never).getKey('t'),
    ).rejects.toThrow('missing');
  });
});
