import { db } from './connection.js';
import type { Order, OrderItem, Event, Job, OrderStatus, ParsedEduzzData } from '../types.js';

// Re-exportar tipos para uso em outros módulos
export type { Order, OrderItem, Event, Job, OrderStatus } from '../types.js';

// ===========================================
// Repositório de Pedidos
// ===========================================

export function findOrderByInvoiceId(invoiceId: string): Order | undefined {
  return db.prepare('SELECT * FROM orders WHERE invoice_id = ?').get(invoiceId) as Order | undefined;
}

export function findOrderById(id: number): Order | undefined {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Order | undefined;
}

export function getAllOrders(limit = 100, offset = 0): Order[] {
  return db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as Order[];
}

export function getOrdersByStatus(status: OrderStatus): Order[] {
  return db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC')
    .all(status) as Order[];
}

export function countOrdersByStatus(): Record<OrderStatus, number> {
  const result = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM orders
    GROUP BY status
  `).all() as { status: OrderStatus; count: number }[];

  const counts: Record<OrderStatus, number> = {
    NOVO: 0,
    ENVIANDO: 0,
    AGUARDANDO_LOGGI: 0,
    ETIQUETA_GERADA: 0,
    FALHA: 0,
    POSTADO: 0,
  };

  for (const row of result) {
    counts[row.status] = row.count;
  }

  return counts;
}

export function createOrder(data: ParsedEduzzData): Order {
  const stmt = db.prepare(`
    INSERT INTO orders (
      invoice_id, buyer_name, buyer_email, buyer_phone,
      address_street, address_number, address_complement, address_neighborhood,
      address_city, address_state, address_zip, address_country,
      status, paid_at
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      'NOVO', ?
    )
  `);

  const result = stmt.run(
    data.invoiceId,
    data.buyer.name,
    data.buyer.email,
    data.buyer.phone,
    data.address.street,
    data.address.number,
    data.address.complement,
    data.address.neighborhood,
    data.address.city,
    data.address.state,
    data.address.zipCode,
    data.address.country,
    data.paidAt
  );

  return findOrderById(result.lastInsertRowid as number)!;
}

export function updateOrderStatus(
  invoiceId: string,
  status: OrderStatus,
  extra?: {
    loggiShipmentId?: string;
    loggiTrackingCode?: string;
    labelPath?: string;
    errorMessage?: string | null;
  }
): void {
  let sql = "UPDATE orders SET status = ?, updated_at = datetime('now')";
  const params: (string | null)[] = [status];

  if (extra?.loggiShipmentId !== undefined) {
    sql += ', loggi_shipment_id = ?';
    params.push(extra.loggiShipmentId);
  }
  if (extra?.loggiTrackingCode !== undefined) {
    sql += ', loggi_tracking_code = ?';
    params.push(extra.loggiTrackingCode);
  }
  if (extra?.labelPath !== undefined) {
    sql += ', label_path = ?';
    params.push(extra.labelPath);
  }
  if (extra?.errorMessage !== undefined) {
    sql += ', error_message = ?';
    params.push(extra.errorMessage);
  }

  sql += ' WHERE invoice_id = ?';
  params.push(invoiceId);

  db.prepare(sql).run(...params);
}

export function updateOrder(invoiceId: string, data: Partial<ParsedEduzzData>): void {
  const order = findOrderByInvoiceId(invoiceId);
  if (!order) return;

  const updates: string[] = ["updated_at = datetime('now')"];
  const params: (string | null)[] = [];

  if (data.buyer) {
    if (data.buyer.name) {
      updates.push('buyer_name = ?');
      params.push(data.buyer.name);
    }
    if (data.buyer.email) {
      updates.push('buyer_email = ?');
      params.push(data.buyer.email);
    }
    if (data.buyer.phone !== undefined) {
      updates.push('buyer_phone = ?');
      params.push(data.buyer.phone);
    }
  }

  if (data.address) {
    if (data.address.street) {
      updates.push('address_street = ?');
      params.push(data.address.street);
    }
    if (data.address.number) {
      updates.push('address_number = ?');
      params.push(data.address.number);
    }
    if (data.address.complement !== undefined) {
      updates.push('address_complement = ?');
      params.push(data.address.complement);
    }
    if (data.address.neighborhood) {
      updates.push('address_neighborhood = ?');
      params.push(data.address.neighborhood);
    }
    if (data.address.city) {
      updates.push('address_city = ?');
      params.push(data.address.city);
    }
    if (data.address.state) {
      updates.push('address_state = ?');
      params.push(data.address.state);
    }
    if (data.address.zipCode) {
      updates.push('address_zip = ?');
      params.push(data.address.zipCode);
    }
    if (data.address.country) {
      updates.push('address_country = ?');
      params.push(data.address.country);
    }
  }

  params.push(invoiceId);
  const sql = `UPDATE orders SET ${updates.join(', ')} WHERE invoice_id = ?`;
  db.prepare(sql).run(...params);
}

// ===========================================
// Repositório de Itens
// ===========================================

export function getOrderItems(orderId: number): OrderItem[] {
  return db.prepare('SELECT * FROM order_items WHERE order_id = ?')
    .all(orderId) as OrderItem[];
}

export function createOrderItems(orderId: number, items: ParsedEduzzData['items']): void {
  const stmt = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, sku_reference, quantity, price)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items: ParsedEduzzData['items']) => {
    for (const item of items) {
      stmt.run(orderId, item.productId, item.name, item.skuReference, item.quantity, item.price);
    }
  });

  insertMany(items);
}

export function deleteOrderItems(orderId: number): void {
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
}

// ===========================================
// Repositório de Eventos
// ===========================================

export function createEvent(
  eventType: string,
  payload?: unknown,
  orderId?: number,
  invoiceId?: string
): Event {
  const stmt = db.prepare(`
    INSERT INTO events (order_id, invoice_id, event_type, payload)
    VALUES (?, ?, ?, ?)
  `);

  const payloadStr = payload ? JSON.stringify(payload) : null;
  const result = stmt.run(orderId ?? null, invoiceId ?? null, eventType, payloadStr);

  return db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid) as Event;
}

export function getEventsByOrderId(orderId: number, limit = 50): Event[] {
  return db.prepare('SELECT * FROM events WHERE order_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(orderId, limit) as Event[];
}

export function getEventsByInvoiceId(invoiceId: string, limit = 50): Event[] {
  return db.prepare('SELECT * FROM events WHERE invoice_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(invoiceId, limit) as Event[];
}

export function getRecentEvents(limit = 100): Event[] {
  return db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Event[];
}

// ===========================================
// Repositório de Jobs
// ===========================================

export function createJob(type: string, payload: unknown, maxAttempts = 5): Job {
  const stmt = db.prepare(`
    INSERT INTO jobs (type, payload, max_attempts)
    VALUES (?, ?, ?)
  `);

  const result = stmt.run(type, JSON.stringify(payload), maxAttempts);
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(result.lastInsertRowid) as Job;
}

export function getNextPendingJob(): Job | undefined {
  return db.prepare(`
    SELECT * FROM jobs
    WHERE status = 'pending'
    AND next_run_at <= datetime('now')
    ORDER BY next_run_at ASC
    LIMIT 1
  `).get() as Job | undefined;
}

export function getPendingJobsCount(): number {
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'
  `).get() as { count: number };
  return result.count;
}

