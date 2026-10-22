import { findProduct } from '../catalog/catalog.repository.ts';
import { productImages } from '../catalog/images.ts';
import { listCustomerOrders, listOrderItems } from '../orders/orders.repository.ts';
import { formatMoney } from '../shared/money.ts';

/** "My orders": recent orders with their line items, each with its product image and category. */
export async function orderHistory(customerId: number, limit: number) {
  const orders = await listCustomerOrders(customerId, limit);

  const history = [];
  for (const order of orders) {
    const items = await listOrderItems(order.id);
    const lines = [];
    for (const item of items) {
      const product = await findProduct(item.productId);
      lines.push({
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        unitPrice: formatMoney(item.unitPriceCents),
        image: product ? productImages(product.sku)[0] : null,
        category: product?.categorySlug ?? null,
      });
    }
    history.push({ ...order, total: formatMoney(order.totalCents), items: lines });
  }
  return history;
}
