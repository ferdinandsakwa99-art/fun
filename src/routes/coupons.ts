import { Router } from 'express';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { supabase } from '../config/supabase';
import { CartService } from '../services/cart.service';
import { PromoService } from '../services/promo.service';
import { RestaurantService } from '../services/restaurant.service';

const router = Router();

const COUPON_TYPES = ['percentage', 'fixed_amount', 'free_delivery'];

const normalizeCoupon = (body: Record<string, any>) => {
  const coupon: Record<string, any> = {};
  if (body.name !== undefined) coupon.name = String(body.name).trim();
  if (body.code !== undefined) coupon.code = String(body.code).trim().toUpperCase();
  if (body.description !== undefined)
    coupon.description = body.description === '' ? null : String(body.description);
  if (body.type !== undefined) coupon.type = String(body.type).trim();
  if (body.value !== undefined) coupon.value = Number(body.value) || 0;
  if (body.max_discount !== undefined && body.max_discount !== '')
    coupon.max_discount = Number(body.max_discount) || null;
  else if (body.max_discount === '') coupon.max_discount = null;
  if (body.min_order_amount !== undefined && body.min_order_amount !== '')
    coupon.min_order_amount = Number(body.min_order_amount) || null;
  else if (body.min_order_amount === '') coupon.min_order_amount = null;
  if (body.per_user_limit !== undefined && body.per_user_limit !== '')
    coupon.per_user_limit = Math.max(0, Number(body.per_user_limit) || 0);
  else if (body.per_user_limit === '') coupon.per_user_limit = null;
  if (body.usage_limit !== undefined && body.usage_limit !== '')
    coupon.usage_limit = Math.max(0, Number(body.usage_limit) || 0);
  else if (body.usage_limit === '') coupon.usage_limit = null;
  if (body.starts_at !== undefined && body.starts_at !== '')
    coupon.starts_at = body.starts_at;
  else if (body.starts_at === '') coupon.starts_at = null;
  if (body.expires_at !== undefined && body.expires_at !== '')
    coupon.expires_at = body.expires_at;
  else if (body.expires_at === '') coupon.expires_at = null;
  if (body.promotion_id !== undefined && body.promotion_id !== '')
    coupon.promotion_id = body.promotion_id;
  else if (body.promotion_id === '') coupon.promotion_id = null;
  if (body.is_active !== undefined) coupon.is_active = body.is_active === true;
  return coupon;
};

const validateCoupon = (coupon: Record<string, any>) => {
  if (!coupon.code) return 'Coupon code is required';
  if (coupon.type && !COUPON_TYPES.includes(coupon.type)) return 'Invalid coupon type';
  if (coupon.value != null && coupon.value < 0) return 'Discount value cannot be negative';
  return null;
};

