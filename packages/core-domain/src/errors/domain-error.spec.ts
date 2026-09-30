import { DomainError } from './domain-error';

describe('DomainError', () => {
  it('carries code, message and details and is an Error', () => {
    const e = new DomainError('X', 'boom', { a: 1 });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(DomainError);
    expect(e.name).toBe('DomainError');
    expect(e.code).toBe('X');
    expect(e.message).toBe('boom');
    expect(e.details).toEqual({ a: 1 });
  });
});
