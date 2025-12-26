import '@shopify/shopify-api/adapters/node';
import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';

let shopify = null;

export const initializeShopify = () => {
  try {
    if (!process.env.SHOPIFY_SHOP_NAME || !process.env.SHOPIFY_ACCESS_TOKEN) {
      console.warn('⚠️  Shopify credentials missing - Product creation disabled');
      return;
    }

    shopify = shopifyApi({
      apiKey: 'not-needed-for-custom-app',
      apiSecretKey: 'not-needed-for-custom-app',
      scopes: ['write_products', 'read_products'],
      hostName: process.env.SHOPIFY_SHOP_NAME.replace('https://', '').replace('http://', ''),
      apiVersion: LATEST_API_VERSION,
      isEmbeddedApp: false,
      isCustomStoreApp: true,
    });

    console.log('✅ Shopify API initialized');
  } catch (error) {
    console.error('❌ Shopify initialization failed:', error.message);
  }
};

/**
 * Créer un produit Shopify pour un patch
 */
export const createShopifyProduct = async (patchData) => {
  if (!shopify) {
    throw new Error('Shopify not initialized');
  }

  const {
    patch_id,
    image_url,
    background_color,
    border_color,
    email
  } = patchData;

  try {
    const session = {
      shop: process.env.SHOPIFY_SHOP_NAME,
      accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    };

    const client = new shopify.clients.Rest({ session });

    // Créer le produit
    const response = await client.post({
      path: 'products',
      data: {
        product: {
          title: `Patch Brodé Personnalisé - ${patch_id.substring(0, 8)}`,
          body_html: `
            <p><strong>Patch brodé personnalisé de haute qualité</strong></p>
            <ul>
              <li>✅ Broderie fil polyester haute résistance</li>
              <li>✅ Bordure métalock renforcée</li>
              <li>✅ Velcro au dos (système d'attache)</li>
              <li>✅ Dimensions: 10cm de diamètre</li>
              <li>✅ Fabriqué en France</li>
            </ul>
            <p><em>Couleur de fond: ${background_color}</em><br>
            <em>Couleur de bordure: ${border_color}</em></p>
            <p><small>Référence: ${patch_id}</small></p>
          `,
          vendor: 'PPATCH',
          product_type: 'Patch Brodé',
          tags: ['personnalisé', 'patch', 'broderie', patch_id],
          images: [
            {
              src: image_url,
              alt: 'Aperçu du patch brodé personnalisé'
            }
          ],
          variants: [
            {
              price: process.env.PATCH_PRICE || '29.90',
              sku: patch_id,
              inventory_management: null, // Pas de gestion de stock
              inventory_policy: 'continue', // Autoriser la vente même si stock = 0
            }
          ],
          metafields: [
            {
              namespace: 'ppatch',
              key: 'patch_id',
              value: patch_id,
              type: 'single_line_text_field'
            },
            {
              namespace: 'ppatch',
              key: 'customer_email',
              value: email,
              type: 'single_line_text_field'
            },
            {
              namespace: 'ppatch',
              key: 'background_color',
              value: background_color,
              type: 'single_line_text_field'
            },
            {
              namespace: 'ppatch',
              key: 'border_color',
              value: border_color,
              type: 'single_line_text_field'
            }
          ]
        }
      }
    });

    const product = response.body.product;

    console.log(`✅ Shopify product created: ${product.id}`);

    // Construire l'URL du produit
    const shopName = process.env.SHOPIFY_SHOP_NAME.replace('.myshopify.com', '');
    const productUrl = `https://${shopName}.myshopify.com/products/${product.handle}`;

    return {
      id: product.id.toString(),
      url: productUrl,
      handle: product.handle,
      admin_url: `https://${process.env.SHOPIFY_SHOP_NAME}/admin/products/${product.id}`
    };

  } catch (error) {
    console.error('❌ Shopify product creation failed:', error.message);
    
    if (error.response) {
      console.error('Shopify API Error:', error.response.body);
    }
    
    throw new Error(`Failed to create Shopify product: ${error.message}`);
  }
};

/**
 * Vérifier si un produit existe déjà
 */
export const getShopifyProduct = async (productId) => {
  if (!shopify) {
    throw new Error('Shopify not initialized');
  }

  try {
    const session = {
      shop: process.env.SHOPIFY_SHOP_NAME,
      accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    };

    const client = new shopify.clients.Rest({ session });

    const response = await client.get({
      path: `products/${productId}`,
    });

    return response.body.product;
  } catch (error) {
    console.error('Failed to get Shopify product:', error.message);
    return null;
  }
};
