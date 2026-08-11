import { Router } from 'express';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { RiderService } from '../services/rider.service';
import { SocketService } from '../services/socket.service';
import { supabase } from '../config/supabase';

const router = Router();

router.get('/me', auth, authorize('RIDER'), async (req, res) => {
  try {
    const rider = await RiderService.findByUserId(String(req.user?.id));
    if (!rider) {
      return fail(res, 'Rider profile not found', 404);
    }
    return success(res, { rider });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load rider profile', 500);
  }
});

router.patch('/me', auth, authorize('RIDER'), async (req, res) => {
  try {
    const rider = await RiderService.findByUserId(String(req.user?.id));
    if (!rider) {
      return fail(res, 'Rider profile not found', 404);
    }
    const allowed = [
      'vehicle_type',
      'vehicle_number',
      'license_number',
      'current_latitude',
      'current_longitude',
    ];
    const update: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) update[key] = req.body[key];
    }
    const updated = await RiderService.updateById(String(rider.id), update);
    return success(res, { rider: updated });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update rider profile', 500);
  }
});

router.patch('/status', auth, authorize('RIDER'), async (req, res) => {
  try {
    const rider = await RiderService.findByUserId(String(req.user?.id));
    if (!rider) {
      return fail(res, 'Rider profile not found', 404);
    }

    const status = String(req.body?.status ?? '');
    if (!['online', 'offline'].includes(status)) {
      return fail(res, "status must be 'online' or 'offline'", 400);
    }

    const updated = await RiderService.updateById(String(rider.id), {
      online: status === 'online',
      status,
    });
    return success(res, { rider: updated });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update rider status', 500);
  }
});

router.post('/location', auth, authorize('RIDER'), async (req, res) => {
  const { latitude, longitude } = req.body ?? {};
  if (latitude == null || longitude == null) {
    return fail(res, 'latitude and longitude are required', 400);
  }

  try {
    const rider = await RiderService.findByUserId(String(req.user?.id));
    if (!rider) {
      return fail(res, 'Rider profile not found', 404);
    }

    const heading = req.body.heading ?? null;
    const speed = req.body.speed ?? null;
    const accuracy = req.body.accuracy ?? null;

    const { error: locError } = await supabase.from('rider_locations').insert({
      rider_id: rider.id,
      latitude,
      longitude,
      heading,
      speed,
      accuracy,
    });
    if (locError) throw locError;

    const { error: updateError } = await supabase
      .from('riders')
      .update({ current_latitude: latitude, current_longitude: longitude })
      .eq('id', rider.id);
    if (updateError) throw updateError;

    broadcastRiderLocation(rider.id, {
      latitude,
      longitude,
      heading: heading ?? null,
      speed: speed ?? null,
    });

    return success(res, { rider_id: rider.id, latitude, longitude });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update rider location', 500);
  }
});

function broadcastRiderLocation(
  riderId: string,
  location: Record<string, unknown>,
) {
  void (async () => {
    try {
      const { data } = await supabase
        .from('orders')
        .select('id, user_id')
        .eq('rider_id', riderId)
        .in('status', ['picked_up', 'in_transit', 'arrived']);
      const payload = { ...location, timestamp: new Date().toISOString() };
      for (const order of data ?? []) {
        if (order?.user_id) {
          SocketService.emitToUser(order.user_id, 'rider_location', {
            order_id: order.id,
            ...payload,
          });
        }
      }
    } catch {
      // Location broadcast is non-blocking; live tracking simply skips a tick.
    }
  })();
}

export default router;
