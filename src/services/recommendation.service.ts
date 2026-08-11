import { supabase } from '../config/supabase';
import WeatherService from './weather.service';

const EVENT_WEIGHTS: Record<string, number> = {
  user_opened_app: 0,
  restaurant_viewed: 1,
  menu_item_viewed: 1,
  category_viewed: 1,
  item_added_to_cart: 5,
  item_removed_from_cart: -2,
  order_created: 8,
  order_completed: 10,
  order_cancelled: -8,
  restaurant_favorited: 6,
  search_performed: 0.5,
  promo_viewed: 0.5,
  promo_used: 4,
};

// ---- Contextual signal configuration -------------------------------
// Meal slots (Nairobi time): 6–11:59 breakfast, 12–15:59 lunch,
// 16–18:59 snacks, 19–23:59 dinner.
const MEAL_SLOT_OF_HOUR = (h: number): string | null =>
  h >= 6 && h < 12 ? 'breakfast'
  : h >= 12 && h < 16 ? 'lunch'
  : h >= 16 && h < 19 ? 'snacks'
  : h >= 19 ? 'dinner'
  : null;

const SANITARY_DAYS = new Set([1, 2, 3, 4, 5]);
const HOT_TEMP_C = 26; // >= this is a "hot" time -> cold drinks
const COLD_TEMP_C = 18; // < this is a "cold" time -> hot beverages
const COLD_DRINK_CUTOFF_HOUR = 18; // cold drinks only boosted before 6pm
const ALCOHOL_START_HOUR = 17; // Friday evening onwards
const ALCOHOL_DAYS = new Set([5, 6]); // Friday, Saturday
const LOCAL_RADIUS_KM = 10;

// Keyword fallbacks so tagging is optional. The engine first reads the
// menu_items.tags column, then falls back to matching these keywords
// against the category name, item name and description.
const TAG_KEYWORDS: Record<string, string[]> = {
  breakfast: ['breakfast', 'mandazi', 'pancake', 'chapati', 'porridge', 'oat', 'omelette', 'cereal', 'toast', 'eggs'],
  lunch: ['lunch', 'rice', 'pilau', 'biryani', 'beef', 'chicken', 'fish', 'ugali', 'burger', 'chips', 'fries', 'kebab'],
  snacks: ['snack', 'samosa', 'pizza', 'cake', 'muffin', 'cookie', 'biscuit', 'crisps', 'bites', 'bhajia', 'nuggets'],
  dinner: ['dinner', 'supper', 'grill', 'steak', 'roast', 'bbq', 'pasta', 'stew', 'nyama', 'taco'],
  hot_beverage: ['hot beverage', 'hot drink', 'tea', 'coffee', 'chai', 'cappuccino', 'latte', 'hot chocolate', 'milo', 'espresso'],
  cold_drink: ['cold drink', 'cold beverage', 'soda', 'juice', 'milkshake', 'smoothie', 'iced', 'fizzy', 'coke', 'fanta', 'sprite', 'mineral water'],
  alcohol: ['alcohol', 'beer', 'lager', 'tusker', 'guinness', 'wine', 'cocktail', 'whisky', 'whiskey', 'vodka', 'gin', 'spirit', 'cider', 'champagne'],
  sanitary: ['sanitary', 'pad', 'pads', 'tampon', 'tampons', 'pantyliner', 'feminine', 'menstrual', 'reusable pad'],
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getItemTags(item: any, categoryName: string): Set<string> {
  const tags = new Set<string>();
  if (Array.isArray(item.tags)) {
    item.tags.forEach((t: any) => {
      const s = String(t).toLowerCase().trim();
      if (s) tags.add(s);
    });
  }
  const text = `${categoryName || ''} ${item.name || ''} ${item.description || ''}`.toLowerCase();
  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) tags.add(tag);
  }
  return tags;
}

// Current date/time parts in Nairobi time (so meal slots, weekday and
// day-of-month always match the local market even if the server clock
// is in a different timezone).
function getNairobiNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    hourCycle: 'h23',
    weekday: 'short',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = Number(get('hour')) || 0;
  const date = Number(get('day')) || 1;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { hour, date, day };
}

