import bcrypt from 'bcryptjs';

export const hash = async (pw: string) => bcrypt.hash(pw, 10);
export const compare = async (pw: string, hashStr: string) => bcrypt.compare(pw, hashStr);
