import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { Router } from 'express';
import auth from '../middleware/auth';
import authorize from '../middleware/authorize';
import { success, fail } from '../utils/response';
import { supabase } from '../config/supabase';
import { RestaurantService } from '../services/restaurant.service';

const upload = multer({ storage: multer.memoryStorage() });
const BANNER_BUCKET = 'restaurant_banners';
const COVER_BUCKET = 'restaurants_covers';
const router = Router();

router.get('/', auth, async (req, res) => {
  try {
    if (
      req.user?.role === 'ADMIN' ||
      req.user?.role === 'CUSTOMER' ||
      req.user?.role === 'RIDER'
    ) {
      const { data, error } = await supabase.from('restaurants').select('*');
      if (error) throw error;
      return success(res, { restaurants: data });
    }

    const userId = String(req.user?.id);
    const restaurantIds = await RestaurantService.getOwnedRestaurantIds(userId);
    const { data, error } = await supabase
      .from('restaurants')
      .select('*')
      .in('id', restaurantIds);
    if (error) throw error;
    return success(res, { restaurants: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load restaurants', 500);
  }
});

router.get('/banners', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('restaurant_banners')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return success(res, { banners: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load banners', 500);
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const restaurantId = String(req.params.id);

    if (
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

    const { data, error } = await supabase
      .from('restaurants')
      .select('*')
      .eq('id', restaurantId)
      .single();
    if (error) throw error;
    return success(res, { restaurant: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load restaurant', 500);
  }
});

router.post('/', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const ownerId = String(req.user?.id);
    const { data, error } = await supabase
      .from('restaurants')
      .insert({ ...req.body, owner_id: ownerId })
      .select('*')
      .single();
    if (error) throw error;

    const { error: staffError } = await supabase.from('restaurant_staff').insert({
      restaurant_id: data.id,
      user_id: ownerId,
      role: 'owner',
    });
    if (staffError) throw staffError;

    return success(res, { restaurant: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to create restaurant', 500);
  }
});

router.get('/:id/banners', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('restaurant_banners')
      .select('*')
      .eq('restaurant_id', String(req.params.id))
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return success(res, { banners: data });
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
    return success(res, { restaurant: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update restaurant', 500);
  }
});

router.delete('/:id', auth, authorize('ADMIN'), async (req, res) => {
  try {
    const { error } = await supabase.from('restaurants').delete().eq('id', String(req.params.id));
    if (error) throw error;
    return success(res, { message: 'Restaurant deleted' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to delete restaurant', 500);
  }
});

export default router;