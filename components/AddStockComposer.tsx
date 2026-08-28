import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import VoiceComposer from './VoiceComposer';
import { STOCK_SYSTEM_PROMPT_SHORT } from '../utils/stockSystemPrompt';
import {
  DuplicateNameError,
  SaveRecordError,
  insertStockItem,
  updateStockItem,
} from '../db/queries';
import type { StockDraft, StockItem } from '../types/stock';
import { emptyStockDraft } from '../types/stock';
import {
  ActionName,
  StockActionSchema,
  type StockAgentActionResponse,
} from '../types/agentActionResponse';
import { useAuth } from '../utils/authContext';
import {
  applyStockAction,
  describeStockAction,
  isIncompleteStockAction,
  isSaveStockAction,
  isUnknownStockAction,
} from '../utils/applyStockAction';
import { formatAmount } from '../utils/currency';
import { useShopData } from '../utils/shopDataContext';
import { waitForSaveFeedback } from '../utils/saveFeedback';
import { useVoiceAgent } from '../utils/useVoiceAgent';
import { styles } from '../screens/InventoryScreen.styles';

function StockDraftCard({ draft }: { draft: StockDraft }) {
  return (
    <View style={styles.card}>
      <Text style={draft.name ? styles.itemName : styles.placeholderName}>
        {draft.name || 'Item name'}
      </Text>
      <View style={styles.divider} />
      <View style={styles.bottomRow}>
        <View style={styles.priceBlock}>
          <Text style={styles.priceLabel}>Quantity</Text>
          <Text style={draft.quantity != null ? styles.priceValue : styles.placeholderValue}>
            {draft.quantity != null ? draft.quantity : '—'}
          </Text>
        </View>
        <View style={styles.priceBlock}>
          <Text style={styles.priceLabel}>Cost Price</Text>
          <Text style={draft.costPrice != null ? styles.priceValue : styles.placeholderValue}>
            {draft.costPrice != null ? formatAmount(draft.costPrice) : '—'}
          </Text>
        </View>
        <View style={styles.priceBlock}>
          <Text style={styles.priceLabel}>Selling Price</Text>
          <Text style={draft.sellingPrice != null ? styles.priceValue : styles.placeholderValue}>
            {draft.sellingPrice != null ? formatAmount(draft.sellingPrice) : '—'}
          </Text>
        </View>
      </View>
    </View>
  );
}

interface AddStockComposerProps {
  onClose: () => void;
  onSaved?: () => void;
  initialName?: string;
  existingItem?: StockItem;
}

export default function AddStockComposer({
  onClose,
  onSaved,
  initialName,
  existingItem,
}: AddStockComposerProps) {
  const db = useSQLiteContext();
  const { user } = useAuth();
  const { bumpData } = useShopData();
  const [draft, setDraft] = useState<StockDraft>(() => {
    if (existingItem) {
      return {
        name: existingItem.name,
        quantity: existingItem.quantity,
        costPrice: existingItem.costPrice,
        sellingPrice: existingItem.sellingPrice,
      };
    }
    return {
      ...emptyStockDraft,
      name: initialName ?? '',
    };
  });
  const [isSaving, setIsSaving] = useState(false);
  const draftRef = useRef(draft);
  const persistStockRef = useRef<() => Promise<boolean>>(async () => false);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const applyResponse = useCallback((response: StockAgentActionResponse) => {
    if (isSaveStockAction(response)) {
      void persistStockRef.current();
      return { label: 'SAVE', updateContext: false };
    }

    const label = describeStockAction(response);
    const next = applyStockAction(draftRef.current, response);
    if (!next) {
      return null;
    }
    draftRef.current = next;
    setDraft(next);
    return { label };
  }, []);

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
    itemSchema: StockActionSchema,
    getSystemPrompt: () => STOCK_SYSTEM_PROMPT_SHORT,
    applyResponse,
    isIncomplete: isIncompleteStockAction,
    isUnknown: isUnknownStockAction,
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

  const persistStock = useCallback(async (): Promise<boolean> => {
    if (!user) {
      showStatus('Unlock the app to save stock items.', true);
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
        quantity: draftRef.current.quantity ?? 0,
        costPrice: draftRef.current.costPrice ?? 0,
        sellingPrice: draftRef.current.sellingPrice ?? 0,
      };
      if (existingItem) {
        await updateStockItem(db, user.id, existingItem.id, payload);
      } else {
        await insertStockItem(db, user.id, payload);
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
          : 'Could not save the stock item. Please try again.';
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
    existingItem,
    isSaving,
    onClose,
    onSaved,
    showStatus,
    user,
  ]);

  useEffect(() => {
    persistStockRef.current = persistStock;
  }, [persistStock]);

  const handleSave = () => {
    void persistStock();
  };

  return (
    <VoiceComposer
      title={existingItem ? 'Edit stock item' : 'New stock item'}
      subtitle="Speak a command — name, quantity, cost, selling price"
      onCancel={handleCancel}
      onSave={handleSave}
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
      <StockDraftCard draft={draft} />
    </VoiceComposer>
  );
}
