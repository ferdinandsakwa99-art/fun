import { Router } from 'express';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { PaymentService } from '../services/payment.service';

const router = Router();

router.post('/', auth, authorize('CUSTOMER'), async (req, res) => {
  const userId = String(req.user?.id);
  try {
    const payment = await PaymentService.create({ ...req.body, user_id: userId });
    return success(res, { payment });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to create payment', 500);
  }
});

router.get('/', auth, async (req, res) => {
  try {
    if (req.user?.role === 'ADMIN') {
      const payments = await PaymentService.listAll();
      return success(res, { payments });
    }

    if (req.user?.role === 'CUSTOMER') {
      const payments = await PaymentService.listForUser(String(req.user.id));
      return success(res, { payments });
    }

    return fail(res, 'Forbidden', 403);
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load payments', 500);
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const payment = await PaymentService.findById(Number(req.params.id));
    if (!payment) {
      return fail(res, 'Payment not found', 404);
    }

    if (req.user?.role === 'ADMIN' || String(payment.user_id) === String(req.user?.id)) {
      return success(res, { payment });
    }

    return fail(res, 'Forbidden', 403);
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load payment', 500);
  }
});

router.post('/webhook', (req, res) => {
  return success(res, { message: 'Webhook received' });
});

router.post('/refund', auth, authorize('ADMIN'), async (req, res) => {
  try {
    const payment = await PaymentService.refund(Number(req.body.id), req.body);
    return success(res, { refund: payment });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to refund payment', 500);
  }
});

export default router;