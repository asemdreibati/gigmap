import { parseRequestId } from './request-logging';

describe('parseRequestId', () => {
  it('reuses well-formed ids from upstream', () => {
    expect(parseRequestId('f3b1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d')).toBe(
      'f3b1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    );
    expect(parseRequestId('Root=1-67891233-abcdef012345678912345678')).toBeNull();
    expect(parseRequestId('lb.trace:0001-abcd')).toBe('lb.trace:0001-abcd');
  });

  it('rejects missing, short, long or log-injecting ids', () => {
    expect(parseRequestId(undefined)).toBeNull();
    expect(parseRequestId('abc')).toBeNull();
    expect(parseRequestId('x'.repeat(129))).toBeNull();
    expect(parseRequestId('abcdefgh\n{"level":"fatal"}')).toBeNull();
  });
});
