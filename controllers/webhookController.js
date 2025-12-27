import crypto from 'crypto';
import { Patch } from '../config/mongodb.js';
import { vectorizeImage } from '../services/vectorizer.js';
import { sendPatchEmail } from '../services/emailService.js';

/**
 * Vérifier la signature du webhook Shopify (sécurité)
 * @param {Object} req - Request object
 * @returns {boolean}
 */
const verifyShopifyWebhook = (req) => {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  
  if (!hmacHeader || !process.env.SHOPIFY_WEBHOOK_SECRET) {
    console.warn('⚠️  Webhook signature verification skipped (no secret configured)');
    return true; // Skip verification si pas de secret configuré
  }

  const body = req.rawBody || JSON.stringify(req.body);
  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(body, 'utf8')
    .digest('base64');

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader));
};

/**
 * Extraire le patch_id depuis les données de commande Shopify
 * @param {Object} orderData - Données de la commande Shopify
 * @returns {string|null} - patch_id ou null
 */
const extractPatchIdFromOrder = (orderData) => {
  // Méthode 1: Depuis le SKU des line items
  for (const item of orderData.line_items || []) {
    if (item.sku && item.sku.startsWith('patch_')) {
      return item.sku;
    }
    
    // Vérifier aussi dans les properties
    for (const prop of item.properties || []) {
      if (prop.name === 'patch_id' || prop.name === '_patch_id') {
        return prop.value;
      }
    }
  }

  // Méthode 2: Depuis les note_attributes de la commande
  for (const attr of orderData.note_attributes || []) {
    if (attr.name === 'patch_id') {
      return attr.value;
    }
  }

  // Méthode 3: Depuis les tags
  if (orderData.tags) {
    const tags = orderData.tags.split(',').map(t => t.trim());
    const patchTag = tags.find(t => t.startsWith('patch_'));
    if (patchTag) return patchTag;
  }

  return null;
};

/**
 * Télécharger une image depuis une URL
 * @param {string} url - URL de l'image
 * @returns {Promise<Buffer>}
 */
const downloadImage = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

/**
 * Handler principal pour le webhook orders/paid
 */
