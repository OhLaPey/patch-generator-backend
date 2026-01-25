import express from 'express';
import { handleOrderPaid, handleProductDelete, testWebhook } from '../controllers/webhookController.js';

const router = express.Router();

/**
 * POST /api/webhooks/shopify/order-paid
 */
router.post('/shopify/order-paid', express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}), handleOrderPaid);

/**
 * POST /api/webhooks/shopify/product-delete
 */
router.post('/shopify/product-delete', express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}), handleProductDelete);

/**
 * POST /api/webhooks/test
 */
router.post('/test', express.json(), testWebhook);

/**
 * GET /api/webhooks/health
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'webhooks',
    timestamp: new Date().toISOString()
  });
});

export default router;
