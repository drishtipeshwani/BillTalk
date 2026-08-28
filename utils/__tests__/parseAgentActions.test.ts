import { ActionSchema, StockActionSchema } from '../../types/agentActionResponse';
import { parseValidActions } from '../parseAgentActions';

describe('parseValidActions', () => {
  it('keeps a valid SET_PRICE when a sibling action is hallucinated', () => {
    expect(
      parseValidActions(
        [
          { action: 'SET_PRICE', name: 'greek yoghurt', pricePerItem: 50 },
          { action: 'SET_BAR', name: 'protein bar', barPricePerItem: 20 },
        ],
        ActionSchema,
      ),
    ).toEqual([{ action: 'SET_PRICE', name: 'greek yoghurt', pricePerItem: 50 }]);
  });

  it('keeps every valid action in a mixed invoice reply', () => {
    expect(
      parseValidActions(
        [
          { action: 'SET_PRICE', name: 'greek yoghurt', pricePerItem: 50 },
          { action: 'SET_PRICE', name: 'protein bar', pricePerItem: 20 },
        ],
        ActionSchema,
      ),
    ).toEqual([
      { action: 'SET_PRICE', name: 'greek yoghurt', pricePerItem: 50 },
      { action: 'SET_PRICE', name: 'protein bar', pricePerItem: 20 },
    ]);
  });

  it('keeps SET_NAME when stock price is marked incomplete', () => {
    expect(
      parseValidActions(
        [{ action: 'SET_NAME', name: 'cheese' }, { action: 'INCOMPLETE' }],
        StockActionSchema,
      ),
    ).toEqual([{ action: 'SET_NAME', name: 'cheese' }, { action: 'INCOMPLETE' }]);
  });

  it('wraps a single action object', () => {
    expect(
      parseValidActions(
        { action: 'SET_PRICE', name: 'pens', pricePerItem: 10 },
        ActionSchema,
      ),
    ).toEqual([{ action: 'SET_PRICE', name: 'pens', pricePerItem: 10 }]);
  });

  it('returns null when every action is invalid', () => {
    expect(
      parseValidActions(
        [{ action: 'SET_BAR', name: 'protein bar', barPricePerItem: 20 }],
        ActionSchema,
      ),
    ).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(parseValidActions([], ActionSchema)).toBeNull();
  });
});
