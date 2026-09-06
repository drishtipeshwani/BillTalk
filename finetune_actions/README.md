# Fine-tuning LFM2.5-350M for Structured Actions

## Overview

- **Goal** — Fine-tune LiquidAI's LFM2.5-350M to turn English voice utterances into **structured action arrays** for three tasks: creating invoices, updating stock inventory, and maintaining customer ledgers.
- **Context resolution** — Training also teaches the model to use the previous turn's response to interpret the current utterance correctly.
- **Why fine-tune?** Off-the-shelf small models could not reliably produce the right actions and the output structure the app depends on. They hallucinated the shape of the response (unwrapped arrays, half-filled item objects), which failed schema validation and broke downstream app logic. Fine-tuning teaches the model both the exact structure and what to populate for a given prompt.
- **Method** — PEFT with a LoRA adapter. Each training row mirrors the real runtime scenario exactly: the model receives a system prompt, the previous conversational context, and the current utterance, then emits a response — an array of actions, each with the parameters it modifies.
- **Data** — Kept in three splits: `train`, `val`, and `test`.



## How a training row maps to runtime

A raw row looks like this:

```json
{"lastModified": null,
 "userInput": "add item pens quantity 10 price 50",
 "agentOutput": {"modifiedCompanyName": null, "...": "..."},
 "meta": {"conversationId": "single-3", "turnIndex": 0, "tags": ["add_item", "single"]}}
```

- `lastModified` is the previous agent response — exactly what `HomeScreen` keeps in `lastSuccessfulAgentResponseRef`. It is `null` on a cold start.
- `agentOutput` is the target label the model must learn to produce.
- `meta` is bookkeeping for splitting and coverage analysis; it is stripped before training.

`to_chat.py` (also invoked internally by `generate_dataset.py`) expands each row into the exact message window the app builds at runtime:

```
system    -> the task's system prompt
assistant -> JSON.stringify(lastModified)   (omitted when null)
user      -> transcript
assistant -> target JSON                    (the training label)
```



## Environment

```bash
python3 -m venv finetune_actions/.venv
finetune_actions/.venv/bin/pip install -r finetune_actions/requirements.txt
```



## Build the dataset and train

```bash
# 1. Generate splits (writes both .jsonl and derived .chat.jsonl)
python3 finetune_actions/generate_dataset.py --seed 20260817 --total 7300

# 2. Validate rows and confirm the handwritten eval set never leaks into training
python3 finetune_actions/validate_dataset.py finetune_actions/data/*.jsonl \
  --holdout finetune_actions/data/eval_handwritten.jsonl

# 3. Convert the handwritten holdout to the chat window (the splits above are already converted)
python3 finetune_actions/to_chat.py finetune_actions/data/eval_handwritten.jsonl \
  -o finetune_actions/data/eval_handwritten.chat.jsonl

# 4. Train the LoRA adapter (writes finetune_actions/output/final and a loss curve)
finetune_actions/.venv/bin/python finetune_actions/finetune_llm.py
```

Generation is seeded, so the same seed produces byte-identical files. The `.jsonl` splits are committed; the `.chat.jsonl` files are derived artifacts excluded from version control, since they embed the full system prompt in every row.

## Extending the dataset

Add vocabulary to `pools.py` or new phrasings to `intents*.py`, then rerun the generate and validate steps above. `validate_dataset.py` rejects any row whose target references an item that is neither audible in the transcript nor present in `lastModified` — a safeguard against generator bugs that would otherwise teach the model to hallucinate items.

## LoRA configuration and findings

The final adapter targets **all linear layers** (`target_modules="all-linear"`) with `learning_rate=3e-4`, `r=16`, `lora_alpha=64`, making the scale factor as `4` , over 2 epochs. How we got there:

- **Only** `q_proj` — the model adapted the response *structure* but populated fields incorrectly (right shape, wrong content).
- **Expanding the target modules** — training more of the layers gave a clear 20–30% improvement on the eval set. Also, considering that it is a small model, training all the linear layers is also feasible. 
- Because LFM2.5 is a hybrid architecture (see below), `all-linear` covers the linears in both the attention and convolution layers.
- **Hyperparameter sweep** — across ranks, alphas, and learning rates, `r=16` / `alpha=64` / `lr=3e-4` gave the best eval results.



## Export for on-device inference

