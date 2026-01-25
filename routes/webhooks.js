import express from 'express';
import { handleOrderPaid, handleProductDelete, testWebhook } from '../controllers/webhookController.js';

const router = express.Router();

/**
 * POST /api/webhooks/shopify/order-paid
 * Webhook Shopify déclenché quand une commande est payée
 */
router.post('/shopify/order-paid', express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}), handleOrderPaid);

/**
 * POST /api/webhooks/shopify/product-delete
 * Webhook Shopify déclenché quand un produit est supprimé
 */
router.post('/shopify/product-delete', express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}), handleProductDelete);

/**
 * POST /api/webhooks/test
 * Endpoint pour tester le système de vectorisation/email manuellement
 */
router.post('/test', express.json(), testWebhook);

/**
 * GET /api/webhooks/health
 * Health check pour les webhooks
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'webhooks',
    timestamp: new Date().toISOString()
  });
});

export default router;
