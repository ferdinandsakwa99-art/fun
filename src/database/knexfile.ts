import type { Knex } from 'knex';
import { DATABASE_URL } from '../config/env';

const config: Knex.Config = {
  client: 'pg',
  connection: DATABASE_URL,
  migrations: {
    directory: './migrations',
  },
  seeds: {
    directory: './seeds',
  },
};

export default config;
