import {
  hiringRefusal,
  isAcceptingWorkers,
  isClosedByEmployer,
  manualTransitionError,
  postingExpiry,
  statusAfterHeadcountChange,
  type JobState,
} from './job-lifecycle';

const now = new Date('2026-09-01T12:00:00Z');
const later = new Date('2026-09-08T12:00:00Z');
const earlier = new Date('2026-08-25T12:00:00Z');

const job = (overrides: Partial<JobState> = {}): JobState => ({
  status: 'open',
  slots: 3,
  filledSlots: 0,
  expiresAt: later,
  ...overrides,
});

describe('isAcceptingWorkers', () => {
  it('is true only for an open, unexpired job with a free slot', () => {
    expect(isAcceptingWorkers(job(), now)).toBe(true);
    expect(isAcceptingWorkers(job({ filledSlots: 3 }), now)).toBe(false);
    expect(isAcceptingWorkers(job({ expiresAt: earlier }), now)).toBe(false);
    expect(isAcceptingWorkers(job({ status: 'filled', filledSlots: 1 }), now)).toBe(false);
    expect(isAcceptingWorkers(job({ status: 'cancelled' }), now)).toBe(false);
  });
});

describe('hiringRefusal', () => {
  it('is null while the job is hiring', () => {
    expect(hiringRefusal(job(), now)).toBeNull();
  });

  it('reports a job that filled up as full', () => {
    expect(hiringRefusal(job({ status: 'filled', filledSlots: 3 }), now)).toBe('full');
  });

  it('reports hand-closed, cancelled and expired jobs as closed, even when full', () => {
    expect(hiringRefusal(job({ status: 'filled', filledSlots: 1 }), now)).toBe('closed');
    expect(hiringRefusal(job({ status: 'cancelled', filledSlots: 3 }), now)).toBe('closed');
    expect(hiringRefusal(job({ status: 'filled', filledSlots: 3, expiresAt: earlier }), now)).toBe(
      'closed',
    );
  });
});

describe('isClosedByEmployer', () => {
  it('distinguishes a hand-closed job from one that filled up', () => {
    expect(isClosedByEmployer(job({ status: 'filled', filledSlots: 1 }))).toBe(true);
    expect(isClosedByEmployer(job({ status: 'filled', filledSlots: 3 }))).toBe(false);
    expect(isClosedByEmployer(job({ status: 'open', filledSlots: 1 }))).toBe(false);
  });
});

describe('manualTransitionError', () => {
  it.each([
    ['open', 'filled'],
    ['open', 'cancelled'],
    ['filled', 'cancelled'],
    ['filled', 'filled'],
    ['cancelled', 'cancelled'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(manualTransitionError(from, to)).toBeNull();
  });

  it.each([
    ['expired', 'filled', 'This job has expired'],
    ['expired', 'cancelled', 'This job has expired'],
    ['cancelled', 'filled', 'This job has been cancelled'],
  ] as const)('refuses %s -> %s', (from, to, message) => {
    expect(manualTransitionError(from, to)).toBe(message);
  });
});

describe('statusAfterHeadcountChange', () => {
  it('fills the job when the last slot is taken', () => {
    expect(statusAfterHeadcountChange(job({ filledSlots: 2 }), 3, now)).toBe('filled');
  });

  it('keeps an open job open while slots remain', () => {
    expect(statusAfterHeadcountChange(job({ filledSlots: 1 }), 2, now)).toBe('open');
  });

  it('reopens a job that had filled up when an acceptance is withdrawn', () => {
    expect(statusAfterHeadcountChange(job({ status: 'filled', filledSlots: 3 }), 2, now)).toBe(
      'open',
    );
  });

  it('keeps a job the employer closed by hand filled', () => {
    expect(statusAfterHeadcountChange(job({ status: 'filled', filledSlots: 2 }), 1, now)).toBe(
      'filled',
    );
  });

  it('expires instead of reopening once the posting window has passed', () => {
    const full = job({ status: 'filled', filledSlots: 3, expiresAt: earlier });
    expect(statusAfterHeadcountChange(full, 2, now)).toBe('expired');
  });

  it('never moves a terminal job', () => {
    expect(statusAfterHeadcountChange(job({ status: 'expired', filledSlots: 1 }), 0, now)).toBe(
      'expired',
    );
    expect(statusAfterHeadcountChange(job({ status: 'cancelled', filledSlots: 1 }), 0, now)).toBe(
      'cancelled',
    );
  });
});

describe('postingExpiry', () => {
  const posted = new Date('2026-09-01T12:00:00Z');

  it('keeps a job up for the standard week after posting', () => {
    const startsTomorrow = new Date('2026-09-02T12:00:00Z');
    expect(postingExpiry(posted, startsTomorrow)).toEqual(new Date('2026-09-08T12:00:00Z'));
  });

  it('keeps a job starting later than that up until it starts', () => {
    const startsInThreeWeeks = new Date('2026-09-22T12:00:00Z');
    expect(postingExpiry(posted, startsInThreeWeeks)).toEqual(startsInThreeWeeks);
  });
});
