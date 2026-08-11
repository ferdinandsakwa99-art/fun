import { supabase } from '../config/supabase';
import { RecommendationService } from './recommendation.service';

export const HomeService = {
  async getHomeFeed(opts: { lat?: number; lon?: number }) {
    const { lat, lon } = opts;

    const [restaurantsRes, categoriesRes, promotionsRes, bannersRes] =
      await Promise.all([
        supabase.from('restaurants').select('*').limit(20),
        supabase.from('categories').select('*').limit(20),
        supabase
          .from('promotions')
          .select('*, restaurant:restaurants(id, name)')
          .eq('active', true)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('restaurant_banners')
          .select('*')
          .order('sort_order', { ascending: true })
          .limit(10),
      ]);

    const errors = [
      restaurantsRes.error,
      categoriesRes.error,
      promotionsRes.error,
      bannersRes.error,
    ].filter(Boolean);
    if (errors.length > 0) throw errors[0];

    const now = Date.now();
    const promotions = (promotionsRes.data || []).filter((promo: any) => {
      if (promo.starts_at && new Date(promo.starts_at).getTime() > now) return false;
      if (promo.ends_at && new Date(promo.ends_at).getTime() < now) return false;
      return true;
    });

    const popular = await RecommendationService.getPopular({ lat, lon, limit: 12 });
    const popularIds = popular.results.map((r: any) => r.id);

    let popularItems: any[] = [];
    if (popularIds.length > 0) {
      const { data: items, error: itemsError } = await supabase
        .from('menu_items')
        .select(
          '*, images:menu_item_images(id, menu_item_id, image_url, alt_text, is_primary, sort_order), restaurant:restaurants(id, name, cover_image)',
        )
        .in('id', popularIds);
      if (itemsError) throw itemsError;

      const byId = new Map((items || []).map((item: any) => [item.id, item]));
      popularItems = popular.results
        .map((r: any) => byId.get(r.id))
        .filter(Boolean);
    }

    return {
      restaurants: restaurantsRes.data || [],
      categories: categoriesRes.data || [],
      promotions,
      banners: bannersRes.data || [],
      popularItems,
    };
  },
};

export default HomeService;
