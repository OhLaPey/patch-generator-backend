import '@shopify/shopify-api/adapters/node';
import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';

let shopify = null;

export const initializeShopify = () => {
  try {
    console.log('🔍 Checking Shopify credentials...');
    console.log('SHOPIFY_SHOP_NAME:', process.env.SHOPIFY_SHOP_NAME);
    console.log('SHOPIFY_ACCESS_TOKEN:', process.env.SHOPIFY_ACCESS_TOKEN ? '✅ Present' : '❌ Missing');
    
    if (!process.env.SHOPIFY_SHOP_NAME || !process.env.SHOPIFY_ACCESS_TOKEN) {
      console.warn('⚠️  Shopify credentials missing - Product creation disabled');
      return;
    }

    shopify = shopifyApi({
      apiKey: process.env.SHOPIFY_API_KEY || 'not-needed',
      apiSecretKey: process.env.SHOPIFY_API_SECRET || 'not-needed',
      scopes: ['write_products', 'read_products'],
      hostName: process.env.SHOPIFY_SHOP_NAME.replace('https://', '').replace('http://', ''),
      apiVersion: LATEST_API_VERSION,
      isEmbeddedApp: false,
      isCustomStoreApp: true,
      adminApiAccessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    });

    console.log('✅ Shopify API initialized');
  } catch (error) {
    console.error('❌ Shopify initialization failed:', error.message);
  }
};

/**
 * Convertir un code hex en nom de couleur approximatif
 */
const getColorName = (hex) => {
  const colors = {
    '#FFFFFF': 'Blanc',
    '#F5F5F5': 'Blanc cassé',
    '#E0E0E0': 'Gris clair',
    '#BDBDBD': 'Gris',
    '#9E9E9E': 'Gris moyen',
    '#757575': 'Gris foncé',
    '#424242': 'Anthracite',
    '#212121': 'Noir profond',
    '#000000': 'Noir',
    '#FF0000': 'Rouge vif',
    '#E91E63': 'Rose',
    '#9C27B0': 'Violet',
    '#673AB7': 'Violet foncé',
    '#3F51B5': 'Indigo',
    '#2196F3': 'Bleu',
    '#03A9F4': 'Bleu ciel',
    '#00BCD4': 'Cyan',
    '#009688': 'Turquoise',
    '#4CAF50': 'Vert',
    '#8BC34A': 'Vert clair',
    '#CDDC39': 'Lime',
    '#FFEB3B': 'Jaune',
    '#FFC107': 'Ambre',
    '#FF9800': 'Orange',
    '#FF5722': 'Orange foncé',
    '#795548': 'Marron',
    '#C41E3A': 'Rouge cardinal',
    '#1E40AF': 'Bleu marine',
    '#00A859': 'Vert émeraude',
  };
  
  const upperHex = hex.toUpperCase();
  return colors[upperHex] || 'Personnalisée';
};

/**
 * Obtenir le nom de la forme en français
 */
const getShapeName = (shape) => {
  const shapes = {
    'square': 'Carré',
    'logo_shape': 'Forme du logo',
    'circle': 'Rond',
    'rectangle_h': 'Rectangle horizontal',
    'rectangle_v': 'Rectangle vertical',
    'shield': 'Écusson',
  };
  return shapes[shape] || 'Carré';
};

/**
 * Générer la description HTML SEO optimisée
 */
