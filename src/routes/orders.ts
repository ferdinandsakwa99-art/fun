import { Router } from 'express';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { cachedFetch, invalidate } from '../utils/cache';
import { OrderService } from '../services/order.service';
import { RestaurantService } from '../services/restaurant.service';
import { RiderService } from '../services/rider.service';
import { DispatchService } from '../services/dispatch.service';
import { DeliveryService } from '../services/delivery.service';
import { EarningsService } from '../services/earnings.service';
import { SocketService } from '../services/socket.service';
import { supabase } from '../config/supabase';

const router = Router();

const normalizeStatus = (status: string) => status.trim().toLowerCase().replace(/\s+/g, '_');
const round2 = (value: number) => Math.round(value * 100) / 100;

router.post('/', auth, authorize('CUSTOMER'), async (req, res) => {
  const userId = String(req.user?.id);
  try {
    const feeCacheKey = `delivery-fee:${String(req.body.restaurant_id || '')}:${String(
      req.body.address_id || 'none',
    )}`;
    const { delivery_fee, distance_km } = await cachedFetch<any>(
      feeCacheKey,
      30,
      () => DeliveryService.computeFeeForOrder(req.body),
    );
    const subtotal = Number(req.body.subtotal) || 0;
    const tax = Number(req.body.tax) || 0;
    const discount = Number(req.body.discount) || 0;
    const total = round2(subtotal + delivery_fee + tax - discount);

    const order = await OrderService.create({
      ...req.body,
      delivery_fee,
      total,
      user_id: userId,
    });
    await invalidate('recommendations:popular:', 'home:');
    SocketService.emitOrderCreated(order);
    return success(res, { order, delivery_fee, distance_km });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to create order', 500);
  }
});

router.get('/', auth, async (req, res) => {
  const userId = String(req.user?.id);
  const restaurantId =
    typeof req.query.restaurant_id === 'string' && req.query.restaurant_id
      ? req.query.restaurant_id
      : undefined;
  try {
    if (req.user?.role === 'ADMIN') {
      let query = supabase.from('orders').select('*');
      if (restaurantId) query = query.eq('restaurant_id', restaurantId);
      const { data, error } = await query;
      if (error) throw error;
      const orders = await OrderService.attachItems(data);
      return success(res, { orders });
    }

    if (req.user?.role === 'CUSTOMER') {
      const orders = await OrderService.listForUser(userId);
      return success(res, { orders });
    }

    if (req.user?.role === 'RESTAURANT_OWNER') {
      const restaurantIds = await RestaurantService.getOwnedRestaurantIds(userId);
      if (restaurantId && !restaurantIds.includes(restaurantId)) {
        return fail(res, 'Forbidden', 403);
      }
      let query = supabase.from('orders').select('*').in('restaurant_id', restaurantIds);
      if (restaurantId) query = query.eq('restaurant_id', restaurantId);
      const { data, error } = await query;
      if (error) throw error;
      const orders = await OrderService.attachItems(data);
      return success(res, { orders });
    }

    if (req.user?.role === 'RIDER') {
      const rider = await RiderService.findByUserId(userId);
      if (!rider) {
        return fail(res, 'Rider profile not found', 404);
      }
      const orders = await OrderService.listForRider(rider.id);
      return success(res, { orders });
    }

    return fail(res, 'Forbidden', 403);
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load orders', 500);
  }
});

router.get('/:id', auth, async (req, res) => {
  const userId = String(req.user?.id);
  try {
    const order = await OrderService.findById(String(req.params.id));
    if (!order) {
      return fail(res, 'Order not found', 404);
    }

    if (req.user?.role === 'ADMIN') {
      const enriched = await OrderService.enrichForCustomer(order);
      return success(res, { order: enriched });
    }

    if (req.user?.role === 'CUSTOMER' && order.user_id === userId) {
      const enriched = await OrderService.enrichForCustomer(order);
      return success(res, { order: enriched });
    }

    if (req.user?.role === 'RESTAURANT_OWNER') {
      const restaurantIds = await RestaurantService.getOwnedRestaurantIds(userId);
      if (restaurantIds.includes(order.restaurant_id)) {
        return success(res, { order });
      }
    }

    if (req.user?.role === 'RIDER') {
      const rider = await RiderService.findByUserId(userId);
      if (rider && order.rider_id === rider.id) {
        const enriched = await OrderService.enrichForRider(order);
        return success(res, { order: enriched });
      }
    }

    return fail(res, 'Forbidden', 403);
  } catch (error: any) {
    return fail(res, error.message || 'Unable to fetch order', 500);
  }
});

