import { createJobSchema, updateJobSchema } from './schemas';

const hour = 60 * 60 * 1000;

const validJob = {
  title: 'Bar help',
  description: 'Help behind the bar for the evening',
  category: 'hospitality',
  payAmount: 30,
  payType: 'hourly',
  latitude: 47.37,
  longitude: 8.54,
  address: 'Zürich',
  startTime: new Date(Date.now() + 24 * hour).toISOString(),
};

describe('createJobSchema', () => {
  it('accepts a valid job and coerces the start time', () => {
    const parsed = createJobSchema.parse(validJob);

    expect(parsed.startTime).toBeInstanceOf(Date);
    expect(parsed.slots).toBe(1);
  });

  it('rejects a start time in the past', () => {
    const result = createJobSchema.safeParse({
      ...validJob,
      startTime: new Date(Date.now() - hour).toISOString(),
    });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.startTime).toEqual([
      'Start time must be in the future',
    ]);
  });
});

describe('updateJobSchema', () => {
  it('rejects moving the start time into the past', () => {
    const result = updateJobSchema.safeParse({ startTime: '2020-01-01T10:00:00Z' });

    expect(result.success).toBe(false);
  });

  it('accepts a partial update without a start time', () => {
    expect(updateJobSchema.parse({ title: 'New title' })).toEqual({ title: 'New title' });
  });
});
