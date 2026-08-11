import { supabase } from '../config/supabase';

export const RiderService = {
  async findByUserId(userId: string) {
    const { data, error } = await supabase.from('riders').select('*').eq('user_id', userId).single();
    if (error) throw error;
    return data;
  },

  async findById(id: string) {
    const { data, error } = await supabase.from('riders').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  async updateById(id: string, values: Record<string, any>) {
    const { data, error } = await supabase.from('riders').update(values).eq('id', id).select('*').single();
    if (error) throw error;
    return data;
  },
};