router.post('/:id/unassign', auth, async (req, res) => {
  try {
    const order = await OrderService.findById(String(req.params.id));
    if (!order) {
      return fail(res, 'Order not found', 404);
    }

    const role = req.user?.role;
    const userId = String(req.user?.id);

    if (role === 'RIDER') {
      const rider = await RiderService.findByUserId(userId);
      if (!rider || order.rider_id !== rider.id) {
        return fail(res, 'Forbidden', 403);
      }
    } else if (role === 'RESTAURANT_OWNER') {
      const restaurantIds = await RestaurantService.getOwnedRestaurantIds(userId);
      if (!restaurantIds.includes(order.restaurant_id)) {
        return fail(res, 'Forbidden', 403);
      }
    } else if (role !== 'ADMIN') {
      return fail(res, 'Forbidden', 403);
    }

    if (!order.rider_id) {
      return fail(res, 'Order is not assigned to a rider', 400);
    }

    try {
      const rider = await RiderService.findById(String(order.rider_id));
      await supabase
        .from('riders')
        .update({
          active_orders: Math.max(0, (Number(rider?.active_orders) || 1) - 1),
        })
        .eq('id', String(order.rider_id));
    } catch {
      // non-blocking bookkeeping
    }

    const unassigned = await OrderService.updateById(String(req.params.id), {
      rider_id: null,
      dispatch_note: 'Declined by rider',
    });

    let dispatch: any = { assigned: false, reason: 'Not re-dispatched' };
    if (unassigned.status === 'ready') {
      try {
        dispatch = await DispatchService.dispatchForOrder(unassigned);
      } catch (dispatchError: any) {
        dispatch = {
          assigned: false,
          reason: dispatchError.message || 'Re-dispatch failed',
        };
      }
    }

    SocketService.emitOrderUpdated(unassigned);
    return success(res, { order: unassigned, dispatch });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to unassign order', 500);
  }
});

router.patch('/:id', auth, async (req, res) => {
  const userId = String(req.user?.id);
  try {
    const order = await OrderService.findById(String(req.params.id));
    if (!order) {
      return fail(res, 'Order not found', 404);
    }

    if (req.user?.role === 'ADMIN') {
      const updated = await OrderService.updateById(String(req.params.id), req.body);
      SocketService.emitOrderUpdated(updated);
      return success(res, { order: updated });
    }

    if (req.user?.role === 'CUSTOMER' && order.user_id === userId) {
      const updated = await OrderService.updateById(String(req.params.id), req.body);
      SocketService.emitOrderUpdated(updated);
      return success(res, { order: updated });
    }

    if (req.user?.role === 'RESTAURANT_OWNER') {
      const restaurantIds = await RestaurantService.getOwnedRestaurantIds(userId);
      if (restaurantIds.includes(order.restaurant_id)) {
        const updated = await OrderService.updateById(String(req.params.id), req.body);
        SocketService.emitOrderUpdated(updated);
        return success(res, { order: updated });
      }
    }

    return fail(res, 'Forbidden', 403);
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update order', 500);
  }
});

