import { Router } from 'express';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { supabase } from '../config/supabase';

const router = Router();

const generateSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

router.get('/', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('categories').select('*');
    if (error) throw error;
    return success(res, { menuCategories: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load categories', 500);
  }
});

router.post('/', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) {
      return fail(res, 'Category name is required', 400);
    }

    const categoryPayload = {
      name,
      description: req.body.description || null,
      slug: generateSlug(name),
    };

    const { data, error } = await supabase.from('categories').insert(categoryPayload).select().single();
    if (error) throw error;
    return success(res, { menuCategory: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to create category', 500);
  }
});

router.patch('/:id', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('categories').update(req.body).eq('id', Number(req.params.id)).select().single();
    if (error) throw error;
    return success(res, { menuCategory: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update category', 500);
  }
});

router.delete('/:id', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const { error } = await supabase.from('categories').delete().eq('id', Number(req.params.id));
    if (error) throw error;
    return success(res, { message: 'Menu category deleted' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to delete category', 500);
  }
});

export default router;