const generateProductDescription = (patchData) => {
  const {
    background_color = '#FFFFFF',
    border_color = '#000000',
    shape = 'square',
    club_name = ''
  } = patchData;

  const bgColorName = getColorName(background_color);
  const borderColorName = getColorName(border_color);
  const shapeName = getShapeName(shape);

  return `
<div class="ppatch-product-description">
  <h2>🧵 Patch Brodé Personnalisé de Haute Qualité</h2>
  
  <p>Transformez ${club_name ? `le logo de <strong>${club_name}</strong>` : 'votre logo'} en un magnifique <strong>écusson brodé professionnel</strong>. Chaque patch est fabriqué avec soin en France, avec des matériaux premium pour une durabilité exceptionnelle.</p>

  <h3>✨ Caractéristiques de votre patch</h3>
  
  <div class="ppatch-specs">
    <div class="ppatch-spec-item">
      <span class="ppatch-spec-label">📐 Dimensions</span>
      <span class="ppatch-spec-value"><strong>Choisissez ci-dessus</strong> (5 à 10 cm)</span>
    </div>
    
    <div class="ppatch-spec-item">
      <span class="ppatch-spec-label">🔷 Forme</span>
      <span class="ppatch-spec-value">${shapeName}</span>
    </div>
    
    <div class="ppatch-spec-item">
      <span class="ppatch-spec-label">🎨 Couleur de fond</span>
      <span class="ppatch-spec-value">
        <span class="ppatch-color-dot" style="background-color: ${background_color}; display: inline-block; width: 16px; height: 16px; border-radius: 50%; border: 1px solid #ddd; vertical-align: middle; margin-right: 6px;"></span>
        ${bgColorName}
      </span>
    </div>
    
    <div class="ppatch-spec-item">
      <span class="ppatch-spec-label">🔲 Couleur de bordure</span>
      <span class="ppatch-spec-value">
        <span class="ppatch-color-dot" style="background-color: ${border_color}; display: inline-block; width: 16px; height: 16px; border-radius: 50%; border: 1px solid #ddd; vertical-align: middle; margin-right: 6px;"></span>
        ${borderColorName}
      </span>
    </div>
  </div>

  <h3>📏 Guide des tailles</h3>
  <ul>
    <li>🔸 <strong>5 cm</strong> — Compact, idéal pour petits espaces (⚠️ détails fins limités)</li>
    <li>⭐ <strong>6.5 cm</strong> — Format standard, compatible supports PPATCH</li>
    <li>🔹 <strong>8 cm</strong> — Grand format, parfait pour les logos détaillés</li>
    <li>🔷 <strong>10 cm</strong> — Très grand, maximum de détails visibles</li>
  </ul>

  <h3>🏆 Qualité Premium</h3>
  <ul>
    <li>✅ <strong>Broderie haute définition</strong> — Fil polyester résistant aux UV et lavages</li>
    <li>✅ <strong>Bordure métalock renforcée</strong> — Finition professionnelle durable</li>
    <li>✅ <strong>Velcro premium au dos</strong> — Système d'attache repositionnable</li>
    <li>✅ <strong>Fabrication française</strong> — Qualité artisanale garantie</li>
  </ul>

  <h3>🎯 Idéal pour</h3>
  <ul>
    <li>👕 Personnaliser vos vêtements (vestes, casquettes, sacs)</li>
    <li>⚽ Équiper votre club ou équipe sportive</li>
    <li>🎁 Offrir un cadeau unique et personnalisé</li>
    <li>🏢 Créer des objets promotionnels pour votre entreprise</li>
  </ul>

  <h3>📦 Livraison & Délais</h3>
  <p>Votre patch personnalisé est fabriqué à la commande. Comptez <strong>5 à 7 jours ouvrés</strong> pour la fabrication, puis expédition sous 24-48h.</p>

  <h3>💡 Compatible PPATCH</h3>
  <p>Ce patch est compatible avec tous nos accessoires de la gamme PPATCH : casquettes, brassards, porte-clés et plus encore !</p>

  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;">
  
  <p style="font-size: 12px; color: #888;">
    ⚠️ <em>Note : L'image présentée est une simulation générée par IA. Le produit final brodé peut présenter de légères variations. Vous êtes responsable d'obtenir les autorisations nécessaires pour l'utilisation de logos ou marques protégés.</em>
  </p>
</div>

<style>
  .ppatch-product-description h2 { font-size: 1.4em; margin-bottom: 16px; }
  .ppatch-product-description h3 { font-size: 1.1em; margin: 24px 0 12px; color: #333; }
  .ppatch-product-description ul { padding-left: 0; list-style: none; }
  .ppatch-product-description li { margin: 8px 0; line-height: 1.6; }
  .ppatch-specs { background: #f9f9f9; padding: 16px; border-radius: 8px; margin: 16px 0; }
  .ppatch-spec-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
  .ppatch-spec-item:last-child { border-bottom: none; }
  .ppatch-spec-label { font-weight: 500; color: #666; }
  .ppatch-spec-value { font-weight: 600; color: #333; }
</style>
`;
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
    background_color = '#FFFFFF',
    border_color = '#000000',
    shape = 'square',
    size = 6.5,
    club_name = '',
    email = ''
  } = patchData;

  // S'assurer que size est un nombre valide
  const sizeNum = parseFloat(size) || 6.5;

  // Générer le titre du produit
  const productTitle = club_name 
    ? `Patch Brodé ${club_name}`
    : 'Patch Brodé Personnalisé';

  // Générer les tags SEO
  const tags = [
    'patch brodé',
    'écusson personnalisé',
    'broderie',
    'patch velcro',
    'fabrication française',
    getShapeName(shape).toLowerCase(),
    patch_id
  ];
  
  if (club_name) {
    tags.push(club_name.toLowerCase());
  }

  try {
    const session = shopify.session.customAppSession(process.env.SHOPIFY_SHOP_NAME);
    session.accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    console.log('🔍 Session créée:', {
      shop: session.shop,
      hasToken: !!session.accessToken
    });

    const client = new shopify.clients.Rest({ session });

    console.log('🔍 Calling Shopify API:', `https://${session.shop}/admin/api/${LATEST_API_VERSION}/products.json`);

    // Créer le produit avec variantes de taille
    const response = await client.post({
      path: 'products',
      data: {
        product: {
          title: productTitle,
          body_html: generateProductDescription(patchData),
          vendor: 'PPATCH',
          product_type: 'Patch Brodé',
          tags: tags.join(', '),
          images: [
            {
              src: image_url,
              alt: `${productTitle} - Patch brodé personnalisé`
            }
          ],
          variants: [
            {
              title: '5 cm',
              price: process.env.PATCH_PRICE_5CM || '24.90',
              sku: `${patch_id}_5cm`,
              inventory_management: null,
              inventory_policy: 'continue',
              option1: '5 cm ⚠️',
              weight: 15,
              weight_unit: 'g'
            },
            {
              title: '6.5 cm ⭐',
              price: process.env.PATCH_PRICE_6CM || '29.90',
              sku: `${patch_id}_6.5cm`,
              inventory_management: null,
              inventory_policy: 'continue',
              option1: '6.5 cm ⭐ Standard',
              weight: 20,
              weight_unit: 'g'
            },
            {
              title: '8 cm',
              price: process.env.PATCH_PRICE_8CM || '34.90',
              sku: `${patch_id}_8cm`,
              inventory_management: null,
              inventory_policy: 'continue',
              option1: '8 cm',
              weight: 25,
              weight_unit: 'g'
            },
            {
              title: '10 cm',
              price: process.env.PATCH_PRICE_10CM || '39.90',
              sku: `${patch_id}_10cm`,
              inventory_management: null,
              inventory_policy: 'continue',
              option1: '10 cm',
              weight: 30,
              weight_unit: 'g'
            }
          ],
          options: [
            {
              name: 'Taille',
              values: ['5 cm ⚠️', '6.5 cm ⭐ Standard', '8 cm', '10 cm']
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
              value: email || '',
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
            },
            {
              namespace: 'ppatch',
              key: 'shape',
              value: shape,
              type: 'single_line_text_field'
            },
            {
              namespace: 'ppatch',
              key: 'club_name',
              value: club_name || '',
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
    const session = shopify.session.customAppSession(process.env.SHOPIFY_SHOP_NAME);
    session.accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

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
