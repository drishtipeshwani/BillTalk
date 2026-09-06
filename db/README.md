# On-device database

All shop data lives on the phone in a local SQLite database (`voicebilling.db`) accessed through [`expo-sqlite`]. There is no remote database. Migrations run automatically on app start in `schema.ts`, and all queries live in `queries.ts`.

The PIN is kept separately in the device keychain (`expo-secure-store`) rather than in SQLite.

## Database Schema

### Table Relationships

```
users 1──* stock
users 1──* customers
users 1──* invoices
customers 1──* invoices
invoices 1──* invoice_items
```

### Table 1 - `users`

The shop owner. The app currently supports a single registered user.


| Column         | Type    | Notes               |
| -------------- | ------- | ------------------- |
| `id`           | TEXT PK | UUID                |
| `name`         | TEXT    |                     |
| `email`        | TEXT    | optional            |
| `phone`        | TEXT    | optional            |
| `company_name` | TEXT    | printed on invoices |
| `created_at`   | TEXT    | ISO timestamp       |




### Table 2 - `stock`

Inventory catalog. Names are unique per user, case-insensitive.


| Column          | Type            | Notes                                                       |
| --------------- | --------------- | ----------------------------------------------------------- |
| `id`            | TEXT PK         | UUID                                                        |
| `user_id`       | TEXT FK → users | cascade delete                                              |
| `name`          | TEXT            | normalized display name                                     |
| `quantity`      | REAL            | units on hand; can go negative if more is sold than stocked |
| `cost_price`    | REAL            |                                                             |
| `selling_price` | REAL            | default rate when adding the item to a bill                 |
| `created_at`    | TEXT            | ISO timestamp                                               |


Unique: `(user_id, name COLLATE NOCASE)`.

### Table 3 - `customers`

Ledger of customers and what they owe.


| Column           | Type            | Notes                            |
| ---------------- | --------------- | -------------------------------- |
| `id`             | TEXT PK         | UUID                             |
| `user_id`        | TEXT FK → users | cascade delete                   |
| `name`           | TEXT            | normalized display name          |
| `balance_amount` | REAL            | outstanding rupees; 0 is settled |
| `created_at`     | TEXT            | ISO timestamp                    |


Unique: `(user_id, name COLLATE NOCASE)`.

### Table 4 - `invoices`

Saved bills. `invoice_number` is assigned per user, starting at 1.


| Column             | Type                | Notes                                                |
| ------------------ | ------------------- | ---------------------------------------------------- |
| `id`               | TEXT PK             | UUID                                                 |
| `user_id`          | TEXT FK → users     | cascade delete                                       |
| `customer_id`      | TEXT FK → customers | required; customer must already exist                |
| `invoice_number`   | INTEGER             | unique per user                                      |
| `customer_name`    | TEXT                | snapshot of the name at save time                    |
| `total_amount`     | REAL                | after item and bill discounts                        |
| `invoice_date`     | TEXT                | ISO date                                             |
| `created_at`       | TEXT                | ISO timestamp                                        |
| `discount_percent` | REAL                | whole-bill percent discount                          |
| `discount_amount`  | REAL                | whole-bill rupee discount                            |
| `snapshot`         | TEXT                | JSON copy of the full invoice used for later viewing |


Unique: `(user_id, invoice_number)`.

### Table 5 - `invoice_items`

Line items on a saved invoice. Cascade-deleted with the parent invoice.


| Column             | Type               | Notes                       |
| ------------------ | ------------------ | --------------------------- |
| `id`               | TEXT PK            | UUID                        |
| `invoice_id`       | TEXT FK → invoices | cascade delete              |
| `name`             | TEXT               |                             |
| `quantity`         | REAL               |                             |
| `price_per_item`   | REAL               |                             |
| `discount_percent` | REAL               | item-level percent discount |
| `discount_amount`  | REAL               | item-level rupee discount   |


Percent and amount discounts are mutually exclusive; the app never sets both on the same item or bill.

## What happens on save

### Saving a customer or a stock item

Names are normalized before anything is written — inner/leading/trailing whitespace is trimmed (case is left unchanged). A blank name is rejected.

Saving from the "New" flow always inserts a brand-new row. Names are unique per user (case-insensitive), so saving a name that already exists is rejected as a duplicate — an existing record is never merged or overwritten from here. To change an existing record, edit it instead (see below).

- **Customer:** the new row is created with the given `balance_amount`.
- **Stock item:** the new row is created with the given `quantity`, `cost_price`, and `selling_price`.

### Saving an invoice

The entire save runs inside one SQLite transaction, so it either completes fully or leaves the database untouched:

1. The customer must already exist in `customers`, and every line item must already exist in `stock`; otherwise the save is aborted.
2. The invoice total is added to that customer's `balance_amount`.
3. The next `invoice_number` is assigned (the current maximum for the user, plus one), and the invoice row is inserted. `snapshot` stores the full invoice as JSON so Accounts can later reopen the bill exactly as it was saved.
4. Each line item is written to `invoice_items`, and its quantity is deducted from the matching `stock.quantity`.

## What happens on edit

Customer and stock edits update the existing row by id, overwriting its fields with whatever the user speaks. Names remain unique per user, so renaming a record to a name another record already uses is rejected. On a stock edit, `quantity` is overwritten with the spoken value; there is no additive/restock save, since saving an already-existing name from the "New" flow is rejected as a duplicate.

Updating a saved invoice also runs inside a single transaction:

1. The new customer and every new line item must already exist, exactly as on create.
2. The previous line quantities are returned to stock (skipped for any stock row that no longer exists), and the previous total is subtracted from the old customer's balance.
3. The new total is added to the (possibly different) customer, the line items are replaced, `snapshot` is rewritten, and the new quantities are deducted from stock.
4. `invoice_number` stays the same.

## What happens on delete

### Deleting an invoice

Deleting an invoice reverses everything the invoice did, inside a single transaction:

1. Each line item's quantity is added back to `stock.quantity` (skipped for any stock row that no longer exists).
2. The invoice's total is subtracted from its customer's `balance_amount`.
3. The `invoice_items` rows and the invoice row are removed.

### Deleting a customer or a stock item

These deletes are guarded: a record that is still referenced by a saved invoice cannot be removed.

- **Customer:** deletion is blocked if any invoice points to that customer (`invoices.customer_id`). Settle or delete those invoices first.
- **Stock item:** deletion is blocked if the item's name appears on any saved invoice's line items (matched case-insensitively). Settle or delete those invoices first.

When a delete is blocked, the database raises a `DeleteBlockedError` and nothing is removed.

