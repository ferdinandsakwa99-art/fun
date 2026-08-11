import dotenv from 'dotenv';

dotenv.config();

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const PORT = process.env.PORT || '3000';
export const DATABASE_URL = process.env.DATABASE_URL || '';
export const REDIS_URL = process.env.REDIS_URL || '';
export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const JWT_SECRET = process.env.JWT_SECRET || 'secret';
