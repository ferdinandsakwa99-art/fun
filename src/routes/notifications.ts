import { Router } from 'express';
import auth from '../middleware/auth';
import { success, fail } from '../utils/response';
import { supabase } from '../config/supabase';

const router = Router();

router.get('/', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('notifications').select('*').eq('user_id', String(req.user?.id));
    if (error) throw error;
    return success(res, { notifications: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load notifications', 500);
  }
});

router.patch('/:id/read', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', Number(req.params.id))
      .eq('user_id', String(req.user?.id))
      .select()
      .single();
    if (error) throw error;
    return success(res, { notification: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to mark notification read', 500);
  }
});

export default router;