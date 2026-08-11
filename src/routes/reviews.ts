import { Router } from 'express';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { supabase } from '../config/supabase';

const router = Router();

router.post('/', auth, authorize('CUSTOMER'), async (req, res) => {
  try {
    const review = await supabase.from('reviews').insert({ ...req.body, user_id: String(req.user?.id) }).select().single();
    if (review.error) throw review.error;
    return success(res, { review: review.data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to create review', 500);
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('reviews').select('*');
    if (error) throw error;
    return success(res, { reviews: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load reviews', 500);
  }
});

router.delete('/:id', auth, authorize('ADMIN'), async (req, res) => {
  try {
    const { error } = await supabase.from('reviews').delete().eq('id', Number(req.params.id));
    if (error) throw error;
    return success(res, { message: 'Review deleted' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to delete review', 500);
  }
});

export default router;