import {
  ActionName,
  type CustomerAction,
  type CustomerAgentActionResponse,
} from '../types/agentActionResponse';
import type { CustomerDraft } from '../types/ledger';
import { emptyCustomerDraft } from '../types/ledger';
import { normalizeEntityName } from './entityName';

function applyOneAction(draft: CustomerDraft, action: CustomerAction): CustomerDraft | null {
  switch (action.action) {
    case ActionName.SET_NAME:
      return { ...draft, name: normalizeEntityName(action.name) };
    case ActionName.SET_BALANCE:
      return { ...draft, balanceAmount: action.balanceAmount };
    case ActionName.CLEAR:
      return { ...emptyCustomerDraft };
    case ActionName.SAVE:
    case ActionName.DELETE_CUSTOMER:
    case ActionName.UNKNOWN:
    case ActionName.INCOMPLETE:
      return null;
  }
}

export function isIncompleteCustomerAction(response: CustomerAgentActionResponse): boolean {
  return response.length === 1 && response[0].action === ActionName.INCOMPLETE;
}

export function isUnknownCustomerAction(response: CustomerAgentActionResponse): boolean {
  return response.length === 1 && response[0].action === ActionName.UNKNOWN;
}

export function isSaveCustomerAction(response: CustomerAgentActionResponse): boolean {
  return response.length === 1 && response[0].action === ActionName.SAVE;
}

export function isDeleteCustomerAction(response: CustomerAgentActionResponse): boolean {
  return response.length === 1 && response[0].action === ActionName.DELETE_CUSTOMER;
}

export function applyCustomerAction(
  draft: CustomerDraft,
  response: CustomerAgentActionResponse,
): CustomerDraft | null {
  if (
    isIncompleteCustomerAction(response) ||
    isUnknownCustomerAction(response) ||
    isDeleteCustomerAction(response)
  ) {
    return null;
  }

  let next = draft;
  let changed = false;

  for (const action of response) {
    if (action.action === ActionName.SAVE || action.action === ActionName.DELETE_CUSTOMER) {
      continue;
    }
    const applied = applyOneAction(next, action);
    if (applied) {
      next = applied;
      changed = true;
    }
  }

  return changed ? next : null;
}

export function describeCustomerAction(response: CustomerAgentActionResponse): string {
  if (isIncompleteCustomerAction(response)) return 'incomplete';
  if (isUnknownCustomerAction(response)) return 'unknown';
  return response.map((action) => action.action).join('+');
}
