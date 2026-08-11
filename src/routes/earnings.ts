import { Router } from 'express';
import auth from '../middleware/auth';
import { success, fail } from '../utils/response';
import { EarningsService } from '../services/earnings.service';
import { WalletService } from '../services/wallet.service';
import { RestaurantService } from '../services/restaurant.service';
import { RiderService } from '../services/rider.service';
import { OrderService } from '../services/order.service';
import { supabase } from '../config/supabase';

const router = Router();

router.get('/restaurant/:id', auth, async (req, res) => {
  try {
    const restaurantId = String(req.params.id);
    const isAdmin = req.user?.role === 'ADMIN';
    if (!isAdmin) {
      const isOwner = await RestaurantService.isOwnerForRestaurant(String(req.user?.id), restaurantId);
      if (!isOwner) return fail(res, 'Forbidden', 403);
    }

    const [entries, wallet] = await Promise.all([
      EarningsService.listForRestaurant(restaurantId),
      WalletService.getByRestaurantId(restaurantId),
    ]);
    return success(res, { entries, wallet, summary: EarningsService.summarize(entries) });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load restaurant earnings', 500);
  }
});

router.get('/rider/:id', auth, async (req, res) => {
  try {
    const riderId = String(req.params.id);
    const isAdmin = req.user?.role === 'ADMIN';
    if (!isAdmin) {
      const rider = await RiderService.findByUserId(String(req.user?.id));
      if (!rider || String(rider.id) !== riderId) return fail(res, 'Forbidden', 403);
    }

    const [entries, wallet] = await Promise.all([
      EarningsService.listForRider(riderId),
      WalletService.getByRiderId(riderId),
    ]);
    return success(res, { entries, wallet, summary: EarningsService.summarize(entries) });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load rider earnings', 500);
  }
});

router.get('/summary', auth, async (req, res) => {
  try {
    const role = req.user?.role;
    const userId = String(req.user?.id);

    if (role === 'RESTAURANT_OWNER') {
      const restaurantIds = await RestaurantService.getOwnedRestaurantIds(userId);
      const [entries, wallets] = await Promise.all([
        EarningsService.listForRestaurants(restaurantIds),
        Promise.all(restaurantIds.map((id) => WalletService.getByRestaurantId(id))),
      ]);
      return success(res, {
        summary: EarningsService.summarize(entries),
        wallets: (wallets as any[]).filter(Boolean),
        entries,
      });
    }

    if (role === 'RIDER') {
      const rider = await RiderService.findByUserId(userId);
      if (!rider) return fail(res, 'Rider profile not found', 404);
      const [entries, wallet] = await Promise.all([
        EarningsService.listForRider(String(rider.id)),
        WalletService.getByRiderId(String(rider.id)),
      ]);
      return success(res, { summary: EarningsService.summarize(entries), wallet, entries });
    }

    if (role === 'ADMIN') {
      const { data, error } = await supabase
        .from('earnings')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const entries = await EarningsService.attachOrders(data);
      return success(res, { summary: EarningsService.summarize(entries), entries });
    }

    return fail(res, 'Forbidden', 403);
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load earnings summary', 500);
  }
});

router.post('/orders/:id/settle', auth, async (req, res) => {
  try {
    const order = await OrderService.findById(String(req.params.id));
    if (!order) return fail(res, 'Order not found', 404);

    const role = req.user?.role;
    const userId = String(req.user?.id);

    if (role === 'RESTAURANT_OWNER') {
      const restaurantIds = await RestaurantService.getOwnedRestaurantIds(userId);
      if (!restaurantIds.includes(order.restaurant_id)) return fail(res, 'Forbidden', 403);
    } else if (role === 'RIDER') {
      const rider = await RiderService.findByUserId(userId);
      if (!rider || order.rider_id !== rider.id) return fail(res, 'Forbidden', 403);
    } else if (role !== 'ADMIN') {
      return fail(res, 'Forbidden', 403);
    }

    if (order.status !== 'delivered') {
      return fail(res, 'Order has not been delivered yet', 400);
    }

    const settlement = await EarningsService.settleOrder(order);
    return success(res, { settlement });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to settle order', 500);
  }
});

export default router;
