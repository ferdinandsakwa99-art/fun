import { Router } from 'express';
import optionalAuth from '../middleware/optionalAuth';
import { success, fail } from '../utils/response';
import { cachedFetch } from '../utils/cache';
import { HomeService } from '../services/home.service';

const router = Router();

router.get('/', optionalAuth, async (req, res) => {
  try {
    const lat = req.query.lat ? Number(req.query.lat) : undefined;
    const lon = req.query.lon ? Number(req.query.lon) : undefined;
    const key = `home:${lat ? lat.toFixed(3) : 'n'}:${lon ? lon.toFixed(3) : 'n'}`;

    const feed = await cachedFetch<any>(key, 120, () => HomeService.getHomeFeed({ lat, lon }));
    return success(res, feed);
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load home feed', 500);
  }
});

export default router;
