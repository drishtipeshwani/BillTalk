import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { InvoiceSummary, SavedInvoice } from '../types/accounts';
import type { User } from '../types/auth';
import {
  getInvoiceTotal,
  parseInvoiceSnapshot,
  serializeInvoiceSnapshot,
  type Invoice,
  type InvoiceItem,
} from '../types/invoice';
import { invoiceDateToIso, isoToInvoiceDate } from '../utils/invoiceDate';
import { entityNameKey, normalizeEntityName } from '../utils/entityName';
import type { CustomerLedgerEntry } from '../types/ledger';
import type { StockItem } from '../types/stock';

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company_name: string;
  created_at: string;
}

function newId(): string {
  return Crypto.randomUUID();
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    companyName: row.company_name,
    createdAt: row.created_at,
  };
}

export async function getRegisteredUser(db: SQLiteDatabase): Promise<User | null> {
  const row = await db.getFirstAsync<UserRow>('SELECT * FROM users LIMIT 1');
  return row ? mapUser(row) : null;
}

export async function insertUser(
  db: SQLiteDatabase,
  input: {
    name: string;
    email: string | null;
    phone: string | null;
    companyName: string;
  },
): Promise<User> {
  const id = newId();
  const createdAt = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO users (id, name, email, phone, company_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    input.name,
    input.email,
    input.phone,
    input.companyName,
    createdAt,
  );
  return {
    id,
    name: input.name,
    email: input.email,
    phone: input.phone,
    companyName: input.companyName,
    createdAt,
  };
}

export async function listStockItems(
  db: SQLiteDatabase,
  userId: string,
): Promise<StockItem[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    quantity: number;
    cost_price: number;
    selling_price: number;
  }>(
    `SELECT id, name, quantity, cost_price, selling_price
     FROM stock
     WHERE user_id = ?
     ORDER BY name COLLATE NOCASE`,
    userId,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    costPrice: row.cost_price,
    sellingPrice: row.selling_price,
  }));
}

export async function listCustomers(
  db: SQLiteDatabase,
  userId: string,
): Promise<CustomerLedgerEntry[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    balance_amount: number;
  }>(
    `SELECT id, name, balance_amount
     FROM customers
     WHERE user_id = ?
     ORDER BY name COLLATE NOCASE`,
    userId,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    balanceAmount: row.balance_amount,
  }));
}

export async function listInvoices(
  db: SQLiteDatabase,
  userId: string,
  customerId?: string,
): Promise<InvoiceSummary[]> {
  const rows = await db.getAllAsync<{
    id: string;
    invoice_number: number;
    customer_name: string;
    invoice_date: string;
    total_amount: number;
  }>(
    customerId
      ? `SELECT id, invoice_number, customer_name, invoice_date, total_amount
         FROM invoices
         WHERE user_id = ? AND customer_id = ?
         ORDER BY invoice_number DESC`
      : `SELECT id, invoice_number, customer_name, invoice_date, total_amount
         FROM invoices
         WHERE user_id = ?
         ORDER BY invoice_number DESC`,
    ...(customerId ? [userId, customerId] : [userId]),
  );
  return rows.map((row) => ({
    id: row.id,
    invoiceNumber: row.invoice_number,
    customerName: row.customer_name,
    date: row.invoice_date,
    totalAmount: row.total_amount,
  }));
}

function mapInvoiceItem(row: {
  name: string;
  quantity: number | null;
  price_per_item: number | null;
  discount_percent: number | null;
  discount_amount: number | null;
}): InvoiceItem {
  return {
    name: row.name,
    quantity: row.quantity,
    pricePerItem: row.price_per_item,
    discountPercent: row.discount_percent,
    discountAmount: row.discount_amount,
  };
}

