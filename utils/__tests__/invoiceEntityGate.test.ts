import { ActionName } from '../../types/agentActionResponse';
import { emptyInvoice } from '../../data/emptyInvoice';
import type { Invoice } from '../../types/invoice';
import {
  catalogRequirement,
  processGatedInvoiceActions,
} from '../invoiceEntityGate';

const invoice: Invoice = {
  ...emptyInvoice,
  companyName: 'Shop',
};

describe('catalogRequirement', () => {
  it('gates SET_CUSTOMER', () => {
    expect(catalogRequirement(invoice, {
      action: ActionName.SET_CUSTOMER,
      customerName: '  Ramesh  ',
    })).toEqual({ kind: 'customer', name: 'Ramesh' });
  });

  it('gates ADD_ITEM', () => {
    expect(catalogRequirement(invoice, {
      action: ActionName.ADD_ITEM,
      name: 'pens',
    })).toEqual({ kind: 'stock', name: 'pens' });
  });

  it('does not gate SET_PRICE when the line already exists', () => {
    const withPens: Invoice = {
      ...invoice,
      items: [{
        name: 'pens',
        quantity: 1,
        pricePerItem: 10,
        discountPercent: null,
        discountAmount: null,
      }],
    };
    expect(catalogRequirement(withPens, {
      action: ActionName.SET_PRICE,
      name: 'pens',
      pricePerItem: 20,
    })).toBeNull();
  });

  it('gates SET_PRICE when the line would be created', () => {
    expect(catalogRequirement(invoice, {
      action: ActionName.SET_PRICE,
      name: 'pens',
      pricePerItem: 20,
    })).toEqual({ kind: 'stock', name: 'pens' });
  });

  it('gates RENAME_ITEM to the new name', () => {
    expect(catalogRequirement(invoice, {
      action: ActionName.RENAME_ITEM,
      name: 'pens',
      updatedItemName: 'notebooks',
    })).toEqual({ kind: 'stock', name: 'notebooks' });
  });
});

describe('processGatedInvoiceActions', () => {
  it('applies actions until a missing catalog name', async () => {
    const result = await processGatedInvoiceActions(
      invoice,
      [
        { action: ActionName.SET_INVOICE_DISCOUNT, invoiceDiscountPercent: 5 },
        { action: ActionName.SET_CUSTOMER, customerName: 'Ramesh' },
        { action: ActionName.ADD_ITEM, name: 'pens' },
      ],
      {
        customerExists: async () => false,
        stockItemExists: async () => true,
      },
    );

    expect(result.changed).toBe(true);
    expect(result.invoice.invoiceDiscountPercent).toBe(5);
    expect(result.invoice.customerName).toBe('');
    expect(result.prompt).toMatchObject({
      kind: 'customer',
      name: 'Ramesh',
    });
    expect(result.prompt?.remaining).toEqual([
      { action: ActionName.ADD_ITEM, name: 'pens' },
    ]);
  });

  it('applies the full array when every name exists', async () => {
    const result = await processGatedInvoiceActions(
      invoice,
      [
        { action: ActionName.SET_CUSTOMER, customerName: 'Ramesh' },
        { action: ActionName.ADD_ITEM, name: 'pens', quantity: 2 },
      ],
      {
        customerExists: async () => true,
        stockItemExists: async () => true,
      },
    );

    expect(result.prompt).toBeNull();
    expect(result.invoice.customerName).toBe('Ramesh');
    expect(result.invoice.items[0]?.name).toBe('pens');
  });

  it('keeps one row when ADD_ITEM repeats a catalog name', async () => {
    const result = await processGatedInvoiceActions(
      invoice,
      [
        { action: ActionName.ADD_ITEM, name: 'pens', quantity: 1 },
        { action: ActionName.ADD_ITEM, name: 'Pens', pricePerItem: 10 },
      ],
      {
        customerExists: async () => true,
        stockItemExists: async () => true,
      },
    );

    expect(result.prompt).toBeNull();
    expect(result.invoice.items).toHaveLength(1);
    expect(result.invoice.items[0]).toMatchObject({
      name: 'pens',
      quantity: 1,
      pricePerItem: 10,
    });
  });

  it('applies each SET_PRICE independently when both items exist', async () => {
    const withItems: Invoice = {
      ...invoice,
      items: [
        {
          name: 'greek yoghurt',
          quantity: 10,
          pricePerItem: null,
          discountPercent: null,
          discountAmount: null,
        },
        {
          name: 'protein bar',
          quantity: 5,
          pricePerItem: null,
          discountPercent: null,
          discountAmount: null,
        },
      ],
    };

    const result = await processGatedInvoiceActions(
      withItems,
      [
        { action: ActionName.SET_PRICE, name: 'greek yoghurt', pricePerItem: 50 },
        { action: ActionName.DELETE_ITEM, name: 'missing item' },
        { action: ActionName.SET_PRICE, name: 'protein bar', pricePerItem: 20 },
      ],
      {
        customerExists: async () => true,
        stockItemExists: async () => true,
      },
    );

    expect(result.prompt).toBeNull();
    expect(result.invoice.items[0]?.pricePerItem).toBe(50);
    expect(result.invoice.items[1]?.pricePerItem).toBe(20);
    expect(result.applied).toEqual([
      { action: ActionName.SET_PRICE, name: 'greek yoghurt', pricePerItem: 50 },
      { action: ActionName.SET_PRICE, name: 'protein bar', pricePerItem: 20 },
    ]);
  });

  it('treats SET_COMPANY as SET_CUSTOMER', async () => {
    const result = await processGatedInvoiceActions(
      invoice,
      [{ action: ActionName.SET_COMPANY, companyName: 'Achi Enterprises' }],
      {
        customerExists: async (name) => name === 'Achi Enterprises',
        stockItemExists: async () => true,
      },
    );

    expect(result.prompt).toBeNull();
    expect(result.invoice.customerName).toBe('Achi Enterprises');
    expect(result.invoice.companyName).toBe('Shop');
  });

  it('rewrites a spoken stock name to the catalog spelling', async () => {
    const result = await processGatedInvoiceActions(
      invoice,
      [{ action: ActionName.ADD_ITEM, name: 'yoghurt' }],
      {
        customerExists: async () => true,
        stockItemExists: async (name) => name === 'Yogurt',
        stockNames: async () => ['Yogurt'],
      },
    );

    expect(result.prompt).toBeNull();
    expect(result.invoice.items[0]?.name).toBe('Yogurt');
  });

  it('rewrites a spoken customer name to the ledger spelling', async () => {
    const result = await processGatedInvoiceActions(
      invoice,
      [{ action: ActionName.SET_CUSTOMER, customerName: 'Rames' }],
      {
        customerExists: async (name) => name === 'Ramesh',
        stockItemExists: async () => true,
        customerNames: async () => ['Ramesh'],
      },
    );

    expect(result.prompt).toBeNull();
    expect(result.invoice.customerName).toBe('Ramesh');
  });
});
