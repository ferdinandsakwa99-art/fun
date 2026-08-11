import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase';
import { UserService } from '../services/user.service';

export default async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  try {
    const token = authHeader.split(' ')[1];
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user || !data.user.email) {
      return next();
    }

    const localUser = await UserService.findByEmail(data.user.email);
    if (localUser) {
      req.user = {
        id: String(localUser.id),
        role: localUser.role?.slug as any,
        email: localUser.email,
        name: localUser.name,
        phone: localUser.phone,
      };
    }
    return next();
  } catch {
    return next();
  }
}
