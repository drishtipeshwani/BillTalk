import { ActionName } from '../../types/agentActionResponse';
import { emptyInvoice } from '../../data/emptyInvoice';
import type { Invoice } from '../../types/invoice';
import { applySingleInvoiceAction } from '../applyInvoiceAction';

const invoice: Invoice = {
  ...emptyInvoice,
  companyName: 'Shop',
};

describe('applySingleInvoiceAction unique item names', () => {
  it('does not add a second row when ADD_ITEM repeats a name', () => {
    const withSpeaker = applySingleInvoiceAction(invoice, {
      action: ActionName.ADD_ITEM,
      name: 'speaker',
      quantity: 1,
    });
    const again = applySingleInvoiceAction(withSpeaker!, {
      action: ActionName.ADD_ITEM,
      name: 'Speaker',
      pricePerItem: 450,
    });

    expect(again?.items).toHaveLength(1);
    expect(again?.items[0]).toMatchObject({
      name: 'speaker',
      quantity: 1,
      pricePerItem: 450,
    });
  });

  it('merges a rename onto the existing row of that name', () => {
    const withBoth = {
      ...invoice,
      items: [
        {
          name: 'speaker',
          quantity: 1,
          pricePerItem: 100,
          discountPercent: null,
          discountAmount: null,
        },
        {
          name: 'Speaker Mini',
          quantity: 2,
          pricePerItem: 50,
          discountPercent: null,
          discountAmount: null,
        },
      ],
    };

    const renamed = applySingleInvoiceAction(withBoth, {
      action: ActionName.RENAME_ITEM,
      name: 'Speaker Mini',
      updatedItemName: 'speaker',
    });

    expect(renamed?.items).toHaveLength(1);
    expect(renamed?.items[0]).toMatchObject({
      name: 'speaker',
      quantity: 1,
      pricePerItem: 100,
    });
  });

  it('collapses duplicate rows already on the invoice', () => {
    const withDupes = {
      ...invoice,
      items: [
        {
          name: 'speaker',
          quantity: 1,
          pricePerItem: null,
          discountPercent: null,
          discountAmount: null,
        },
        {
          name: 'Speaker',
          quantity: null,
          pricePerItem: 450,
          discountPercent: null,
          discountAmount: null,
        },
      ],
    };

    const next = applySingleInvoiceAction(withDupes, {
      action: ActionName.SET_QUANTITY,
      name: 'speaker',
      quantity: 3,
    });

    expect(next?.items).toHaveLength(1);
    expect(next?.items[0]).toMatchObject({
      name: 'speaker',
      quantity: 3,
      pricePerItem: 450,
    });
  });

  it('deletes a named line item', () => {
    const withItem = applySingleInvoiceAction(invoice, {
      action: ActionName.ADD_ITEM,
      name: 'cheese',
      quantity: 1,
    });
    const next = applySingleInvoiceAction(withItem!, {
      action: ActionName.DELETE_ITEM,
      name: 'cheese',
    });
    expect(next?.items).toHaveLength(0);
  });

  it('deletes the current (last named) item when DELETE_ITEM omits name', () => {
    const withItems = {
      ...invoice,
      items: [
        {
          name: 'milk',
          quantity: 1,
          pricePerItem: 40,
          discountPercent: null,
          discountAmount: null,
        },
        {
          name: 'cheese',
          quantity: 2,
          pricePerItem: 80,
          discountPercent: null,
          discountAmount: null,
        },
      ],
    };
    const next = applySingleInvoiceAction(withItems, {
      action: ActionName.DELETE_ITEM,
    });
    expect(next?.items).toEqual([
      {
        name: 'milk',
        quantity: 1,
        pricePerItem: 40,
        discountPercent: null,
        discountAmount: null,
      },
    ]);
  });
});
