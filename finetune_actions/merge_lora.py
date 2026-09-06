#!/usr/bin/env python3
"""Merge the trained LoRA adapter into the base LFM2.5-350M weights.

The React Native ExecuTorch runtime cannot load a PEFT adapter. Export to
.pte needs a single merged checkpoint.

Usage:
    finetune_actions/.venv/bin/python finetune_actions/merge_lora.py
    finetune_actions/.venv/bin/python finetune_actions/merge_lora.py --adapter finetune_actions/output/final
"""

from __future__ import annotations

import argparse
import os

from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ADAPTER = os.path.join(HERE, "output", "final")
DEFAULT_OUT = os.path.join(HERE, "output", "merged")
MODEL_ID = "LiquidAI/LFM2.5-350M-Base"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=MODEL_ID)
    parser.add_argument("--adapter", default=DEFAULT_ADAPTER)
    parser.add_argument("--out", default=DEFAULT_OUT)
    args = parser.parse_args()

    print(f"Loading base {args.base} …")
    model = AutoModelForCausalLM.from_pretrained(args.base)
    tokenizer = AutoTokenizer.from_pretrained(args.base)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    print(f"Loading adapter {args.adapter} …")
    model = PeftModel.from_pretrained(model, args.adapter)
    print("Merging LoRA into base weights …")
    model = model.merge_and_unload()

    os.makedirs(args.out, exist_ok=True)
    print(f"Saving merged model to {args.out} …")
    model.save_pretrained(args.out)
    tokenizer.save_pretrained(args.out)
    print("Done. Next: export to .pte (see finetune_actions/README.md).")


if __name__ == "__main__":
    main()
