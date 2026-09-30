import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DatabaseService, EnrichmentStatus, Prisma } from '@repo/database';
import { validateEnrichment } from '@repo/core-domain';
import { AUDIT_ACTIONS, AUDIT_ENTITIES, LLM_OPERATIONS, PIM_TOKENS, PRODUCT_ATTRIBUTE_KEYS } from './constants';
import type { LlmClient, UsageLogger } from './ports';
import { stripHtml } from './util/text';

export interface EnrichmentPromptInput {
  name: string;
  description?: string | null;
  categories?: string[];
  attributes?: Record<string, unknown>;
}

const SYSTEM_PROMPT = [
  'You write e-commerce product copy in European Portuguese (PT-PT) for a shop selling crystals and oils.',
  'Never make health, medical or therapeutic claims: do not say a product cures, treats, heals or relieves any condition.',
  'Use only plain facts from the supplied data. Allowed HTML in description_pt_html: p, br, ul, ol, li, strong, em, h2, h3.',
  'Answer with a single JSON object and nothing else, with keys: title_pt (max 128 chars), short_description_pt,',
  'description_pt_html, bullet_points (array of strings), seo_title (max 60 chars), seo_description (max 160 chars),',
  'suggested_attributes (object of string/number/boolean values).',
].join(' ');

export function buildEnrichmentPrompt(input: EnrichmentPromptInput): { system: string; user: string } {
  const lines = [`Supplier name: ${input.name}`, `Supplier description: ${stripHtml(input.description)}`];
  if (input.categories?.length) lines.push(`Categories: ${input.categories.join(' > ')}`);
  if (input.attributes && Object.keys(input.attributes).length) lines.push(`Attributes: ${JSON.stringify(input.attributes)}`);
  return { system: SYSTEM_PROMPT, user: lines.join('\n') };
}

export type GenerateResult = { ok: true } | { ok: false; errors: string[] };

function parseJson(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(body);
}

@Injectable()
export class EnrichmentService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(PIM_TOKENS.LLM_CLIENT) private readonly llm: LlmClient,
    @Inject(PIM_TOKENS.USAGE_LOGGER) private readonly usage: UsageLogger,
    @Optional() @Inject(PIM_TOKENS.FORBIDDEN_TERMS) private readonly forbiddenTerms?: readonly string[],
  ) {}

  async generate(tenantId: string, productId: string): Promise<GenerateResult> {
    const product = await this.db.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
      include: { supplierProduct: true, category: true },
    });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);
    const sp = product.supplierProduct;
    const prompt = buildEnrichmentPrompt({
      name: sp?.name ?? product.titlePt ?? product.sku,
      description: sp?.descriptionRaw,
      categories: [sp?.department, sp?.subDepartment, sp?.family, product.category?.name].filter((c): c is string => !!c),
      attributes: (product.attributes ?? {}) as Record<string, unknown>,
    });

    const response = await this.llm.complete(prompt);
    await this.usage.logLlmUsage({ tenantId, productId, operation: LLM_OPERATIONS.ENRICHMENT, ...response.usage });

    let parsed: unknown;
    try {
      parsed = parseJson(response.text);
    } catch {
      return { ok: false, errors: ['Output is not valid JSON'] };
    }
    const result = validateEnrichment(parsed, this.forbiddenTerms ? { forbiddenTerms: this.forbiddenTerms } : {});
    if (!result.ok) return { ok: false, errors: result.errors };

    const d = result.data;
    const attributes = {
      ...((product.attributes ?? {}) as Record<string, unknown>),
      [PRODUCT_ATTRIBUTE_KEYS.ENRICHMENT]: {
        bulletPoints: d.bullet_points,
        seoTitle: d.seo_title,
        seoDescription: d.seo_description,
        suggestedAttributes: d.suggested_attributes,
      },
    };
    await this.db.product.update({
      where: { id: product.id },
      data: {
        titlePt: d.title_pt,
        shortDescriptionPt: d.short_description_pt,
        descriptionPtHtml: d.description_pt_html,
        attributes: attributes as Prisma.InputJsonValue,
        enrichmentStatus: EnrichmentStatus.AI_DRAFT,
      },
    });
    return { ok: true };
  }

  /** The only path that sets APPROVED (human action). */
  async approve(tenantId: string, productId: string, actor: string): Promise<void> {
    const product = await this.find(tenantId, productId);
    if (product.enrichmentStatus !== EnrichmentStatus.AI_DRAFT) {
      throw new BadRequestException('Only an AI draft can be approved');
    }
    await this.db.product.update({ where: { id: product.id }, data: { enrichmentStatus: EnrichmentStatus.APPROVED } });
    await this.db.auditEvent.create({
      data: { tenantId, actor, entity: AUDIT_ENTITIES.PRODUCT, entityId: product.id, action: AUDIT_ACTIONS.ENRICHMENT_APPROVED },
    });
  }

  async assertPublishable(tenantId: string, productId: string): Promise<void> {
    const product = await this.find(tenantId, productId);
    if (product.enrichmentStatus !== EnrichmentStatus.APPROVED) {
      throw new BadRequestException('Enrichment must be approved before publishing');
    }
  }

  private async find(tenantId: string, productId: string) {
    const product = await this.db.product.findFirst({ where: { id: productId, tenantId, deletedAt: null } });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);
    return product;
  }
}
