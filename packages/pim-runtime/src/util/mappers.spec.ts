import { dec, iso, isoOrNull, lower, orderBy, pathKey, upper } from './mappers';

describe('mappers', () => {
  it('formats dates and decimals', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(iso(d)).toBe('2026-01-01T00:00:00.000Z');
    expect(isoOrNull(d)).toBe('2026-01-01T00:00:00.000Z');
    expect(isoOrNull(null)).toBeNull();
    expect(dec({ toString: () => '1.5' })).toBe('1.5');
    expect(dec(null)).toBeNull();
    expect(dec(undefined)).toBeNull();
    expect(lower('AI_DRAFT')).toBe('ai_draft');
    expect(upper('ai_draft')).toBe('AI_DRAFT');
  });

  it('normalises supplier paths like pim-catalog does (accents, case, spaces)', () => {
    expect(pathKey('Cristais  Naturais', 'Ametista', null)).toBe(
      'cristais naturais>ametista>',
    );
    expect(pathKey('Incenso', undefined, 'Café')).toBe('incenso>>cafe');
  });

  it('only sorts by whitelisted columns', () => {
    expect(orderBy('name', 'desc', ['name'], 'id')).toEqual({ name: 'desc' });
    expect(orderBy('rawPayload; drop', 'asc', ['name'], 'id')).toEqual({
      id: 'asc',
    });
  });
});
