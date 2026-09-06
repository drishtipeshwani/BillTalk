import {
  buildLlmInferenceSample,
  isCurrentLatencyLog,
} from '../commandLatency';

describe('buildLlmInferenceSample', () => {
  it('records generate start to response elapsed milliseconds', () => {
    expect(
      buildLlmInferenceSample({
        utterance: 'set mango price 50',
        startedAt: 1_000,
        firstTokenAt: 1_400,
        finishedAt: 2_450,
        promptTokenCount: 190,
        generatedTokenCount: 18,
        totalTokenCount: 208,
      }),
    ).toEqual({
      recordedAt: new Date(2_450).toISOString(),
      utterance: 'set mango price 50',
      inferenceMs: 1450,
      ttftMs: 400,
      promptTokenCount: 190,
      generatedTokenCount: 18,
      totalTokenCount: 208,
    });
  });

  it('returns null when timestamps are invalid', () => {
    expect(
      buildLlmInferenceSample({
        utterance: 'save',
        startedAt: 3_000,
        finishedAt: 2_000,
      }),
    ).toBeNull();
  });
});

describe('isCurrentLatencyLog', () => {
  it('rejects apply-stage samples from the old log', () => {
    expect(
      isCurrentLatencyLog({
        samples: [{ llmToApplyMs: 4000, utterance: 'add speaker' }],
      }),
    ).toBe(false);
  });

  it('accepts the llm-inference schema', () => {
    expect(
      isCurrentLatencyLog({
        version: 1,
        samples: [],
      }),
    ).toBe(true);
  });

  it('keeps version 1 logs compatible with samples recorded before token metrics', () => {
    expect(
      isCurrentLatencyLog({
        version: 1,
        samples: [
          {
            recordedAt: new Date(2_450).toISOString(),
            utterance: 'set mango price 50',
            inferenceMs: 1450,
          },
        ],
      }),
    ).toBe(true);
  });
});
