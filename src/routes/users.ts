import { Router } from 'express';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { UserService } from '../services/user.service';

const router = Router();

router.get('/me', auth, async (req, res) => {
  if (!req.user) {
    return fail(res, 'Not authenticated', 401);
  }

  try {
    const user = await UserService.findById(String(req.user.id));
    return success(res, { user });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to fetch user profile', 500);
  }
});

router.patch('/me', auth, async (req, res) => {
  if (!req.user) {
    return fail(res, 'Not authenticated', 401);
  }

  try {
    const user = await UserService.updateById(String(req.user.id), req.body);
    return success(res, { user });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update profile', 500);
  }
});

router.delete('/me', auth, async (req, res) => {
  if (!req.user) {
    return fail(res, 'Not authenticated', 401);
  }

  try {
    await UserService.deleteById(String(req.user.id));
    return success(res, { message: 'User account deleted' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to delete account', 500);
  }
});

router.get('/:id', auth, authorize('ADMIN'), async (req, res) => {
  try {
    const user = await UserService.findById(String(req.params.id));
    return success(res, { user });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to fetch user', 500);
  }
});

router.get('/', auth, authorize('ADMIN'), async (req, res) => {
  try {
    const users = await UserService.list();
    return success(res, { users });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to fetch users', 500);
  }
});

export default router;