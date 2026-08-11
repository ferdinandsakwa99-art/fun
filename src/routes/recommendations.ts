import { Router } from 'express';
import EventService from '../services/event.service';
import { RecommendationService } from '../services/recommendation.service';
import auth from '../middleware/auth';
import optionalAuth from '../middleware/optionalAuth';
import { cachedFetch } from '../utils/cache';
import { supabase } from '../config/supabase';

const router = Router();

// Protect event-recording endpoints
router.post('/events', auth as any, async (req, res, next) => {
  try {
    const body = req.body || {};
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    // ensure user_id is the authenticated user
    const event = { ...body, user_id: userId };

    if (!event.event_type) return res.status(400).json({ ok: false, error: 'event_type required' });

    const data = await EventService.record(event);
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

// Record recommendation impressions/clicks/orders for evaluation
router.post('/impressions', auth as any, async (req, res, next) => {
  try {
    const body = req.body || {};
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const payload = {
      user_id: userId,
      menu_item_id: body.menu_item_id || null,
      position: body.position ?? null,
      score: body.score ?? null,
      shown_at: body.shown_at || new Date().toISOString(),
      clicked: !!body.clicked,
      ordered: !!body.ordered,
      metadata: body.metadata || null,
    };

    const { data, error } = await supabase.from('recommendation_impressions').insert(payload).select().single();
    if (error) throw error;
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

// Record promo events (impression, clicked, applied, used)
router.post('/promo-events', auth as any, async (req, res, next) => {
  try {
    const body = req.body || {};
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    if (!body.promo_id || !body.event_type) return res.status(400).json({ ok: false, error: 'promo_id and event_type required' });

    const payload = {
      promo_id: body.promo_id,
      user_id: userId,
      event_type: body.event_type,
      order_id: body.order_id || null,
      metadata: body.metadata || null,
    };

    const { data, error } = await supabase.from('promo_events').insert(payload).select().single();
    if (error) throw error;
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

// Get recommendations for the authenticated user (or popular picks for guests)
router.get('/', optionalAuth as any, async (req, res, next) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 12;
    const lat = req.query.lat ? Number(req.query.lat) : undefined;
    const lon = req.query.lon ? Number(req.query.lon) : undefined;

    if (req.user?.id) {
      const recs = await RecommendationService.getRecommendations({ user_id: req.user.id, lat, lon, limit });
      return res.json({ ok: true, ...recs });
    }

    const key = `recommendations:popular:${limit}:${lat ? lat.toFixed(3) : 'n'}:${lon ? lon.toFixed(3) : 'n'}`;
    const recs = await cachedFetch<any>(key, 300, () =>
      RecommendationService.getPopular({ lat, lon, limit }),
    );
    return res.json({ ok: true, ...recs });
  } catch (err) {
    next(err);
  }
});

export default router;
