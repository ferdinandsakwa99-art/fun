-- Promotions & coupons management support.
-- Extends the dashboard-created promotions/coupons tables so restaurants can
-- target offers at specific menu items, cap the number of orders a promotion
-- covers, name coupons, limit per-user coupon usage, and link coupons to offers.
-- Also adds a coupon_usages table to track redemptions per user.
-- Run this against your Supabase project (SQL editor) once.

-- Promotions: target a specific menu item and cap the number of orders covered.
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS menu_item_id uuid REFERENCES public.menu_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS usage_limit integer,
  ADD COLUMN IF NOT EXISTS used_count integer NOT NULL DEFAULT 0;

-- Coupons: display name, per-user usage cap, and optional link to a promotion.
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS per_user_limit integer,
  ADD COLUMN IF NOT EXISTS promotion_id uuid REFERENCES public.promotions(id) ON DELETE SET NULL;

-- Per-user coupon redemption tracking.
CREATE TABLE IF NOT EXISTS public.coupon_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coupon_usages_coupon_user_idx
  ON public.coupon_usages (coupon_id, user_id);
CREATE INDEX IF NOT EXISTS coupon_usages_user_idx
  ON public.coupon_usages (user_id);

ALTER TABLE public.coupon_usages ENABLE ROW LEVEL SECURITY;

-- Atomic usage counters used at order placement.
CREATE OR REPLACE FUNCTION public.increment_coupon_usage(p_coupon_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.coupons SET used_count = used_count + 1 WHERE id = p_coupon_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_promotion_usage(p_promotion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.promotions SET used_count = used_count + 1 WHERE id = p_promotion_id;
END;
$$;
