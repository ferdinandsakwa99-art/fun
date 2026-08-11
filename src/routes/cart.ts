import { Router } from 'express';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { CartService } from '../services/cart.service';
import { supabase } from '../config/supabase';

const router = Router();

router.get('/', auth, authorize('CUSTOMER'), async (req, res) => {
  const userId = String(req.user?.id);
  try {
    const cart = await CartService.getCartByUserId(userId);
    return success(res, { cart: cart || { items: [] } });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load cart', 500);
  }
});

router.post('/items', auth, authorize('CUSTOMER'), async (req, res) => {
  const userId = String(req.user?.id);
  try {
    const { menu_item_id, quantity, special_instructions } = req.body;
    if (!menu_item_id) {
      return fail(res, 'menu_item_id is required', 400);
    }

    const { data: menuItem, error: menuItemError } = await supabase
      .from('menu_items')
      .select('id, price, restaurant_id')
      .eq('id', menu_item_id)
      .single();
    if (menuItemError || !menuItem) {
      return fail(res, 'Menu item not found', 404);
    }

    const qty = Math.max(1, Number(quantity) || 1);
    const unitPrice = Number(menuItem.price) || 0;

    let cart = await CartService.getCartByUserId(userId);
    if (!cart) {
      cart = await CartService.createCart(userId, { restaurant_id: menuItem.restaurant_id });
    } else if (cart.restaurant_id && String(cart.restaurant_id) !== String(menuItem.restaurant_id)) {
      return fail(res, 'Your cart already contains items from a different restaurant', 400);
    } else if (!cart.restaurant_id) {
      await supabase
        .from('carts')
        .update({ restaurant_id: menuItem.restaurant_id })
        .eq('id', cart.id);
    }

    const item = await CartService.addItem(cart.id, {
      menu_item_id,
      quantity: qty,
      unit_price: unitPrice,
      total_price: unitPrice * qty,
      special_instructions: special_instructions || null,
    });
    return success(res, { item });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to add cart item', 500);
  }
});

router.patch('/items/:id', auth, authorize('CUSTOMER'), async (req, res) => {
  try {
    const item = await CartService.getItemById(String(req.params.id));
    if (!item) {
      return fail(res, 'Cart item not found', 404);
    }
    if (item.cart_id == null) {
      return fail(res, 'Invalid cart item', 400);
    }
    const updated = await CartService.updateItem(String(req.params.id), req.body);
    return success(res, { item: updated });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update cart item', 500);
  }
});

router.delete('/items/:id', auth, authorize('CUSTOMER'), async (req, res) => {
  try {
    await CartService.removeItem(String(req.params.id));
    return success(res, { message: 'Cart item removed' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to delete cart item', 500);
  }
});

router.delete('/', auth, authorize('CUSTOMER'), async (req, res) => {
  const userId = String(req.user?.id);
  try {
    await CartService.clearCartByUserId(userId);
    return success(res, { message: 'Cart cleared' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to clear cart', 500);
  }
});

export default router;
