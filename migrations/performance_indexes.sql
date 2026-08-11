-- Performance indexes for frequently-queried columns.
-- Run this against your Supabase project (SQL editor) once.
-- CREATE INDEX IF NOT EXISTS is idempotent and safe to re-run.

CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant_id
  ON public.menu_items (restaurant_id);

CREATE INDEX IF NOT EXISTS idx_menu_items_category_id
  ON public.menu_items (category_id);

CREATE INDEX IF NOT EXISTS idx_menu_item_images_menu_item_id
  ON public.menu_item_images (menu_item_id);

CREATE INDEX IF NOT EXISTS idx_orders_user_id
  ON public.orders (user_id);

CREATE INDEX IF NOT EXISTS idx_orders_restaurant_id
  ON public.orders (restaurant_id);

CREATE INDEX IF NOT EXISTS idx_orders_rider_id
  ON public.orders (rider_id);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id
  ON public.order_items (order_id);

CREATE INDEX IF NOT EXISTS idx_order_items_menu_item_id
  ON public.order_items (menu_item_id);

CREATE INDEX IF NOT EXISTS idx_deliveries_rider_id
  ON public.deliveries (rider_id);

CREATE INDEX IF NOT EXISTS idx_riders_user_id
  ON public.riders (user_id);

CREATE INDEX IF NOT EXISTS idx_user_events_user_id
  ON public.user_events (user_id);

CREATE INDEX IF NOT EXISTS idx_user_events_menu_item_id
  ON public.user_events (menu_item_id);

CREATE INDEX IF NOT EXISTS idx_categories_restaurant_id
  ON public.categories (restaurant_id);

CREATE INDEX IF NOT EXISTS idx_earnings_order_id
  ON public.earnings (order_id);

CREATE INDEX IF NOT EXISTS idx_promotions_active
  ON public.promotions (active);
