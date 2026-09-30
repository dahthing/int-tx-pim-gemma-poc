import { z } from 'zod';

export const DEFAULT_FORBIDDEN_TERMS: readonly string[] = [
  'cura', 'curar', 'trata', 'tratar', 'tratamento', 'medicinal', 'terapeutico', 'terapia',
];

const ALLOWED_TAGS = new Set(['p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'h2', 'h3', 'h4', 'span', 'a']);
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

export interface HtmlCheck {
  ok: boolean;
  errors: string[];
}

/** Checks HTML against an allow list (tags; only `href` on <a>; no on* / style / javascript:). */
export function sanitizeHtml(html: string): HtmlCheck {
  const errors: string[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\s*(\/?)>/y;
  let i = html.indexOf('<');
  while (i !== -1) {
    re.lastIndex = i;
    const m = re.exec(html);
    if (!m) {
      errors.push(`Malformed or disallowed markup near "${html.slice(i, i + 20)}"`);
    } else {
      const closing = m[1] ?? '';
      const tag = m[2] ?? '';
      const attrs = m[3] ?? '';
      const name = tag.toLowerCase();
      if (!ALLOWED_TAGS.has(name)) errors.push(`Disallowed tag <${name}>`);
      else if (!closing && attrs.trim()) {
        const attrRe = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
        for (const a of attrs.matchAll(attrRe)) {
          const val = a[2] ?? a[3] ?? a[4] ?? '';
          if (name === 'a' && (a[1] ?? '').toLowerCase() === 'href' && SAFE_HREF.test(val.trim())) continue;
          errors.push(`Disallowed attribute "${a[1]}" on <${name}>`);
        }
      }
    }
    i = html.indexOf('<', i + 1);
  }
  return { ok: errors.length === 0, errors };
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Accent and case insensitive whole-word search. Returns the matched terms (as configured). */
export function findForbiddenTerms(text: string, terms: readonly string[]): string[] {
  const hay = normalize(text);
  return terms.filter((t) => {
    const n = normalize(t).trim();
    if (!n) return false;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`).test(hay);
  });
}

export const enrichmentSchema = z.object({
  title_pt: z.string().trim().min(1).max(128),
  short_description_pt: z.string().trim().min(1).max(500),
  description_pt_html: z.string().trim().min(1),
  bullet_points: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
  seo_title: z.string().trim().min(1).max(60),
  seo_description: z.string().trim().min(1).max(160),
  suggested_attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export type Enrichment = z.infer<typeof enrichmentSchema>;

export type EnrichmentResult = { ok: true; data: Enrichment } | { ok: false; errors: string[] };

export interface EnrichmentOptions {
  forbiddenTerms?: readonly string[];
}

export function validateEnrichment(input: unknown, options: EnrichmentOptions = {}): EnrichmentResult {
  const parsed = enrichmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  const d = parsed.data;
  const errors: string[] = [];
  const html = sanitizeHtml(d.description_pt_html);
  errors.push(...html.errors.map((e) => `description_pt_html: ${e}`));

  const fields: Record<string, string> = {
    title_pt: d.title_pt,
    short_description_pt: d.short_description_pt,
    description_pt_html: d.description_pt_html.replace(/<[^>]*>/g, ' '),
    bullet_points: d.bullet_points.join('\n'),
    seo_title: d.seo_title,
    seo_description: d.seo_description,
    suggested_attributes: Object.entries(d.suggested_attributes).map(([k, v]) => `${k} ${String(v)}`).join('\n'),
  };
  const terms = options.forbiddenTerms ?? DEFAULT_FORBIDDEN_TERMS;
  for (const [field, text] of Object.entries(fields)) {
    const hit = findForbiddenTerms(text, terms);
    if (hit.length) errors.push(`${field}: forbidden term(s) ${hit.join(', ')}`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, data: d };
}
