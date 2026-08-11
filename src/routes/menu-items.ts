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
const STORAGE_BUCKET = 'menu_item_images';
const router = Router();

router.get('/', optionalAuth, async (req, res) => {
  try {
    const categoryId =
      typeof req.query.category_id === 'string' && req.query.category_id
        ? req.query.category_id
        : undefined;
    const restaurantId =
      typeof req.query.restaurant_id === 'string' && req.query.restaurant_id
        ? req.query.restaurant_id
        : undefined;
    const withImages = req.query.with_images === 'true';

    const rawPage = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : NaN;
    const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
    const paginate = req.query.page !== undefined || req.query.limit !== undefined;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 20;

    const cacheKey = [
      'menu-items',
      restaurantId || 'all',
      categoryId || 'all',
      withImages ? 'img' : 'noimg',
      paginate ? `${page}:${limit}` : 'full',
    ].join(':');

    const result = await cachedFetch<{ items: any[]; total?: number }>(
      cacheKey,
      300,
      async () => {
        let query = supabase.from('menu_items').select('*');
        if (categoryId) query = query.eq('category_id', categoryId);
        if (restaurantId) query = query.eq('restaurant_id', restaurantId);

        let data: any[] = [];
        let total: number | undefined;

        if (paginate) {
          let pQuery = supabase.from('menu_items').select('*', { count: 'exact' });
          if (categoryId) pQuery = pQuery.eq('category_id', categoryId);
          if (restaurantId) pQuery = pQuery.eq('restaurant_id', restaurantId);
          pQuery = pQuery.range((page - 1) * limit, page * limit - 1);
          const res = await pQuery;
          if (res.error) throw res.error;
          data = res.data || [];
          total = res.count ?? undefined;
        } else {
          const { data: d, error } = await query;
          if (error) throw error;
          data = d || [];
        }

        if (withImages && data.length > 0) {
          const ids = data.map((item: any) => item.id);
          const { data: images, error: imagesError } = await supabase
            .from('menu_item_images')
            .select('id, menu_item_id, image_url, alt_text, is_primary, sort_order')
            .in('menu_item_id', ids)
            .order('sort_order', { ascending: true });
          if (imagesError) throw imagesError;

          const grouped = new Map<string, any[]>();
          (images || []).forEach((image: any) => {
            if (!grouped.has(image.menu_item_id)) {
              grouped.set(image.menu_item_id, []);
            }
            grouped.get(image.menu_item_id)!.push(image);
          });

          data = data.map((item: any) => ({
            ...item,
            images: grouped.get(item.id) || [],
          }));
        }

        return { items: data, total };
      },
    );

    return success(res, {
      menuItems: result.items,
      ...(paginate ? { page, limit, total: result.total ?? result.items.length } : {}),
    });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load menu items', 500);
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const menuItem = await cachedFetch<any>(
      `menu-item:${String(req.params.id)}`,
      300,
      async () => {
        const { data, error } = await supabase.from('menu_items').select('*').eq('id', req.params.id).single();
        if (error) throw error;

        const item = data as any;
        if (item) {
          const { data: images, error: imagesError } = await supabase
            .from('menu_item_images')
            .select('id, menu_item_id, image_url, alt_text, is_primary, sort_order')
            .eq('menu_item_id', item.id)
            .order('sort_order', { ascending: true });
          if (imagesError) throw imagesError;
          item.images = images || [];
        }
        return item;
      },
    );
    return success(res, { menuItem });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load menu item', 500);
  }
});

router.get('/:id/images', optionalAuth, async (req, res) => {
  try {
    const images = await cachedFetch<any[]>(
      `menu-item-images:${String(req.params.id)}`,
      300,
      async () => {
        const { data, error } = await supabase
          .from('menu_item_images')
          .select('*')
          .eq('menu_item_id', req.params.id)
          .order('sort_order', { ascending: true });
        if (error) throw error;
        return data || [];
      },
    );
    return success(res, { images });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to load menu item images', 500);
  }
});

