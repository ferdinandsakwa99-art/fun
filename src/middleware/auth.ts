import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase';
import { UserService } from '../services/user.service';
import { RoleService } from '../services/role.service';
import { hash } from '../utils/password';

export default async function auth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user || !data.user.email) {
      return res.status(401).json({ success: false, error: 'Invalid Supabase authentication token' });
    }

    const authUser = data.user;
    if (!authUser.email) {
      return res.status(401).json({ success: false, error: 'Invalid Supabase authentication token' });
    }
    let localUser = await UserService.findByEmail(authUser.email);
    if (!localUser) {
      // Create a local user record for Supabase-authenticated user
      const name = (authUser.user_metadata && (authUser.user_metadata as any).full_name) ||
        (authUser.user_metadata && (authUser.user_metadata as any).name) ||
        (authUser.email ? authUser.email.split('@')[0] : '');

      let roleSlug = (authUser.user_metadata && (authUser.user_metadata as any).role) || 'CUSTOMER';
      roleSlug = String(roleSlug).toUpperCase();

      const gender =
        (authUser.user_metadata && (authUser.user_metadata as any).gender) || null;

      let roleRecord = null;
      try {
        roleRecord = await RoleService.getBySlug(roleSlug);
      } catch (e) {
        roleRecord = null;
      }

      if (!roleRecord) {
        roleRecord = await RoleService.getBySlug('CUSTOMER');
      }

      const tempPw = Math.random().toString(36).slice(2);
      const hashed = await hash(tempPw);

      const created = await UserService.create({
        name,
        email: authUser.email,
        password: hashed,
        role_id: roleRecord.id,
        gender,
      });

      localUser = created;

      // If this user should be a rider, create a riders row linking to the new user
      try {
        if (roleRecord.slug === 'RIDER') {
          const { data: rider } = await supabase
            .from('riders')
            .insert({ user_id: created.id, status: 'offline' })
            .select('id')
            .single();
          if (rider?.id) {
            await supabase.from('wallets').insert({ rider_id: rider.id });
          }
        }
      } catch (e) {
        // ignore rider creation errors
      }
    }

    req.user = {
      id: String(localUser.id),
      role: localUser.role?.slug as any,
      email: localUser.email,
      name: localUser.name,
      phone: localUser.phone,
    };
    return next();
  } catch (error: any) {
    return res.status(401).json({ success: false, error: error.message || 'Invalid authentication token' });
  }
}