async function reconstructInvoice(
  db: SQLiteDatabase,
  invoiceId: string,
  header: {
    customer_name: string;
    invoice_date: string;
    discount_percent: number | null;
    discount_amount: number | null;
    company_name: string;
  },
): Promise<Invoice> {
  const itemRows = await db.getAllAsync<{
    name: string;
    quantity: number | null;
    price_per_item: number | null;
    discount_percent: number | null;
    discount_amount: number | null;
  }>(
    `SELECT name, quantity, price_per_item, discount_percent, discount_amount
     FROM invoice_items
     WHERE invoice_id = ?
     ORDER BY rowid`,
    invoiceId,
  );

  return {
    companyName: header.company_name,
    customerName: header.customer_name,
    items: itemRows.map(mapInvoiceItem),
    invoiceDate: isoToInvoiceDate(header.invoice_date),
    invoiceDiscountPercent: header.discount_percent,
    invoiceDiscountAmount: header.discount_amount,
  };
}

export async function backfillInvoiceSnapshots(db: SQLiteDatabase): Promise<void> {
  const rows = await db.getAllAsync<{
    id: string;
    customer_name: string;
    invoice_date: string;
    discount_percent: number | null;
    discount_amount: number | null;
    company_name: string;
  }>(
    `SELECT invoices.id, invoices.customer_name, invoices.invoice_date,
            invoices.discount_percent, invoices.discount_amount, users.company_name
     FROM invoices
     INNER JOIN users ON users.id = invoices.user_id
     WHERE invoices.snapshot IS NULL`,
  );

  for (const row of rows) {
    const invoice = await reconstructInvoice(db, row.id, row);
    await db.runAsync(
      'UPDATE invoices SET snapshot = ? WHERE id = ?',
      serializeInvoiceSnapshot(invoice),
      row.id,
    );
  }
}

export async function getInvoiceById(
  db: SQLiteDatabase,
  userId: string,
  invoiceId: string,
): Promise<SavedInvoice | null> {
  const row = await db.getFirstAsync<{
    invoice_number: number;
    customer_name: string;
    invoice_date: string;
    discount_percent: number | null;
    discount_amount: number | null;
    snapshot: string | null;
    company_name: string;
  }>(
    `SELECT invoices.invoice_number, invoices.customer_name, invoices.invoice_date,
            invoices.discount_percent, invoices.discount_amount, invoices.snapshot,
            users.company_name
     FROM invoices
     INNER JOIN users ON users.id = invoices.user_id
     WHERE invoices.id = ? AND invoices.user_id = ?`,
    invoiceId,
    userId,
  );

  if (!row) {
    return null;
  }

  if (row.snapshot) {
    try {
      return {
        invoiceNumber: row.invoice_number,
        invoice: parseInvoiceSnapshot(row.snapshot),
      };
    } catch {
      // Fall through and rebuild from columns.
    }
  }

  return {
    invoiceNumber: row.invoice_number,
    invoice: await reconstructInvoice(db, invoiceId, row),
  };
}

export class SaveInvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveInvoiceError';
  }
}

export class SaveRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveRecordError';
  }
}

export class DuplicateNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateNameError';
  }
}

export class DeleteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeleteBlockedError';
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE/i.test(message);
}

async function findCustomerIdByName(
  db: SQLiteDatabase,
  userId: string,
  name: string,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM customers
     WHERE user_id = ? AND name = ? COLLATE NOCASE`,
    userId,
    name,
  );
  return row?.id ?? null;
}

async function findStockByName(
  db: SQLiteDatabase,
  userId: string,
  name: string,
): Promise<{
  id: string;
  quantity: number;
  cost_price: number;
  selling_price: number;
} | null> {
  return db.getFirstAsync<{
    id: string;
    quantity: number;
    cost_price: number;
    selling_price: number;
  }>(
    `SELECT id, quantity, cost_price, selling_price FROM stock
     WHERE user_id = ? AND name = ? COLLATE NOCASE`,
    userId,
    name,
  );
}

export async function customerExists(
  db: SQLiteDatabase,
  userId: string,
  name: string,
): Promise<boolean> {
  const normalized = normalizeEntityName(name);
  if (!normalized) {
    return false;
  }
  return (await findCustomerIdByName(db, userId, normalized)) != null;
}

export async function stockItemExists(
  db: SQLiteDatabase,
  userId: string,
  name: string,
): Promise<boolean> {
  const normalized = normalizeEntityName(name);
  if (!normalized) {
    return false;
  }
  return (await findStockByName(db, userId, normalized)) != null;
}

export async function insertStockItem(
  db: SQLiteDatabase,
  userId: string,
  input: {
    name: string;
    quantity: number;
    costPrice: number;
    sellingPrice: number;
  },
): Promise<StockItem> {
  const name = normalizeEntityName(input.name);
  if (!name) {
    throw new SaveRecordError('Add an item name before saving.');
  }

  if (await findStockByName(db, userId, name)) {
    throw new DuplicateNameError(`A stock item named "${name}" already exists.`);
  }

  const id = newId();
  const createdAt = new Date().toISOString();
  try {
    await db.runAsync(
      `INSERT INTO stock (
         id, user_id, name, quantity, cost_price, selling_price, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      name,
      input.quantity,
      input.costPrice,
      input.sellingPrice,
      createdAt,
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new DuplicateNameError(`A stock item named "${name}" already exists.`);
    }
    throw error;
  }

  return {
    id,
    name,
    quantity: input.quantity,
    costPrice: input.costPrice,
    sellingPrice: input.sellingPrice,
  };
}

