import { Router } from 'express';
import auth from '../middleware/auth';
import optionalAuth from '../middleware/optionalAuth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { cachedFetch, invalidate } from '../utils/cache';
import { supabase } from '../config/supabase';
import { RestaurantService } from '../services/restaurant.service';

const router = Router();

const generateSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const ownedScope = async (userId: string) => {
  const owned = await RestaurantService.getOwnedRestaurantIds(userId);
  return owned;
};

router.get('/', optionalAuth, async (req, res) => {
  try {
    const scopedRestaurantId =
      typeof req.query.restaurant_id === 'string' && req.query.restaurant_id
        ? req.query.restaurant_id
        : undefined;

    // Owners only see their own restaurants' categories. Everyone else
    // (customers, guests, admins) gets the global category list used for
    // browsing across restaurants.
    let scopeKey = 'all';
    let scopeRestaurantIds: string[] | undefined;

    if (scopedRestaurantId) {
      scopeKey = `restaurant:${scopedRestaurantId}`;
      scopeRestaurantIds = [scopedRestaurantId];
    } else if (req.user?.role === 'RESTAURANT_OWNER') {
      scopeKey = `owner:${req.user.id}`;
      scopeRestaurantIds = await ownedScope(String(req.user.id));
    }

    const cacheKey = `categories:${scopeKey}`;
    const data = await cachedFetch<any[]>(cacheKey, 1800, async () => {
      let query = supabase.from('categories').select('*');
      if (scopeRestaurantIds) {
        query = query.in('restaurant_id', scopeRestaurantIds);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    });
    return success(res, { menuCategories: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load categories', 500);
  }
});

router.post('/', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) {
      return fail(res, 'Category name is required', 400);
    }

    const owned = await ownedScope(String(req.user?.id));
    const requestedRestaurantId = req.body.restaurant_id
      ? String(req.body.restaurant_id)
      : null;

    let restaurantId: string | null = null;
    if (req.user?.role === 'RESTAURANT_OWNER') {
      if (owned.length === 0) {
        return fail(res, 'No restaurant is associated with this account', 403);
      }
      if (owned.length === 1) {
        restaurantId = owned[0];
      } else {
        if (!requestedRestaurantId || !owned.includes(requestedRestaurantId)) {
          return fail(res, 'restaurant_id must match one of your restaurants', 400);
        }
        restaurantId = requestedRestaurantId;
      }
    } else if (requestedRestaurantId) {
      restaurantId = requestedRestaurantId;
    }

    const categoryPayload: Record<string, any> = {
      name,
      description: req.body.description || null,
      slug: generateSlug(name),
    };
    if (restaurantId) categoryPayload.restaurant_id = restaurantId;

    const { data, error } = await supabase.from('categories').insert(categoryPayload).select().single();
    if (error) throw error;
    await invalidate('categories:', 'home:');
    return success(res, { menuCategory: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to create category', 500);
  }
});

router.patch('/:id', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const { data: existing, error: fetchError } = await supabase
      .from('categories')
      .select('*')
      .eq('id', Number(req.params.id))
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) {
      return fail(res, 'Menu category not found', 404);
    }

    if (req.user?.role === 'RESTAURANT_OWNER') {
      if (!existing.restaurant_id) {
        return fail(res, 'Forbidden', 403);
      }
      const allowed = await RestaurantService.isOwnerForRestaurant(
        String(req.user.id),
        existing.restaurant_id,
      );
      if (!allowed) {
        return fail(res, 'Forbidden', 403);
      }
    }

    const { data, error } = await supabase.from('categories').update(req.body).eq('id', Number(req.params.id)).select().single();
    if (error) throw error;
    await invalidate('categories:', 'home:');
    return success(res, { menuCategory: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update category', 500);
  }
});

router.delete('/:id', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const { data: existing, error: fetchError } = await supabase
      .from('categories')
      .select('*')
      .eq('id', Number(req.params.id))
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) {
      return fail(res, 'Menu category not found', 404);
    }

    if (req.user?.role === 'RESTAURANT_OWNER') {
      if (!existing.restaurant_id) {
        return fail(res, 'Forbidden', 403);
      }
      const allowed = await RestaurantService.isOwnerForRestaurant(
        String(req.user.id),
        existing.restaurant_id,
      );
      if (!allowed) {
        return fail(res, 'Forbidden', 403);
      }
    }

    const { error } = await supabase.from('categories').delete().eq('id', Number(req.params.id));
    if (error) throw error;
    await invalidate('categories:', 'home:');
    return success(res, { message: 'Menu category deleted' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to delete category', 500);
  }
});

export default router;
