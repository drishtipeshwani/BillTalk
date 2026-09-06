import { ActionName } from '../../types/agentActionResponse';
import { emptyCustomerDraft } from '../../types/ledger';
import {
  applyCustomerAction,
  isDeleteCustomerAction,
  isSaveCustomerAction,
} from '../applyCustomerAction';

describe('applyCustomerAction', () => {
  it('sets the customer name', () => {
    const next = applyCustomerAction(emptyCustomerDraft, [
      { action: ActionName.SET_NAME, name: '  Ramesh  ' },
    ]);
    expect(next).toEqual({ name: 'Ramesh', balanceAmount: null });
  });

  it('sets balance without clearing an existing name', () => {
    const next = applyCustomerAction(
      { name: 'Ramesh', balanceAmount: null },
      [{ action: ActionName.SET_BALANCE, balanceAmount: 0 }],
    );
    expect(next).toEqual({ name: 'Ramesh', balanceAmount: 0 });
  });

  it('applies name and balance in order', () => {
    const next = applyCustomerAction(emptyCustomerDraft, [
      { action: ActionName.SET_NAME, name: 'Amit' },
      { action: ActionName.SET_BALANCE, balanceAmount: 1200 },
    ]);
    expect(next).toEqual({ name: 'Amit', balanceAmount: 1200 });
  });

  it('clears the draft', () => {
    const next = applyCustomerAction(
      { name: 'Ramesh', balanceAmount: 500 },
      [{ action: ActionName.CLEAR }],
    );
    expect(next).toEqual(emptyCustomerDraft);
  });

  it('does not change the draft for SAVE', () => {
    const draft = { name: 'Ramesh', balanceAmount: 500 };
    expect(isSaveCustomerAction([{ action: ActionName.SAVE }])).toBe(true);
    expect(applyCustomerAction(draft, [{ action: ActionName.SAVE }])).toBeNull();
  });

  it('treats DELETE_CUSTOMER as a side-effect action', () => {
    const draft = { name: 'Ramesh', balanceAmount: 500 };
    expect(
      isDeleteCustomerAction([{ action: ActionName.DELETE_CUSTOMER }]),
    ).toBe(true);
    expect(
      applyCustomerAction(draft, [{ action: ActionName.DELETE_CUSTOMER }]),
    ).toBeNull();
    expect(
      applyCustomerAction(draft, [
        { action: ActionName.DELETE_CUSTOMER, name: 'Ramesh' },
      ]),
    ).toBeNull();
  });
});
