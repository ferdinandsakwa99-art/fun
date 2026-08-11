import http from 'http';
import express from 'express';
import cors from 'cors';
import routes from './routes';
import errorHandler from './middleware/errorHandler';
import { initSockets } from './config/socket';

const app = express();
const httpServer = http.createServer(app);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (/^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

initSockets(httpServer);

export { httpServer };
export default app;
