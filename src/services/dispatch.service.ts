import { supabase } from '../config/supabase';
import { OrderService } from './order.service';
import { SocketService } from './socket.service';

const MAX_ACTIVE_ORDERS = 2;
const PICKUP_SPEED_KMH = 25;
const DELIVERY_SPEED_KMH = 25;
const BASE_PICKUP_MIN = 3;
const BASE_DELIVERY_MIN = 8;
const FAIRNESS_CAP_MIN = 40;
const EARTH_RADIUS_KM = 6371;

interface GeoPoint {
  latitude: number;
  longitude: number;
}

function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function etaMinutes(distanceKm: number, speedKmh: number, base: number): number {
  return base + (distanceKm / speedKmh) * 60;
}

interface RiderRow {
  id: string;
  user_id?: string;
  vehicle_type?: string;
  status?: string;
  online?: boolean;
  is_verified?: boolean;
  average_rating?: number;
  total_deliveries?: number;
  active_orders?: number;
  last_delivered_at?: string | null;
  current_latitude?: number | null;
  current_longitude?: number | null;
}

export interface DispatchResult {
  assigned: boolean;
  order?: any;
  rider?: RiderRow;
  reason?: string;
  candidates?: Array<{
    rider_id: string;
    score: number;
    pickup_eta: number;
    delivery_eta: number;
  }>;
}

export const DispatchService = {
  async findEligibleRiders(): Promise<RiderRow[]> {
    const { data, error } = await supabase
      .from('riders')
      .select('*')
      .eq('online', true)
      .eq('is_verified', true)
      .lt('active_orders', MAX_ACTIVE_ORDERS);
    if (error) throw error;
    return (data ?? []).filter(
      (rider) =>
        rider.current_latitude != null && rider.current_longitude != null,
    );
  },

  scoreRider(
    rider: RiderRow,
    pickupKm: number,
    deliveryKm: number,
  ): {
    score: number;
    pickupEta: number;
    deliveryEta: number;
    reliability: number;
    workload: number;
    fairness: number;
    vehicleBonus: number;
  } {
    const pickupEta = etaMinutes(pickupKm, PICKUP_SPEED_KMH, BASE_PICKUP_MIN);
    const deliveryEta = etaMinutes(
      deliveryKm,
      DELIVERY_SPEED_KMH,
      BASE_DELIVERY_MIN,
    );

    // Reliability: perfect rating (5) adds nothing; lower ratings add up to 12.5
    const rating = Math.min(Number(rider.average_rating ?? 5) || 5, 5);
    const reliability = (5 - rating) * 2.5;

    // Workload: each active order adds 3 minutes of perceived cost
    const workload = Number(rider.active_orders ?? 0) * 3;

    // Fairness: riders waiting longer get a boost (up to -10 points)
    const waitingMin = rider.last_delivered_at
      ? Math.max(
          0,
          (Date.now() - new Date(rider.last_delivered_at).getTime()) / 60000,
        )
      : FAIRNESS_CAP_MIN;
    const fairness = Math.min(waitingMin, FAIRNESS_CAP_MIN) * 0.25;

    // Vehicle suitability: motorized riders can pick up faster
    const vehicleBonus = /motorbike|motor|bike|scooter|car|auto|bicycle/i.test(
      String(rider.vehicle_type ?? ''),
    )
      ? 2
      : 0;

    const score =
      pickupEta +
      deliveryEta +
      reliability +
      workload -
      fairness -
      vehicleBonus;

    return { score, pickupEta, deliveryEta, reliability, workload, fairness, vehicleBonus };
  },

  async dispatchForOrder(order: any): Promise<DispatchResult> {
    const { restaurant, dropoff } = await this.getOrderGeo(order);

    if (!restaurant || restaurant.latitude == null || restaurant.longitude == null) {
      return { assigned: false, reason: 'Restaurant location unavailable' };
    }

    const riders = await this.findEligibleRiders();
    if (riders.length === 0) {
      return { assigned: false, reason: 'No eligible riders available' };
    }

    const restaurantLat = restaurant.latitude as number;
    const restaurantLon = restaurant.longitude as number;

    const candidates = riders
      .map((rider) => {
        const pickupKm = haversineKm(
          { latitude: rider.current_latitude as number, longitude: rider.current_longitude as number },
          { latitude: restaurantLat, longitude: restaurantLon },
        );
        const deliveryKm =
          dropoff?.latitude != null && dropoff?.longitude != null
            ? haversineKm(
                { latitude: restaurantLat, longitude: restaurantLon },
                { latitude: dropoff.latitude, longitude: dropoff.longitude },
              )
            : 0;
        const scored = this.scoreRider(rider, pickupKm, deliveryKm);
        return { rider, pickupKm, deliveryKm, ...scored };
      })
      .sort((a, b) => a.score - b.score);

    const best = candidates[0];

    const { data: updated, error } = await supabase
      .from('orders')
      .update({
        rider_id: best.rider.id,
        dispatched_at: new Date().toISOString(),
        dispatch_score: best.score,
        dispatch_note: 'Auto-dispatched',
      })
      .eq('id', order.id)
      .select('*')
      .single();
    if (error) throw error;

    await supabase
      .from('riders')
      .update({ active_orders: (Number(best.rider.active_orders) || 0) + 1 })
      .eq('id', best.rider.id);

    const orderWithItems = await OrderService.findById(order.id);
    const enriched = await OrderService.enrichForRider(orderWithItems);
    SocketService.emitOrderAssigned(enriched, best.rider.user_id);

    return {
      assigned: true,
      order: enriched,
      rider: best.rider,
      candidates: candidates.map((c) => ({
        rider_id: c.rider.id,
        score: c.score,
        pickup_eta: c.pickupEta,
        delivery_eta: c.deliveryEta,
      })),
    };
  },

  async getOrderGeo(order: any): Promise<{
    restaurant: { id?: string; latitude?: number; longitude?: number } | null;
    dropoff: GeoPoint | null;
  }> {
    let restaurant: { id?: string; latitude?: number; longitude?: number } | null = null;
    if (order.restaurant_id) {
      const { data, error } = await supabase
        .from('restaurants')
        .select('id, latitude, longitude')
        .eq('id', order.restaurant_id)
        .single();
      if (error) throw error;
      restaurant = data;
    }

    let dropoff: GeoPoint | null = null;
    if (order.address_id) {
      const { data, error } = await supabase
        .from('addresses')
        .select('latitude, longitude')
        .eq('id', order.address_id)
        .single();
      if (error) throw error;
      if (data && data.latitude != null && data.longitude != null) {
        dropoff = { latitude: data.latitude, longitude: data.longitude };
      }
    }

    return { restaurant, dropoff };
  },
};
