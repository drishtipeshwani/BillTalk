import { z } from 'zod';

export const ActionName = {
  ADD_ITEM: 'ADD_ITEM',
  DELETE_ITEM: 'DELETE_ITEM',
  SET_PRICE: 'SET_PRICE',
  SET_QUANTITY: 'SET_QUANTITY',
  RENAME_ITEM: 'RENAME_ITEM',
  SET_ITEM_DISCOUNT: 'SET_ITEM_DISCOUNT',
  SET_INVOICE_DISCOUNT: 'SET_INVOICE_DISCOUNT',
  SET_DATE: 'SET_DATE',
  SET_CUSTOMER: 'SET_CUSTOMER',
  SET_COMPANY: 'SET_COMPANY',
  CLEAR_INVOICE: 'CLEAR_INVOICE',
  SAVE_INVOICE: 'SAVE_INVOICE',
  DELETE_INVOICE: 'DELETE_INVOICE',
  SET_NAME: 'SET_NAME',
  SET_BALANCE: 'SET_BALANCE',
  SET_COST: 'SET_COST',
  SET_SELLING: 'SET_SELLING',
  CLEAR: 'CLEAR',
  SAVE: 'SAVE',
  DELETE_CUSTOMER: 'DELETE_CUSTOMER',
  UNKNOWN: 'UNKNOWN',
  INCOMPLETE: 'INCOMPLETE',
} as const;

export type ActionName = (typeof ActionName)[keyof typeof ActionName];

export const AddItemActionSchema = z
  .object({
    action: z.literal(ActionName.ADD_ITEM),
    name: z.string(),
    quantity: z.number().optional(),
    pricePerItem: z.number().optional(),
    discountPercent: z.number().min(0).max(100).optional(),
    discountAmount: z.number().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.discountPercent === undefined || value.discountAmount === undefined,
    { message: 'percent and amount discounts cannot both be set' },
  );

export const DeleteItemActionSchema = z
  .object({
    action: z.literal(ActionName.DELETE_ITEM),
    name: z.string().optional(),
  })
  .strict();

export const SetPriceActionSchema = z
  .object({
    action: z.literal(ActionName.SET_PRICE),
    name: z.string(),
    pricePerItem: z.number(),
  })
  .strict();

export const SetQuantityActionSchema = z
  .object({
    action: z.literal(ActionName.SET_QUANTITY),
    name: z.string(),
    quantity: z.number(),
  })
  .strict();

export const RenameItemActionSchema = z
  .object({
    action: z.literal(ActionName.RENAME_ITEM),
    name: z.string(),
    updatedItemName: z.string(),
  })
  .strict();

export const SetItemDiscountActionSchema = z.union([
  z
    .object({
      action: z.literal(ActionName.SET_ITEM_DISCOUNT),
      name: z.string(),
      discountPercent: z.number().min(0).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal(ActionName.SET_ITEM_DISCOUNT),
      name: z.string(),
      discountAmount: z.number(),
    })
    .strict(),
]);

export const SetInvoiceDiscountActionSchema = z.union([
  z
    .object({
      action: z.literal(ActionName.SET_INVOICE_DISCOUNT),
      invoiceDiscountPercent: z.number().min(0).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal(ActionName.SET_INVOICE_DISCOUNT),
      invoiceDiscountAmount: z.number(),
    })
    .strict(),
]);

export const SetDateActionSchema = z
  .object({
    action: z.literal(ActionName.SET_DATE),
    invoiceDate: z.string(),
  })
  .strict();

export const SetCustomerActionSchema = z
  .object({
    action: z.literal(ActionName.SET_CUSTOMER),
    customerName: z.string(),
  })
  .strict();

export const SetCompanyActionSchema = z
  .object({
    action: z.literal(ActionName.SET_COMPANY),
    companyName: z.string(),
  })
  .strict();

export const ClearInvoiceActionSchema = z
  .object({
    action: z.literal(ActionName.CLEAR_INVOICE),
  })
  .strict();

export const SaveInvoiceActionSchema = z
  .object({
    action: z.literal(ActionName.SAVE_INVOICE),
  })
  .strict();

export const DeleteInvoiceActionSchema = z
  .object({
    action: z.literal(ActionName.DELETE_INVOICE),
  })
  .strict();

export const UnknownActionSchema = z
  .object({
    action: z.literal(ActionName.UNKNOWN),
  })
  .strict();

export const IncompleteActionSchema = z
  .object({
    action: z.literal(ActionName.INCOMPLETE),
  })
  .strict();

export const SetNameActionSchema = z
  .object({
    action: z.literal(ActionName.SET_NAME),
    name: z.string(),
  })
  .strict();

export const SetBalanceActionSchema = z
  .object({
    action: z.literal(ActionName.SET_BALANCE),
    balanceAmount: z.number(),
  })
  .strict();

export const StockSetQuantityActionSchema = z
  .object({
    action: z.literal(ActionName.SET_QUANTITY),
    quantity: z.number(),
  })
  .strict();

export const SetCostActionSchema = z
  .object({
    action: z.literal(ActionName.SET_COST),
    costPrice: z.number(),
  })
  .strict();

export const SetSellingActionSchema = z
  .object({
    action: z.literal(ActionName.SET_SELLING),
    sellingPrice: z.number(),
  })
  .strict();

export const ClearActionSchema = z
  .object({
    action: z.literal(ActionName.CLEAR),
  })
  .strict();

export const SaveActionSchema = z
  .object({
    action: z.literal(ActionName.SAVE),
  })
  .strict();

export const DeleteCustomerActionSchema = z
  .object({
    action: z.literal(ActionName.DELETE_CUSTOMER),
    name: z.string().optional(),
  })
  .strict();

export const ActionSchema = z.union([
  AddItemActionSchema,
  DeleteItemActionSchema,
  SetPriceActionSchema,
  SetQuantityActionSchema,
  RenameItemActionSchema,
  SetItemDiscountActionSchema,
  SetInvoiceDiscountActionSchema,
  SetDateActionSchema,
  SetCustomerActionSchema,
  SetCompanyActionSchema,
  ClearInvoiceActionSchema,
  SaveInvoiceActionSchema,
  DeleteInvoiceActionSchema,
  UnknownActionSchema,
  IncompleteActionSchema,
]);

export type Action = z.infer<typeof ActionSchema>;

export const AgentActionResponseSchema = z.array(ActionSchema).min(1);

export type AgentActionResponse = z.infer<typeof AgentActionResponseSchema>;

export const CustomerActionSchema = z.union([
  SetNameActionSchema,
  SetBalanceActionSchema,
  ClearActionSchema,
  SaveActionSchema,
  DeleteCustomerActionSchema,
  UnknownActionSchema,
  IncompleteActionSchema,
]);

export type CustomerAction = z.infer<typeof CustomerActionSchema>;

export const CustomerAgentActionResponseSchema = z.array(CustomerActionSchema).min(1);

export type CustomerAgentActionResponse = z.infer<
  typeof CustomerAgentActionResponseSchema
>;

export const StockActionSchema = z.union([
  SetNameActionSchema,
  StockSetQuantityActionSchema,
  SetCostActionSchema,
  SetSellingActionSchema,
  ClearActionSchema,
  SaveActionSchema,
  UnknownActionSchema,
  IncompleteActionSchema,
]);

export type StockAction = z.infer<typeof StockActionSchema>;

export const StockAgentActionResponseSchema = z.array(StockActionSchema).min(1);

export type StockAgentActionResponse = z.infer<typeof StockAgentActionResponseSchema>;