// Restaurant owner / admin coupon management list.
router.get('/', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const userId = String(req.user?.id);
    let query = supabase
      .from('coupons')
      .select('*, promotion:promotions(id, name)')
      .order('created_at', { ascending: false });

    if (req.user?.role === 'RESTAURANT_OWNER') {
      const restaurantIds = await RestaurantService.getOwnedRestaurantIds(userId);
      if (restaurantIds.length === 0) return success(res, { coupons: [] });
      query = query.in('restaurant_id', restaurantIds);
    } else if (typeof req.query.restaurant_id === 'string' && req.query.restaurant_id) {
      query = query.eq('restaurant_id', req.query.restaurant_id);
    }

    const { data, error } = await query;
    if (error) throw error;
    return success(res, { coupons: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load coupons', 500);
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

    const coupon = normalizeCoupon(req.body);
    const validationError = validateCoupon(coupon);
    if (validationError) return fail(res, validationError, 400);

    const { data, error } = await supabase
      .from('coupons')
      .insert({ ...coupon, restaurant_id: restaurantId, is_active: coupon.is_active ?? true })
      .select('*, promotion:promotions(id, name)')
      .single();
    if (error) {
      if (error.code === '23505') {
        return fail(res, 'A coupon with this code already exists', 409);
      }
      throw error;
    }
    return success(res, { coupon: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to create coupon', 500);
  }
});

router.post('/apply', auth, authorize('CUSTOMER'), async (req, res) => {
  try {
    const userId = String(req.user?.id);
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) {
      return fail(res, 'Coupon code is required', 400);
    }

    const { data: coupon, error } = await supabase
      .from('coupons')
      .select('*')
      .eq('code', code)
      .single();
    if (error || !coupon) {
      return fail(res, 'Invalid coupon code', 404);
    }

    if (coupon.is_active === false) {
      return fail(res, 'This coupon is not active', 400);
    }

    const now = new Date().getTime();
    if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) {
      return fail(res, 'This coupon is not active yet', 400);
    }
    if (coupon.expires_at && new Date(coupon.expires_at).getTime() < now) {
      return fail(res, 'This coupon has expired', 400);
    }
    if (coupon.usage_limit && (Number(coupon.used_count) || 0) >= Number(coupon.usage_limit)) {
      return fail(res, 'This coupon has reached its usage limit', 400);
    }
    if (coupon.per_user_limit && Number(coupon.per_user_limit) > 0) {
      const usedByUser = await PromoService.usageCount(coupon.id, userId);
      if (usedByUser >= Number(coupon.per_user_limit)) {
        return fail(res, 'You have reached the maximum uses for this coupon', 400);
      }
    }

    let cart = await CartService.getCartByUserId(userId);
    if (!cart || !cart.items || cart.items.length === 0) {
      return fail(res, 'Your cart is empty', 400);
    }

    if (coupon.restaurant_id && cart.restaurant_id && String(coupon.restaurant_id) !== String(cart.restaurant_id)) {
      return fail(res, 'This coupon is not valid for items in your cart', 400);
    }

    const subtotal = Number(cart.subtotal) || 0;
    if (coupon.min_order_amount && subtotal < Number(coupon.min_order_amount)) {
      return fail(res, `Minimum order for this coupon is KSh ${Number(coupon.min_order_amount).toFixed(2)}`, 400);
    }

    await CartService.applyCoupon(cart.id, coupon.id);
    const discount = await CartService.computeCouponDiscount(coupon, subtotal);
    cart = await CartService.getCartByUserId(userId);

    return success(res, { coupon, discount, cart });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to apply coupon', 500);
  }
});

router.post('/remove', auth, authorize('CUSTOMER'), async (req, res) => {
  try {
    const userId = String(req.user?.id);
    const cart = await CartService.getCartByUserId(userId);
    if (cart && cart.id) {
      await CartService.removeCoupon(cart.id);
    }
    const refreshed = await CartService.getCartByUserId(userId);
    return success(res, { cart: refreshed || { items: [] } });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to remove coupon', 500);
  }
});

router.patch('/:id', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const userId = String(req.user?.id);
    const couponId = String(req.params.id);

    const { data: existing, error: fetchError } = await supabase
      .from('coupons')
      .select('restaurant_id, code')
      .eq('id', couponId)
      .single();
    if (fetchError || !existing) return fail(res, 'Coupon not found', 404);

    if (req.user?.role === 'RESTAURANT_OWNER') {
      const owned = await RestaurantService.getOwnedRestaurantIds(userId);
      if (!owned.includes(String(existing.restaurant_id))) {
        return fail(res, 'Forbidden', 403);
      }
    }

    const coupon = normalizeCoupon(req.body);
    const validationError = validateCoupon({ ...existing, ...coupon });
    if (validationError) return fail(res, validationError, 400);

    const { data, error } = await supabase
      .from('coupons')
      .update(coupon)
      .eq('id', couponId)
      .select('*, promotion:promotions(id, name)')
      .single();
    if (error) {
      if (error.code === '23505') {
        return fail(res, 'A coupon with this code already exists', 409);
      }
      throw error;
    }
    return success(res, { coupon: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update coupon', 500);
  }
});

router.delete('/:id', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const userId = String(req.user?.id);
    const couponId = String(req.params.id);

    const { data: existing, error: fetchError } = await supabase
      .from('coupons')
      .select('restaurant_id')
      .eq('id', couponId)
      .single();
    if (fetchError || !existing) return fail(res, 'Coupon not found', 404);

    if (req.user?.role === 'RESTAURANT_OWNER') {
      const owned = await RestaurantService.getOwnedRestaurantIds(userId);
      if (!owned.includes(String(existing.restaurant_id))) {
        return fail(res, 'Forbidden', 403);
      }
    }

    await supabase.from('coupon_usages').delete().eq('coupon_id', couponId);
    await supabase.from('orders').update({ coupon_id: null }).eq('coupon_id', couponId);

    const { error } = await supabase.from('coupons').delete().eq('id', couponId);
    if (error) throw error;
    return success(res, { message: 'Coupon deleted' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to delete coupon', 500);
  }
});

export default router;
