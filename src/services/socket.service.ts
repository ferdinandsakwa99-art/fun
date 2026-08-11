import { getIO } from '../config/socket';

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

  emitOrderCreated(order: any) {
    this.emitToRestaurant(order?.restaurant_id, 'order_created', order);
    this.emitToUser(order?.user_id, 'order_created', order);
  },

  emitOrderUpdated(order: any) {
    this.emitToRestaurant(order?.restaurant_id, 'order_updated', order);
    this.emitToUser(order?.user_id, 'order_updated', order);
  },

  emitOrderAssigned(order: any, riderUserId?: string | null) {
    this.emitToUser(riderUserId, 'order_assigned', order);
    this.emitToRestaurant(order?.restaurant_id, 'order_updated', order);
    this.emitToUser(order?.user_id, 'order_updated', order);
  },
};
