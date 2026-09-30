import { BadRequestException, NotFoundException } from '@nestjs/common';
import { buildEnrichmentPrompt, EnrichmentService } from './enrichment.service';
import { createMockDb, MockDb } from './testing/mock-db.types';

const valid = {
  title_pt: 'Quartzo Rosa',
  short_description_pt: 'Cristal decorativo.',
  description_pt_html: '<p>Cristal <strong>bonito</strong>.</p>',
  bullet_points: ['Natural'],
  seo_title: 'Quartzo Rosa',
  seo_description: 'Quartzo rosa decorativo.',
  suggested_attributes: { cor: 'rosa' },
};

describe('buildEnrichmentPrompt', () => {
  it('forbids therapeutic claims, asks for JSON and strips html', () => {
    const p = buildEnrichmentPrompt({ name: 'Rose Quartz', description: '<p>A <b>stone</b></p>', categories: ['Crystals', 'Quartz'], attributes: { size: 'M' } });
    expect(p.system).toMatch(/therapeutic/i);
    expect(p.system).toMatch(/PT-PT/);
    expect(p.system).toMatch(/JSON/);
    expect(p.user).toContain('Rose Quartz');
    expect(p.user).toContain('A stone');
    expect(p.user).not.toContain('<b>');
    expect(p.user).toContain('Crystals > Quartz');
    expect(p.user).toContain('size');
  });

  it('copes with empty input', () => {
    expect(buildEnrichmentPrompt({ name: 'X' }).user).toContain('X');
  });
});

describe('EnrichmentService', () => {
  let mock: MockDb;
  let service: EnrichmentService;
  let llm: { complete: jest.Mock };
  let usage: { logLlmUsage: jest.Mock };
  const usageInfo = { inputTokens: 100, outputTokens: 50, model: 'gemma' };

  beforeEach(() => {
    const m = createMockDb();
    mock = m.mock;
    llm = { complete: jest.fn().mockResolvedValue({ text: JSON.stringify(valid), usage: usageInfo }) };
    usage = { logLlmUsage: jest.fn().mockResolvedValue(undefined) };
    mock.product.findFirst.mockResolvedValue({
      id: 'p1', titlePt: 'Rose Quartz', attributes: { size: 'M' }, enrichmentStatus: 'NONE',
      category: { name: 'Quartz' },
      supplierProduct: { name: 'Rose Quartz', descriptionRaw: '<p>Stone</p>', department: 'Crystals', subDepartment: 'Quartz', family: null },
    });
    mock.product.update.mockResolvedValue({});
    mock.auditEvent.create.mockResolvedValue({});
    service = new EnrichmentService(m.db, llm, usage);
  });

  it('saves a valid output as AI_DRAFT and logs token usage', async () => {
    const res = await service.generate('t1', 'p1');
    expect(mock.product.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'p1', tenantId: 't1' });
    expect(res.ok).toBe(true);
    const upd = mock.product.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'p1' });
    expect(upd.data).toMatchObject({
      titlePt: 'Quartzo Rosa', shortDescriptionPt: 'Cristal decorativo.', descriptionPtHtml: valid.description_pt_html, enrichmentStatus: 'AI_DRAFT',
    });
    expect(upd.data.attributes).toMatchObject({ size: 'M', enrichment: { bulletPoints: ['Natural'], seoTitle: 'Quartzo Rosa' } });
    expect(usage.logLlmUsage).toHaveBeenCalledWith({ tenantId: 't1', productId: 'p1', operation: 'enrichment', ...usageInfo });
  });

  it('accepts JSON wrapped in a code fence', async () => {
    llm.complete.mockResolvedValue({ text: '```json\n' + JSON.stringify(valid) + '\n```', usage: usageInfo });
    expect((await service.generate('t1', 'p1')).ok).toBe(true);
  });

  it('rejects invalid schema output, never saves it, still logs usage', async () => {
    llm.complete.mockResolvedValue({ text: JSON.stringify({ ...valid, title_pt: 'x'.repeat(200) }), usage: usageInfo });
    const res = await service.generate('t1', 'p1');
    expect(res.ok).toBe(false);
    expect(mock.product.update).not.toHaveBeenCalled();
    expect(usage.logLlmUsage).toHaveBeenCalledTimes(1);
  });

  it('rejects therapeutic terms', async () => {
    llm.complete.mockResolvedValue({ text: JSON.stringify({ ...valid, short_description_pt: 'Ajuda a curar a ansiedade' }), usage: usageInfo });
    const res = await service.generate('t1', 'p1');
    expect(res).toMatchObject({ ok: false });
    expect(mock.product.update).not.toHaveBeenCalled();
  });

  it('rejects non JSON output', async () => {
    llm.complete.mockResolvedValue({ text: 'sorry, cannot', usage: usageInfo });
    const res = await service.generate('t1', 'p1');
    expect(res).toMatchObject({ ok: false, errors: [expect.stringContaining('JSON')] });
    expect(mock.product.update).not.toHaveBeenCalled();
  });

  it('honours a custom forbidden term list', async () => {
    const m = createMockDb();
    m.mock.product.findFirst.mockResolvedValue({ id: 'p1', attributes: null, supplierProduct: null, category: null });
    const custom = new EnrichmentService(m.db, llm, usage, ['bonito']);
    const res = await custom.generate('t1', 'p1');
    expect(res.ok).toBe(false);
  });

  it('throws NotFound for an unknown product', async () => {
    mock.product.findFirst.mockResolvedValue(null);
    await expect(service.generate('t1', 'p1')).rejects.toBeInstanceOf(NotFoundException);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('only approve() sets APPROVED, from AI_DRAFT, audited', async () => {
    mock.product.findFirst.mockResolvedValue({ id: 'p1', enrichmentStatus: 'AI_DRAFT' });
    await service.approve('t1', 'p1', 'user-1');
    expect(mock.product.update.mock.calls[0][0]).toMatchObject({ where: { id: 'p1' }, data: { enrichmentStatus: 'APPROVED' } });
    expect(mock.auditEvent.create.mock.calls[0][0].data).toMatchObject({ tenantId: 't1', actor: 'user-1', entity: 'Product', entityId: 'p1', action: 'enrichment.approved' });
  });

  it('cannot approve without an AI draft or for an unknown product', async () => {
    mock.product.findFirst.mockResolvedValue({ id: 'p1', enrichmentStatus: 'NONE' });
    await expect(service.approve('t1', 'p1', 'u')).rejects.toBeInstanceOf(BadRequestException);
    mock.product.findFirst.mockResolvedValue(null);
    await expect(service.approve('t1', 'p1', 'u')).rejects.toBeInstanceOf(NotFoundException);
    expect(mock.product.update).not.toHaveBeenCalled();
  });

  it('publishing gate requires APPROVED', async () => {
    mock.product.findFirst.mockResolvedValue({ id: 'p1', enrichmentStatus: 'APPROVED' });
    await expect(service.assertPublishable('t1', 'p1')).resolves.toBeUndefined();
    mock.product.findFirst.mockResolvedValue({ id: 'p1', enrichmentStatus: 'AI_DRAFT' });
    await expect(service.assertPublishable('t1', 'p1')).rejects.toBeInstanceOf(BadRequestException);
    mock.product.findFirst.mockResolvedValue(null);
    await expect(service.assertPublishable('t1', 'p1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
