import { Router } from 'express';
import auth from '../middleware/auth';
import { success, fail } from '../utils/response';
import { supabase } from '../config/supabase';

const router = Router();

router.get('/', auth, async (req, res) => {
  try {
    const restaurantId =
      typeof req.query.restaurant_id === 'string' && req.query.restaurant_id
        ? req.query.restaurant_id
        : undefined;

    let query = supabase
      .from('promotions')
      .select('*, restaurant:restaurants(id, name)')
      .eq('active', true)
      .order('created_at', { ascending: false });
    if (restaurantId) query = query.eq('restaurant_id', restaurantId);

    const { data, error } = await query;
    if (error) throw error;

    const now = Date.now();
    const promotions = (data || []).filter((promo: any) => {
      if (promo.starts_at && new Date(promo.starts_at).getTime() > now) return false;
      if (promo.ends_at && new Date(promo.ends_at).getTime() < now) return false;
      return true;
    });

    return success(res, { promotions });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load promotions', 500);
  }
});

export default router;
