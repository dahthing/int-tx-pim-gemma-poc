import { blankToUndefined } from './forms';

describe('blankToUndefined', () => {
  it('turns blank strings and all-blank nested groups into undefined', () => {
    expect(blankToUndefined({ a: '', b: 'x', c: { d: '', e: ' ' }, f: null, g: 0 })).toEqual({
      b: 'x',
      f: null,
      g: 0,
    });
  });
});
