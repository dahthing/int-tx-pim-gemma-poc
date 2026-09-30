import { decodeListingState, encodeListingState } from './listing-state.codec';

describe('listing-state codec', () => {
  it('round-trips hash and image checksums', () => {
    const s = encodeListingState('abc', ['c1', 'c,2']);
    expect(decodeListingState(s)).toEqual({ hash: 'abc', imageChecksums: ['c1', 'c,2'] });
  });
  it('stores a bare hash when there are no checksums', () => {
    expect(encodeListingState('abc', undefined)).toBe('abc');
    expect(decodeListingState('abc')).toEqual({ hash: 'abc', imageChecksums: undefined });
  });
  it('handles null / malformed values', () => {
    expect(decodeListingState(null)).toEqual({ hash: undefined, imageChecksums: undefined });
    expect(decodeListingState('h|not-json')).toEqual({ hash: 'h', imageChecksums: undefined });
    expect(encodeListingState(undefined, ['x'])).toBeNull();
  });
});
