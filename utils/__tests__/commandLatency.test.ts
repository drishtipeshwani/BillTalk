import { buildCommandLatencySample } from '../commandLatency';

describe('buildCommandLatencySample', () => {
  it('records llm-start to apply elapsed milliseconds', () => {
    expect(
      buildCommandLatencySample({
        utterance: 'set mango price 50',
        appliedLabel: 'SET_PRICE',
        llmStartedAt: 1_000,
        appliedAt: 2_450,
      }),
    ).toEqual({
      recordedAt: new Date(2_450).toISOString(),
      utterance: 'set mango price 50',
      appliedLabel: 'SET_PRICE',
      llmToApplyMs: 1450,
    });
  });

  it('returns null when timestamps are invalid', () => {
    expect(
      buildCommandLatencySample({
        utterance: 'save',
        appliedLabel: 'SAVE_INVOICE',
        llmStartedAt: 3_000,
        appliedAt: 2_000,
      }),
    ).toBeNull();
  });
});
