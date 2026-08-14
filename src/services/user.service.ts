import { supabase } from '../config/supabase';

export const UserService = {
  async findByEmail(email: string) {
    const { data, error } = await supabase
      .from('users')
      .select('*, role:roles(name,slug)')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  },

  async findById(id: string) {
    const { data, error } = await supabase
      .from('users')
      .select('*, role:roles(name,slug)')
      .eq('id', id)
      .single();

    if (error) {
      throw error;
    }

    return data;
  },

  async create(user: {
    name: string;
    email: string;
    password: string;
    role_id: number;
    gender?: string | null;
    phone?: string | null;
  }) {
    const insertValues: Record<string, any> = {
      name: user.name,
      email: user.email,
      password: user.password,
      role_id: user.role_id,
    };
    if (user.gender) insertValues.gender = user.gender;
    if (user.phone) insertValues.phone = user.phone;

    const { data, error } = await supabase
      .from('users')
      .insert(insertValues)
      .select('*, role:roles(name,slug)')
      .single();

    if (error) {
      // gender/phone columns may not exist yet (migration pending) -> retry without them
      const hasOptional = Boolean(user.gender || user.phone);
      const missingColumn =
        error.code === 'PGRST204' ||
        String(error.message).includes('gender') ||
        String(error.message).includes('phone');
      if (hasOptional && missingColumn) {
        const retryValues: Record<string, any> = {
          name: user.name,
          email: user.email,
          password: user.password,
          role_id: user.role_id,
        };
        if (user.phone) retryValues.phone = user.phone;
        const retry = await supabase
          .from('users')
          .insert(retryValues)
          .select('*, role:roles(name,slug)')
          .single();
        if (retry.error) throw retry.error;
        return retry.data;
      }
      throw error;
    }

    return data;
  },

  async updateById(id: string, values: Record<string, any>) {
    const { data, error } = await supabase
      .from('users')
      .update(values)
      .eq('id', id)
      .select('*, role:roles(name,slug)')
      .single();

    if (error) {
      throw error;
    }

    return data;
  },

  async deleteById(id: string) {
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) {
      throw error;
    }

    return true;
  },

  async list() {
    const { data, error } = await supabase.from('users').select('*, role:roles(name,slug)');
    if (error) {
      throw error;
    }
    return data;
  },
};