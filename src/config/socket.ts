import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { orderSocket } from '../sockets/order.socket';

let ioInstance: Server | null = null;

export function initSockets(httpServer: HttpServer) {
  if (ioInstance) return ioInstance;

  ioInstance = new Server(httpServer, {
    cors: {
      origin: (origin: any, cb: any) => {
        if (!origin) return cb(null, true);
        if (/^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
        if (origin === 'https://takead.vercel.app') return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
    },
  });

  orderSocket(ioInstance);
  return ioInstance;
}

export function getIO() {
  if (!ioInstance) {
    throw new Error('Socket.io has not been initialized');
  }

  return ioInstance;
}
