import { LFM2_5_350M } from 'react-native-executorch';

const FINETUNED_PTE = process.env.EXPO_PUBLIC_INVOICE_PTE;
const parsedPteUrl = URL.parse(FINETUNED_PTE);

if (!parsedPteUrl || parsedPteUrl.protocol !== 'https:') {
  throw new Error(
    'EXPO_PUBLIC_INVOICE_PTE must be an https:// URL pointing to the repository ' +
      'where the fine-tuned invoice model .pte is present. Add it to your .env ' +
      '(see finetune_actions/README.md) and rebuild — there is no default fallback.',
  );
}

export const INVOICE_LLM_MODEL = {
  ...LFM2_5_350M,
  modelName: 'lfm2.5-350m' as const,
  modelSource: FINETUNED_PTE,
};
