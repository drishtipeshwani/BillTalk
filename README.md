# BillTalk

An End-to-end billing software that can be operated entirely with voice. Users can create invoices, track inventory, and manage ledgers without typing anything.

Tap the mic, speak in English, and the device transcribes the utterance, turns it into structured actions, and updates the bill, ledger, or stock list, making invoice creation quick and efficient.

Everything stays on the phone. A fine-tuned LLM runs directly on the device, and shop data lives in local SQLite. No billing records are sent to a server, so the experience works offline and keeps customer and inventory data private.

## Tech stack

| Layer | Choice |
| --- | --- |
| App | Expo, React Native, TypeScript; PDF via expo-print and expo-sharing; Zod schemas for invoice, customer, and stock actions |
| Speech | expo-speech-recognition (on-device Apple STT on iOS) |
| On-device LLM | react-native-executorch with a fine-tuned LiquidAI **LFM2.5-350M** model |
| Local database | expo-sqlite |
| Auth | PIN via expo-secure-store, optional Face ID / biometrics via expo-local-authentication |

## Run locally

`react-native-executorch` includes native code, so this app **does not run in Expo Go**. Use a custom development build. Rebuild whenever native dependencies or config plugins change.

```bash
npm install
```

### iOS (macOS + Xcode)

```bash
npx expo run:ios
```

On first launch, wait for the on-device model to download and load (progress shows under the mic). Register with a PIN (and Face ID if you want), then tap the mic and speak.

The fine-tuned `.pte` is fetched over HTTPS into the app documents directory. Its URL must be set via `EXPO_PUBLIC_INVOICE_PTE` in `.env` (an `https://` URL) — the app throws on startup if it is missing.

## Features

Voice-driven CRUD for the shop's core records:

- **Invoices** — create and edit bills (line items, quantities, prices, item and bill discounts, date, customer), save, clear, delete a line item, or delete a saved invoice. Browse past bills in Accounts and reopen one to edit or delete.
- **Inventory** — create and update stock items (name, quantity, cost price, selling price). Saving an invoice deducts sold units from stock.
- **Customer ledger** — create, update, and delete customers and their outstanding balances. Saving an invoice adds the bill total to that customer's balance.
- **Share a PDF** of the current invoice.
- **Device lock** — PIN, with optional Face ID / biometrics.

If a spoken customer or stock item is not in the catalog yet, the app pauses the invoice and asks you to add it by voice before continuing.

### Voice agents

One on-device model, three system prompts. Each agent replies with a JSON array of actions (only the fields that utterance set):

1. **Invoice agent** — line items, discounts, date, customer, save / clear / delete item or invoice. Used on the home screen and when editing a saved bill.
2. **Customer agent** — name, outstanding balance, save / clear / delete. Used when adding or editing a customer.
3. **Stock agent** — name, quantity, cost price, and selling price for an inventory draft. Used when adding stock.

## Fine-tuned model

The on-device model is **LiquidAI LFM2.5-350M**, LoRA-fine-tuned to map Indian English speech transcripts to those action arrays.

Training data, hyperparameters, and the ExecuTorch `.pte` export recipe live in [finetune_actions/README.md](finetune_actions/README.md).

## Database

Shop data is stored on-device in SQLite (`voicebilling.db`). Schema, tables, and save-time side effects are documented in [db/README.md](db/README.md).