export const RecommendationService = {
  async getPopular(opts: { lat?: number; lon?: number; limit?: number }) {
    const { lat, lon, limit = 12 } = opts;

    // Global popularity signals (all users)
    const [allEventsRes, orderItemsRes] = await Promise.all([
      supabase.from('user_events').select('menu_item_id'),
      supabase.from('order_items').select('menu_item_id, quantity'),
    ]);
    const allEvents = allEventsRes.data || [];
    const eventPop: Record<string, number> = {};
    (allEvents || []).forEach((e: any) => {
      if (e.menu_item_id) eventPop[e.menu_item_id] = (eventPop[e.menu_item_id] || 0) + 1;
    });

    const orderItems = orderItemsRes.data || [];
    const orderPop: Record<string, number> = {};
    (orderItems || []).forEach((o: any) => {
      if (o.menu_item_id) orderPop[o.menu_item_id] = (orderPop[o.menu_item_id] || 0) + Number(o.quantity || 1);
    });

    // Candidate items with their restaurants
    const ITEM_SELECT =
      'id, name, description, price, category_id, tags, is_available, restaurant:restaurants(id,name,latitude,longitude,average_rating,cover_image,delivery_fee)';
    const ITEM_SELECT_NO_TAGS =
      'id, name, description, price, category_id, is_available, restaurant:restaurants(id,name,latitude,longitude,average_rating,cover_image,delivery_fee)';

    let items: any[] = [];
    const itemsResult = await supabase
      .from('menu_items')
      .select(ITEM_SELECT)
      .eq('is_available', true)
      .limit(800);
    if (itemsResult.error || !itemsResult.data || itemsResult.data.length === 0) {
      const fallback = await supabase
        .from('menu_items')
        .select(ITEM_SELECT_NO_TAGS)
        .eq('is_available', true)
        .limit(800);
      items = fallback.data || [];
    } else {
      items = itemsResult.data;
    }
    if (!items || items.length === 0) return { context: [], results: [] };

    const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const toRad = (v: number) => (v * Math.PI) / 180;
      const R = 6371;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const distanceOf = (rest: any): number | null => {
      if (!lat || !lon || !rest?.latitude || !rest?.longitude) return null;
      return haversineKm(Number(lat), Number(lon), Number(rest.latitude), Number(rest.longitude));
    };

    let localPop: Record<string, number> = {};
    if (lat && lon) {
      const localIds = new Set<string>();
      (items as any[]).forEach((it) => {
        const d = distanceOf(it.restaurant);
        if (d !== null && d <= LOCAL_RADIUS_KM) localIds.add(it.id);
      });
      localIds.forEach((id) => {
        localPop[id] = (eventPop[id] || 0) + (orderPop[id] || 0) * 3;
      });
    }

    const scored = (items as any[]).map((it) => {
      const pop = (eventPop[it.id] || 0) + (orderPop[it.id] || 0) * 3;
      const popSignal = lat && lon ? localPop[it.id] || 0 : pop;
      const rating = Number(it.restaurant?.average_rating || 0);
      const score = (lat && lon ? popSignal : pop) + rating * 4;
      return { item: it, score, pop: pop || rating || 1 };
    });

    scored.sort((a, b) => b.score - a.score);
    const final = scored.slice(0, limit);

    return {
      context: lat && lon ? ['nearby'] : [],
      results: final.map((s) => ({
        id: s.item.id,
        name: s.item.name,
        restaurant: s.item.restaurant,
        tags: [],
        score: s.score,
      })),
    };
  },

  async updatePreferencesFromEvent(event: any) {
    // We only maintain category-level preference scores for now.
    if (!event.user_id) return;

    const weight = EVENT_WEIGHTS[event.event_type] ?? 0;
    if (!event.category_id || weight === 0) return;

    // Upsert into user_preferences (user_id, category_id)
    const { data: existing } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', event.user_id)
      .eq('category_id', event.category_id)
      .maybeSingle();

    if (!existing) {
      await supabase.from('user_preferences').insert({
        user_id: event.user_id,
        category_id: event.category_id,
        preference_score: weight,
      });
      return;
    }

    // simple decay + increment
    const newScore = (existing.preference_score || 0) * 0.95 + weight;
    await supabase
      .from('user_preferences')
      .update({ preference_score: newScore })
      .eq('id', existing.id);
  },

  async getRecommendations(opts: { user_id: string; lat?: number; lon?: number; limit?: number }) {
    const { user_id, lat, lon, limit = 12 } = opts;

    // ---- Contextual signals -----------------------------------------
    const ctx = getNairobiNow();
    const temperature = await WeatherService.getNairobiTemperature();
    const mealSlot = MEAL_SLOT_OF_HOUR(ctx.hour);
    const isSanitaryDay = SANITARY_DAYS.has(ctx.date);
    const isAlcoholWindow =
      ALCOHOL_DAYS.has(ctx.day) && (ctx.day === 6 || ctx.hour >= ALCOHOL_START_HOUR);
    const isColdDay = temperature != null && temperature < COLD_TEMP_C;
    const isHotDay = temperature != null && temperature >= HOT_TEMP_C;
    const beforeSixPm = ctx.hour < COLD_DRINK_CUTOFF_HOUR;

    // gender (defensive: the column may not exist until the SQL runs)
    let gender: string | undefined;
    try {
      const { data: userRow } = await supabase
        .from('users')
        .select('gender')
        .eq('id', user_id)
        .maybeSingle();
      gender = userRow?.gender as string | undefined;
    } catch {
      gender = undefined;
    }

    // 1) category preference scores maintained from user_events
    const { data: prefs } = await supabase
      .from('user_preferences')
      .select('category_id, preference_score')
      .eq('user_id', user_id);
    const prefMap: Record<string, number> = {};
    (prefs || []).forEach((p: any) => {
      prefMap[p.category_id] = Number(p.preference_score) || 0;
    });

    // 2) user-level affinities derived from their behavioral events
    const { data: userEvents } = await supabase
      .from('user_events')
      .select('event_type, restaurant_id, menu_item_id')
      .eq('user_id', user_id);
    const restaurantAff: Record<string, number> = {};
    const itemAff: Record<string, number> = {};
    (userEvents || []).forEach((e: any) => {
      const w = EVENT_WEIGHTS[e.event_type] ?? 0;
      if (w <= 0) return;
      if (e.restaurant_id) restaurantAff[e.restaurant_id] = (restaurantAff[e.restaurant_id] || 0) + w;
      if (e.menu_item_id) itemAff[e.menu_item_id] = (itemAff[e.menu_item_id] || 0) + w;
    });

    // order history: strong restaurant affinity + spend/time context
    const { data: userOrders } = await supabase
      .from('orders')
      .select('restaurant_id, total, status, created_at')
      .eq('user_id', user_id);
    const amounts: number[] = [];
    const hours: number[] = [];
    (userOrders || []).forEach((o: any) => {
      if (o.status === 'cancelled') return;
      if (o.restaurant_id) restaurantAff[o.restaurant_id] = (restaurantAff[o.restaurant_id] || 0) + 3;
      const amount = Number(o.total || 0);
      if (amount > 0) amounts.push(amount);
      if (o.created_at) hours.push(new Date(o.created_at).getHours());
    });
    const avgOrder = amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
    const avgHour =
      hours.length > 0 ? Math.round(hours.reduce((a, b) => a + b, 0) / hours.length) : null;

    // 3) global popularity signals (all users)
    const { data: allEvents } = await supabase.from('user_events').select('menu_item_id');
    const eventPop: Record<string, number> = {};
    (allEvents || []).forEach((e: any) => {
      if (e.menu_item_id) eventPop[e.menu_item_id] = (eventPop[e.menu_item_id] || 0) + 1;
    });

    const { data: orderItems } = await supabase.from('order_items').select('menu_item_id, quantity');
    const orderPop: Record<string, number> = {};
    (orderItems || []).forEach((o: any) => {
      if (o.menu_item_id) orderPop[o.menu_item_id] = (orderPop[o.menu_item_id] || 0) + Number(o.quantity || 1);
    });

    // 4) candidate items with their restaurants
    const ITEM_SELECT =
      'id, name, description, price, category_id, tags, is_available, restaurant:restaurants(id,name,latitude,longitude,average_rating,cover_image,delivery_fee)';
    const ITEM_SELECT_NO_TAGS =
      'id, name, description, price, category_id, is_available, restaurant:restaurants(id,name,latitude,longitude,average_rating,cover_image,delivery_fee)';

    let items: any[] = [];
    const itemsResult = await supabase
      .from('menu_items')
      .select(ITEM_SELECT)
      .eq('is_available', true)
      .limit(800);
    if (itemsResult.error || !itemsResult.data || itemsResult.data.length === 0) {
      // The tags column may not exist yet; fall back to keyword matching only.
      const fallback = await supabase
        .from('menu_items')
        .select(ITEM_SELECT_NO_TAGS)
        .eq('is_available', true)
        .limit(800);
      items = fallback.data || [];
    } else {
      items = itemsResult.data;
    }
    if (!items || items.length === 0) return [];

    // category names for keyword classification
    const { data: categories } = await supabase.from('categories').select('id, name, slug');
    const catName: Record<string, string> = {};
    (categories || []).forEach((c: any) => {
      catName[c.id] = `${c.name || ''} ${c.slug || ''}`;
    });

    // distance helper + local (in-radius) popularity
    const distanceOf = (rest: any): number | null => {
      if (!lat || !lon || !rest?.latitude || !rest?.longitude) return null;
      return haversineKm(Number(lat), Number(lon), Number(rest.latitude), Number(rest.longitude));
    };

    let localPop: Record<string, number> = {};
    if (lat && lon) {
      const localIds = new Set<string>();
      (items as any[]).forEach((it) => {
        const d = distanceOf(it.restaurant);
        if (d !== null && d <= LOCAL_RADIUS_KM) localIds.add(it.id);
      });
      localIds.forEach((id) => {
        localPop[id] = (eventPop[id] || 0) + (orderPop[id] || 0) * 3;
      });
    }

    // 5) active promotions per restaurant
    const restaurantIds = Array.from(
      new Set((items as any[]).map((it) => it.restaurant?.id).filter(Boolean)),
    );
    const promoMap: Record<string, any[]> = {};
    if (restaurantIds.length > 0) {
      const { data: promos } = await supabase
        .from('promotions')
        .select('*')
        .in('restaurant_id', restaurantIds)
        .eq('active', true);
      const now = Date.now();
      (promos || []).forEach((p: any) => {
        if (p.starts_at && new Date(p.starts_at).getTime() > now) return;
        if (p.ends_at && new Date(p.ends_at).getTime() < now) return;
        const rid = String(p.restaurant_id);
        promoMap[rid] = promoMap[rid] || [];
        promoMap[rid].push(p);
      });
    }

    // normalize maxima so each signal contributes a bounded weight
    const maxPref = Math.max(0, ...Object.values(prefMap));
    const maxItem = Math.max(0, ...Object.values(itemAff));
    const maxRest = Math.max(0, ...Object.values(restaurantAff));
    const maxPop = Math.max(0, ...Object.values(eventPop), ...Object.values(orderPop).map((v) => v * 3));
    const maxLocalPop = Math.max(0, ...Object.values(localPop));

    const currentHour = new Date().getHours();
    const novelty = () => Math.random() * 2;

    const activeContext: string[] = [];
    if (mealSlot) activeContext.push(mealSlot);
    if (temperature != null) activeContext.push(`${Math.round(temperature)}°C`);
    if (isHotDay) activeContext.push('hot-day');
    if (isColdDay) activeContext.push('cold-day');
    if (isSanitaryDay && gender === 'female') activeContext.push('sanitary-days');
    if (isAlcoholWindow) activeContext.push('weekend-drinks');
    if (lat && lon) activeContext.push('nearby');

    const scored = (items as any[]).map((it) => {
      const categoryId = it.category_id;
      const cat = prefMap[categoryId] || 0;
      const pop = (eventPop[it.id] || 0) + (orderPop[it.id] || 0) * 3;
      const popSignal = lat && lon ? localPop[it.id] || 0 : pop;
      const popMax = lat && lon ? maxLocalPop : maxPop;

      let promoBonus = 0;
      let freeDeliveryBonus = 0;
      const rid = it.restaurant?.id ? String(it.restaurant.id) : null;
      if (rid && promoMap[rid] && promoMap[rid].length > 0) {
        const hasFreeDelivery = promoMap[rid].some((p: any) =>
          p.type === 'free_delivery' ||
          (p.metadata && (p.metadata.free_delivery === true || p.metadata.free_delivery === 'true')) ||
          /free delivery/i.test(p.name || ''),
        );
        promoBonus = hasFreeDelivery ? 14 : 10;
        if (hasFreeDelivery) freeDeliveryBonus = 10;
      }
      if (Number(it.restaurant?.delivery_fee || 0) === 0) freeDeliveryBonus += 6;

      let priceMatch = 0;
      const price = Number(it.price || 0);
      if (avgOrder > 0 && price > 0) {
        const ratio = price / avgOrder;
        if (ratio >= 0.5 && ratio <= 1.5) priceMatch = 10;
        else if (ratio >= 0.3 && ratio <= 2.0) priceMatch = 4;
      }

      let distanceScore = 0;
      const distance = distanceOf(it.restaurant);
      if (distance !== null) {
        if (distance <= 1) distanceScore = 12;
        else if (distance <= 3) distanceScore = 8;
        else if (distance <= 6) distanceScore = 4;
      }

      let timeScore = 0;
      if (avgHour !== null) {
        const diff = Math.abs(((currentHour - avgHour) + 24) % 24);
        if (diff <= 1) timeScore = 8;
        else if (diff <= 3) timeScore = 4;
      }

      // ---- Contextual boosts (meal time, weather, occasions) ---------
      let contextBonus = 0;
      const tags = getItemTags(it, catName[categoryId] || '');
      if (mealSlot && tags.has(mealSlot)) contextBonus += 16;
      if (isColdDay && tags.has('hot_beverage')) contextBonus += 14;
      if (isHotDay && beforeSixPm && tags.has('cold_drink')) contextBonus += 14;
      if (isAlcoholWindow && tags.has('alcohol')) contextBonus += 20;
      if (isSanitaryDay && gender === 'female' && tags.has('sanitary')) contextBonus += 26;

      const rating = Number(it.restaurant?.average_rating || 0);
      const score =
        (maxPref ? (cat / maxPref) * 35 : 0) +
        (maxItem ? ((itemAff[it.id] || 0) / maxItem) * 25 : 0) +
        (maxRest ? ((restaurantAff[it.restaurant_id] || 0) / maxRest) * 15 : 0) +
        (popMax ? (popSignal / popMax) * 12 : 0) +
        (rating ? (rating / 5) * 5 : 0) +
        promoBonus +
        freeDeliveryBonus +
        priceMatch +
        distanceScore +
        timeScore +
        contextBonus +
        novelty();

      return { item: it, score, pop: pop || rating || 1, tags: Array.from(tags) };
    });

    scored.sort((a, b) => b.score - a.score);

    // 80% exploitation / 20% exploration
    const explorationPct = 0.2;
    const exploitCount = Math.max(1, Math.round(limit * (1 - explorationPct)));
    const top = scored.slice(0, exploitCount);
    const remaining = scored.slice(exploitCount);

    function weightedRandomSample(arr: any[], k: number) {
      if (!arr || arr.length === 0 || k <= 0) return [];
      const total = arr.reduce((s, a) => s + a.pop, 0) || 1;
      const picks: any[] = [];
      const used = new Set();
      while (picks.length < k && used.size < arr.length) {
        let r = Math.random() * total;
        let i = 0;
        for (; i < arr.length; i++) {
          if (used.has(i)) continue;
          r -= arr[i].pop;
          if (r <= 0) break;
        }
        if (i >= arr.length) {
          // fall back to first unused index
          i = arr.findIndex((_, idx) => !used.has(idx));
        }
        if (i >= 0 && !used.has(i)) {
          picks.push(arr[i]);
          used.add(i);
        }
      }
      return picks;
    }

    const exploreCount = Math.max(0, limit - top.length);
    const exploration = weightedRandomSample(remaining, exploreCount);
    const final = top.concat(exploration).slice(0, limit);

    return {
      context: activeContext,
      results: final.map((s) => ({
        id: s.item.id,
        name: s.item.name,
        restaurant: s.item.restaurant,
        tags: s.tags,
        score: s.score,
      })),
    };
  },
};

export default RecommendationService;
