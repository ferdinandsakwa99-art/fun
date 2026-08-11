import { Request, Response, NextFunction } from 'express';

export default function validate(schema: any) {
  return (req: Request, res: Response, next: NextFunction) => {
    // placeholder validation
    next();
  };
}
