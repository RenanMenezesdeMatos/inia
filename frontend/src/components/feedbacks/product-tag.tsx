/** Selo discreto com o produto (`PRODUCT_IN_FEEDBACK_V1`): de uma fala, de um ponto, de uma regra ou de uma prática da base. */
export function ProductTag({ product, prefix }: { product: string; prefix?: string }) {
  return <span className="inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] leading-4 text-muted-foreground not-italic break-words" data-slot="product-tag">{prefix ? `${prefix} ` : ""}{product}</span>
}
