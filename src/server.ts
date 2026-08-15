import app, { httpServer } from './app';
import { DispatchRetryService } from './services/dispatch.retry';

const PORT = Number(process.env.PORT) || 3000;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  DispatchRetryService.start();
});
