import { Router } from 'express';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { DeliveryService } from '../services/delivery.service';
import { RiderService } from '../services/rider.service';
import { supabase } from '../config/supabase';

const router = Router();

router.get('/', auth, async (req, res) => {
  try {
    if (req.user?.role === 'ADMIN') {
      const deliveries = await DeliveryService.list();
      return success(res, { deliveries });
    }

    if (req.user?.role === 'RIDER') {
      const rider = await RiderService.findByUserId(String(req.user.id));
      if (!rider) {
        return fail(res, 'Rider profile not found', 404);
      }
      const { data, error } = await supabase.from('deliveries').select('*').eq('rider_id', rider.id);
      if (error) throw error;
      return success(res, { deliveries: data });
    }

    return fail(res, 'Forbidden', 403);
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load deliveries', 500);
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const delivery = await DeliveryService.findById(Number(req.params.id));
    if (!delivery) {
      return fail(res, 'Delivery not found', 404);
    }

    if (req.user?.role === 'ADMIN') {
      return success(res, { delivery });
    }

    if (req.user?.role === 'RIDER') {
      const rider = await RiderService.findByUserId(String(req.user.id));
      if (!rider || delivery.rider_id !== rider.id) {
        return fail(res, 'Forbidden', 403);
      }
      return success(res, { delivery });
    }

    return fail(res, 'Forbidden', 403);
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load delivery', 500);
  }
});

router.post('/:id/accept', auth, authorize('RIDER'), async (req, res) => {
  try {
    const rider = await RiderService.findByUserId(String(req.user?.id));
    if (!rider) {
      return fail(res, 'Rider profile not found', 404);
    }

    const { data, error } = await supabase
      .from('deliveries')
      .update({ rider_id: rider.id, status: 'assigned' })
      .eq('id', Number(req.params.id))
      .single();
    if (error) throw error;
    return success(res, { delivery: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to accept delivery', 500);
  }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    const delivery = await DeliveryService.findById(Number(req.params.id));
    if (!delivery) {
      return fail(res, 'Delivery not found', 404);
    }

    if (req.user?.role === 'ADMIN') {
      const updated = await DeliveryService.updateById(Number(req.params.id), req.body);
      return success(res, { delivery: updated });
    }

    if (req.user?.role === 'RIDER') {
      const rider = await RiderService.findByUserId(String(req.user.id));
      if (!rider || delivery.rider_id !== rider.id) {
        return fail(res, 'Forbidden', 403);
      }
      const updated = await DeliveryService.updateById(Number(req.params.id), req.body);
      return success(res, { delivery: updated });
    }

    return fail(res, 'Forbidden', 403);
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update delivery', 500);
  }
});

router.patch('/:id/location', auth, authorize('RIDER'), async (req, res) => {
  const { latitude, longitude } = req.body;
  if (latitude == null || longitude == null) {
    return fail(res, 'latitude and longitude are required', 400);
  }

  try {
    const delivery = await DeliveryService.findById(Number(req.params.id));
    if (!delivery) {
      return fail(res, 'Delivery not found', 404);
    }
    const rider = await RiderService.findByUserId(String(req.user?.id));
    if (!rider || delivery.rider_id !== rider.id) {
      return fail(res, 'Forbidden', 403);
    }

    const { data, error } = await supabase
      .from('deliveries')
      .update({ delivery_latitude: latitude, delivery_longitude: longitude })
      .eq('id', Number(req.params.id))
      .single();
    if (error) throw error;
    return success(res, { delivery: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update location', 500);
  }
});

export default router;