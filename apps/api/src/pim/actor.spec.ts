import { actorOf } from './actor';

describe('actorOf', () => {
  it('prefers the email, then the id, then "unknown"', () => {
    expect(actorOf({ email: 'a@b.pt', id: '1' })).toBe('a@b.pt');
    expect(actorOf({ id: '1' })).toBe('1');
    expect(actorOf({ email: '', id: '' })).toBe('unknown');
    expect(actorOf(undefined)).toBe('unknown');
    expect(actorOf({ email: 5 })).toBe('unknown');
  });
});
