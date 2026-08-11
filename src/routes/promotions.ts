import { Router } from 'express';
import optionalAuth from '../middleware/optionalAuth';
import { success, fail } from '../utils/response';
import { cachedFetch } from '../utils/cache';
import { supabase } from '../config/supabase';

const router = Router();

router.get('/', optionalAuth, async (req, res) => {
  try {
    const restaurantId =
      typeof req.query.restaurant_id === 'string' && req.query.restaurant_id
        ? req.query.restaurant_id
        : undefined;

    const cacheKey = restaurantId ? `promotions:${restaurantId}` : 'promotions:all';

    const promotions = await cachedFetch<any[]>(cacheKey, 120, async () => {
      let query = supabase
        .from('promotions')
        .select('*, restaurant:restaurants(id, name)')
        .eq('active', true)
        .order('created_at', { ascending: false });
      if (restaurantId) query = query.eq('restaurant_id', restaurantId);

      const { data, error } = await query;
      if (error) throw error;

      const now = Date.now();
      return (data || []).filter((promo: any) => {
        if (promo.starts_at && new Date(promo.starts_at).getTime() > now) return false;
        if (promo.ends_at && new Date(promo.ends_at).getTime() < now) return false;
        return true;
      });
    });

    return success(res, { promotions });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load promotions', 500);
  }
});

export default router;
