import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { BuyContent } from "@/components/buy-content"
import { getProduct, getProductReviews, getProductRating, canUserReview } from "@/lib/db/queries"

// Revalidate every 5 seconds for near-real-time stock updates
export const revalidate = 5

interface BuyPageProps {
    params: Promise<{ id: string }>
}

export default async function BuyPage({ params }: BuyPageProps) {
    const { id } = await params

    // Run all queries in parallel for better performance
    const [session, product, reviews, rating] = await Promise.all([
        auth(),
        getProduct(id).catch(() => null),
        getProductReviews(id).catch(() => []),
        getProductRating(id).catch(() => ({ average: 0, count: 0 }))
    ])

    // Return 404 if product doesn't exist or is inactive
    if (!product) {
        notFound()
    }

    // Check review eligibility (depends on session, so run after)
    let userCanReview: { canReview: boolean; orderId?: string } = { canReview: false }
    if (session?.user?.id) {
        try {
            userCanReview = await canUserReview(session.user.id, id, session.user.username || undefined)
        } catch {
            // Ignore errors
        }
    }

    const isDynamic = product.fulfillmentType === 'siyuan_token';

    return (
        <BuyContent
            product={product}
            stockCount={isDynamic ? 999 : (product.stock || 0)}
            lockedStockCount={isDynamic ? 0 : (product.locked || 0)}
            isLoggedIn={!!session?.user}
            reviews={reviews}
            averageRating={rating.average}
            reviewCount={rating.count}
            canReview={userCanReview.canReview}
            reviewOrderId={userCanReview.orderId}
            isDynamic={isDynamic}
        />
    )
}
