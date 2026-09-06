# BillTalk

BillTalk is an end-to-end billing application that can be operated entirely by voice. It enables users to create invoices, track inventory, and manage customer ledgers without typing.

Tap the microphone and speak in English and the app transcribes each utterance, converts it into structured actions, and updates the relevant invoice, ledger, or inventory record.

All processing and business data remain on the phone. A fine-tuned LLM runs directly on the device, while shop data is stored in a local SQLite database. Billing records are never sent to a server, allowing the app to work offline while keeping customer and inventory data private.

## Tech stack


| Layer          | Choice                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App            | Expo, React Native, and TypeScript; PDF generation and sharing through expo-print and expo-sharing; Zod schemas for invoice, customer, and stock actions |
| Speech         | expo-speech-recognition (on-device Apple STT on iOS)                                                                                                     |
| On-device LLM  | react-native-executorch with a fine-tuned LiquidAI **LFM2.5-350M** model                                                                                 |
| Local database | expo-sqlite                                                                                                                                              |
| Auth           | PIN via expo-secure-store, optional Face ID / biometrics via expo-local-authentication                                                                   |


## Run locally

Because `react-native-executorch` includes native code, BillTalk **does not run in Expo Go**. Use a custom development build, and rebuild the app whenever native dependencies or configuration plugins change.

```bash
npm install
```

### iOS (macOS + Xcode)

```bash
npx expo run:ios
```

On first launch, wait for the on-device model to download and initialize. Download progress appears below the microphone button. Register with a PIN, optionally enable Face ID, and then tap the microphone to begin.

The fine-tuned `.pte` model is downloaded over HTTPS and stored in the app's documents directory. Set its HTTPS URL through `EXPO_PUBLIC_INVOICE_PTE` in `.env`; the app will fail during startup if this value is missing or invalid.

## Features

BillTalk provides voice-driven CRUD operations for the shop's core records:

- **Invoices** — Create and edit invoices, including line items, quantities, prices, discounts, dates, and customers. Save or clear a draft, remove line items, browse previous invoices in Accounts, and reopen a saved invoice to edit or delete it.
- **Inventory** — Create and update stock items with a name, quantity, cost price, and selling price. Saving an invoice automatically deducts the sold units from inventory.
- **Customer ledger** — Create, update, and delete customers and their outstanding balances. Saving an invoice automatically adds its total to the selected customer's balance.
- **PDF sharing** — Generate and share a PDF of the current invoice.
- **Device lock** — Secure the app with a PIN and optional Face ID or biometric authentication.

If a spoken customer or stock item does not yet exist in the catalog, the app pauses the invoice workflow and prompts the user to add the missing record by voice before continuing.

### Voice agents

One on-device model powers three specialized voice agents. Each agent uses a dedicated system prompt and returns a JSON array drawn from its own domain-specific set of actions and fields:

1. **Invoice agent** — Manages line items, discounts, dates, customers, and save, clear, or delete operations. It is used on the home screen and when editing saved invoices.
2. **Customer agent** — Manages customer names, outstanding balances, and save, clear, or delete operations. It is used when adding or editing customers.
3. **Stock agent** — Manages the name, quantity, cost price, and selling price of an inventory item. It is used when adding or editing stock.

## Fine-tuned model

BillTalk uses **LiquidAI LFM2.5-350M**, fine-tuned with LoRA to convert Indian English speech transcripts into structured action arrays.

The training data, hyperparameters, and ExecuTorch `.pte` export process are documented in [finetune_actions/README.md](finetune_actions/README.md).

## Database

Shop data is stored on-device in the `voicebilling.db` SQLite database. Its schema, tables, and save-time side effects are documented in [db/README.md](db/README.md).