-- =============================================================
-- Contextual recommendations: schema additions
-- Run this in the Supabase SQL editor (or via psql).
-- =============================================================

-- 1) Gender on the local users table, so the recommendation engine
--    can personalise (e.g. sanitary items for female accounts).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gender text
  CHECK (gender IN ('male', 'female', 'other'));

-- 2) Contextual tags on menu_items. Restaurants tag their menu items
--    with any of: breakfast, lunch, snacks, dinner,
--    hot_beverage, cold_drink, alcohol, sanitary.
--    The engine also falls back to keyword matching on the category /
--    item name, so tagging is optional.
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_menu_items_tags ON menu_items USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_users_gender ON users (gender);
