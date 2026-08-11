import { Router } from 'express';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { supabase } from '../config/supabase';
import { RoleService } from '../services/role.service';

const router = Router();

router.use(auth, authorize('ADMIN'));

router.get('/dashboard', async (req, res) => {
  try {
    const usersCount = await supabase.from('users').select('id', { count: 'exact' }).maybeSingle();
    const restaurantsCount = await supabase.from('restaurants').select('id', { count: 'exact' }).maybeSingle();
    const ordersCount = await supabase.from('orders').select('id', { count: 'exact' }).maybeSingle();
    const ridersCount = await supabase.from('riders').select('id', { count: 'exact' }).maybeSingle();
    return success(res, {
      dashboard: {
        users: usersCount.count,
        restaurants: restaurantsCount.count,
        orders: ordersCount.count,
        riders: ridersCount.count,
      },
    });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load dashboard', 500);
  }
});

router.get('/analytics', async (req, res) => {
  try {
    const { data, error } = await supabase.from('orders').select('status');
    if (error) throw error;
    const grouped = (data || []).reduce<Record<string, number>>((acc, order: any) => {
      const status = order?.status || 'unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    return success(res, { analytics: { orderStatuses: Object.entries(grouped).map(([status, count]) => ({ status, count })) } });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load analytics', 500);
  }
});

router.patch('/users/:id/role', async (req, res) => {
  try {
    const role = await RoleService.getBySlug(req.body.role);
    if (!role) {
      return fail(res, 'Invalid role', 400);
    }
    const { data, error } = await supabase
      .from('users')
      .update({ role_id: role.id })
      .eq('id', Number(req.params.id))
      .single();
    if (error) throw error;
    return success(res, { user: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update role', 500);
  }
});

router.patch('/restaurants/:id/approve', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('restaurants')
      .update({ status: 'active' })
      .eq('id', Number(req.params.id))
      .single();
    if (error) throw error;
    return success(res, { restaurant: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to approve restaurant', 500);
  }
});

router.patch('/riders/:id/approve', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('riders')
      .update({ is_verified: true })
      .eq('id', Number(req.params.id))
      .single();
    if (error) throw error;
    return success(res, { rider: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to approve rider', 500);
  }
});

router.patch('/orders/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .update(req.body)
      .eq('id', Number(req.params.id))
      .single();
    if (error) throw error;
    return success(res, { order: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update order', 500);
  }
});

export default router;