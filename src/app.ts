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
    if (/\.up\.railway\.app$/.test(origin)) return cb(null, true);
    if (origin === 'https://takead.vercel.app') return cb(null, true);
    if (process.env.CORS_ORIGINS) {
      const allowed = process.env.CORS_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      if (allowed.includes(origin)) return cb(null, true);
    }
    return cb(null, false);
  },
  credentials: true,
}));
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(
      `[request] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`,
    );
  });
  next();
});

app.use('/api', routes);
app.use(errorHandler);

initSockets(httpServer);

export { httpServer };
export default app;
