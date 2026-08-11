import { Router } from 'express';
import { hash } from '../utils/password';
import { success, fail } from '../utils/response';
import { UserService } from '../services/user.service';
import { RoleService } from '../services/role.service';
import { supabase } from '../config/supabase';
import auth from '../middleware/auth';

const router = Router();

router.post('/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return fail(res, 'name, email, password and role are required', 400);
  }

  try {
    const roleRecord = await RoleService.getBySlug(role);
    if (!roleRecord) {
      return fail(res, 'Invalid role provided', 400);
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      return fail(res, error.message, 400);
    }

    if (!data.user) {
      return fail(res, 'Unable to register user', 500);
    }

    const hashed = await hash(password);
    const user = await UserService.create({
      name,
      email,
      password: hashed,
      role_id: roleRecord.id,
    });

    return success(res, { user: { id: user.id, email: user.email, role: roleRecord.slug } });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to register user', 500);
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return fail(res, 'email and password are required', 400);
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session) {
      return fail(res, 'Invalid credentials', 401);
    }

    const user = await UserService.findByEmail(email);
    if (!user) {
      return fail(res, 'Invalid credentials', 401);
    }

    const roleSlug = user.role?.slug || 'CUSTOMER';
    return success(res, { user: { id: user.id, email: user.email, role: roleSlug }, session: data.session });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to login', 500);
  }
});

router.post('/logout', auth, async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];

  try {
    if (!token) {
      return fail(res, 'Authentication required', 401);
    }

    await supabase.auth.admin.signOut(token);
    return success(res, { message: 'Logged out' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to logout', 500);
  }
});

router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return fail(res, 'refresh_token is required', 400);
  }

  try {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token,
    });

    if (error || !data.session) {
      return fail(res, error?.message || 'Unable to refresh session', 401);
    }

    return success(res, { session: data.session });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to refresh session', 500);
  }
});

router.post('/forgot-password', async (req, res) => {
  return success(res, { message: 'Password reset requested' });
});

router.post('/reset-password', (req, res) => {
  return success(res, { message: 'Password reset successfully' });
});

router.get('/me', auth, (req, res) => {
  return success(res, { user: req.user || null });
});

export default router;