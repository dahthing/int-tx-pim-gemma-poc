import { collectAll, paginate } from './paginate';

const page = (n: number, last: number, next: string | null, data: number[]) => ({
  data,
  links: { next },
  meta: { current_page: n, last_page: last },
});

describe('paginate', () => {
  it('walks 3 pages and stops on links.next null', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce(page(1, 9, 'u?page=2', [1]))
      .mockResolvedValueOnce(page(2, 9, 'u?page=3', [2]))
      .mockResolvedValueOnce(page(3, 9, null, [3]));
    expect(await collectAll(fetchPage)).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage.mock.calls.map((c) => c[0].page)).toEqual([1, 2, 3]);
    expect(fetchPage.mock.calls[1][0].url).toBe('u?page=2');
  });

  it('stops when current_page >= last_page even if next is set', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce(page(1, 2, 'u?page=2', [1]))
      .mockResolvedValueOnce(page(2, 2, 'u?page=3', [2]));
    expect(await collectAll(fetchPage)).toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('stops when links and meta are absent', async () => {
    const fetchPage = jest.fn().mockResolvedValueOnce({ data: [1] });
    expect(await collectAll(fetchPage)).toEqual([1]);
  });

  it('yields page results with page number and raw response', async () => {
    const r = page(1, 1, null, [7]);
    const out = [];
    for await (const p of paginate(async () => r)) out.push(p);
    expect(out).toEqual([{ page: 1, items: [7], raw: r }]);
  });

  it('honours startPage and treats missing data as empty', async () => {
    const fetchPage = jest.fn().mockResolvedValueOnce({ links: { next: null } });
    const out = [];
    for await (const p of paginate(fetchPage, { startPage: 4 })) out.push(p);
    expect(fetchPage.mock.calls[0][0].page).toBe(4);
    expect(out[0]!.items).toEqual([]);
  });

  it('propagates page failures after yielding earlier pages', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce(page(1, 3, 'n', [1]))
      .mockRejectedValueOnce(new Error('boom'));
    const seen: number[] = [];
    await expect(
      (async () => {
        for await (const p of paginate<number>(fetchPage)) seen.push(...p.items);
      })(),
    ).rejects.toThrow('boom');
    expect(seen).toEqual([1]);
  });

  it('guards against runaway pagination with maxPages', async () => {
    const fetchPage = jest.fn().mockImplementation(async ({ page: n }) => page(n, 99, 'n', [n]));
    await expect(collectAll(fetchPage, { maxPages: 3 })).rejects.toThrow(/maxPages/);
  });
});