The app runs the model through `react-native-executorch`, which needs a single merged checkpoint exported to an ExecuTorch `.pte` file.

### 1. Merge the LoRA adapter into the base model

`react-native-executorch` cannot load a standalone PEFT adapter, so the adapter weights are merged into the base model first.

```bash
finetune_actions/.venv/bin/python finetune_actions/merge_lora.py
```

This writes `finetune_actions/output/merged/` — a standard Hugging Face layout with `model.safetensors` and the tokenizer files. Keep it as a single `model.safetensors`; do not shard it, since `convert_weights` reads one file.

### 2. Set up ExecuTorch (separate venv)

Install ExecuTorch in its **own** virtual environment. Do **not** add it to `finetune_actions/.venv`: it pins its own PyTorch build, which conflicts with the PyTorch used for training.

```bash
python3 -m venv ~/et-export
source ~/et-export/bin/activate
pip install executorch safetensors
```

ExecuTorch requires Python 3.10–3.13 (3.14 is not yet supported). The export step reads LFM2 config files, so clone just that directory (no full build):

```bash
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/pytorch/executorch.git ~/executorch
cd ~/executorch
git sparse-checkout set examples/models/lfm2
```

If `lfm2_5_350m_config.json` is missing from the wheel, download it from the matching ExecuTorch release tag.

### 3. Why the dedicated LFM2 recipe is required

The generic Hugging Face export paths (`convert_and_export_with_cache`, `optimum-cli export executorch`) assume a conventional attention-only decoder with a static KV cache. LFM2.5 is instead a hybrid architecture: most layers are short convolutions with their own dedicated cache. `optimum-executorch` therefore does not support LFM2, and ExecuTorch ships a dedicated recipe at `examples/models/lfm2`.

### 4. Choose a config, then convert and export

Two choices drive the output:

1. **Weight quantization** — e.g. `lfm2_xnnpack_fp32.yaml` (unquantized) vs. `lfm2_xnnpack_q8da4w.yaml` (4-bit). Quantization shrinks the file but noticeably degrades structured-JSON quality on a 350M model.
2. **Context length** (`max_seq_length` / `max_context_length`) — the default of 128 tokens is too small for real prompts.

**Our choice:** the fp32 config with an fp16 dtype override and a 2048-token window. The unquantized path preserves far more of the fine-tuned quality; the invoice system prompt plus chat template alone is ~184 tokens, so 2048 comfortably fits multi-turn conversations; and with the fp16 override the resulting `.pte` is ~800 MB — small enough to download on first launch.

```bash
python -m executorch.examples.models.lfm2.convert_weights \
  /abs/path/to/voicebillingapp/finetune_actions/output/merged \
  invoice_lfm2_5_350m.pth

python -m executorch.extension.llm.export.export_llm \
  --config ~/executorch/examples/models/lfm2/config/lfm2_xnnpack_fp32.yaml \
  +base.model_class="lfm2_5_350m" \
  +base.params="$HOME/executorch/examples/models/lfm2/config/lfm2_5_350m_config.json" \
  +base.checkpoint="invoice_lfm2_5_350m.pth" \
  model.dtype_override=fp16 \
  +export.max_seq_length=2048 \
  +export.max_context_length=2048 \
  +export.output_name="invoice_lfm2_5_350m_fp16.pte"
```



### 5. Host the exported model

The ~800 MB `.pte` exceeds React Native's 512 MB `require()` asset limit, so it cannot be bundled statically. It is uploaded to Hugging Face and fetched over HTTPS at runtime; the tokenizer stays the stock LFM2.5-350M one from Software Mansion.

```bash
# .env  (Expo inlines EXPO_PUBLIC_* at bundle time)
EXPO_PUBLIC_INVOICE_PTE=https://huggingface.co/drishti09/LFM-350M-VoiceBilling-FineTuned/resolve/main/invoice_lfm2_5_350m_fp16.pte
```

`EXPO_PUBLIC_INVOICE_PTE` is **required** and must point to the remote repository path url which contains the .pte ((https:// is required) . The app throws an error if the value is not set as required. 

The invoice system prompt is always `INVOICE_SYSTEM_PROMPT_SHORT`, which is kept byte-identical to `finetune_actions/system_prompt.txt`. Rebuild or reload after editing `.env`; on first launch the device downloads the `.pte` into the app's documents directory. This also enabled offline inference in future. 