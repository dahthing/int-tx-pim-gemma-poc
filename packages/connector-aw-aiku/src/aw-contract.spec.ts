import { readdirSync } from 'node:fs';
import { FIXTURE_DIR, loadFixture } from './__fixtures__/load';
import { mapImages, mapPortfolioItem, mapProduct, mapTransaction } from './aw-mappers';

/**
 * FR 12.3: replays every recorded fixture in __fixtures__ through the mapper that owns it
 * (chosen by file name prefix). Drop a real recorded file in with the right prefix and CI
 * replays it.
 */
const byPrefix: Array<[string, (row: any) => unknown, (out: any) => void]> = [
  ['products-', mapProduct, (o) => {
    expect(o.externalId).toMatch(/^\d+$/);
    expect(o.costPrice).toMatch(/^\d+(\.\d+)?$/);
    expect(Number.isInteger(o.stock)).toBe(true);
  }],
  ['my-products.', mapPortfolioItem, (o) => expect(o.externalPortfolioId).toMatch(/^\d+$/)],
  ['transactions', mapTransaction, (o) => expect(o.quantityOrdered).toBeGreaterThanOrEqual(0)],
];

describe('recorded contracts', () => {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const hit = byPrefix.find(([p]) => file.startsWith(p));
    if (!hit) continue;
    it(`${file} maps`, () => {
      const rows = loadFixture(file).data as any[];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) hit[2](hit[1](row));
    });
  }
  it('images fixtures map', () => {
    for (const f of files.filter((x) => x.startsWith('images'))) {
      for (const m of mapImages(loadFixture(f).data)) expect(m.url).toMatch(/^https?:/);
    }
  });
});
