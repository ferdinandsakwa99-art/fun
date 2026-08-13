import { supabase } from '../config/supabase';

export const PromoService = {
  // Count how many times a user has redeemed a coupon.
  async usageCount(couponId: string, userId: string) {
    const { count, error } = await supabase
      .from('coupon_usages')
      .select('id', { count: 'exact', head: true })
      .eq('coupon_id', couponId)
      .eq('user_id', userId);
    if (error) throw error;
    return count ?? 0;
  },

  // Record a redemption: bump the coupon's used_count, insert a per-user usage
  // row, and if the coupon is linked to a promotion, bump its order cap count.
  async recordRedemption(couponId: string, userId: string) {
    const { data: coupon } = await supabase
      .from('coupons')
      .select('id, promotion_id')
      .eq('id', couponId)
      .single();

    await supabase.rpc('increment_coupon_usage', { p_coupon_id: couponId });

    await supabase.from('coupon_usages').insert({
      coupon_id: couponId,
      user_id: userId,
    });

    if (coupon?.promotion_id) {
      await supabase.rpc('increment_promotion_usage', {
        p_promotion_id: coupon.promotion_id,
      });
    }
  },
};
