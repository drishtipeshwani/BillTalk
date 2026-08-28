import { flushPendingAction, ingestPendingAction } from '../actionHypothesis';

describe('ingestPendingAction', () => {
  it('keeps a single action pending without applying', () => {
    expect(
      ingestPendingAction(null, [
        { action: 'SET_CUSTOMER', customerName: 'Ram' },
      ]),
    ).toEqual({
      toApply: [],
      pending: { action: 'SET_CUSTOMER', customerName: 'Ram' },
    });
  });

  it('replaces the pending action when the same type is revised', () => {
    expect(
      ingestPendingAction(
        { action: 'SET_CUSTOMER', customerName: 'Ram' },
        [{ action: 'SET_CUSTOMER', customerName: 'Ramesh' }],
      ),
    ).toEqual({
      toApply: [],
      pending: { action: 'SET_CUSTOMER', customerName: 'Ramesh' },
    });
  });

  it('finalizes the pending name when a new action type arrives', () => {
    expect(
      ingestPendingAction(
        { action: 'SET_CUSTOMER', customerName: 'Ramesh' },
        [{ action: 'ADD_ITEM', name: 'ear' }],
      ),
    ).toEqual({
      toApply: [{ action: 'SET_CUSTOMER', customerName: 'Ramesh' }],
      pending: { action: 'ADD_ITEM', name: 'ear' },
    });
  });

  it('replaces ADD_ITEM while the item name is still being spoken', () => {
    expect(
      ingestPendingAction({ action: 'ADD_ITEM', name: 'ear' }, [
        { action: 'ADD_ITEM', name: 'earphone' },
      ]),
    ).toEqual({
      toApply: [],
      pending: { action: 'ADD_ITEM', name: 'earphone' },
    });
  });

  it('commits the prefix of a multi-action reply and keeps the last pending', () => {
    expect(
      ingestPendingAction(null, [
        { action: 'ADD_ITEM', name: 'mango' },
        { action: 'ADD_ITEM', name: 'apple' },
      ]),
    ).toEqual({
      toApply: [{ action: 'ADD_ITEM', name: 'mango' }],
      pending: { action: 'ADD_ITEM', name: 'apple' },
    });
  });

  it('ignores a repeated full hypothesis that restates the open candidate', () => {
    const speaker = { action: 'ADD_ITEM' as const, name: 'speaker' };
    expect(
      ingestPendingAction(speaker, [
        { action: 'SET_CUSTOMER', customerName: 'Ramesh' },
        speaker,
      ]),
    ).toEqual({ toApply: [], pending: speaker });
  });

  it('does not re-apply an action that was already committed this utterance', () => {
    expect(
      ingestPendingAction(
        { action: 'ADD_ITEM', name: 'earphone' },
        [
          { action: 'SET_CUSTOMER', customerName: 'Ramesh' },
          { action: 'ADD_ITEM', name: 'earphone' },
          { action: 'SET_QUANTITY', name: 'earphone', quantity: 2 },
        ],
        [{ action: 'SET_CUSTOMER', customerName: 'Ramesh' }],
      ),
    ).toEqual({
      toApply: [{ action: 'ADD_ITEM', name: 'earphone' }],
      pending: {
        action: 'SET_QUANTITY',
        name: 'earphone',
        quantity: 2,
      },
    });
  });
});

describe('flushPendingAction', () => {
  it('applies the open candidate on isFinal', () => {
    expect(
      flushPendingAction({ action: 'ADD_ITEM', name: 'earphone' }),
    ).toEqual([{ action: 'ADD_ITEM', name: 'earphone' }]);
    expect(flushPendingAction(null)).toEqual([]);
  });

  it('does not flush an action that was already applied', () => {
    const speaker = { action: 'ADD_ITEM', name: 'speaker' };
    expect(flushPendingAction(speaker, [speaker])).toEqual([]);
  });
});
