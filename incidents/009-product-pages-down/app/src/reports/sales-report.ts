import { query } from '../platform/db.ts';
import { toCsv } from '../shared/csv.ts';
import { formatMoney } from '../shared/money.ts';

export interface DateRange {
  /** Inclusive, midnight UTC. */
  from: Date;
  /** Exclusive, midnight UTC. */
  to: Date;
}

const HEADER = [
  'order_id',
  'order_date',
  'customer_email',
  'sku',
  'product',
  'category',
  'quantity',
  'unit_price',
  'line_total',
] as const;

interface Sale {
  orderId: number;
  orderedAt: Date;
  customerEmail: string;
  sku: string;
  product: string;
  category: string;
  quantity: number;
  unitPriceCents: number;
}

/** One CSV line per order item sold in the given range, oldest first. */
export async function buildSalesReport(range: DateRange): Promise<string> {
  // The database joins product and category details through indexes, instead
  // of the API scanning the whole catalog once per line.
  const sales = await query<Sale>(
    'reports.sales',
    `SELECT o.id AS "orderId", o.created_at AS "orderedAt", c.email AS "customerEmail",
            p.sku, p.name AS product, cat.name AS category,
            i.quantity, i.unit_price_cents AS "unitPriceCents"
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       JOIN order_items i ON i.order_id = o.id
       JOIN products p ON p.id = i.product_id
       JOIN categories cat ON cat.id = p.category_id
      WHERE o.created_at >= $1 AND o.created_at < $2
      ORDER BY o.created_at, o.id, i.id`,
    [range.from, range.to],
  );

  const rows = sales.map((sale) => [
    sale.orderId,
    sale.orderedAt.toISOString().slice(0, 10),
    sale.customerEmail,
    sale.sku,
    sale.product,
    sale.category,
    sale.quantity,
    formatMoney(sale.unitPriceCents),
    formatMoney(sale.unitPriceCents * sale.quantity),
  ]);

  return toCsv(HEADER, rows);
}
