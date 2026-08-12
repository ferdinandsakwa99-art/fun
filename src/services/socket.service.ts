import { getIO } from '../config/socket';
import { supabase } from '../config/supabase';

export const SocketService = {
  init: (_io: unknown) => {
    // placeholder
  },

  emitToRestaurant(restaurantId: string | number | null | undefined, event: string, payload: unknown) {
    if (!restaurantId) return;
    const io = getIO();
    io.to(`restaurant:${restaurantId}`).emit(event, payload);
  },

  emitToUser(userId: string | number | null | undefined, event: string, payload: unknown) {
    if (!userId) return;
    const io = getIO();
    io.to(`user:${userId}`).emit(event, payload);
  },

  // Emits an event to the user room of the rider assigned to an order. The
  // `riders.id` on the order is not the auth user id, so resolve it via the
  // riders table before emitting. Fire-and-forget.
  async emitToRider(riderId: string | number | null | undefined, event: string, payload: unknown) {
    if (!riderId) return;
    const { data, error } = await supabase
      .from('riders')
      .select('user_id')
      .eq('id', String(riderId))
      .single();
    if (!error && data?.user_id) {
      this.emitToUser(data.user_id, event, payload);
    }
  },

  emitOrderCreated(order: any) {
    this.emitToRestaurant(order?.restaurant_id, 'order_created', order);
    this.emitToUser(order?.user_id, 'order_created', order);
  },

  emitOrderUpdated(order: any) {
    this.emitToRestaurant(order?.restaurant_id, 'order_updated', order);
    this.emitToUser(order?.user_id, 'order_updated', order);
    if (order?.rider_id) {
      void this.emitToRider(order.rider_id, 'order_updated', order);
    }
  },

  emitOrderAssigned(order: any, riderUserId?: string | null) {
    this.emitToUser(riderUserId, 'order_assigned', order);
    this.emitToRestaurant(order?.restaurant_id, 'order_updated', order);
    this.emitToUser(order?.user_id, 'order_updated', order);
  },
};
