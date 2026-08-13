import { Router } from 'express';
import optionalAuth from '../middleware/optionalAuth';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { cachedFetch, invalidate } from '../utils/cache';
import { supabase } from '../config/supabase';
import { RestaurantService } from '../services/restaurant.service';

const router = Router();

const PROMO_TYPES = ['percentage', 'fixed_amount', 'free_delivery'];

const normalizePromo = (body: Record<string, any>) => {
  const promo: Record<string, any> = {};
  if (body.name !== undefined) promo.name = String(body.name).trim();
  if (body.type !== undefined) promo.type = String(body.type).trim();
  if (body.discount_value !== undefined)
    promo.discount_value = Number(body.discount_value) || 0;
  if (body.minimum_order !== undefined && body.minimum_order !== '')
    promo.minimum_order = Number(body.minimum_order) || 0;
  else if (body.minimum_order === '') promo.minimum_order = null;
  if (body.menu_item_id !== undefined && body.menu_item_id !== '')
    promo.menu_item_id = body.menu_item_id;
  else if (body.menu_item_id === '') promo.menu_item_id = null;
  if (body.usage_limit !== undefined && body.usage_limit !== '')
    promo.usage_limit = Math.max(0, Number(body.usage_limit) || 0);
  else if (body.usage_limit === '') promo.usage_limit = null;
  if (body.starts_at !== undefined && body.starts_at !== '')
    promo.starts_at = body.starts_at;
  else if (body.starts_at === '') promo.starts_at = null;
  if (body.ends_at !== undefined && body.ends_at !== '')
    promo.ends_at = body.ends_at;
  else if (body.ends_at === '') promo.ends_at = null;
  if (body.active !== undefined) promo.active = body.active === true;
  if (body.budget !== undefined && body.budget !== '')
    promo.budget = Number(body.budget) || null;
  else if (body.budget === '') promo.budget = null;
  if (body.metadata !== undefined) promo.metadata = body.metadata;
  return promo;
};

const validatePromo = (promo: Record<string, any>) => {
  if (!promo.name) return 'Promotion name is required';
  if (promo.type && !PROMO_TYPES.includes(promo.type))
    return 'Invalid promotion type';
  return null;
};

// Public feed: active promotions, optionally filtered by restaurant.
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

// Restaurant owner's own promotions (including inactive), used by the
// restaurant settings UI.
router.get('/mine', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const userId = String(req.user?.id);
    let restaurantIds: string[];
    if (req.user?.role === 'ADMIN') {
      restaurantIds = (
        typeof req.query.restaurant_id === 'string' && req.query.restaurant_id
          ? [req.query.restaurant_id]
          : []
      );
    } else {
      restaurantIds = await RestaurantService.getOwnedRestaurantIds(userId);
    }
    if (restaurantIds.length === 0) return success(res, { promotions: [] });

    let query = supabase
      .from('promotions')
      .select('*, menu_item:menu_items(id, name), restaurant:restaurants(id, name)')
      .in('restaurant_id', restaurantIds)
      .order('created_at', { ascending: false });
    const { data, error } = await query;
    if (error) throw error;

    return success(res, { promotions: data ?? [] });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load promotions', 500);
  }
});

router.post('/', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const userId = String(req.user?.id);
    const restaurantId = String(req.body.restaurant_id || '');
    if (!restaurantId) {
      return fail(res, 'restaurant_id is required', 400);
    }
    if (req.user?.role === 'RESTAURANT_OWNER') {
      const owned = await RestaurantService.getOwnedRestaurantIds(userId);
      if (!owned.includes(restaurantId)) {
        return fail(res, 'Forbidden', 403);
      }
    }

    const promo = normalizePromo(req.body);
    const validationError = validatePromo(promo);
    if (validationError) return fail(res, validationError, 400);

    if (promo.menu_item_id) {
      const { data: item } = await supabase
        .from('menu_items')
        .select('id')
        .eq('id', promo.menu_item_id)
        .eq('restaurant_id', restaurantId)
        .maybeSingle();
      if (!item) {
        return fail(res, 'Selected menu item does not belong to this restaurant', 400);
      }
    }

    const { data, error } = await supabase
      .from('promotions')
      .insert({ ...promo, restaurant_id: restaurantId, active: promo.active ?? true })
      .select('*, menu_item:menu_items(id, name)')
      .single();
    if (error) throw error;

    await invalidate('promotions:');
    return success(res, { promotion: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to create promotion', 500);
  }
});

router.patch('/:id', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const userId = String(req.user?.id);
    const promotionId = String(req.params.id);

    const { data: existing, error: fetchError } = await supabase
      .from('promotions')
      .select('restaurant_id')
      .eq('id', promotionId)
      .single();
    if (fetchError || !existing) return fail(res, 'Promotion not found', 404);

    if (req.user?.role === 'RESTAURANT_OWNER') {
      const owned = await RestaurantService.getOwnedRestaurantIds(userId);
      if (!owned.includes(String(existing.restaurant_id))) {
        return fail(res, 'Forbidden', 403);
      }
    }

    const promo = normalizePromo(req.body);
    const validationError = validatePromo({ ...existing, ...promo });
    if (validationError) return fail(res, validationError, 400);

    if (promo.menu_item_id) {
      const { data: item } = await supabase
        .from('menu_items')
        .select('id')
        .eq('id', promo.menu_item_id)
        .eq('restaurant_id', existing.restaurant_id)
        .maybeSingle();
      if (!item) {
        return fail(res, 'Selected menu item does not belong to this restaurant', 400);
      }
    }

    const { data, error } = await supabase
      .from('promotions')
      .update(promo)
      .eq('id', promotionId)
      .select('*, menu_item:menu_items(id, name)')
      .single();
    if (error) throw error;

    await invalidate('promotions:');
    return success(res, { promotion: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update promotion', 500);
  }
});

router.delete('/:id', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const userId = String(req.user?.id);
    const promotionId = String(req.params.id);

    const { data: existing, error: fetchError } = await supabase
      .from('promotions')
      .select('restaurant_id')
      .eq('id', promotionId)
      .single();
    if (fetchError || !existing) return fail(res, 'Promotion not found', 404);

    if (req.user?.role === 'RESTAURANT_OWNER') {
      const owned = await RestaurantService.getOwnedRestaurantIds(userId);
      if (!owned.includes(String(existing.restaurant_id))) {
        return fail(res, 'Forbidden', 403);
      }
    }

    const { error } = await supabase.from('promotions').delete().eq('id', promotionId);
    if (error) throw error;

    await invalidate('promotions:');
    return success(res, { message: 'Promotion deleted' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to delete promotion', 500);
  }
});

export default router;
