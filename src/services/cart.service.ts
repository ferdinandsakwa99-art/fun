import { supabase } from '../config/supabase';

const round2 = (value: number) => Math.round(value * 100) / 100;

const CART_SELECT =
  '*, items:cart_items(*, menu_item:menu_items(id, name, price, restaurant_id))';

async function attachCartImages(cart: any) {
  if (!cart) return cart;
  const items: any[] = cart.items || [];
  const ids = [
    ...new Set(items.map((it: any) => it.menu_item_id).filter(Boolean)),
  ];
  if (ids.length === 0) return cart;

  const { data: images, error } = await supabase
    .from('menu_item_images')
    .select('id, menu_item_id, image_url, alt_text, is_primary, sort_order')
    .in('menu_item_id', ids)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  const grouped = new Map<string, any[]>();
  (images || []).forEach((image: any) => {
    const list = grouped.get(image.menu_item_id) ?? [];
    list.push(image);
    grouped.set(image.menu_item_id, list);
  });

  return {
    ...cart,
    items: items.map((item: any) =>
      item.menu_item
        ? {
            ...item,
            menu_item: {
              ...item.menu_item,
              images: grouped.get(item.menu_item_id) ?? [],
            },
          }
        : item,
    ),
  };
}

export const CartService = {
  async getCartByUserId(userId: string) {
    const { data, error } = await supabase
      .from('carts')
      .select(CART_SELECT)
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!data) {
      return data;
    }

    return attachCartImages(await this.refreshTotals(data));
  },

  async createCart(userId: string, values: Record<string, any>) {
    const { data, error } = await supabase
      .from('carts')
      .insert({
        ...values,
        user_id: userId,
        subtotal: 0,
        delivery_fee: 0,
        tax: 0,
        discount: 0,
        total: 0,
      })
      .select(CART_SELECT)
      .single();

    if (error) {
      throw error;
    }

    return data;
  },

  async getItemById(itemId: string) {
    const { data, error } = await supabase.from('cart_items').select('*').eq('id', itemId).single();
    if (error) {
      throw error;
    }
    return data;
  },

  async addItem(cartId: string, values: Record<string, any>) {
    const { data, error } = await supabase
      .from('cart_items')
      .insert({ ...values, cart_id: cartId })
      .select()
      .single();
    if (error) {
      throw error;
    }
    await this.refreshTotals(cartId);
    return data;
  },

  async updateItem(itemId: string, values: Record<string, any>) {
    const existing = await this.getItemById(itemId);
    const quantity = values.quantity != null
      ? Math.max(1, Number(values.quantity))
      : Number(existing?.quantity);
    const unitPrice = values.unit_price != null
      ? Number(values.unit_price)
      : Number(existing?.unit_price);
    const payload = {
      ...values,
      quantity,
      unit_price: unitPrice,
      total_price: round2(unitPrice * quantity),
    };
    const { data, error } = await supabase
      .from('cart_items')
      .update(payload)
      .eq('id', itemId)
      .select()
      .single();
    if (error) {
      throw error;
    }
    if (existing?.cart_id) {
      await this.refreshTotals(existing.cart_id);
    }
    return data;
  },

  async removeItem(itemId: string) {
    let existing: any = null;
    try {
      existing = await this.getItemById(itemId);
    } catch {
      existing = null;
    }
    const { error } = await supabase.from('cart_items').delete().eq('id', itemId);
    if (error) {
      throw error;
    }
    if (existing?.cart_id) {
      await this.refreshTotals(existing.cart_id);
    }
    return true;
  },

  async clearCartByUserId(userId: string) {
    const { data: cart, error: cartError } = await supabase
      .from('carts')
      .select('id')
      .eq('user_id', userId)
      .single();
    if (cartError && cartError.code !== 'PGRST116') {
      throw cartError;
    }

    if (!cart) {
      return true;
    }

    const { error } = await supabase.from('cart_items').delete().eq('cart_id', cart.id);
    if (error) {
      throw error;
    }
    await this.refreshTotals(cart.id);
    return true;
  },

  async applyCoupon(cartId: string, couponId: string) {
    await supabase.from('carts').update({ coupon_id: couponId }).eq('id', cartId);
    await this.refreshTotals(cartId);
  },

  async removeCoupon(cartId: string) {
    await supabase.from('carts').update({ coupon_id: null }).eq('id', cartId);
    await this.refreshTotals(cartId);
  },

  async computeCouponDiscount(coupon: any, subtotal: number) {
    if (!coupon) return 0;
    const value = Number(coupon.value) || 0;
    if (coupon.type === 'percentage') {
      const discount = round2(subtotal * (value / 100));
      const maxDiscount = Number(coupon.max_discount) || 0;
      return maxDiscount > 0 ? Math.min(discount, maxDiscount) : discount;
    }
    if (coupon.type === 'fixed_amount') {
      return Math.min(value, subtotal);
    }
    // free_delivery is applied to the delivery fee at order time
    return 0;
  },

  async refreshTotals(cartOrId: any) {
    const cart =
      typeof cartOrId === 'string'
        ? await supabase
            .from('carts')
            .select(CART_SELECT)
            .eq('id', cartOrId)
            .single()
            .then((r) => {
              if (r.error) throw r.error;
              return r.data;
            })
        : cartOrId;

    const items = cart?.items || [];
    const subtotal = round2(
      items.reduce((sum: number, it: any) => sum + (Number(it.total_price) || 0), 0),
    );

    let discount = 0;
    if (cart?.coupon_id) {
      const { data: coupon } = await supabase
        .from('coupons')
        .select('*')
        .eq('id', cart.coupon_id)
        .single();
      discount = await this.computeCouponDiscount(coupon, subtotal);
    }

    const delivery_fee = 0;
    const tax = 0;
    const total = round2(subtotal + delivery_fee + tax - discount);

    await supabase
      .from('carts')
      .update({ subtotal, delivery_fee, tax, discount, total })
      .eq('id', cart.id);

    return { ...cart, subtotal, delivery_fee, tax, discount, total };
  },
};
