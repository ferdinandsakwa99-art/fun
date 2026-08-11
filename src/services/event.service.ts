import { supabase } from '../config/supabase';
import { RecommendationService } from './recommendation.service';

export type UserEvent = {
  user_id: string;
  event_type: string;
  restaurant_id?: string | null;
  menu_item_id?: string | null;
  category_id?: string | null;
  order_id?: string | null;
  metadata?: Record<string, any> | null;
};

export const EventService = {
  async record(event: UserEvent) {
    const payload = {
      user_id: event.user_id,
      event_type: event.event_type,
      restaurant_id: event.restaurant_id || null,
      menu_item_id: event.menu_item_id || null,
      category_id: event.category_id || null,
      order_id: event.order_id || null,
      metadata: event.metadata ? JSON.stringify(event.metadata) : null,
    };

    const { data, error } = await supabase.from('user_events').insert(payload).select().single();
    if (error) {
      throw error;
    }

    // Update lightweight preferences asynchronously (best-effort)
    try {
      await RecommendationService.updatePreferencesFromEvent(event);
    } catch (err) {
      // swallow errors so event recording still succeeds
      console.warn('Failed to update preferences', err);
    }

    return data;
  },
};

export default EventService;
