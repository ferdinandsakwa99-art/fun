import { Router } from 'express';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { supabase } from '../config/supabase';
import { CartService } from '../services/cart.service';

const router = Router();

router.get('/', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('coupons').select('*');
    if (error) throw error;
    return success(res, { coupons: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load coupons', 500);
  }
});

router.post('/', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('coupons').insert(req.body).select().single();
    if (error) throw error;
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
    const { data, error } = await supabase.from('coupons').update(req.body).eq('id', Number(req.params.id)).select().single();
    if (error) throw error;
    return success(res, { coupon: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update coupon', 500);
  }
});

router.delete('/:id', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const { error } = await supabase.from('coupons').delete().eq('id', Number(req.params.id));
    if (error) throw error;
    return success(res, { message: 'Coupon deleted' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to delete coupon', 500);
  }
});

export default router;