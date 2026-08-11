import { Router } from 'express';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { supabase } from '../config/supabase';

const router = Router();

router.get('/', auth, authorize('CUSTOMER'), async (req, res) => {
  const userId = String(req.user?.id);
  try {
    const { data, error } = await supabase.from('addresses').select('*').eq('user_id', userId);
    if (error) throw error;
    return success(res, { addresses: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load addresses', 500);
  }
});

router.post('/', auth, authorize('CUSTOMER'), async (req, res) => {
  try {
    const userId = String(req.user?.id);
    const payload = { ...req.body, user_id: userId };
    const { data, error } = await supabase.from('addresses').insert(payload).select().single();
    if (error) throw error;
    return success(res, { address: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to create address', 500);
  }
});

router.patch('/:id', auth, authorize('CUSTOMER'), async (req, res) => {
  const userId = String(req.user?.id);
  try {
    const { data: existing, error: fetchError } = await supabase
      .from('addresses')
      .select('user_id')
      .eq('id', String(req.params.id))
      .single();
    if (fetchError) throw fetchError;
    if (existing.user_id !== userId) {
      return fail(res, 'Forbidden', 403);
    }

    const { data, error } = await supabase
      .from('addresses')
      .update(req.body)
      .eq('id', String(req.params.id))
      .select()
      .single();
    if (error) throw error;
    return success(res, { address: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update address', 500);
  }
});

router.delete('/:id', auth, authorize('CUSTOMER'), async (req, res) => {
  const userId = String(req.user?.id);
  try {
    const { data: existing, error: fetchError } = await supabase
      .from('addresses')
      .select('user_id')
      .eq('id', String(req.params.id))
      .single();
    if (fetchError) throw fetchError;
    if (existing.user_id !== userId) {
      return fail(res, 'Forbidden', 403);
    }

    const { error } = await supabase.from('addresses').delete().eq('id', String(req.params.id));
    if (error) throw error;
    return success(res, { message: 'Address deleted' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to delete address', 500);
  }
});

export default router;