export async function updateStockItem(
  db: SQLiteDatabase,
  userId: string,
  id: string,
  input: {
    name: string;
    quantity: number;
    costPrice: number;
    sellingPrice: number;
  },
): Promise<StockItem> {
  const name = normalizeEntityName(input.name);
  if (!name) {
    throw new SaveRecordError('Add an item name before saving.');
  }

  const takenBy = await findStockByName(db, userId, name);
  if (takenBy && takenBy.id !== id) {
    throw new DuplicateNameError(`A stock item named "${name}" already exists.`);
  }

  try {
    const result = await db.runAsync(
      `UPDATE stock
       SET name = ?, quantity = ?, cost_price = ?, selling_price = ?
       WHERE id = ? AND user_id = ?`,
      name,
      input.quantity,
      input.costPrice,
      input.sellingPrice,
      id,
      userId,
    );
    if (result.changes === 0) {
      throw new SaveRecordError('Could not update this stock item.');
    }
  } catch (error) {
    if (error instanceof SaveRecordError || error instanceof DuplicateNameError) {
      throw error;
    }
    if (isUniqueConstraintError(error)) {
      throw new DuplicateNameError(`A stock item named "${name}" already exists.`);
    }
    throw error;
  }

  return {
    id,
    name,
    quantity: input.quantity,
    costPrice: input.costPrice,
    sellingPrice: input.sellingPrice,
  };
}

export async function deleteStockItem(
  db: SQLiteDatabase,
  userId: string,
  id: string,
): Promise<void> {
  const stock = await db.getFirstAsync<{ name: string }>(
    'SELECT name FROM stock WHERE id = ? AND user_id = ?',
    id,
    userId,
  );
  if (!stock) {
    throw new SaveRecordError('Could not delete this stock item.');
  }

  const referencing = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM invoice_items
     INNER JOIN invoices ON invoices.id = invoice_items.invoice_id
     WHERE invoices.user_id = ? AND invoice_items.name = ? COLLATE NOCASE`,
    userId,
    stock.name,
  );
  if ((referencing?.count ?? 0) > 0) {
    throw new DeleteBlockedError(
      'This item appears on saved invoices. Delete those invoices first.',
    );
  }

  await db.runAsync(
    'DELETE FROM stock WHERE id = ? AND user_id = ?',
    id,
    userId,
  );
}

export async function insertCustomer(
  db: SQLiteDatabase,
  userId: string,
  input: {
    name: string;
    balanceAmount: number;
  },
): Promise<CustomerLedgerEntry> {
  const name = normalizeEntityName(input.name);
  if (!name) {
    throw new SaveRecordError('Add a customer name before saving.');
  }
  if (await findCustomerIdByName(db, userId, name)) {
    throw new DuplicateNameError(`A customer named "${name}" already exists.`);
  }

  const id = newId();
  const createdAt = new Date().toISOString();
  try {
    await db.runAsync(
      `INSERT INTO customers (id, user_id, name, balance_amount, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      userId,
      name,
      input.balanceAmount,
      createdAt,
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new DuplicateNameError(`A customer named "${name}" already exists.`);
    }
    throw error;
  }

  return {
    id,
    name,
    balanceAmount: input.balanceAmount,
  };
}

