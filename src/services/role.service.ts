import { supabase } from '../config/supabase';

export const RoleService = {
  async getBySlug(slug: string) {
    const { data, error } = await supabase.from('roles').select('*').eq('slug', slug).single();
    if (error) {
      throw error;
    }
    return data;
  },
};