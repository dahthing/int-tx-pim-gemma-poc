import { HttpStatusError, NetworkError } from '@repo/http-client';
import { HttpMediaDownloader } from './http-media-downloader';

const response = (
  status: number,
  body: Buffer,
  headers: Record<string, string> = {},
) =>
  ({
    ok: status < 400,
    status,
    headers: new Headers(headers),
    arrayBuffer: async () =>
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  }) as unknown as Response;

describe('HttpMediaDownloader', () => {
  it('downloads bytes and returns the mime without parameters', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        response(200, Buffer.from('img'), {
          'content-type': 'image/jpeg; charset=x',
        }),
      );
    const d = new HttpMediaDownloader({ fetchImpl });
    const r = await d.download('https://cdn.example.com/a.jpg');
    expect(r.data.toString()).toBe('img');
    expect(r.mime).toBe('image/jpeg');
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('follow');
  });

  it('falls back to a mime sniffed from the extension, then octet-stream', async () => {
    const d = new HttpMediaDownloader({
      fetchImpl: jest.fn().mockResolvedValue(response(200, Buffer.from('x'))),
    });
    expect((await d.download('https://x/a.PNG?v=1')).mime).toBe('image/png');
    expect((await d.download('https://x/a')).mime).toBe(
      'application/octet-stream',
    );
  });

  it('raises a redacted HttpStatusError on non-2xx', async () => {
    const d = new HttpMediaDownloader({
      fetchImpl: jest.fn().mockResolvedValue(response(404, Buffer.alloc(0))),
    });
    await expect(
      d.download('https://x/a.jpg?token=abc'),
    ).rejects.toBeInstanceOf(HttpStatusError);
    await expect(d.download('https://x/a.jpg?token=abc')).rejects.not.toThrow(
      /abc/,
    );
  });

  it('wraps transport failures in NetworkError', async () => {
    const d = new HttpMediaDownloader({
      fetchImpl: jest.fn().mockRejectedValue(new Error('boom')),
    });
    await expect(d.download('https://x/a.jpg')).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it('rejects payloads above the size cap', async () => {
    const d = new HttpMediaDownloader({
      maxBytes: 2,
      fetchImpl: jest.fn().mockResolvedValue(response(200, Buffer.from('abc'))),
    });
    await expect(d.download('https://x/a.jpg')).rejects.toThrow(/too large/i);
  });

  it('rejects non-http(s) schemes', async () => {
    const fetchImpl = jest.fn();
    await expect(
      new HttpMediaDownloader({ fetchImpl }).download('file:///etc/passwd'),
    ).rejects.toThrow(/http/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
