import { query } from '../platform/db.ts';

export interface Category {
  id: number;
  slug: string;
  name: string;
}

export interface CategoryWithCount extends Category {
  productCount: number;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  categoryId: number;
  category: string;
  categorySlug: string;
  createdAt: Date;
}

export interface CatalogEntry {
  id: number;
  sku: string;
  name: string;
  category: string;
}

const PRODUCT_COLUMNS = `
  p.id, p.sku, p.name, p.description, p.price_cents AS "priceCents", p.category_id AS "categoryId",
  c.name AS category, c.slug AS "categorySlug", p.created_at AS "createdAt"`;

export function listCategories(): Promise<CategoryWithCount[]> {
  return query<CategoryWithCount>(
    'categories.list',
    `SELECT c.id, c.slug, c.name, count(p.id)::int AS "productCount"
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY c.name`,
  );
}

export async function findCategoryBySlug(slug: string): Promise<Category | undefined> {
  const [category] = await query<Category>('categories.by-slug', 'SELECT id, slug, name FROM categories WHERE slug = $1', [
    slug,
  ]);
  return category;
}

export function listProducts({
  categoryId,
  limit,
  offset,
}: {
  categoryId?: number | undefined;
  limit: number;
  offset: number;
}): Promise<Product[]> {
  if (categoryId === undefined) {
    return query<Product>(
      'products.list',
      `SELECT ${PRODUCT_COLUMNS}
         FROM products p
         JOIN categories c ON c.id = p.category_id
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
  }
  return query<Product>(
    'products.list-by-category',
    `SELECT ${PRODUCT_COLUMNS}
       FROM products p
       JOIN categories c ON c.id = p.category_id
      WHERE p.category_id = $1
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $2 OFFSET $3`,
    [categoryId, limit, offset],
  );
}

export async function findProduct(id: number): Promise<Product | undefined> {
  const [product] = await query<Product>(
    'products.by-id',
    `SELECT ${PRODUCT_COLUMNS}
       FROM products p
       JOIN categories c ON c.id = p.category_id
      WHERE p.id = $1`,
    [id],
  );
  return product;
}

export function listRelatedProducts(product: Product, limit = 4): Promise<Product[]> {
  return query<Product>(
    'products.related',
    `SELECT ${PRODUCT_COLUMNS}
       FROM products p
       JOIN categories c ON c.id = p.category_id
      WHERE p.category_id = $1 AND p.id <> $2
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $3`,
    [product.categoryId, product.id, limit],
  );
}

/** Every product with its category name, ordered by id. */
export function listProductCatalog(): Promise<CatalogEntry[]> {
  return query<CatalogEntry>(
    'products.catalog',
    `SELECT p.id, p.sku, p.name, c.name AS category
       FROM products p
       JOIN categories c ON c.id = p.category_id
      ORDER BY p.id`,
  );
}
