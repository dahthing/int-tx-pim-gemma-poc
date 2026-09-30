export interface LaravelPage<T> {
  data?: T[];
  links?: { next?: string | null };
  meta?: { current_page?: number; last_page?: number };
}

export interface PageRequest {
  page: number;
  /** `links.next` of the previous page, when present. */
  url?: string;
}

export interface PageResult<T> {
  page: number;
  items: T[];
  raw: LaravelPage<T>;
}

export interface PaginateOptions {
  startPage?: number;
  /** Safety valve against servers that never end; default 10000. */
  maxPages?: number;
}

/**
 * Walks a Laravel style paginated endpoint page by page. Stops when `links.next` is
 * null/absent or `meta.current_page >= meta.last_page`. Page errors propagate to the
 * consumer after earlier pages were already yielded.
 */
export async function* paginate<T>(
  fetchPage: (req: PageRequest) => Promise<LaravelPage<T>>,
  opts: PaginateOptions = {},
): AsyncGenerator<PageResult<T>, void, undefined> {
  const { startPage = 1, maxPages = 10_000 } = opts;
  let page = startPage;
  let url: string | undefined;
  for (let n = 0; ; n++) {
    if (n >= maxPages) throw new Error(`paginate exceeded maxPages (${maxPages})`);
    const raw = await fetchPage({ page, url });
    yield { page, items: raw.data ?? [], raw };
    const next = raw.links?.next;
    const { current_page: cur, last_page: last } = raw.meta ?? {};
    if (!next) return;
    if (cur !== undefined && last !== undefined && cur >= last) return;
    url = next;
    page = (cur ?? page) + 1;
  }
}

export async function collectAll<T>(
  fetchPage: (req: PageRequest) => Promise<LaravelPage<T>>,
  opts?: PaginateOptions,
): Promise<T[]> {
  const out: T[] = [];
  for await (const p of paginate(fetchPage, opts)) out.push(...p.items);
  return out;
}
