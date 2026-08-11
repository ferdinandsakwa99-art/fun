import { Request, Response, NextFunction } from 'express';

export default function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    if (roles.length === 0 || roles.includes(user.role)) {
      return next();
    }

    return res.status(403).json({ success: false, error: 'Forbidden' });
  };
}
