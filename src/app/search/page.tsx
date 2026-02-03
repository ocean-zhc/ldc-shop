import { searchActiveProducts, getCategories } from "@/lib/db/queries"
import { SearchContent } from "@/components/search-content"

export const dynamic = 'force-dynamic';

function firstParam(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined
  return Array.isArray(value) ? value[0] : value
}

function parseIntParam(value: unknown, fallback: number) {
  const num = typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  return Number.isFinite(num) && num > 0 ? num : fallback
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const q = (firstParam(searchParams.q) || '').trim()
  const category = (firstParam(searchParams.category) || 'all').trim()
  const sort = (firstParam(searchParams.sort) || 'default').trim()
  const page = parseIntParam(firstParam(searchParams.page), 1)
  const pageSize = Math.min(parseIntParam(firstParam(searchParams.pageSize), 24), 60)

  const [result, categories] = await Promise.all([
    searchActiveProducts({ q, category, sort, page, pageSize }),
    getCategories(),
  ])

  return (
    <SearchContent
      q={q}
      category={category}
      sort={sort}
      page={result.page}
      pageSize={result.pageSize}
      total={result.total}
      products={result.items.map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
        compareAtPrice: p.compareAtPrice ?? null,
        image: p.image,
        category: p.category,
        isHot: p.isHot ?? false,
        stockCount: p.fulfillmentType === 'siyuan_token' ? 999 : p.stock,
        soldCount: p.sold || 0
      }))}
      categories={categories.map((c: any) => ({ name: c.name, icon: c.icon, sortOrder: c.sortOrder }))}
    />
  )
}

