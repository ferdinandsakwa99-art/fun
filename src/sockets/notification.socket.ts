import { Server, Socket } from 'socket.io';

export function notificationSocket(io: Server) {
  io.on('connection', (socket: Socket) => {
    // notification handlers
  });
}
