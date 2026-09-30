import { S3ObjectStorage } from './s3-object-storage';

const values: Record<string, string> = {
  PIM_S3_ENDPOINT: 'http://minio:9000/',
  PIM_S3_BUCKET: 'pim',
  PIM_S3_ACCESS_KEY: 'ak',
  PIM_S3_SECRET_KEY: 'sk',
};
const config = (extra: Record<string, string> = {}) => {
  const all = { ...values, ...extra };
  return {
    get: jest.fn((k: string, d?: string) => all[k] ?? d),
    getOrThrow: jest.fn((k: string) => {
      if (all[k] === undefined) throw new Error(`missing ${k}`);
      return all[k];
    }),
  };
};
const res = (status: number, text = '') => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => text,
});

describe('S3ObjectStorage', () => {
  it('PUTs a signed path-style object and sends content type', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(res(200));
    const s = new S3ObjectStorage(config() as never, fetchImpl);
    await s.put('t/p/img 1.jpg', Buffer.from('abc'), 'image/jpeg');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://minio:9000/pim/t/p/img%201.jpg');
    expect(init.method).toBe('PUT');
    expect(init.headers['content-type']).toBe('image/jpeg');
    expect(init.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=ak\//,
    );
    expect(init.body).toEqual(Buffer.from('abc'));
  });

  it('throws without echoing secrets when the store rejects', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(res(403, 'AccessDenied'));
    const s = new S3ObjectStorage(config() as never, fetchImpl);
    const err = await s
      .put('k', Buffer.from('x'), 'image/png')
      .catch((e: Error) => e);
    expect((err as Error).message).toContain('403');
    expect((err as Error).message).not.toContain('sk');
  });

  it('builds the public URL from the endpoint or from the configured base', () => {
    expect(
      new S3ObjectStorage(config() as never, jest.fn()).publicUrl('a/b c.png'),
    ).toBe('http://minio:9000/pim/a/b%20c.png');
    expect(
      new S3ObjectStorage(
        config({ PIM_S3_PUBLIC_BASE_URL: 'https://cdn.x/img/' }) as never,
        jest.fn(),
      ).publicUrl('a.png'),
    ).toBe('https://cdn.x/img/a.png');
  });

  it('fails lazily when configuration is missing', async () => {
    const s = new S3ObjectStorage(
      {
        get: jest.fn(),
        getOrThrow: jest.fn(() => {
          throw new Error('missing');
        }),
      } as never,
      jest.fn(),
    );
    await expect(s.put('k', Buffer.from('x'), 'a/b')).rejects.toThrow(
      'missing',
    );
  });
});
