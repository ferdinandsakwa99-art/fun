import { Router } from 'express';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { WalletService } from '../services/wallet.service';
import { RestaurantService } from '../services/restaurant.service';
import { RiderService } from '../services/rider.service';

const router = Router();

// Get client (user) wallet
router.get('/clients/:id', auth, async (req, res) => {
  try {
    const requestedId = String(req.params.id);
    const isAdmin = req.user && req.user.role === 'ADMIN';
    if (!isAdmin && (!req.user || String(req.user.id) !== requestedId)) {
      return fail(res, 'Forbidden', 403);
    }

    const wallet = await WalletService.getOrCreateClient(requestedId);
    return success(res, { wallet });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to fetch client wallet', 500);
  }
});

// Top up the client's wallet (self or admin)
router.post('/clients/:id/topup', auth, async (req, res) => {
  try {
    const requestedId = String(req.params.id);
    const isAdmin = req.user && req.user.role === 'ADMIN';
    if (!isAdmin && (!req.user || String(req.user.id) !== requestedId)) {
      return fail(res, 'Forbidden', 403);
    }

    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) {
      return fail(res, 'A valid amount is required', 400);
    }

    const wallet = await WalletService.creditClient(requestedId, amount);
    return success(res, { wallet });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to top up wallet', 500);
  }
});

// Debit the client's wallet (self or admin)
router.post('/clients/:id/debit', auth, async (req, res) => {
  try {
    const requestedId = String(req.params.id);
    const isAdmin = req.user && req.user.role === 'ADMIN';
    if (!isAdmin && (!req.user || String(req.user.id) !== requestedId)) {
      return fail(res, 'Forbidden', 403);
    }

    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) {
      return fail(res, 'A valid amount is required', 400);
    }

    const wallet = await WalletService.debitClient(requestedId, amount);
    return success(res, { wallet });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to debit wallet', 400);
  }
});

// Get restaurant wallet
router.get('/restaurants/:id', auth, async (req, res) => {
  try {
    const restaurantId = String(req.params.id);
    const isAdmin = req.user && req.user.role === 'ADMIN';
    if (!isAdmin) {
      const isOwner = await RestaurantService.isOwnerForRestaurant(String(req.user?.id), restaurantId);
      if (!isOwner) return fail(res, 'Forbidden', 403);
    }

    const wallet = await WalletService.getByRestaurantId(restaurantId);
    return success(res, { wallet });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to fetch restaurant wallet', 500);
  }
});

// Get rider wallet
router.get('/riders/:id', auth, async (req, res) => {
  try {
    const riderId = String(req.params.id);
    const isAdmin = req.user && req.user.role === 'ADMIN';
    if (!isAdmin) {
      // allow rider owner to access their wallet
      const rider = await RiderService.findByUserId(String(req.user?.id));
      if (!rider || String(rider.id) !== riderId) return fail(res, 'Forbidden', 403);
    }

    const wallet = await WalletService.getByRiderId(riderId);
    return success(res, { wallet });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to fetch rider wallet', 500);
  }
});

export default router;
