import { Request, Response, NextFunction } from 'express';

export default function rateLimiter(req: Request, res: Response, next: NextFunction) {
  // placeholder rate limiter
  next();
}
