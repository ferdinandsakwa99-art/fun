import { supabase } from '../config/supabase';

export const PaymentService = {
  async listForUser(userId: string) {
    const { data, error } = await supabase.from('payments').select('*').eq('user_id', userId);
    if (error) {
      throw error;
    }
    return data;
  },

  async listAll() {
    const { data, error } = await supabase.from('payments').select('*');
    if (error) {
      throw error;
    }
    return data;
  },

  async findById(id: number) {
    const { data, error } = await supabase.from('payments').select('*').eq('id', id).single();
    if (error) {
      throw error;
    }
    return data;
  },

  async create(values: Record<string, any>) {
    const { data, error } = await supabase.from('payments').insert(values).select().single();
    if (error) {
      throw error;
    }
    return data;
  },

  async refund(id: number, values: Record<string, any>) {
    const { data, error } = await supabase
      .from('payments')
      .update({ payment_status: 'refunded', ...values })
      .eq('id', id)
      .select()
      .single();
    if (error) {
      throw error;
    }
    return data;
  },

  async markOrderCompleted(orderId: string) {
    const { data, error } = await supabase
      .from('payments')
      .update({ payment_status: 'completed' })
      .eq('order_id', orderId)
      .in('payment_status', ['pending', 'processing', 'completed'])
      .select();
    if (error) {
      throw error;
    }
    return data;
  },
};
