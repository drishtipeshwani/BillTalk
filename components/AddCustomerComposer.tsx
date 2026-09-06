import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import VoiceComposer from './VoiceComposer';
import { CUSTOMER_SYSTEM_PROMPT_SHORT } from '../utils/customerSystemPrompt';
import {
  DeleteBlockedError,
  DuplicateNameError,
  SaveRecordError,
  deleteCustomer,
  insertCustomer,
  updateCustomer,
} from '../db/queries';
import type { CustomerDraft, CustomerLedgerEntry } from '../types/ledger';
import { emptyCustomerDraft } from '../types/ledger';
import {
  ActionName,
  CustomerActionSchema,
  type CustomerAgentActionResponse,
} from '../types/agentActionResponse';
import { useAuth } from '../utils/authContext';
import {
  applyCustomerAction,
  describeCustomerAction,
  isDeleteCustomerAction,
  isIncompleteCustomerAction,
  isSaveCustomerAction,
  isUnknownCustomerAction,
} from '../utils/applyCustomerAction';
import { formatAmount } from '../utils/currency';
import { useShopData } from '../utils/shopDataContext';
import { waitForSaveFeedback } from '../utils/saveFeedback';
import { useVoiceAgent } from '../utils/useVoiceAgent';
import { styles } from '../screens/LedgerScreen.styles';

function CustomerDraftCard({ draft }: { draft: CustomerDraft }) {
  const hasBalance = draft.balanceAmount != null;
  const isSettled = (draft.balanceAmount ?? 0) <= 0;
  return (
    <View style={styles.row}>
      <Text style={draft.name ? styles.customerName : styles.placeholderName}>
        {draft.name || 'Customer name'}
      </Text>
      <View style={styles.balanceWrap}>
        <Text
          style={[
            hasBalance ? styles.balance : styles.placeholderBalance,
            hasBalance && isSettled && styles.balanceSettled,
          ]}
        >
          {hasBalance ? formatAmount(draft.balanceAmount ?? 0) : '—'}
        </Text>
        <Text style={styles.balanceLabel}>
          {hasBalance ? (isSettled ? 'Settled' : 'Outstanding') : 'Balance'}
        </Text>
      </View>
    </View>
  );
}

interface AddCustomerComposerProps {
  onClose: () => void;
  onSaved?: () => void;
  initialName?: string;
  existingCustomer?: CustomerLedgerEntry;
}

export default function AddCustomerComposer({
  onClose,
  onSaved,
  initialName,
  existingCustomer,
}: AddCustomerComposerProps) {
  const db = useSQLiteContext();
  const { user } = useAuth();
  const { bumpData } = useShopData();
  const [draft, setDraft] = useState<CustomerDraft>(() => {
    if (existingCustomer) {
      return {
        name: existingCustomer.name,
        balanceAmount: existingCustomer.balanceAmount,
      };
    }
    return {
      ...emptyCustomerDraft,
      name: initialName ?? '',
    };
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const draftRef = useRef(draft);
  const persistCustomerRef = useRef<() => Promise<boolean>>(async () => false);
  const deleteCustomerRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const applyResponse = useCallback((response: CustomerAgentActionResponse) => {
    if (isSaveCustomerAction(response)) {
      void persistCustomerRef.current();
      return { label: 'SAVE', updateContext: false };
    }

    if (isDeleteCustomerAction(response)) {
      if (!existingCustomer) {
        return null;
      }
      void deleteCustomerRef.current();
      return { label: 'DELETE_CUSTOMER', updateContext: false };
    }

    const label = describeCustomerAction(response);
    const next = applyCustomerAction(draftRef.current, response);
    if (!next) {
      return null;
    }
    draftRef.current = next;
    setDraft(next);
    return { label };
  }, [existingCustomer]);

  const {
    isSessionActive,
    heardText,
    commandStatus,
    errorMessage,
    modelsReady,
    downloadProgress,
    modelError,
    handleMicPress,
    endSession,
    clearAgentContext,
    showStatus,
  } = useVoiceAgent({
    itemSchema: CustomerActionSchema,
    getSystemPrompt: () => CUSTOMER_SYSTEM_PROMPT_SHORT,
    applyResponse,
    isIncomplete: isIncompleteCustomerAction,
    isUnknown: isUnknownCustomerAction,
    getAssistantContext: () => {
      const name = draftRef.current.name.trim();
      if (!name) {
        return null;
      }
      return [{ action: ActionName.SET_NAME, name }];
    },
  });

  const handleCancel = () => {
    endSession();
    onClose();
  };

  const persistCustomer = useCallback(async (): Promise<boolean> => {
    if (!user) {
      showStatus('Unlock the app to save customers.', true);
      return false;
    }
    if (isSaving) {
      return false;
    }

    setIsSaving(true);
    const startedAt = Date.now();
    try {
      const payload = {
        name: draftRef.current.name,
        balanceAmount: draftRef.current.balanceAmount ?? 0,
      };
      if (existingCustomer) {
        await updateCustomer(db, user.id, existingCustomer.id, payload);
      } else {
        await insertCustomer(db, user.id, payload);
      }
      bumpData();
      clearAgentContext();
      await waitForSaveFeedback(startedAt);
      endSession();
      onSaved?.();
      onClose();
      return true;
    } catch (error) {
      const message =
        error instanceof SaveRecordError || error instanceof DuplicateNameError
          ? error.message
          : 'Could not save the customer. Please try again.';
      showStatus(message, true);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [
    bumpData,
    clearAgentContext,
    db,
    endSession,
    existingCustomer,
    isSaving,
    onClose,
    onSaved,
    showStatus,
    user,
  ]);

  useEffect(() => {
    persistCustomerRef.current = persistCustomer;
  }, [persistCustomer]);

  const handleSave = () => {
    void persistCustomer();
  };

  const performDelete = useCallback(async () => {
    if (!user || !existingCustomer || isDeleting) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteCustomer(db, user.id, existingCustomer.id);
      bumpData();
      endSession();
      onSaved?.();
      onClose();
    } catch (error) {
      const message =
        error instanceof DeleteBlockedError || error instanceof SaveRecordError
          ? error.message
          : 'Could not delete the customer. Please try again.';
      showStatus(message, true);
    } finally {
      setIsDeleting(false);
    }
  }, [
    bumpData,
    db,
    endSession,
    existingCustomer,
    isDeleting,
    onClose,
    onSaved,
    showStatus,
    user,
  ]);

  useEffect(() => {
    deleteCustomerRef.current = performDelete;
  }, [performDelete]);

  const handleDelete = () => {
    if (!existingCustomer) {
      return;
    }
    Alert.alert(
      'Delete customer',
      `Delete "${existingCustomer.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void performDelete();
          },
        },
      ],
    );
  };

  return (
    <VoiceComposer
      title={existingCustomer ? 'Edit customer' : 'New customer'}
      subtitle={
        existingCustomer
          ? 'Speak a command — update name or outstanding balance'
          : 'Speak a command — name and optional opening balance'
      }
      onCancel={handleCancel}
      onSave={handleSave}
      onDelete={existingCustomer ? handleDelete : undefined}
      isDeleting={isDeleting}
      isSaving={isSaving}
      heardText={heardText}
      commandStatus={commandStatus}
      errorMessage={errorMessage}
      modelError={modelError}
      modelsReady={modelsReady}
      downloadProgress={downloadProgress}
      isSessionActive={isSessionActive}
      onMicPress={handleMicPress}
    >
      <CustomerDraftCard draft={draft} />
    </VoiceComposer>
  );
}
