import { db } from "@/lib/db";
import { orders, cards, products } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { isPaymentOrder } from "@/lib/payment";
import { createTokenByLinuxDoId } from "@/lib/siyuan-share";

async function fulfillSiyuanToken(orderId: string, order: any, tradeNo: string): Promise<{ success: boolean; status: string }> {
    const linuxDoId = order.userId;
    if (!linuxDoId) {
        console.error(`[Fulfill] Order ${orderId}: No userId (linuxDoId) on order, cannot create siyuan token`);
        await db.update(orders)
            .set({ status: 'paid', paidAt: new Date(), tradeNo })
            .where(eq(orders.orderId, orderId));
        return { success: true, status: 'processed' };
    }

    const quantity = order.quantity || 1;
    const tokenKeys: string[] = [];

    for (let i = 0; i < quantity; i++) {
        const result = await createTokenByLinuxDoId(
            linuxDoId,
            `ldc-shop-${orderId}${quantity > 1 ? `-${i + 1}` : ''}`
        );
        if (result.success && result.token) {
            tokenKeys.push(result.token);
        } else {
            console.error(`[Fulfill] Order ${orderId}: siyuan-share token creation failed: ${result.error}`);
            break;
        }
    }

    if (tokenKeys.length > 0) {
        await db.update(orders)
            .set({
                status: 'delivered',
                paidAt: new Date(),
                deliveredAt: new Date(),
                tradeNo,
                cardKey: tokenKeys.join('\n'),
            })
            .where(eq(orders.orderId, orderId));
        console.log(`[Fulfill] Order ${orderId}: siyuan token delivered (${tokenKeys.length}/${quantity})`);
    } else {
        await db.update(orders)
            .set({ status: 'paid', paidAt: new Date(), tradeNo })
            .where(eq(orders.orderId, orderId));
        console.log(`[Fulfill] Order ${orderId}: siyuan token failed, marked as paid`);
    }

    return { success: true, status: 'processed' };
}

export async function processOrderFulfillment(orderId: string, paidAmount: number, tradeNo: string) {
    const order = await db.query.orders.findFirst({
        where: eq(orders.orderId, orderId)
    });

    if (!order) {
        throw new Error(`Order ${orderId} not found`);
    }

    // Verify Amount (Prevent penny-dropping)
    const orderMoney = parseFloat(order.amount);

    // Allow small float epsilon difference
    if (Math.abs(paidAmount - orderMoney) > 0.01) {
        throw new Error(`Amount mismatch! Order: ${orderMoney}, Paid: ${paidAmount}`);
    }

    if (isPaymentOrder(order.productId)) {
        if (order.status === 'pending' || order.status === 'cancelled') {
            await db.update(orders)
                .set({
                    status: 'paid',
                    paidAt: new Date(),
                    tradeNo: tradeNo
                })
                .where(eq(orders.orderId, orderId));
        }
        return { success: true, status: 'processed' };
    }

    if (order.status === 'pending' || order.status === 'cancelled') {
        // 判断商品发货类型
        const product = await db.query.products.findFirst({
            where: eq(products.id, order.productId)
        });

        if (product?.fulfillmentType === 'siyuan_token') {
            return fulfillSiyuanToken(orderId, order, tradeNo);
        }

        // 默认：静态卡密发货
        const quantity = order.quantity || 1;

        await db.transaction(async (tx: any) => {
            // Atomic update to claim card (Postgres only)
            let cardKeys: string[] = [];
            let supportsReservation = true;

            try {
                // Try to claim reserved card first
                // Use RETURNING to get all keys
                const reservedResult = await tx.execute(sql`
                    UPDATE cards
                    SET is_used = true,
                        used_at = NOW(),
                        reserved_order_id = NULL,
                        reserved_at = NULL
                    WHERE reserved_order_id = ${orderId} AND COALESCE(is_used, false) = false
                    RETURNING card_key
                `);

                if (reservedResult.rows.length > 0) {
                    cardKeys = reservedResult.rows.map((r: any) => r.card_key);
                }
            } catch (error: any) {
                const errorString = JSON.stringify(error);
                if (
                    error?.message?.includes('reserved_order_id') ||
                    error?.message?.includes('reserved_at') ||
                    errorString.includes('42703')
                ) {
                    supportsReservation = false;
                } else {
                    throw error;
                }
            }

            if (cardKeys.length < quantity) {
                const needed = quantity - cardKeys.length;
                console.log(`[Fulfill] Order ${orderId}: Found ${cardKeys.length} reserved cards, need ${needed} more.`);

                if (supportsReservation) {
                    const result = await tx.execute(sql`
                        UPDATE cards
                        SET is_used = true,
                            used_at = NOW(),
                            reserved_order_id = NULL,
                            reserved_at = NULL
                        WHERE id IN (
                            SELECT id
                            FROM cards
                            WHERE product_id = ${order.productId}
                              AND COALESCE(is_used, false) = false
                              AND (reserved_at IS NULL OR reserved_at < NOW() - INTERVAL '1 minute')
                            LIMIT ${needed}
                            FOR UPDATE SKIP LOCKED
                        )
                        RETURNING card_key
                    `);

                    const newKeys = result.rows.map((r: any) => r.card_key);
                    cardKeys = [...cardKeys, ...newKeys];

                } else {
                    // Legacy fallback
                    const result = await tx.execute(sql`
                        UPDATE cards
                        SET is_used = true, used_at = NOW()
                        WHERE id IN (
                            SELECT id
                            FROM cards
                            WHERE product_id = ${order.productId} AND COALESCE(is_used, false) = false
                            LIMIT ${needed}
                            FOR UPDATE SKIP LOCKED
                        )
                        RETURNING card_key
                    `);

                    const newKeys = result.rows.map((r: any) => r.card_key);
                    cardKeys = [...cardKeys, ...newKeys];
                }
            }

            console.log(`[Fulfill] Order ${orderId}: Cards claimed: ${cardKeys.length}/${quantity}`);

            if (cardKeys.length > 0) {
                const joinedKeys = cardKeys.join('\n');

                await tx.update(orders)
                    .set({
                        status: 'delivered',
                        paidAt: new Date(),
                        deliveredAt: new Date(),
                        tradeNo: tradeNo,
                        cardKey: joinedKeys
                    })
                    .where(eq(orders.orderId, orderId));
                console.log(`[Fulfill] Order ${orderId} delivered successfully!`);
            } else {
                // Paid but no stock
                await tx.update(orders)
                    .set({ status: 'paid', paidAt: new Date(), tradeNo: tradeNo })
                    .where(eq(orders.orderId, orderId));
                console.log(`[Fulfill] Order ${orderId} marked as paid (no stock)`);
            }
        });
        return { success: true, status: 'processed' };
    } else {
        return { success: true, status: 'already_processed' }; // Idempotent success
    }
}
