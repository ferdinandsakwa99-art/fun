import { Request } from 'express';

declare global {
  namespace Express {
    interface User {
      id: string;
      role: UserRole;
      email?: string;
      name?: string;
      phone?: string;
    }

    interface Request {
      user?: User;
    }
  }
}

declare type UserRole = 'CUSTOMER' | 'RESTAURANT_OWNER' | 'RIDER' | 'ADMIN';

declare type OrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'PICKED_UP'
  | 'DELIVERING'
  | 'DELIVERED'
  | 'CANCELLED';
