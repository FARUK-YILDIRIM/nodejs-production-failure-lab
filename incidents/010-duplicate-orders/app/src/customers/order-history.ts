import { productImages } from '../catalog/images.ts';
import { listCustomerOrders, listItemsForOrders } from '../orders/orders.repository.ts';
import { formatMoney } from '../shared/money.ts';

/**
 * "My orders": recent orders with their line items, each with its product image and category.
 * Two queries whatever the number of orders and items: every query costs a network
 * round trip to the database, so they must not grow with the size of the page.
 */
export async function orderHistory(customerId: number, limit: number) {
  const orders = await listCustomerOrders(customerId, limit);
  const items = Map.groupBy(await listItemsForOrders(orders.map((order) => order.id)), (item) => item.orderId);

  return orders.map((order) => ({
    ...order,
    total: formatMoney(order.totalCents),
    items: (items.get(order.id) ?? []).map((item) => ({
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unitPrice: formatMoney(item.unitPriceCents),
      image: productImages(item.sku)[0] ?? null,
      category: item.categorySlug,
    })),
  }));
}
