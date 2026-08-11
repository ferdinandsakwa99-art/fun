import { supabase } from '../config/supabase';

export const RestaurantService = {
  async getOwnedRestaurantIds(userId: string) {
    const { data, error } = await supabase
      .from('restaurant_staff')
      .select('restaurant_id')
      .in('role', ['owner', 'manager'])
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    return (data || []).map((row: any) => row.restaurant_id as string);
  },

  async isOwnerForRestaurant(userId: string, restaurantId: string) {
    const { data, error } = await supabase
      .from('restaurant_staff')
      .select('id')
      .in('role', ['owner', 'manager'])
      .eq('user_id', userId)
      .eq('restaurant_id', restaurantId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return !!data;
  },
};