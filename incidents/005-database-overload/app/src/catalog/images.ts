const CDN = 'https://cdn.shopflow.example/products';
const GALLERY_SIZE = 4;

/** Gallery image URLs for a product; the CDN serves resized variants from the same path. */
export function productImages(sku: string): string[] {
  return Array.from({ length: GALLERY_SIZE }, (_, index) => `${CDN}/${sku}/${index + 1}.jpg`);
}
