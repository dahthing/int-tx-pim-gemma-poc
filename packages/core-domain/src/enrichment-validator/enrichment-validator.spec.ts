import { validateEnrichment, sanitizeHtml, findForbiddenTerms, DEFAULT_FORBIDDEN_TERMS } from './enrichment-validator';

const valid = {
  title_pt: 'Cristal de quartzo rosa',
  short_description_pt: 'Um cristal decorativo.',
  description_pt_html: '<p>Cristal <strong>decorativo</strong> para a casa.</p><ul><li>Rosa</li></ul>',
  bullet_points: ['Natural', 'Decorativo'],
  seo_title: 'Quartzo rosa decorativo',
  seo_description: 'Compre o seu quartzo rosa decorativo.',
  suggested_attributes: { cor: 'rosa', peso_g: 120 },
};

describe('enrichment-validator', () => {
  it('accepts a valid payload', () => {
    const r = validateEnrichment(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.title_pt).toBe(valid.title_pt);
  });
  it.each(Object.keys(valid))('rejects missing %s', (k) => {
    const { [k]: _omit, ...rest } = valid as Record<string, unknown>;
    const r = validateEnrichment(rest);
    expect(r.ok).toBe(false);
  });
  it('rejects non object input', () => expect(validateEnrichment(null).ok).toBe(false));
  it('enforces length limits (128 / 60 / 160) inclusive', () => {
    expect(validateEnrichment({ ...valid, title_pt: 'a'.repeat(128) }).ok).toBe(true);
    expect(validateEnrichment({ ...valid, title_pt: 'a'.repeat(129) }).ok).toBe(false);
    expect(validateEnrichment({ ...valid, seo_title: 'a'.repeat(60) }).ok).toBe(true);
    expect(validateEnrichment({ ...valid, seo_title: 'a'.repeat(61) }).ok).toBe(false);
    expect(validateEnrichment({ ...valid, seo_description: 'a'.repeat(160) }).ok).toBe(true);
    expect(validateEnrichment({ ...valid, seo_description: 'a'.repeat(161) }).ok).toBe(false);
  });
  it('rejects empty title and empty bullet list', () => {
    expect(validateEnrichment({ ...valid, title_pt: '' }).ok).toBe(false);
    expect(validateEnrichment({ ...valid, bullet_points: [] }).ok).toBe(false);
  });
  it.each([
    '<script>alert(1)</script>',
    '<p>x</p><iframe src="x"></iframe>',
    '<style>p{}</style>',
    '<p onclick="x()">a</p>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '<p style="color:red">x</p>',
    '<p>unterminated <b',
    '<!-- c --><p>x</p>',
  ])('rejects disallowed html %s', (html) => {
    const r = validateEnrichment({ ...valid, description_pt_html: html });
    expect(r.ok).toBe(false);
  });
  it('allows safe links', () => {
    expect(validateEnrichment({ ...valid, description_pt_html: '<p><a href="https://x.pt/a">x</a><br/></p>' }).ok).toBe(true);
  });
  it.each(['Este cristal CURA a ansiedade', 'Produto que trata dores', 'Uso medicinal', 'É MÉDICINAL', 'Cúra total'])('rejects forbidden term in %s', (text) => {
    const r = validateEnrichment({ ...valid, short_description_pt: text });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/forbidden/i);
  });
  it('checks forbidden terms in html text, bullets, seo and attributes', () => {
    expect(validateEnrichment({ ...valid, description_pt_html: '<p>ajuda a <b>curar</b></p>' }).ok).toBe(false);
    expect(validateEnrichment({ ...valid, description_pt_html: '<p>efeito medicinal</p>' }).ok).toBe(false);
    expect(validateEnrichment({ ...valid, bullet_points: ['medicinal'] }).ok).toBe(false);
    expect(validateEnrichment({ ...valid, seo_description: 'medicinal' }).ok).toBe(false);
    expect(validateEnrichment({ ...valid, suggested_attributes: { uso: 'medicinal' } }).ok).toBe(false);
  });
  it('does not match terms inside other words (procura, secura)', () => {
    expect(validateEnrichment({ ...valid, short_description_pt: 'Procura pela beleza, segura' }).ok).toBe(true);
  });
  it('forbidden list is configurable', () => {
    expect(validateEnrichment({ ...valid, title_pt: 'Quartzo milagroso' }, { forbiddenTerms: ['milagroso'] }).ok).toBe(false);
    expect(validateEnrichment({ ...valid, short_description_pt: 'cura' }, { forbiddenTerms: ['milagroso'] }).ok).toBe(true);
  });
  it('exposes defaults and helper', () => {
    expect(DEFAULT_FORBIDDEN_TERMS).toEqual(expect.arrayContaining(['cura', 'trata', 'medicinal']));
    expect(findForbiddenTerms('Cura e TRATA', ['cura', 'trata', ''])).toEqual(['cura', 'trata']);
  });
  describe('sanitizeHtml', () => {
    it('returns ok for allowed markup and errors for others', () => {
      expect(sanitizeHtml('<p>a</p>')).toEqual({ ok: true, errors: [] });
      expect(sanitizeHtml('<div>a</div>').errors[0]).toMatch(/div/);
      expect(sanitizeHtml('<p class="x">a</p>').ok).toBe(false);
    });
  });
});
