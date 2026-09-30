import type { ChannelAttributeSpec, ChannelListingPayload } from '@repo/connector-contracts';
import { validateListing } from './listing-validator';

const good = (over: Partial<ChannelListingPayload> = {}): ChannelListingPayload => ({
  sku: 'SKU1',
  title: 'Amethyst',
  descriptionHtml: '<p>x</p>',
  weightG: 100,
  priceNet: '10.00',
  vatRate: '0.21',
  stock: 5,
  categoryId: '123',
  attributes: { color: 'purple', material: 'stone' },
  imageUrls: ['a', 'b', 'c'],
  compliance: {
    gpsr_manufacturer: 'ACME',
    gpsr_eu_responsible_person: 'EU Rep',
    safety_information: 'none',
  },
  active: true,
  enrichmentApproved: true,
  ...over,
});
const specs: ChannelAttributeSpec[] = [
  { id: 'color', name: 'Color', mandatory: true },
  { id: 'material', name: 'Material', mandatory: true },
  { id: 'opt', name: 'Opt', mandatory: false },
];

describe('validateListing', () => {
  it('passes a complete listing', () => {
    expect(validateListing(good(), specs)).toEqual({ ok: true, missing: [] });
  });

  it('flags unapproved enrichment', () => {
    const r = validateListing(good({ enrichmentApproved: false }), specs);
    expect(r.missing).toEqual([{ code: 'enrichment_not_approved' }]);
    expect(r.ok).toBe(false);
  });

  it('treats undefined enrichmentApproved as not approved', () => {
    expect(validateListing(good({ enrichmentApproved: undefined }), specs).ok).toBe(false);
  });

  it('flags missing category mapping', () => {
    expect(validateListing(good({ categoryId: '' }), specs).missing).toEqual([{ code: 'category_unmapped' }]);
  });

  it('lists each missing mandatory attribute, including blank values', () => {
    const r = validateListing(good({ attributes: { color: '  ' } }), specs);
    expect(r.missing).toEqual([
      { code: 'mandatory_attribute_missing', field: 'color' },
      { code: 'mandatory_attribute_missing', field: 'material' },
    ]);
  });

  it('flags fewer than 3 images (configurable)', () => {
    expect(validateListing(good({ imageUrls: ['a', 'b'] }), specs).missing).toEqual([
      { code: 'images_insufficient', field: '2/3' },
    ]);
    expect(validateListing(good({ imageUrls: ['a', 'b'] }), specs, { minImages: 2 }).ok).toBe(true);
  });

  it('ignores blank image urls when counting', () => {
    expect(validateListing(good({ imageUrls: ['a', '', 'c'] }), specs).ok).toBe(false);
  });

  it('flags missing compliance fields, and CLP label when applicable', () => {
    const r = validateListing(good({ compliance: { gpsr_manufacturer: 'ACME', clpApplicable: true } }), specs);
    expect(r.missing).toEqual([
      { code: 'compliance_field_missing', field: 'gpsr_eu_responsible_person' },
      { code: 'compliance_field_missing', field: 'safety_information' },
      { code: 'compliance_field_missing', field: 'clp_label' },
    ]);
    expect(validateListing(good({ compliance: undefined }), specs).missing).toHaveLength(3);
  });

  it('accumulates every problem at once', () => {
    const r = validateListing(
      good({ enrichmentApproved: false, imageUrls: [], attributes: {}, compliance: {} }),
      specs,
    );
    expect(r.missing.map((m) => m.code)).toEqual([
      'enrichment_not_approved',
      'mandatory_attribute_missing',
      'mandatory_attribute_missing',
      'images_insufficient',
      'compliance_field_missing',
      'compliance_field_missing',
      'compliance_field_missing',
    ]);
  });

  it('skips attribute checks when the category is unmapped (no spec to check)', () => {
    expect(validateListing(good({ categoryId: '' }), []).missing).toEqual([{ code: 'category_unmapped' }]);
  });
});
