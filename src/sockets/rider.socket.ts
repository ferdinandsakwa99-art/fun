import { Server, Socket } from 'socket.io';

export function riderSocket(io: Server) {
  io.on('connection', (socket: Socket) => {
    // rider socket handlers
  });
}
