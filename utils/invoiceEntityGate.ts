import {
  ActionName,
  type Action,
  type AgentActionResponse,
} from '../types/agentActionResponse';
import type { Invoice } from '../types/invoice';
import {
  applySingleInvoiceAction,
  invoiceHasItem,
} from './applyInvoiceAction';
import { fuzzyMatchEntityName, normalizeEntityName } from './entityName';

export type CatalogKind = 'customer' | 'stock';

export interface EntityPrompt {
  kind: CatalogKind;
  name: string;
  action: Action;
  remaining: Action[];
}

export interface GatedApplyResult {
  invoice: Invoice;
  changed: boolean;
  prompt: EntityPrompt | null;
  applied: Action[];
}

export function rewriteCompanyAsCustomer(action: Action): Action {
  if (action.action !== ActionName.SET_COMPANY) {
    return action;
  }
  return {
    action: ActionName.SET_CUSTOMER,
    customerName: action.companyName,
  };
}

export function catalogRequirement(
  invoice: Invoice,
  action: Action,
): { kind: CatalogKind; name: string } | null {
  switch (action.action) {
    case ActionName.SET_CUSTOMER: {
      const name = normalizeEntityName(action.customerName);
      if (!name) {
        return null;
      }
      return { kind: 'customer', name };
    }
    case ActionName.ADD_ITEM: {
      const name = normalizeEntityName(action.name);
      if (!name) {
        return null;
      }
      return { kind: 'stock', name };
    }
    case ActionName.SET_PRICE:
    case ActionName.SET_QUANTITY:
    case ActionName.SET_ITEM_DISCOUNT: {
      const name = normalizeEntityName(action.name);
      if (!name) {
        return null;
      }
      if (invoiceHasItem(invoice, name)) {
        return null;
      }
      return { kind: 'stock', name };
    }
    case ActionName.RENAME_ITEM: {
      const name = normalizeEntityName(action.updatedItemName);
      if (!name) {
        return null;
      }
      return { kind: 'stock', name };
    }
    default:
      return null;
  }
}

export interface CatalogLookup {
  customerExists: (name: string) => Promise<boolean>;
  stockItemExists: (name: string) => Promise<boolean>;
  customerNames?: () => Promise<string[]>;
  stockNames?: () => Promise<string[]>;
}

export function rewriteActionEntityName(action: Action, name: string): Action {
  switch (action.action) {
    case ActionName.SET_CUSTOMER:
      return { ...action, customerName: name };
    case ActionName.ADD_ITEM:
    case ActionName.DELETE_ITEM:
    case ActionName.SET_PRICE:
    case ActionName.SET_QUANTITY:
    case ActionName.SET_ITEM_DISCOUNT:
      return { ...action, name };
    case ActionName.RENAME_ITEM:
      return { ...action, updatedItemName: name };
    default:
      return action;
  }
}

async function resolveCatalogName(
  invoice: Invoice,
  kind: CatalogKind,
  spoken: string,
  lookup: CatalogLookup,
  namesCache: { customer: string[] | null; stock: string[] | null },
): Promise<string> {
  if (kind === 'customer') {
    if (!namesCache.customer && lookup.customerNames) {
      namesCache.customer = await lookup.customerNames();
    }
    return fuzzyMatchEntityName(spoken, namesCache.customer ?? []) ?? spoken;
  }

  const invoiceNames = invoice.items.map((item) => item.name).filter(Boolean);
  if (!namesCache.stock && lookup.stockNames) {
    namesCache.stock = await lookup.stockNames();
  }
  return (
    fuzzyMatchEntityName(spoken, [
      ...invoiceNames,
      ...(namesCache.stock ?? []),
    ]) ?? spoken
  );
}

export async function processGatedInvoiceActions(
  invoice: Invoice,
  actions: AgentActionResponse,
  lookup: CatalogLookup,
): Promise<GatedApplyResult> {
  let next = invoice;
  let changed = false;
  const applied: Action[] = [];
  const namesCache: { customer: string[] | null; stock: string[] | null } = {
    customer: null,
    stock: null,
  };

  for (let index = 0; index < actions.length; index += 1) {
    let action = rewriteCompanyAsCustomer(actions[index]);
    if (action.action === ActionName.SAVE_INVOICE) {
      continue;
    }

    const requirement = catalogRequirement(next, action);
    if (requirement) {
      const resolvedName = await resolveCatalogName(
        next,
        requirement.kind,
        requirement.name,
        lookup,
        namesCache,
      );
      if (resolvedName !== requirement.name) {
        action = rewriteActionEntityName(action, resolvedName);
      }
      const exists =
        requirement.kind === 'customer'
          ? await lookup.customerExists(resolvedName)
          : await lookup.stockItemExists(resolvedName);
      if (!exists) {
        return {
          invoice: next,
          changed,
          applied,
          prompt: {
            kind: requirement.kind,
            name: resolvedName,
            action,
            remaining: actions.slice(index + 1).map(rewriteCompanyAsCustomer),
          },
        };
      }
    } else if (
      action.action === ActionName.DELETE_ITEM ||
      action.action === ActionName.SET_PRICE ||
      action.action === ActionName.SET_QUANTITY ||
      action.action === ActionName.SET_ITEM_DISCOUNT
    ) {
      const spoken = normalizeEntityName(action.name);
      if (spoken) {
        const resolvedName = await resolveCatalogName(
          next,
          'stock',
          spoken,
          lookup,
          namesCache,
        );
        if (resolvedName !== spoken) {
          action = rewriteActionEntityName(action, resolvedName);
        }
      }
    } else if (action.action === ActionName.RENAME_ITEM) {
      const fromName = normalizeEntityName(action.name);
      if (fromName) {
        const resolvedFrom = await resolveCatalogName(
          next,
          'stock',
          fromName,
          lookup,
          namesCache,
        );
        if (resolvedFrom !== fromName) {
          action = { ...action, name: resolvedFrom };
        }
      }
      const toName = normalizeEntityName(action.updatedItemName);
      if (toName) {
        const resolvedTo = await resolveCatalogName(
          next,
          'stock',
          toName,
          lookup,
          namesCache,
        );
        if (resolvedTo !== toName) {
          action = { ...action, updatedItemName: resolvedTo };
        }
      }
    }

    const appliedInvoice = applySingleInvoiceAction(next, action);
    if (appliedInvoice) {
      next = appliedInvoice;
      changed = true;
      applied.push(action);
    }
  }

  return { invoice: next, changed, prompt: null, applied };
}
