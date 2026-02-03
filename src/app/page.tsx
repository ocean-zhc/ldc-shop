import { getActiveProducts, getCategories, getProductRating, getVisitorCount, getUserPendingOrders } from "@/lib/db/queries";
import { getActiveAnnouncement } from "@/actions/settings";
import { auth } from "@/lib/auth";
import { HomeContent } from "@/components/home-content";

// Revalidate every 5 seconds for near-real-time updates
export const revalidate = 5;

export default async function Home() {
  // Run all independent queries in parallel
  const [session, productsResult, announcement, visitorCount, categories] = await Promise.all([
    auth(),
    getActiveProducts().catch(() => []),
    getActiveAnnouncement().catch(() => null),
    getVisitorCount().catch(() => 0),
    getCategories().catch(() => [])
  ]);

  const products = productsResult;

  // Fetch ratings for all products in parallel
  const productsWithRatings = await Promise.all(
    products.map(async (p: any) => {
      let rating = { average: 0, count: 0 };
      try {
        rating = await getProductRating(p.id);
      } catch {
        // Reviews table might not exist yet
      }
      return {
        ...p,
        stockCount: p.fulfillmentType === 'siyuan_token' ? 999 : p.stock + (p.locked || 0),
        soldCount: p.sold || 0,
        rating: rating.average,
        reviewCount: rating.count
      };
    })
  );

  // Check for pending orders (depends on session)
  let pendingOrders: any[] = [];
  if (session?.user?.id) {
    try {
      pendingOrders = await getUserPendingOrders(session.user.id);
    } catch {
      // Ignore errors fetching pending orders
    }
  }

  return <HomeContent
    products={productsWithRatings}
    announcement={announcement}
    visitorCount={visitorCount}
    categories={categories}
    pendingOrders={pendingOrders}
  />;
}
