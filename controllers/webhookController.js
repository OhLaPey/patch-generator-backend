import crypto from 'crypto';
import { Patch } from '../config/mongodb.js';
import { vectorizeImage } from '../services/vectorizer.js';
import { sendPatchEmail } from '../services/emailService.js';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

/**
 * Vérifier la signature du webhook Shopify (sécurité)
 */
const verifyShopifyWebhook = (req) => {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  
  if (!hmacHeader || !process.env.SHOPIFY_WEBHOOK_SECRET) {
    console.warn('⚠️  Webhook signature verification skipped (no secret configured)');
    return true;
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
 */
const extractPatchIdFromOrder = (orderData) => {
  for (const item of orderData.line_items || []) {
    if (item.sku && item.sku.startsWith('patch_')) {
      return item.sku;
    }
    for (const prop of item.properties || []) {
      if (prop.name === 'patch_id' || prop.name === '_patch_id') {
        return prop.value;
      }
    }
  }

  for (const attr of orderData.note_attributes || []) {
    if (attr.name === 'patch_id') {
      return attr.value;
    }
  }

  if (orderData.tags) {
    const tags = orderData.tags.split(',').map(t => t.trim());
    const patchTag = tags.find(t => t.startsWith('patch_'));
    if (patchTag) return patchTag;
  }

  return null;
};

/**
 * Télécharger une image depuis une URL
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
 * Envoyer un événement à Brevo
 */
const sendBrevoEvent = async (email, eventData) => {
  if (!process.env.BREVO_API_KEY) {
    console.warn('⚠️  BREVO_API_KEY non configurée - événement non envoyé');
    return false;
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/events', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        event_name: 'order_paid',
        email: email,
        event_data: eventData
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Brevo API error: ${response.status} - ${errorText}`);
    }

    console.log('✅ Événement Brevo envoyé avec succès');
    return true;
  } catch (error) {
    console.error('❌ Erreur envoi événement Brevo:', error.message);
    return false;
  }
};

/**
 * Initialiser Google Sheets pour le webhook
 */
const getGoogleSheet = async () => {
  const auth = new JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  
  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);
  await doc.loadInfo();
  return doc.sheetsByTitle['Exploitables'];
};

/**
 * Handler pour le webhook orders/paid
 */
export const handleOrderPaid = async (req, res) => {
  console.log('\n' + '='.repeat(60));
  console.log('🔔 WEBHOOK REÇU: orders/paid');
  console.log('='.repeat(60));

  try {
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

    const patchId = extractPatchIdFromOrder(orderData);

    if (!patchId) {
      console.log('ℹ️  Pas de patch_id trouvé - commande standard (non-PPATCH)');
      return res.status(200).json({ 
        success: true, 
        message: 'Order received but no patch_id found - skipping vectorization' 
      });
    }

    console.log(`🎯 Patch ID trouvé: ${patchId}`);

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

    patch.purchased = true;
    patch.shopify_order_id = orderData.id.toString();
    patch.shopify_order_number = orderData.order_number;
    patch.purchase_date = new Date();
    await patch.save();

    console.log('✅ Patch marqué comme acheté');

    let originalLogoBuffer = null;
    if (patch.original_logo_url) {
      console.log('📥 Téléchargement du logo original...');
      try {
        originalLogoBuffer = await downloadImage(patch.original_logo_url);
        console.log(`✅ Logo original téléchargé: ${(originalLogoBuffer.length / 1024).toFixed(1)} KB`);
      } catch (downloadError) {
        console.error('❌ Erreur téléchargement logo original:', downloadError.message);
      }
    }

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

    let svgResult = null;
    if (originalLogoBuffer) {
      console.log('🔄 Vectorisation du logo original...');
      try {
        svgResult = await vectorizeImage(originalLogoBuffer, { levels: 4 });
        console.log(`✅ Vectorisation terminée: ${svgResult.layerCount} niveaux`);
      } catch (vectorError) {
        console.error('❌ Erreur vectorisation:', vectorError.message);
      }
    }

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

    const emailFiles = {
      originalImage: patchImageBuffer,
      svgFile: svgResult?.svg ? Buffer.from(svgResult.svg, 'utf-8') : null
    };

    console.log('📧 Envoi de l\'email interne...');
    try {
      await sendPatchEmail(emailOrderData, emailFiles);
      console.log('✅ Email interne envoyé avec succès!');
    } catch (emailError) {
      console.error('❌ Erreur envoi email interne:', emailError.message);
    }

    patch.vectorized = !!svgResult;
    patch.vectorized_at = svgResult ? new Date() : null;
    patch.email_sent = true;
    patch.email_sent_at = new Date();
    await patch.save();

    const customerEmail = orderData.email || orderData.contact_email;
    if (customerEmail) {
      console.log('📤 Envoi événement Brevo...');
      
      const brevoEventData = {
        order_number: orderData.order_number || orderData.name,
        patch_id: patchId,
        customer_name: `${orderData.customer?.first_name || ''} ${orderData.customer?.last_name || ''}`.trim() || 'Client',
        total_price: orderData.total_price,
        patch_image_url: patch.generated_image_url || '',
        vectorized: !!svgResult,
        order_date: orderData.created_at
      };

      const brevoSent = await sendBrevoEvent(customerEmail, brevoEventData);
      
      patch.brevo_event_sent = brevoSent;
      patch.brevo_event_sent_at = brevoSent ? new Date() : null;
      await patch.save();
    }

    console.log('='.repeat(60));
    console.log('✅ TRAITEMENT COMMANDE TERMINÉ');
    console.log('='.repeat(60) + '\n');

    res.status(200).json({
      success: true,
      order_number: orderData.order_number,
      patch_id: patchId,
      vectorized: !!svgResult,
      email_sent: true,
      brevo_event_sent: patch.brevo_event_sent || false
    });

  } catch (error) {
    console.error('❌ Webhook handler error:', error);
    res.status(200).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Handler pour le webhook product/delete
 * Met à jour le Google Sheet quand un produit est supprimé sur Shopify
 */
export const handleProductDelete = async (req, res) => {
  console.log('\n' + '='.repeat(60));
  console.log('🔔 WEBHOOK REÇU: products/delete');
  console.log('='.repeat(60));

  try {
    if (!verifyShopifyWebhook(req)) {
      console.error('❌ Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const productData = req.body;
    const productId = productData.id;
    const productHandle = productData.handle;
    const productTitle = productData.title;

    console.log('🗑️ Produit supprimé:', {
      id: productId,
      handle: productHandle,
      title: productTitle
    });

    // Construire l'URL du produit pour chercher dans le Sheet
    const shopName = process.env.SHOPIFY_SHOP_NAME;
    const productUrl = `https://${shopName}/products/${productHandle}`;
    const productUrlAlt = `https://ppatch.shop/products/${productHandle}`;

    console.log('🔍 Recherche dans le Sheet pour:', productUrl);

    // Accéder au Google Sheet
    const sheet = await getGoogleSheet();
    const rows = await sheet.getRows();

    let updatedCount = 0;

    for (const row of rows) {
      const statutShopify = row.get('Statut_Shopify');
      
      // Vérifier si cette ligne correspond au produit supprimé
      if (statutShopify && (
        statutShopify.includes(productHandle) ||
        statutShopify.includes(productId) ||
        statutShopify === productUrl ||
        statutShopify === productUrlAlt
      )) {
        const clubName = row.get('Club') || row.get('Nom_Court');
        console.log(`📝 Mise à jour: ${clubName}`);
        
        row.set('Statut_Shopify', 'deleted_from_shopify');
        await row.save();
        updatedCount++;
      }
    }

    console.log(`✅ ${updatedCount} ligne(s) mise(s) à jour dans le Sheet`);
    console.log('='.repeat(60) + '\n');

    res.status(200).json({
      success: true,
      product_id: productId,
      product_handle: productHandle,
      rows_updated: updatedCount
    });

  } catch (error) {
    console.error('❌ Product delete webhook error:', error);
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
  handleProductDelete,
  testWebhook
};
