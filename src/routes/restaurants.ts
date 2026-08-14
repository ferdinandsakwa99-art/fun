import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { Router } from 'express';
import auth from '../middleware/auth';
import optionalAuth from '../middleware/optionalAuth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { cachedFetch, invalidate } from '../utils/cache';
import { supabase } from '../config/supabase';
import { RestaurantService } from '../services/restaurant.service';

const upload = multer({ storage: multer.memoryStorage() });
const BANNER_BUCKET = 'restaurant_banners';
const COVER_BUCKET = 'restaurants_covers';
const router = Router();

router.get('/', optionalAuth, async (req, res) => {
  try {
    const rawPage = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : NaN;
    const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
    const paginate = req.query.page !== undefined || req.query.limit !== undefined;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;

    if (req.user?.role === 'RESTAURANT_OWNER') {
      const userId = String(req.user?.id);
      const restaurantIds = await RestaurantService.getOwnedRestaurantIds(userId);
      const { data, error } = await supabase
        .from('restaurants')
        .select('*')
        .in('id', restaurantIds);
      if (error) throw error;
      return success(res, { restaurants: data });
    }

    const cacheKey = paginate
      ? `restaurants:all:${page}:${limit}`
      : 'restaurants:all';

    const result = await cachedFetch<{ data: any[]; total?: number }>(
      cacheKey,
      300,
      async () => {
        if (paginate) {
          const { data, count, error } = await supabase
            .from('restaurants')
            .select('*', { count: 'exact' })
            .range((page - 1) * limit, page * limit - 1);
          if (error) throw error;
          return { data: data || [], total: count ?? undefined };
        }
        const { data, error } = await supabase.from('restaurants').select('*');
        if (error) throw error;
        return { data: data || [] };
      },
    );

    return success(res, {
      restaurants: result.data,
      ...(paginate
        ? { page, limit, total: result.total ?? result.data.length }
        : {}),
    });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load restaurants', 500);
  }
});

router.get('/banners', optionalAuth, async (req, res) => {
  try {
    const banners = await cachedFetch<any[]>('restaurants:banners', 300, async () => {
      const { data, error } = await supabase
        .from('restaurant_banners')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data || [];
    });
    return success(res, { banners });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load banners', 500);
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const restaurantId = String(req.params.id);

    if (
      req.user &&
      req.user?.role !== 'ADMIN' &&
      req.user?.role !== 'CUSTOMER' &&
      req.user?.role !== 'RIDER'
    ) {
      const isOwner = await RestaurantService.isOwnerForRestaurant(
        String(req.user?.id),
        restaurantId,
      );
      if (!isOwner) {
        return fail(res, 'Forbidden', 403);
      }
    }

    const restaurant = await cachedFetch<any>(`restaurants:id:${restaurantId}`, 300, async () => {
      const { data, error } = await supabase
        .from('restaurants')
        .select('*')
        .eq('id', restaurantId)
        .single();
      if (error) throw error;
      return data;
    });
    return success(res, { restaurant });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load restaurant', 500);
  }
});

router.post('/', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const ownerId = String(req.user?.id);
    const { data, error } = await supabase
      .from('restaurants')
      .insert({ ...req.body, owner_id: ownerId, status: 'pending' })
      .select('*')
      .single();
    if (error) throw error;

    const { error: staffError } = await supabase.from('restaurant_staff').insert({
      restaurant_id: data.id,
      user_id: ownerId,
      role: 'owner',
    });
    if (staffError) throw staffError;

    await invalidate('restaurants:all', 'home:');
    return success(res, { restaurant: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to create restaurant', 500);
  }
});

router.patch('/:id/documents', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const restaurantId = String(req.params.id);
    if (req.user?.role !== 'ADMIN') {
      const allowed = await RestaurantService.isOwnerForRestaurant(
        String(req.user?.id),
        restaurantId,
      );
      if (!allowed) return fail(res, 'Forbidden', 403);
    }

    const documentKeys = [
      'id_number',
      'id_front_url',
      'id_back_url',
      'documents_submitted_at',
    ];
    const isDocumentSubmit = documentKeys.some(
      (key) => req.body?.[key] !== undefined,
    );
    if (!isDocumentSubmit) {
      return fail(res, 'No document fields provided', 400);
    }

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('documents_submitted_at')
      .eq('id', restaurantId)
      .single();
    if (restaurant?.documents_submitted_at) {
      return fail(res, 'Documents have already been submitted', 409);
    }

    const update: Record<string, any> = { status: 'pending' };
    for (const key of documentKeys) {
      if (req.body?.[key] !== undefined) update[key] = req.body[key];
    }

    const { data, error } = await supabase
      .from('restaurants')
      .update(update)
      .eq('id', restaurantId)
      .select('*')
      .single();
    if (error) throw error;

    await invalidate(`restaurants:id:${restaurantId}`, 'restaurants:all', 'home:');
    return success(res, { restaurant: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to submit restaurant documents', 500);
  }
});