export const handleOrderPaid = async (req, res) => {
  console.log('\n' + '='.repeat(60));
  console.log('🔔 WEBHOOK REÇU: orders/paid');
  console.log('='.repeat(60));

  try {
    // 1. Vérifier la signature Shopify
    if (!verifyShopifyWebhook(req)) {
      console.error('❌ Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const orderData = req.body;

    console.log('📦 Commande:', {
      id: orderData.id,
      order_number: orderData.order_number,
      email: orderData.email,
      total_price: orderData.total_price,
      line_items_count: orderData.line_items?.length || 0
    });

    // 2. Extraire le patch_id
    const patchId = extractPatchIdFromOrder(orderData);

    if (!patchId) {
      console.log('ℹ️  Pas de patch_id trouvé - commande standard (non-PPATCH)');
      return res.status(200).json({ 
        success: true, 
        message: 'Order received but no patch_id found - skipping vectorization' 
      });
    }

    console.log(`🎯 Patch ID trouvé: ${patchId}`);

    // 3. Récupérer le patch depuis MongoDB
    const patch = await Patch.findOne({ patch_id: patchId });

    if (!patch) {
      console.error(`❌ Patch not found in database: ${patchId}`);
      return res.status(404).json({ 
        success: false, 
        error: 'Patch not found',
        patch_id: patchId
      });
    }

    console.log('📋 Patch trouvé:', {
      patch_id: patch.patch_id,
      original_logo_url: patch.original_logo_url,
      generated_image_url: patch.generated_image_url,
      background_color: patch.background_color
    });

    // 4. Marquer le patch comme acheté
    patch.purchased = true;
    patch.shopify_order_id = orderData.id.toString();
    patch.shopify_order_number = orderData.order_number;
    patch.purchase_date = new Date();
    await patch.save();

    console.log('✅ Patch marqué comme acheté');

    // 5. Télécharger le logo ORIGINAL pour vectorisation
    let originalLogoBuffer = null;
    if (patch.original_logo_url) {
      console.log('📥 Téléchargement du logo original...');
      try {
        originalLogoBuffer = await downloadImage(patch.original_logo_url);
        console.log(`✅ Logo original téléchargé: ${(originalLogoBuffer.length / 1024).toFixed(1)} KB`);
      } catch (downloadError) {
        console.error('❌ Erreur téléchargement logo original:', downloadError.message);
      }
    } else {
      console.warn('⚠️  Pas de logo original stocké pour ce patch');
    }

    // 6. Télécharger l'image du PATCH FINAL pour l'email
    let patchImageBuffer = null;
    if (patch.generated_image_url) {
      console.log('📥 Téléchargement du rendu patch final...');
      try {
        patchImageBuffer = await downloadImage(patch.generated_image_url);
        console.log(`✅ Patch final téléchargé: ${(patchImageBuffer.length / 1024).toFixed(1)} KB`);
      } catch (downloadError) {
        console.error('❌ Erreur téléchargement patch final:', downloadError.message);
      }
    }

    // 7. Vectoriser le LOGO ORIGINAL
    let svgResult = null;
    if (originalLogoBuffer) {
      console.log('🔄 Vectorisation du logo original...');
      try {
        svgResult = await vectorizeImage(originalLogoBuffer, {
          levels: 4
        });
        console.log(`✅ Vectorisation terminée: ${svgResult.layerCount} niveaux`);
      } catch (vectorError) {
        console.error('❌ Erreur vectorisation:', vectorError.message);
      }
    } else {
      console.warn('⚠️  Impossible de vectoriser - logo original non disponible');
    }

    // 8. Préparer les données pour l'email
    const shippingAddress = orderData.shipping_address || orderData.billing_address;
    
    const emailOrderData = {
      orderNumber: orderData.order_number || orderData.name,
      customerName: `${orderData.customer?.first_name || ''} ${orderData.customer?.last_name || ''}`.trim() || 'Client',
      customerEmail: orderData.email || orderData.contact_email,
      shippingAddress: shippingAddress ? {
        name: shippingAddress.name,
        address1: shippingAddress.address1,
        address2: shippingAddress.address2,
        city: shippingAddress.city,
        zip: shippingAddress.zip,
        country: shippingAddress.country
      } : null,
      patchId: patchId,
      orderDate: orderData.created_at,
      totalPrice: orderData.total_price
    };

    // Email contient: le PATCH FINAL (image) + le LOGO VECTORISÉ (SVG)
    const emailFiles = {
      originalImage: patchImageBuffer,  // Le rendu du patch final
      svgFile: svgResult?.svg ? Buffer.from(svgResult.svg, 'utf-8') : null  // Le logo vectorisé
    };

    // 9. Envoyer l'email
    console.log('📧 Envoi de l\'email...');
    try {
      await sendPatchEmail(emailOrderData, emailFiles);
      console.log('✅ Email envoyé avec succès!');
    } catch (emailError) {
      console.error('❌ Erreur envoi email:', emailError.message);
      // Log mais ne pas faire échouer le webhook
    }

    // 10. Mettre à jour le patch avec le statut de vectorisation
    patch.vectorized = !!svgResult;
    patch.vectorized_at = svgResult ? new Date() : null;
    patch.email_sent = true;
    patch.email_sent_at = new Date();
    await patch.save();

    console.log('='.repeat(60));
    console.log('✅ TRAITEMENT COMMANDE TERMINÉ');
    console.log('='.repeat(60) + '\n');

    res.status(200).json({
      success: true,
      order_number: orderData.order_number,
      patch_id: patchId,
      vectorized: !!svgResult,
      email_sent: true
    });

  } catch (error) {
    console.error('❌ Webhook handler error:', error);
    
    // Toujours répondre 200 pour éviter que Shopify retry en boucle
    res.status(200).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Handler pour tester le webhook manuellement
 */
export const testWebhook = async (req, res) => {
  try {
    const { patch_id } = req.body;

    if (!patch_id) {
      return res.status(400).json({
        success: false,
        error: 'patch_id is required'
      });
    }

    // Simuler une commande
    const fakeOrderData = {
      id: 'test_' + Date.now(),
      order_number: 'TEST-' + Math.floor(Math.random() * 10000),
      email: 'test@example.com',
      total_price: '29.90',
      created_at: new Date().toISOString(),
      customer: {
        first_name: 'Test',
        last_name: 'Client'
      },
      shipping_address: {
        name: 'Test Client',
        address1: '123 Rue de Test',
        address2: '',
        city: 'Toulouse',
        zip: '31000',
        country: 'France'
      },
      line_items: [{
        sku: patch_id,
        title: 'Patch Test'
      }]
    };

    // Appeler le handler avec les données simulées
    req.body = fakeOrderData;
    return handleOrderPaid(req, res);

  } catch (error) {
    console.error('Test webhook error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export default {
  handleOrderPaid,
  testWebhook
};
