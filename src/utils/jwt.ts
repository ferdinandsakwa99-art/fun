import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/env';

export const sign = (payload: any, expiresIn = '1h') => jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] });
export const verify = (token: string) => jwt.verify(token, JWT_SECRET);