export function markJobProcessing(jobId: number): void {
  db.prepare(`
    UPDATE jobs
    SET status = 'processing', attempts = attempts + 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(jobId);
}

export function markJobCompleted(jobId: number): void {
  db.prepare(`
    UPDATE jobs
    SET status = 'completed', updated_at = datetime('now')
    WHERE id = ?
  `).run(jobId);
}

export function markJobFailed(jobId: number, errorMessage: string, retryDelayMinutes?: number): void {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Job;

  if (job.attempts >= job.max_attempts) {
    // Falha permanente
    db.prepare(`
      UPDATE jobs
      SET status = 'failed', error_message = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(errorMessage, jobId);
  } else {
    // Agendar retry com backoff
    const delay = retryDelayMinutes ?? Math.pow(2, job.attempts); // 1, 2, 4, 8, 16 minutos
    db.prepare(`
      UPDATE jobs
      SET status = 'pending', error_message = ?,
          next_run_at = datetime('now', '+' || ? || ' minutes'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(errorMessage, delay, jobId);
  }
}

export function getFailedJobs(limit = 100): Job[] {
  return db.prepare("SELECT * FROM jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT ?")
    .all(limit) as Job[];
}

export function retryJob(jobId: number): void {
  db.prepare(`
    UPDATE jobs
    SET status = 'pending', attempts = 0, next_run_at = datetime('now'),
        error_message = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(jobId);
}

export function deleteCompletedJobs(olderThanDays = 7): number {
  const result = db.prepare(`
    DELETE FROM jobs
    WHERE status = 'completed'
    AND updated_at < datetime('now', '-' || ? || ' days')
  `).run(olderThanDays);
  return result.changes;
}

// ===========================================
// Transações compostas
// ===========================================

export function createOrderWithItems(data: ParsedEduzzData): Order {
  const transaction = db.transaction(() => {
    const order = createOrder(data);
    createOrderItems(order.id, data.items);
    createEvent('order_created', { invoiceId: data.invoiceId }, order.id, data.invoiceId);
    return order;
  });

  return transaction();
}

export function updateOrderWithItems(invoiceId: string, data: ParsedEduzzData): Order | undefined {
  const transaction = db.transaction(() => {
    const order = findOrderByInvoiceId(invoiceId);
    if (!order) return undefined;

    updateOrder(invoiceId, data);
    deleteOrderItems(order.id);
    createOrderItems(order.id, data.items);
    createEvent('order_updated', { invoiceId }, order.id, invoiceId);

    return findOrderByInvoiceId(invoiceId);
  });

  return transaction();
}
