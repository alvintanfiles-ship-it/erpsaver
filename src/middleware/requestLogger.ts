import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export const requestLogger = (req: Request, _res: Response, next: NextFunction) => {
  const start = Date.now();
  const { method, url, ip, headers } = req;

  _res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = _res;
    const userAgent = headers['user-agent'] || 'unknown';

    logger.info({
      method,
      url,
      statusCode,
      durationMs: duration,
      ip,
      userAgent,
    }, 'HTTP Request');
  });

  next();
};