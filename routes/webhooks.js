import express from 'express';
import { handleOrderPaid, testWebhook } from '../controllers/webhookController.js';

const router = express.Router();

/**
 * Middleware pour capturer le body brut (nécessaire pour la vérification HMAC)
 */
const captureRawBody = (req, res, next) => {
  let data = '';
  req.setEncoding('utf8');
  
  req.on('data', chunk => {
    data += chunk;
  });
  
  req.on('end', () => {
    req.rawBody = data;
    try {
      req.body = JSON.parse(data);
    } catch (e) {
      req.body = {};
    }
    next();
  });
};

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
 * POST /api/webhooks/test
 * Endpoint pour tester le système de vectorisation/email manuellement
 * Body: { "patch_id": "patch_xxx" }
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
