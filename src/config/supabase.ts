import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from './env';

const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !supabaseKey) {
  throw new Error('Supabase URL and key must be defined in environment variables');
}

export const supabase = createClient(SUPABASE_URL, supabaseKey);