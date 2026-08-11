import app, { httpServer } from './app';

const PORT = Number(process.env.PORT) || 3000;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
