import { Router } from 'express';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { supabase } from '../config/supabase';

const router = Router();

router.get('/', auth, authorize('CUSTOMER'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('favorites').select('*').eq('user_id', String(req.user?.id));
    if (error) throw error;
    return success(res, { favorites: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load favorites', 500);
  }
});

router.post('/', auth, authorize('CUSTOMER'), async (req, res) => {
  try {
    const payload = { ...req.body, user_id: String(req.user?.id) };
    const { data, error } = await supabase.from('favorites').insert(payload).select().single();
    if (error) throw error;
    return success(res, { favorite: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to add favorite', 500);
  }
});

router.delete('/:restaurantId', auth, authorize('CUSTOMER'), async (req, res) => {
  try {
    const { error } = await supabase
      .from('favorites')
      .delete()
      .eq('user_id', String(req.user?.id))
      .eq('restaurant_id', String(req.params.restaurantId));
    if (error) throw error;
    return success(res, { message: 'Favorite removed' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to remove favorite', 500);
  }
});

export default router;