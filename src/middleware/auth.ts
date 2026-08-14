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
      const metadata = (authUser.user_metadata ?? {}) as Record<string, any>;
      const name = metadata.full_name ||
        metadata.name ||
        (authUser.email ? authUser.email.split('@')[0] : '');
      const phone = metadata.phone || null;

      let roleSlug = metadata.role || 'CUSTOMER';
      roleSlug = String(roleSlug).toUpperCase();

      const gender = metadata.gender || null;

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
        phone,
      });

      localUser = created;
    }

    // Ensure the RIDER resource set (riders + wallet) exists idempotently.
    // Signup used to insert these from the client with the anon key, which
    // could be rejected and leave a half-created account (auth user + users
    // row but no riders/wallets row). Creating them here with the service role
    // both prevents and heals that state.
    if (localUser.role?.slug === 'RIDER') {
      try {
        const { data: rider } = await supabase
          .from('riders')
          .select('id')
          .eq('user_id', localUser.id)
          .maybeSingle();
        if (!rider?.id) {
          const { data: createdRider, error: riderError } = await supabase
            .from('riders')
            .insert({ user_id: localUser.id, status: 'offline' })
            .select('id')
            .single();
          if (riderError) throw riderError;
          const { data: wallet } = await supabase
            .from('wallets')
            .select('id')
            .eq('rider_id', createdRider.id)
            .maybeSingle();
          if (!wallet?.id) {
            await supabase
              .from('wallets')
              .insert({ rider_id: createdRider.id, currency: 'KES', balance: 0 });
          }
        }
      } catch (e) {
        // Best-effort; the next authenticated request retries the creation.
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
