import { supabase } from '../config/supabase';

const DELIVERY_BASE_FEE = 60;
const DELIVERY_PER_KM = 25;
const DELIVERY_MIN_FEE = 60;

const toRad = (deg: number) => (deg * Math.PI) / 180;

export const haversineKm = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) => {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const DeliveryService = {
  async findById(id: number) {
    const { data, error } = await supabase.from('deliveries').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  async list() {
    const { data, error } = await supabase.from('deliveries').select('*');
    if (error) throw error;
    return data;
  },

  async updateById(id: number, values: Record<string, any>) {
    const { data, error } = await supabase.from('deliveries').update(values).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  estimateFee(distanceKm: number) {
    const fee = DELIVERY_BASE_FEE + DELIVERY_PER_KM * Math.max(0, distanceKm);
    return Math.max(DELIVERY_MIN_FEE, Math.round(fee * 100) / 100);
  },

  async computeFeeForOrder(order: any) {
    const restaurantId = order?.restaurant_id as string | undefined;
    const addressId = order?.address_id as string | undefined;
    if (!restaurantId) {
      return { delivery_fee: DELIVERY_MIN_FEE, distance_km: 0 };
    }

    const [restaurantResult, addressResult] = await Promise.all([
      supabase.from('restaurants').select('latitude, longitude').eq('id', restaurantId).single(),
      addressId
        ? supabase.from('addresses').select('latitude, longitude').eq('id', addressId).single()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const restaurantLat = Number(restaurantResult.data?.latitude);
    const restaurantLng = Number(restaurantResult.data?.longitude);
    const destLat = Number(addressResult.data?.latitude);
    const destLng = Number(addressResult.data?.longitude);

    if (
      !restaurantLat ||
      !restaurantLng ||
      !destLat ||
      !destLng ||
      Number.isNaN(restaurantLat) ||
      Number.isNaN(destLat)
    ) {
      return { delivery_fee: DELIVERY_MIN_FEE, distance_km: 0 };
    }

    const distance_km = haversineKm(restaurantLat, restaurantLng, destLat, destLng);
    return { delivery_fee: this.estimateFee(distance_km), distance_km: Math.round(distance_km * 100) / 100 };
  },
};