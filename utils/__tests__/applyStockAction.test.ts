import { ActionName } from '../../types/agentActionResponse';
import { emptyStockDraft } from '../../types/stock';
import {
  applyStockAction,
  isSaveStockAction,
} from '../applyStockAction';

describe('applyStockAction', () => {
    it('sets the item name', () => {
    const next = applyStockAction(emptyStockDraft, [
      { action: ActionName.SET_NAME, name: '  speaker  ' },
    ]);
    expect(next).toEqual({
      name: 'speaker',
      quantity: null,
      costPrice: null,
      sellingPrice: null,
    });
  });

  it('sets quantity without an item name on the action', () => {
    const next = applyStockAction(
      { name: 'speaker', quantity: null, costPrice: null, sellingPrice: null },
      [{ action: ActionName.SET_QUANTITY, quantity: 10 }],
    );
    expect(next).toEqual({
      name: 'speaker',
      quantity: 10,
      costPrice: null,
      sellingPrice: null,
    });
  });

  it('applies a full combo in order', () => {
    const next = applyStockAction(emptyStockDraft, [
      { action: ActionName.SET_NAME, name: 'SL-253' },
      { action: ActionName.SET_QUANTITY, quantity: 20 },
      { action: ActionName.SET_COST, costPrice: 100 },
      { action: ActionName.SET_SELLING, sellingPrice: 150 },
    ]);
    expect(next).toEqual({
      name: 'SL-253',
      quantity: 20,
      costPrice: 100,
      sellingPrice: 150,
    });
  });

  it('clears the draft', () => {
    const next = applyStockAction(
      { name: 'pens', quantity: 10, costPrice: 20, sellingPrice: 35 },
      [{ action: ActionName.CLEAR }],
    );
    expect(next).toEqual(emptyStockDraft);
  });

  it('applies SET_NAME when INCOMPLETE is in the same array', () => {
    const next = applyStockAction(emptyStockDraft, [
      { action: ActionName.SET_NAME, name: 'cheese' },
      { action: ActionName.INCOMPLETE },
    ]);
    expect(next).toEqual({
      name: 'cheese',
      quantity: null,
      costPrice: null,
      sellingPrice: null,
    });
  });

  it('does not change the draft for SAVE', () => {
    const draft = { name: 'pens', quantity: 10, costPrice: 20, sellingPrice: 35 };
    expect(isSaveStockAction([{ action: ActionName.SAVE }])).toBe(true);
    expect(applyStockAction(draft, [{ action: ActionName.SAVE }])).toBeNull();
  });
});
