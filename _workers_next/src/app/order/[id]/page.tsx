import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { orders, products, refundRequests } from "@/lib/db/schema"
import { and, desc, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { cookies } from "next/headers"
import { OrderContent } from "@/components/order-content"
import { cancelExpiredOrders } from "@/lib/db/queries"

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const session = await auth()
    const user = session?.user

    try {
        await cancelExpiredOrders({ orderId: id })
    } catch {
        // Best effort cleanup
    }

    const order = await db.query.orders.findFirst({
        where: eq(orders.orderId, id)
    })

    if (!order) return notFound()

    // Check if product is dynamic fulfillment type
    let isDynamic = false
    if (order.productId) {
        const product = await db.query.products.findFirst({
            where: eq(products.id, order.productId),
            columns: { fulfillmentType: true }
        })
        isDynamic = product?.fulfillmentType === 'siyuan_token'
    }

    // Access Control
    let canViewKey = false
    const isOwner = !!(user && (user.id === order.userId || user.username === order.username))
    if (isOwner) canViewKey = true

    // Check Cookie
    const cookieStore = await cookies()
    const pending = cookieStore.get('ldc_pending_order')
    if (pending?.value === id) canViewKey = true

    // Refund request status (best effort)
    let refundRequest: any = null
    if (user?.id) {
        try {
            refundRequest = await db.query.refundRequests.findFirst({
                where: and(eq(refundRequests.orderId, id), eq(refundRequests.userId, user.id)),
                orderBy: [desc(refundRequests.createdAt)]
            })
        } catch {
            refundRequest = null
        }
    }

    return (
        <OrderContent
            order={{
                orderId: order.orderId,
                productId: order.productId,
                productName: order.productName,
                amount: order.amount,
                status: order.status || 'pending',
                cardKey: order.cardKey,
                payee: order.payee,
                createdAt: order.createdAt,
                paidAt: order.paidAt
            }}
            canViewKey={canViewKey}
            isOwner={isOwner}
            isDynamic={isDynamic}
            refundRequest={refundRequest ? { status: refundRequest.status, reason: refundRequest.reason } : null}
        />
    )
}
