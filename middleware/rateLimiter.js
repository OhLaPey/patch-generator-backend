import rateLimit from 'express-rate-limit';

const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '86400000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '5'),
  message: 'Too many patch generations from this IP, please try again tomorrow',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return !req.path.includes('/generate-patch');
  },
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  },
});

export default rateLimiter;
