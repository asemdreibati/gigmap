import { levelsFrom } from './logger';

describe('levelsFrom', () => {
  it('includes the minimum level and everything more severe', () => {
    expect(levelsFrom('log')).toEqual(['log', 'warn', 'error', 'fatal']);
    expect(levelsFrom('error')).toEqual(['error', 'fatal']);
    expect(levelsFrom('verbose')).toHaveLength(6);
  });
});
