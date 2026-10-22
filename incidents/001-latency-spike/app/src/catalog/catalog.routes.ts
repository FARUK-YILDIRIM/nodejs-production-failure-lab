import express from 'express';
import { formatMoney } from '../shared/money.ts';
import { notFound } from '../shared/http-errors.ts';
import { optionalIntInRange, positiveInt } from '../shared/validation.ts';
import {
  findCategoryBySlug,
  findProduct,
  listCategories,
  listProducts,
  listRelatedProducts,
  type Product,
} from './catalog.repository.ts';

export const catalogRouter = express.Router();

function toSummary(product: Product) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    category: product.categorySlug,
    price: formatMoney(product.priceCents),
    priceCents: product.priceCents,
  };
}

catalogRouter.get('/categories', async (_req, res) => {
  res.json({ items: await listCategories() });
});

catalogRouter.get('/products', async (req, res) => {
  const page = optionalIntInRange(req.query.page, 'page', { min: 1, max: 100, fallback: 1 });
  const limit = optionalIntInRange(req.query.limit, 'limit', { min: 1, max: 100, fallback: 24 });

  let categoryId: number | undefined;
  if (typeof req.query.category === 'string') {
    const category = await findCategoryBySlug(req.query.category);
    if (!category) throw notFound('category');
    categoryId = category.id;
  }

  const products = await listProducts({ categoryId, limit, offset: (page - 1) * limit });
  res.json({ page, limit, items: products.map(toSummary) });
});

catalogRouter.get('/products/:id', async (req, res) => {
  const product = await findProduct(positiveInt(req.params.id, 'id'));
  if (!product) throw notFound('product');

  const related = await listRelatedProducts(product);
  res.json({
    ...toSummary(product),
    description: product.description,
    categoryName: product.category,
    related: related.map(toSummary),
  });
});