router.post('/:id/images', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return fail(res, 'Image file is required', 400);
    }

    const filename = `${uuidv4()}${path.extname(req.file.originalname)}`;
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filename, req.file.buffer, {
        cacheControl: '3600',
        upsert: false,
        contentType: req.file.mimetype,
      });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filename);
    const payload = {
      menu_item_id: req.params.id,
      image_url: publicUrlData.publicUrl,
      alt_text: req.body.alt_text || null,
      is_primary: req.body.is_primary === 'true' || req.body.is_primary === true,
      sort_order: req.body.sort_order ? Number(req.body.sort_order) : 0,
    };

    const { data, error } = await supabase.from('menu_item_images').insert(payload).select().single();
    if (error) throw error;

    await invalidate('menu-item-images:', `menu-item:${req.params.id}`, 'menu-items:', 'home:');
    return success(res, { image: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to upload menu item image', 500);
  }
});

router.delete('/:id/images/:imageId', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const { data: image, error: fetchError } = await supabase
      .from('menu_item_images')
      .select('*')
      .eq('id', req.params.imageId)
      .single();
    if (fetchError) throw fetchError;

    if (!image) {
      return fail(res, 'Menu item image not found', 404);
    }

    if (image.menu_item_id !== req.params.id) {
      return fail(res, 'Menu item and image mismatch', 400);
    }

    const { data: menuItem, error: menuItemError } = await supabase
      .from('menu_items')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (menuItemError) throw menuItemError;

    if (req.user?.role === 'RESTAURANT_OWNER') {
      const allowed = await RestaurantService.isOwnerForRestaurant(String(req.user.id), menuItem.restaurant_id);
      if (!allowed) {
        return fail(res, 'Forbidden', 403);
      }
    }

    const parsedUrl = new URL(image.image_url);
    const storagePath = parsedUrl.pathname.split(`/public/${STORAGE_BUCKET}/`)[1];

    if (storagePath) {
      const { error: removeError } = await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      if (removeError) throw removeError;
    }

    const { error: deleteError } = await supabase.from('menu_item_images').delete().eq('id', req.params.imageId);
    if (deleteError) throw deleteError;

    await invalidate('menu-item-images:', `menu-item:${req.params.id}`, 'menu-items:', 'home:');
    return success(res, { message: 'Menu item image deleted' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to delete menu item image', 500);
  }
});

router.post('/', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('menu_items').insert(req.body).select().single();
    if (error) throw error;
    await invalidate('menu-items:', 'home:', 'recommendations:popular:');
    return success(res, { menuItem: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to create menu item', 500);
  }
});

router.patch('/:id', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const { data: item, error: fetchError } = await supabase
      .from('menu_items')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchError) throw fetchError;

    if (req.user?.role === 'RESTAURANT_OWNER') {
      const allowed = await RestaurantService.isOwnerForRestaurant(String(req.user.id), item.restaurant_id);
      if (!allowed) {
        return fail(res, 'Forbidden', 403);
      }
    }

    const { data, error } = await supabase
      .from('menu_items')
      .update(req.body)
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    await invalidate(`menu-item:${req.params.id}`, 'menu-items:', 'home:', 'recommendations:popular:');
    return success(res, { menuItem: data });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to update menu item', 500);
  }
});

router.delete('/:id', auth, authorize('RESTAURANT_OWNER', 'ADMIN'), async (req, res) => {
  try {
    const { data: item, error: fetchError } = await supabase
      .from('menu_items')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchError) throw fetchError;

    if (req.user?.role === 'RESTAURANT_OWNER') {
      const allowed = await RestaurantService.isOwnerForRestaurant(String(req.user.id), item.restaurant_id);
      if (!allowed) {
        return fail(res, 'Forbidden', 403);
      }
    }

    const { error } = await supabase.from('menu_items').delete().eq('id', req.params.id);
    if (error) throw error;
    await invalidate(`menu-item:${req.params.id}`, 'menu-items:', 'home:', 'recommendations:popular:');
    return success(res, { message: 'Menu item deleted' });
  } catch (error: any) {
    return fail(res, error.message || 'Unable to delete menu item', 500);
  }
});

export default router;