router.get('/:id/banners', optionalAuth, async (req, res) => {
  try {
    const banners = await cachedFetch<any[]>(
      `restaurants:banners:${String(req.params.id)}`,
      300,
      async () => {
        const { data, error } = await supabase
          .from('restaurant_banners')
          .select('*')
          .eq('restaurant_id', String(req.params.id))
          .order('sort_order', { ascending: true });
        if (error) throw error;
        return data || [];
      },
    );
    return success(res, { banners });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load banners', 500);
  }
});

router.post('/:id/banners', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), upload.single('image'), async (req, res) => {
  try {
    const restaurantId = String(req.params.id);
    if (req.user?.role !== 'ADMIN') {
      const allowed = await RestaurantService.isOwnerForRestaurant(
        String(req.user?.id),
        restaurantId,
      );
      if (!allowed) return fail(res, 'Forbidden', 403);
    }

    if (!req.file) {
      return fail(res, 'Image file is required', 400);
    }

    const filename = `${uuidv4()}${path.extname(req.file.originalname)}`;
    const { error: uploadError } = await supabase.storage
      .from(BANNER_BUCKET)
      .upload(filename, req.file.buffer, {
        cacheControl: '3600',
        upsert: false,
        contentType: req.file.mimetype,
      });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from(BANNER_BUCKET).getPublicUrl(filename);
    const sortOrder = req.body.sort_order !== undefined ? Number(req.body.sort_order) : 0;

    const { data, error } = await supabase
      .from('restaurant_banners')
      .insert({
        restaurant_id: restaurantId,
        image_url: publicUrlData.publicUrl,
        alt_text: req.body.alt_text || null,
        is_primary: req.body.is_primary === 'true' || req.body.is_primary === true,
        sort_order: sortOrder,
      })
      .select('*')
      .single();
    if (error) throw error;

    await invalidate(`restaurants:banners:${restaurantId}`, 'restaurants:banners', 'home:');
    return success(res, { banner: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to upload banner', 500);
  }
});

router.delete('/:id/banners/:bannerId', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const restaurantId = String(req.params.id);
    if (req.user?.role !== 'ADMIN') {
      const allowed = await RestaurantService.isOwnerForRestaurant(
        String(req.user?.id),
        restaurantId,
      );
      if (!allowed) return fail(res, 'Forbidden', 403);
    }

    const { data: banner, error: fetchError } = await supabase
      .from('restaurant_banners')
      .select('*')
      .eq('id', String(req.params.bannerId))
      .single();
    if (fetchError) throw fetchError;

    if (!banner) {
      return fail(res, 'Banner not found', 404);
    }

    const parsedUrl = new URL(banner.image_url);
    const storagePath = parsedUrl.pathname.split(`/public/${BANNER_BUCKET}/`)[1];

    if (storagePath) {
      const { error: removeError } = await supabase.storage.from(BANNER_BUCKET).remove([storagePath]);
      if (removeError) throw removeError;
    }

    const { error: deleteError } = await supabase
      .from('restaurant_banners')
      .delete()
      .eq('id', String(req.params.bannerId));
    if (deleteError) throw deleteError;

    await invalidate(`restaurants:banners:${restaurantId}`, 'restaurants:banners', 'home:');
    return success(res, { message: 'Banner deleted' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to delete banner', 500);
  }
});

router.post('/:id/cover', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), upload.single('image'), async (req, res) => {
  try {
    const restaurantId = String(req.params.id);
    if (req.user?.role !== 'ADMIN') {
      const allowed = await RestaurantService.isOwnerForRestaurant(
        String(req.user?.id),
        restaurantId,
      );
      if (!allowed) return fail(res, 'Forbidden', 403);
    }

    if (!req.file) {
      return fail(res, 'Image file is required', 400);
    }

    const filename = `${uuidv4()}${path.extname(req.file.originalname)}`;
    const { error: uploadError } = await supabase.storage
      .from(COVER_BUCKET)
      .upload(filename, req.file.buffer, {
        cacheControl: '3600',
        upsert: false,
        contentType: req.file.mimetype,
      });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from(COVER_BUCKET).getPublicUrl(filename);

    const { data, error } = await supabase
      .from('restaurants')
      .update({ cover_image: publicUrlData.publicUrl })
      .eq('id', restaurantId)
      .select('*')
      .single();
    if (error) throw error;

    await invalidate(`restaurants:id:${restaurantId}`, 'restaurants:all', 'home:');
    return success(res, { restaurant: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to upload cover image', 500);
  }
});

router.patch('/:id', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('restaurants')
      .update(req.body)
      .eq('id', String(req.params.id))
      .select('*')
      .single();
    if (error) throw error;
    await invalidate(`restaurants:id:${String(req.params.id)}`, 'restaurants:all', 'home:');
    return success(res, { restaurant: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update restaurant', 500);
  }
});

router.delete('/:id', auth, authorize('ADMIN'), async (req, res) => {
  try {
    const { error } = await supabase.from('restaurants').delete().eq('id', String(req.params.id));
    if (error) throw error;
    await invalidate('restaurants:id:', 'restaurants:all', 'home:');
    return success(res, { message: 'Restaurant deleted' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to delete restaurant', 500);
  }
});

export default router;