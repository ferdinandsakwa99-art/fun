import { supabase } from '../config/supabase';

export const WalletService = {
  async getByUserId(userId: string) {
    const { data, error } = await supabase.from('wallets').select('*').eq('user_id', userId).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  },

  async getByRestaurantId(restaurantId: string) {
    const { data, error } = await supabase.from('wallets').select('*').eq('restaurant_id', restaurantId).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  },

  async getByRiderId(riderId: string) {
    const { data, error } = await supabase.from('wallets').select('*').eq('rider_id', riderId).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  },

  async getOrCreateRestaurant(restaurantId: string) {
    const existing = await this.getByRestaurantId(restaurantId);
    if (existing) return existing;
    const { data, error } = await supabase
      .from('wallets')
      .insert({ restaurant_id: restaurantId, currency: 'KES', balance: 0 })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') return this.getByRestaurantId(restaurantId);
      throw error;
    }
    return data;
  },

  async getOrCreateRider(riderId: string) {
    const existing = await this.getByRiderId(riderId);
    if (existing) return existing;
    const { data, error } = await supabase
      .from('wallets')
      .insert({ rider_id: riderId, currency: 'KES', balance: 0 })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') return this.getByRiderId(riderId);
      throw error;
    }
    return data;
  },

  async getPlatform() {
    const { data, error } = await supabase.from('wallets').select('*').eq('is_platform', true).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  },

  async getOrCreatePlatform() {
    const existing = await this.getPlatform();
    if (existing) return existing;
    const { data, error } = await supabase
      .from('wallets')
      .insert({ is_platform: true, currency: 'KES', balance: 0 })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') return this.getPlatform();
      throw error;
    }
    return data;
  },

  async getOrCreateClient(userId: string) {
    const existing = await this.getByUserId(userId);
    if (existing) return existing;
    const { data, error } = await supabase
      .from('wallets')
      .insert({ user_id: userId, currency: 'KES', balance: 0 })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') return this.getByUserId(userId);
      throw error;
    }
    return data;
  },

  async creditClient(userId: string, amount: number) {
    const wallet = await this.getOrCreateClient(userId);
    const newBalance = Math.round((Number(wallet.balance) + Number(amount)) * 100) / 100;
    const { data, error } = await supabase
      .from('wallets')
      .update({ balance: newBalance })
      .eq('id', wallet.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async debitClient(userId: string, amount: number) {
    const wallet = await this.getOrCreateClient(userId);
    const currentBalance = Number(wallet.balance) || 0;
    if (currentBalance < Number(amount)) {
      throw new Error('Insufficient wallet balance');
    }
    const newBalance = Math.round((currentBalance - Number(amount)) * 100) / 100;
    const { data, error } = await supabase
      .from('wallets')
      .update({ balance: newBalance })
      .eq('id', wallet.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async credit(owner: { restaurant_id?: string; rider_id?: string; platform?: boolean }, amount: number) {
    if (!owner.restaurant_id && !owner.rider_id && !owner.platform) {
      throw new Error('A wallet owner is required');
    }
    const wallet = owner.platform
      ? await this.getOrCreatePlatform()
      : owner.restaurant_id
        ? await this.getOrCreateRestaurant(owner.restaurant_id)
        : await this.getOrCreateRider(owner.rider_id as string);

    const newBalance = Math.round((Number(wallet.balance) + Number(amount)) * 100) / 100;
    const { data, error } = await supabase
      .from('wallets')
      .update({ balance: newBalance })
      .eq('id', wallet.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async debit(owner: { restaurant_id?: string; rider_id?: string; platform?: boolean }, amount: number) {
    if (!owner.restaurant_id && !owner.rider_id && !owner.platform) {
      throw new Error('A wallet owner is required');
    }
    const wallet = owner.platform
      ? await this.getOrCreatePlatform()
      : owner.restaurant_id
        ? await this.getOrCreateRestaurant(owner.restaurant_id)
        : await this.getOrCreateRider(owner.rider_id as string);

    const newBalance = Math.round((Number(wallet.balance) - Number(amount)) * 100) / 100;
    const { data, error } = await supabase
      .from('wallets')
      .update({ balance: newBalance })
      .eq('id', wallet.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

export default WalletService;