export async function updateCustomer(
  db: SQLiteDatabase,
  userId: string,
  id: string,
  input: {
    name: string;
    balanceAmount: number;
  },
): Promise<CustomerLedgerEntry> {
  const name = normalizeEntityName(input.name);
  if (!name) {
    throw new SaveRecordError('Add a customer name before saving.');
  }

  const takenBy = await findCustomerIdByName(db, userId, name);
  if (takenBy && takenBy !== id) {
    throw new DuplicateNameError(`A customer named "${name}" already exists.`);
  }

  try {
    const result = await db.runAsync(
      `UPDATE customers
       SET name = ?, balance_amount = ?
       WHERE id = ? AND user_id = ?`,
      name,
      input.balanceAmount,
      id,
      userId,
    );
    if (result.changes === 0) {
      throw new SaveRecordError('Could not update this customer.');
    }
  } catch (error) {
    if (error instanceof SaveRecordError || error instanceof DuplicateNameError) {
      throw error;
    }
    if (isUniqueConstraintError(error)) {
      throw new DuplicateNameError(`A customer named "${name}" already exists.`);
    }
    throw error;
  }

  return {
    id,
    name,
    balanceAmount: input.balanceAmount,
  };
}

export async function deleteCustomer(
  db: SQLiteDatabase,
  userId: string,
  id: string,
): Promise<void> {
  const referencing = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM invoices
     WHERE user_id = ? AND customer_id = ?`,
    userId,
    id,
  );
  if ((referencing?.count ?? 0) > 0) {
    throw new DeleteBlockedError(
      'This customer has saved invoices. Delete those invoices first.',
    );
  }

  const result = await db.runAsync(
    'DELETE FROM customers WHERE id = ? AND user_id = ?',
    id,
    userId,
  );
  if (result.changes === 0) {
    throw new SaveRecordError('Could not delete this customer.');
  }
}

async function applyStockSale(
  db: SQLiteDatabase,
  userId: string,
  itemName: string,
  soldQty: number,
): Promise<void> {
  const stock = await findStockByName(db, userId, itemName);
  if (!stock) {
    throw new SaveInvoiceError(
      `Add "${itemName}" to inventory before saving.`,
    );
  }
  await db.runAsync(
    'UPDATE stock SET quantity = ? WHERE id = ?',
    stock.quantity - soldQty,
    stock.id,
  );
}

async function restoreStockSale(
  db: SQLiteDatabase,
  userId: string,
  itemName: string,
  soldQty: number,
): Promise<void> {
  const stock = await findStockByName(db, userId, itemName);
  if (!stock) {
    return;
  }
  await db.runAsync(
    'UPDATE stock SET quantity = ? WHERE id = ?',
    stock.quantity + soldQty,
    stock.id,
  );
}

function prepareInvoicePayload(invoice: Invoice): {
  customerName: string;
  items: InvoiceItem[];
  snapshotInvoice: Invoice;
  totalAmount: number;
} {
  const customerName = normalizeEntityName(invoice.customerName);
  if (!customerName) {
    throw new SaveInvoiceError('Add a customer before saving.');
  }

  const items = invoice.items
    .map((item) => ({ ...item, name: normalizeEntityName(item.name) }))
    .filter((item) => item.name.length > 0);
  if (items.length === 0) {
    throw new SaveInvoiceError('Add at least one item before saving.');
  }

  const snapshotInvoice: Invoice = {
    ...invoice,
    customerName,
    items,
  };
  return {
    customerName,
    items,
    snapshotInvoice,
    totalAmount: getInvoiceTotal(snapshotInvoice),
  };
}

async function assertInvoiceDependencies(
  db: SQLiteDatabase,
  userId: string,
  customerName: string,
  items: InvoiceItem[],
): Promise<string> {
  const customerId = await findCustomerIdByName(db, userId, customerName);
  if (!customerId) {
    throw new SaveInvoiceError(
      'Add this customer in the ledger before saving.',
    );
  }

  for (const item of items) {
    if (!(await findStockByName(db, userId, item.name))) {
      throw new SaveInvoiceError(
        `Add "${item.name}" to inventory before saving.`,
      );
    }
  }

  return customerId;
}

async function insertInvoiceItems(
  db: SQLiteDatabase,
  userId: string,
  invoiceId: string,
  items: InvoiceItem[],
): Promise<void> {
  for (const item of items) {
    await db.runAsync(
      `INSERT INTO invoice_items (
         id, invoice_id, name, quantity, discount_percent,
         price_per_item, discount_amount
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      invoiceId,
      item.name,
      item.quantity,
      item.discountPercent,
      item.pricePerItem,
      item.discountAmount,
    );

    await applyStockSale(db, userId, item.name, item.quantity ?? 0);
  }
}