router.delete('/:id', auth, async (req, res) => {
  const userId = String(req.user?.id);
  try {
    const order = await OrderService.findById(String(req.params.id));
    if (!order) {
      return fail(res, 'Order not found', 404);
    }

    if (req.user?.role !== 'ADMIN' && order.user_id !== userId) {
      return fail(res, 'Forbidden', 403);
    }

    const { error } = await supabase.from('orders').delete().eq('id', String(req.params.id));
    if (error) throw error;
    return success(res, { message: 'Order deleted' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to delete order', 500);
  }
});

router.post('/:id/dispatch', auth, async (req, res) => {
  try {
    const order = await OrderService.findById(String(req.params.id));
    if (!order) {
      return fail(res, 'Order not found', 404);
    }

    if (req.user?.role === 'RESTAURANT_OWNER') {
      const restaurantIds = await RestaurantService.getOwnedRestaurantIds(
        String(req.user?.id),
      );
      if (!restaurantIds.includes(order.restaurant_id)) {
        return fail(res, 'Forbidden', 403);
      }
    } else if (req.user?.role !== 'ADMIN') {
      return fail(res, 'Forbidden', 403);
    }

    const result = await DispatchService.dispatchForOrder(order);
    return success(res, result);
  } catch (error: any) {
    return fail(res, error.message || 'Unable to dispatch order', 500);
  }
});

router.patch('/:id/status', auth, async (req, res) => {
  const userId = String(req.user?.id);
  const requestedStatus = normalizeStatus(String(req.body.status || ''));
  const restaurantStatuses = ['pending', 'accepted', 'preparing', 'ready'];
  const riderStatuses = ['ready', 'picked_up', 'in_transit', 'arrived', 'delivered'];

  try {
    const order = await OrderService.findById(String(req.params.id));
    if (!order) {
      return fail(res, 'Order not found', 404);
    }

    if (req.user?.role === 'CUSTOMER') {
      if (requestedStatus !== 'cancelled') {
        return fail(res, 'Customers may only cancel orders', 403);
      }
      if (order.user_id !== userId) {
        return fail(res, 'Forbidden', 403);
      }
    }

    if (req.user?.role === 'RESTAURANT_OWNER') {
      if (!restaurantStatuses.includes(requestedStatus)) {
        return fail(res, 'Invalid status for restaurant', 403);
      }
      const restaurantIds = await RestaurantService.getOwnedRestaurantIds(userId);
      if (!restaurantIds.includes(order.restaurant_id)) {
        return fail(res, 'Forbidden', 403);
      }
    }

    if (req.user?.role === 'RIDER') {
      if (!riderStatuses.includes(requestedStatus)) {
        return fail(res, 'Invalid status for rider', 403);
      }
      const rider = await RiderService.findByUserId(userId);
      if (!rider || order.rider_id !== rider.id) {
        return fail(res, 'Forbidden', 403);
      }
    }

    const updated = await OrderService.updateById(String(req.params.id), { status: requestedStatus });

    // Return the order enriched with restaurant/dropoff/customer so clients can render full details.
    const enriched = await OrderService.enrichForRider(updated);

    if (requestedStatus === 'ready') {
      try {
        const dispatchResult = await DispatchService.dispatchForOrder(updated);
        if (dispatchResult.assigned) {
          SocketService.emitOrderUpdated(dispatchResult.order);
          return success(res, { order: dispatchResult.order, dispatch: dispatchResult });
        }
        return success(res, { order: enriched, dispatch: dispatchResult });
      } catch (dispatchError: any) {
        return success(res, {
          order: enriched,
          dispatch: { assigned: false, reason: dispatchError.message || 'Dispatch failed' },
        });
      }
    }

    if (requestedStatus === 'delivered') {
      if (updated?.rider_id) {
        try {
          const rider = await RiderService.findById(String(updated.rider_id));
          await supabase
            .from('riders')
            .update({
              active_orders: Math.max(0, (Number(rider?.active_orders) || 1) - 1),
              last_delivered_at: new Date().toISOString(),
            })
            .eq('id', String(updated.rider_id));
        } catch {
          // non-blocking bookkeeping
        }
      }

      try {
        const settlement = await EarningsService.settleOrder(updated);
        SocketService.emitOrderUpdated(updated);
        return success(res, { order: enriched, settlement });
      } catch (settlementError: any) {
        return success(res, {
          order: enriched,
          settlement: { error: settlementError.message || 'Settlement failed' },
        });
      }
    }

    SocketService.emitOrderUpdated(updated);
    return success(res, { order: enriched });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update order status', 500);
  }
});

router.post('/:id/payment-collected', auth, async (req, res) => {
  try {
    const order = await OrderService.findById(String(req.params.id));
    if (!order) {
      return fail(res, 'Order not found', 404);
    }

    if (req.user?.role === 'RIDER') {
      const rider = await RiderService.findByUserId(String(req.user?.id));
      if (!rider || order.rider_id !== rider.id) {
        return fail(res, 'Forbidden', 403);
      }
    } else if (req.user?.role !== 'ADMIN') {
      return fail(res, 'Forbidden', 403);
    }

    const updated = await OrderService.updateById(String(req.params.id), {
      payment_status: 'paid',
    });
    const enriched = await OrderService.enrichForRider(updated);
    SocketService.emitOrderUpdated(updated);
    return success(res, { order: enriched });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to record payment', 500);
  }
});

export default router;