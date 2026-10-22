import { listProductCatalog } from '../catalog/catalog.repository.ts';
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
  productId: number;
  quantity: number;
  unitPriceCents: number;
}

/** One CSV line per order item sold in the given range, oldest first. */
export async function buildSalesReport(range: DateRange): Promise<string> {
  const sales = await query<Sale>(
    'reports.sales',
    `SELECT o.id AS "orderId", o.created_at AS "orderedAt", c.email AS "customerEmail",
            i.product_id AS "productId", i.quantity, i.unit_price_cents AS "unitPriceCents"
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       JOIN order_items i ON i.order_id = o.id
      WHERE o.created_at >= $1 AND o.created_at < $2
      ORDER BY o.created_at, o.id, i.id`,
    [range.from, range.to],
  );

  // Finance needs SKU, product name and category next to each line.
  const catalog = await listProductCatalog();

  const rows = sales.map((sale) => {
    const product = catalog.find((entry) => entry.id === sale.productId);
    return [
      sale.orderId,
      sale.orderedAt.toISOString().slice(0, 10),
      sale.customerEmail,
      product?.sku,
      product?.name,
      product?.category,
      sale.quantity,
      formatMoney(sale.unitPriceCents),
      formatMoney(sale.unitPriceCents * sale.quantity),
    ];
  });

  return toCsv(HEADER, rows);
}
