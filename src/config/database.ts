import { knex } from 'knex';
import { DATABASE_URL } from './env';

export const db = knex({
  client: 'pg',
  connection: DATABASE_URL,
});
