import { normalizedKey, normalizeSegment, stripHtml } from './text';

describe('text utils', () => {
  it('strips html, scripts and entities', () => {
    expect(stripHtml('<p>Olá&nbsp;<b>mundo</b> &amp; co</p><script>x()</script>')).toBe('Olá mundo & co');
    expect(stripHtml(null)).toBe('');
  });

  it('normalizes accents, case and spaces', () => {
    expect(normalizeSegment('  Cristais   Águas ')).toBe('cristais aguas');
    expect(normalizeSegment(undefined)).toBe('');
  });

  it('builds a stable key', () => {
    expect(normalizedKey('Cristais', 'Quartzo', null)).toBe('cristais>quartzo>');
  });
});
