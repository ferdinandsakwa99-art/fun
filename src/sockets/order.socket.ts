import { Server, Socket } from 'socket.io';

export function orderSocket(io: Server) {
  io.on('connection', (socket: Socket) => {
    socket.on('join_restaurant', (restaurantId?: string) => {
      if (!restaurantId) return;
      socket.join(`restaurant:${restaurantId}`);
    });

    socket.on('leave_restaurant', (restaurantId?: string) => {
      if (!restaurantId) return;
      socket.leave(`restaurant:${restaurantId}`);
    });

    socket.on('join_user', (userId?: string) => {
      if (!userId) return;
      socket.join(`user:${userId}`);
    });

    socket.on('leave_user', (userId?: string) => {
      if (!userId) return;
      socket.leave(`user:${userId}`);
    });
  });
}
