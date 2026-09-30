import type { ChannelAttributeSpec, ChannelListingPayload } from '@repo/connector-contracts';

export type MissingCode =
  | 'enrichment_not_approved'
  | 'category_unmapped'
  | 'mandatory_attribute_missing'
  | 'images_insufficient'
  | 'compliance_field_missing';

export interface MissingItem {
  code: MissingCode;
  field?: string;
}

export interface ListingValidation {
  ok: boolean;
  missing: MissingItem[];
}

export interface ListingValidationOptions {
  minImages?: number;
  /** Compliance keys always required (S0.9 placeholder list). */
  requiredComplianceFields?: string[];
}

export const DEFAULT_COMPLIANCE_FIELDS = ['gpsr_manufacturer', 'gpsr_eu_responsible_person', 'safety_information'];

const blank = (v: unknown): boolean => v === undefined || v === null || String(v).trim() === '';

export function validateListing(
  listing: ChannelListingPayload,
  attributeSpecs: ChannelAttributeSpec[],
  opts: ListingValidationOptions = {},
): ListingValidation {
  const missing: MissingItem[] = [];
  if (listing.enrichmentApproved !== true) missing.push({ code: 'enrichment_not_approved' });

  const mapped = !blank(listing.categoryId);
  if (!mapped) missing.push({ code: 'category_unmapped' });
  else {
    for (const spec of attributeSpecs) {
      if (spec.mandatory && blank(listing.attributes[spec.id])) {
        missing.push({ code: 'mandatory_attribute_missing', field: spec.id });
      }
    }
  }

  const minImages = opts.minImages ?? 3;
  const images = listing.imageUrls.filter((u) => !blank(u)).length;
  if (images < minImages) missing.push({ code: 'images_insufficient', field: `${images}/${minImages}` });

  const compliance = listing.compliance ?? {};
  const required = [...(opts.requiredComplianceFields ?? DEFAULT_COMPLIANCE_FIELDS)];
  if (compliance['clpApplicable'] === true) required.push('clp_label');
  for (const f of required) {
    if (blank(compliance[f])) missing.push({ code: 'compliance_field_missing', field: f });
  }
  return { ok: missing.length === 0, missing };
}

export function formatMissing(missing: MissingItem[]): string {
  return missing.map((m) => (m.field ? `${m.code}:${m.field}` : m.code)).join('; ');
}
