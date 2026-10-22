import express from 'express';
import { notFound } from '../shared/http-errors.ts';
import { formatMoney } from '../shared/money.ts';
import { cacheResponses } from '../shared/response-cache.ts';
import { optionalIntInRange, positiveInt } from '../shared/validation.ts';
import {
  findCategoryBySlug,
  findProduct,
  listCategories,
  listProducts,
  listRelatedProducts,
  type Product,
} from './catalog.repository.ts';
import { productImages } from './images.ts';

const CATALOG_TTL_MS = 60_000;

export const catalogRouter = express.Router();

/** What a product card in a listing needs. */
function toCard(product: Product) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    category: product.categorySlug,
    description: product.description,
    images: productImages(product.sku),
    price: formatMoney(product.priceCents),
    priceCents: product.priceCents,
  };
}

catalogRouter.get('/categories', cacheResponses({ ttlMs: CATALOG_TTL_MS }), async (_req, res) => {
  res.json({ items: await listCategories() });
});

catalogRouter.get('/products', cacheResponses({ ttlMs: CATALOG_TTL_MS, params: ['category', 'page', 'limit'] }), async (req, res) => {
  const page = optionalIntInRange(req.query.page, 'page', { min: 1, max: 100, fallback: 1 });
  const limit = optionalIntInRange(req.query.limit, 'limit', { min: 1, max: 100, fallback: 24 });

  let categoryId: number | undefined;
  if (typeof req.query.category === 'string') {
    const category = await findCategoryBySlug(req.query.category);
    if (!category) throw notFound('category');
    categoryId = category.id;
  }

  const products = await listProducts({ categoryId, limit, offset: (page - 1) * limit });
  res.json({ page, limit, items: products.map(toCard) });
});

catalogRouter.get('/products/:id', cacheResponses({ ttlMs: CATALOG_TTL_MS }), async (req, res) => {
  const product = await findProduct(positiveInt(req.params.id, 'id'));
  if (!product) throw notFound('product');

  const related = await listRelatedProducts(product);
  res.json({
    ...toCard(product),
    categoryName: product.category,
    related: related.map(toCard),
  });
});