export async function saveInvoice(
  db: SQLiteDatabase,
  userId: string,
  invoice: Invoice,
): Promise<void> {
  const { customerName, items, snapshotInvoice, totalAmount } =
    prepareInvoicePayload(invoice);
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    const customerId = await assertInvoiceDependencies(
      db,
      userId,
      customerName,
      items,
    );

    await db.runAsync(
      'UPDATE customers SET balance_amount = balance_amount + ? WHERE id = ?',
      totalAmount,
      customerId,
    );

    const nextRow = await db.getFirstAsync<{ next: number }>(
      `SELECT COALESCE(MAX(invoice_number), 0) + 1 AS next
       FROM invoices
       WHERE user_id = ?`,
      userId,
    );
    const invoiceNumber = nextRow?.next ?? 1;
    const invoiceId = newId();

    await db.runAsync(
      `INSERT INTO invoices (
         id, user_id, customer_id, invoice_number, customer_name,
         total_amount, invoice_date, created_at, discount_percent, discount_amount,
         snapshot
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      invoiceId,
      userId,
      customerId,
      invoiceNumber,
      customerName,
      totalAmount,
      invoiceDateToIso(invoice.invoiceDate),
      now,
      invoice.invoiceDiscountPercent,
      invoice.invoiceDiscountAmount,
      serializeInvoiceSnapshot(snapshotInvoice),
    );

    await insertInvoiceItems(db, userId, invoiceId, items);
  });
}

export async function updateInvoice(
  db: SQLiteDatabase,
  userId: string,
  invoiceId: string,
  invoice: Invoice,
): Promise<void> {
  const { customerName, items, snapshotInvoice, totalAmount } =
    prepareInvoicePayload(invoice);

  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{
      customer_id: string;
      total_amount: number;
    }>(
      `SELECT customer_id, total_amount
       FROM invoices
       WHERE id = ? AND user_id = ?`,
      invoiceId,
      userId,
    );
    if (!existing) {
      throw new SaveInvoiceError('Could not update this invoice.');
    }

    const customerId = await assertInvoiceDependencies(
      db,
      userId,
      customerName,
      items,
    );

    const oldItems = await db.getAllAsync<{
      name: string;
      quantity: number | null;
    }>(
      `SELECT name, quantity FROM invoice_items WHERE invoice_id = ?`,
      invoiceId,
    );
    for (const item of oldItems) {
      await restoreStockSale(db, userId, item.name, item.quantity ?? 0);
    }

    await db.runAsync(
      'UPDATE customers SET balance_amount = balance_amount - ? WHERE id = ?',
      existing.total_amount,
      existing.customer_id,
    );
    await db.runAsync(
      'UPDATE customers SET balance_amount = balance_amount + ? WHERE id = ?',
      totalAmount,
      customerId,
    );

    await db.runAsync(
      `UPDATE invoices
       SET customer_id = ?, customer_name = ?, total_amount = ?,
           invoice_date = ?, discount_percent = ?, discount_amount = ?,
           snapshot = ?
       WHERE id = ? AND user_id = ?`,
      customerId,
      customerName,
      totalAmount,
      invoiceDateToIso(invoice.invoiceDate),
      invoice.invoiceDiscountPercent,
      invoice.invoiceDiscountAmount,
      serializeInvoiceSnapshot(snapshotInvoice),
      invoiceId,
      userId,
    );

    await db.runAsync('DELETE FROM invoice_items WHERE invoice_id = ?', invoiceId);
    await insertInvoiceItems(db, userId, invoiceId, items);
  });
}

export async function deleteInvoice(
  db: SQLiteDatabase,
  userId: string,
  invoiceId: string,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{
      customer_id: string;
      total_amount: number;
    }>(
      `SELECT customer_id, total_amount
       FROM invoices
       WHERE id = ? AND user_id = ?`,
      invoiceId,
      userId,
    );
    if (!existing) {
      throw new SaveInvoiceError('Could not delete this invoice.');
    }

    const oldItems = await db.getAllAsync<{
      name: string;
      quantity: number | null;
    }>(
      `SELECT name, quantity FROM invoice_items WHERE invoice_id = ?`,
      invoiceId,
    );
    for (const item of oldItems) {
      await restoreStockSale(db, userId, item.name, item.quantity ?? 0);
    }

    await db.runAsync(
      'UPDATE customers SET balance_amount = balance_amount - ? WHERE id = ?',
      existing.total_amount,
      existing.customer_id,
    );

    await db.runAsync('DELETE FROM invoice_items WHERE invoice_id = ?', invoiceId);
    await db.runAsync(
      'DELETE FROM invoices WHERE id = ? AND user_id = ?',
      invoiceId,
      userId,
    );
  });
}

export async function dedupeCustomersAndStock(db: SQLiteDatabase): Promise<void> {
  const customers = await db.getAllAsync<{
    id: string;
    user_id: string;
    name: string;
    balance_amount: number;
    created_at: string;
  }>(
    `SELECT id, user_id, name, balance_amount, created_at
     FROM customers
     ORDER BY created_at, id`,
  );

  const customerGroups = new Map<string, typeof customers>();
  for (const row of customers) {
    const key = `${row.user_id}::${entityNameKey(row.name)}`;
    const group = customerGroups.get(key) ?? [];
    group.push(row);
    customerGroups.set(key, group);
  }

  for (const group of customerGroups.values()) {
    const [keep, ...dupes] = group;
    const canonical = normalizeEntityName(keep.name);
    let balance = keep.balance_amount;
    for (const dupe of dupes) {
      balance += dupe.balance_amount;
      await db.runAsync(
        'UPDATE invoices SET customer_id = ?, customer_name = ? WHERE customer_id = ?',
        keep.id,
        canonical,
        dupe.id,
      );
      await db.runAsync('DELETE FROM customers WHERE id = ?', dupe.id);
    }
    await db.runAsync(
      'UPDATE customers SET name = ?, balance_amount = ? WHERE id = ?',
      canonical,
      balance,
      keep.id,
    );
    await db.runAsync(
      'UPDATE invoices SET customer_name = ? WHERE customer_id = ?',
      canonical,
      keep.id,
    );
  }

  const stockRows = await db.getAllAsync<{
    id: string;
    user_id: string;
    name: string;
    quantity: number;
    cost_price: number;
    selling_price: number;
    created_at: string;
  }>(
    `SELECT id, user_id, name, quantity, cost_price, selling_price, created_at
     FROM stock
     ORDER BY created_at, id`,
  );

  const stockGroups = new Map<string, typeof stockRows>();
  for (const row of stockRows) {
    const key = `${row.user_id}::${entityNameKey(row.name)}`;
    const group = stockGroups.get(key) ?? [];
    group.push(row);
    stockGroups.set(key, group);
  }

  for (const group of stockGroups.values()) {
    const [keep, ...dupes] = group;
    const canonical = normalizeEntityName(keep.name);
    let quantity = keep.quantity;
    for (const dupe of dupes) {
      quantity += dupe.quantity;
      await db.runAsync('DELETE FROM stock WHERE id = ?', dupe.id);
    }
    await db.runAsync(
      'UPDATE stock SET name = ?, quantity = ? WHERE id = ?',
      canonical,
      quantity,
      keep.id,
    );
  }
}
