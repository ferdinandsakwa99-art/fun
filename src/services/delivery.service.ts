import { supabase } from '../config/supabase';

const DELIVERY_BASE_FEE = 70;
const DELIVERY_PER_KM = 30;
const DELIVERY_MIN_FEE = 70;

const RIDER_BASE_PAY = 60;
const RIDER_PER_KM = 20;
const RIDER_MIN_PAY = 60;

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

const round2 = (value: number) => Math.round(value * 100) / 100;

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
    return Math.max(DELIVERY_MIN_FEE, round2(fee));
  },

  /// Rider pay for a delivery, derived from the same distance used for the
  /// customer delivery fee — no second geolocation/maps call needed.
  estimateRiderPay(distanceKm: number) {
    const pay = RIDER_BASE_PAY + RIDER_PER_KM * Math.max(0, distanceKm);
    return Math.max(RIDER_MIN_PAY, round2(pay));
  },

  /// Both the customer delivery fee and the rider payout in one pass, so the
  /// server computes the distance once and reuses it everywhere.
  estimatePricing(distanceKm: number) {
    return {
      delivery_fee: this.estimateFee(distanceKm),
      rider_pay: this.estimateRiderPay(distanceKm),
    };
  },

  async computeFeeForOrder(order: any) {
    const restaurantId = order?.restaurant_id as string | undefined;
    const addressId = order?.address_id as string | undefined;
    if (!restaurantId) {
      return { delivery_fee: DELIVERY_MIN_FEE, rider_pay: RIDER_MIN_PAY, distance_km: 0 };
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
      return { delivery_fee: DELIVERY_MIN_FEE, rider_pay: RIDER_MIN_PAY, distance_km: 0 };
    }

    const distance_km = round2(haversineKm(restaurantLat, restaurantLng, destLat, destLng));
    return { distance_km, ...this.estimatePricing(distance_km) };
  },
};