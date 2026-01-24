/**
 * PPATCH - Push Shopify Automatisé v2.1
 * Adapté pour le backend unifié
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { generateClubVisuals } from '../visuals/generate-visuals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  price: '10.00',

  fixedOptions: {
    forme: 'Carré',
    taille: '6.5cm',
    velcro: 'Avec velcro'
  },

  colorsFond: [
    { name: 'Blanc', hex: '#FFFFFF' },
    { name: 'Noir', hex: '#000000' },
    { name: 'Rouge', hex: '#DC2626' },
    { name: 'Bordeaux', hex: '#7F1D1D' },
    { name: 'Beige', hex: '#D4B896' },
    { name: 'Jaune', hex: '#EAB308' },
    { name: 'Orange', hex: '#EA580C' },
    { name: 'Bleu', hex: '#2563EB' },
    { name: 'Bleu Ciel', hex: '#0EA5E9' },
    { name: 'Marine', hex: '#1E3A8A' },
    { name: 'Vert', hex: '#16A34A' },
    { name: 'Kaki', hex: '#4B5320' },
    { name: 'Gris Clair', hex: '#D1D5DB' },
    { name: 'Gris Foncé', hex: '#4B5563' }
  ],

  colorsBordureEssentielles: [
    { name: 'Noir', hex: '#000000' },
    { name: 'Blanc', hex: '#FFFFFF' },
    { name: 'Or', hex: '#D4AF37' }
  ],

  filsBroderie: [
    { name: 'Blanc', hex: '#FFFFFF' },
    { name: 'Noir', hex: '#000000' },
    { name: 'Rouge', hex: '#DC2626' },
    { name: 'Bordeaux', hex: '#7F1D1D' },
    { name: 'Or', hex: '#D4AF37' },
    { name: 'Argent', hex: '#C0C0C0' },
    { name: 'Jaune', hex: '#EAB308' },
    { name: 'Orange', hex: '#EA580C' },
    { name: 'Bleu', hex: '#2563EB' },
    { name: 'Bleu Ciel', hex: '#0EA5E9' },
    { name: 'Marine', hex: '#1E3A8A' },
    { name: 'Vert', hex: '#16A34A' },
    { name: 'Violet', hex: '#7C3AED' },
    { name: 'Rose', hex: '#EC4899' }
  ],

  grandesVilles: [
    'Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice',
    'Nantes', 'Montpellier', 'Strasbourg', 'Bordeaux', 'Lille'
  ],

  regions: {
    '01': 'Auvergne-Rhône-Alpes', '02': 'Hauts-de-France', '03': 'Auvergne-Rhône-Alpes',
    '04': 'Provence-Alpes-Côte d\'Azur', '05': 'Provence-Alpes-Côte d\'Azur',
    '06': 'Provence-Alpes-Côte d\'Azur', '07': 'Auvergne-Rhône-Alpes', '08': 'Grand Est',
    '09': 'Occitanie', '10': 'Grand Est', '11': 'Occitanie', '12': 'Occitanie',
    '13': 'Provence-Alpes-Côte d\'Azur', '14': 'Normandie', '15': 'Auvergne-Rhône-Alpes',
    '16': 'Nouvelle-Aquitaine', '17': 'Nouvelle-Aquitaine', '18': 'Centre-Val de Loire',
    '19': 'Nouvelle-Aquitaine', '21': 'Bourgogne-Franche-Comté', '22': 'Bretagne',
    '23': 'Nouvelle-Aquitaine', '24': 'Nouvelle-Aquitaine', '25': 'Bourgogne-Franche-Comté',
    '26': 'Auvergne-Rhône-Alpes', '27': 'Normandie', '28': 'Centre-Val de Loire',
    '29': 'Bretagne', '30': 'Occitanie', '31': 'Occitanie', '32': 'Occitanie',
    '33': 'Nouvelle-Aquitaine', '34': 'Occitanie', '35': 'Bretagne', '36': 'Centre-Val de Loire',
    '37': 'Centre-Val de Loire', '38': 'Auvergne-Rhône-Alpes', '39': 'Bourgogne-Franche-Comté',
    '40': 'Nouvelle-Aquitaine', '41': 'Centre-Val de Loire', '42': 'Auvergne-Rhône-Alpes',
    '43': 'Auvergne-Rhône-Alpes', '44': 'Pays de la Loire', '45': 'Centre-Val de Loire',
    '46': 'Occitanie', '47': 'Nouvelle-Aquitaine', '48': 'Occitanie', '49': 'Pays de la Loire',
    '50': 'Normandie', '51': 'Grand Est', '52': 'Grand Est', '53': 'Pays de la Loire',
    '54': 'Grand Est', '55': 'Grand Est', '56': 'Bretagne', '57': 'Grand Est',
    '58': 'Bourgogne-Franche-Comté', '59': 'Hauts-de-France', '60': 'Hauts-de-France',
    '61': 'Normandie', '62': 'Hauts-de-France', '63': 'Auvergne-Rhône-Alpes',
    '64': 'Nouvelle-Aquitaine', '65': 'Occitanie', '66': 'Occitanie', '67': 'Grand Est',
    '68': 'Grand Est', '69': 'Auvergne-Rhône-Alpes', '70': 'Bourgogne-Franche-Comté',
    '71': 'Bourgogne-Franche-Comté', '72': 'Pays de la Loire', '73': 'Auvergne-Rhône-Alpes',
    '74': 'Auvergne-Rhône-Alpes', '75': 'Île-de-France', '76': 'Normandie',
    '77': 'Île-de-France', '78': 'Île-de-France', '79': 'Nouvelle-Aquitaine',
    '80': 'Hauts-de-France', '81': 'Occitanie', '82': 'Occitanie', '83': 'Provence-Alpes-Côte d\'Azur',
    '84': 'Provence-Alpes-Côte d\'Azur', '85': 'Pays de la Loire', '86': 'Nouvelle-Aquitaine',
    '87': 'Nouvelle-Aquitaine', '88': 'Grand Est', '89': 'Bourgogne-Franche-Comté',
    '90': 'Bourgogne-Franche-Comté', '91': 'Île-de-France', '92': 'Île-de-France',
    '93': 'Île-de-France', '94': 'Île-de-France', '95': 'Île-de-France',
    '2A': 'Corse', '2B': 'Corse'
  },

  departements: {
    '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence',
    '05': 'Hautes-Alpes', '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes',
    '09': 'Ariège', '10': 'Aube', '11': 'Aude', '12': 'Aveyron',
    '13': 'Bouches-du-Rhône', '14': 'Calvados', '15': 'Cantal', '16': 'Charente',
    '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze', '21': 'Côte-d\'Or',
    '22': 'Côtes-d\'Armor', '23': 'Creuse', '24': 'Dordogne', '25': 'Doubs',
    '26': 'Drôme', '27': 'Eure', '28': 'Eure-et-Loir', '29': 'Finistère',
    '30': 'Gard', '31': 'Haute-Garonne', '32': 'Gers', '33': 'Gironde',
    '34': 'Hérault', '35': 'Ille-et-Vilaine', '36': 'Indre', '37': 'Indre-et-Loire',
    '38': 'Isère', '39': 'Jura', '40': 'Landes', '41': 'Loir-et-Cher',
    '42': 'Loire', '43': 'Haute-Loire', '44': 'Loire-Atlantique', '45': 'Loiret',
    '46': 'Lot', '47': 'Lot-et-Garonne', '48': 'Lozère', '49': 'Maine-et-Loire',
    '50': 'Manche', '51': 'Marne', '52': 'Haute-Marne', '53': 'Mayenne',
    '54': 'Meurthe-et-Moselle', '55': 'Meuse', '56': 'Morbihan', '57': 'Moselle',
    '58': 'Nièvre', '59': 'Nord', '60': 'Oise', '61': 'Orne',
    '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme', '64': 'Pyrénées-Atlantiques',
    '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales', '67': 'Bas-Rhin',
    '68': 'Haut-Rhin', '69': 'Rhône', '70': 'Haute-Saône', '71': 'Saône-et-Loire',
    '72': 'Sarthe', '73': 'Savoie', '74': 'Haute-Savoie', '75': 'Paris',
    '76': 'Seine-Maritime', '77': 'Seine-et-Marne', '78': 'Yvelines',
    '79': 'Deux-Sèvres', '80': 'Somme', '81': 'Tarn', '82': 'Tarn-et-Garonne',
    '83': 'Var', '84': 'Vaucluse', '85': 'Vendée', '86': 'Vienne',
    '87': 'Haute-Vienne', '88': 'Vosges', '89': 'Yonne', '90': 'Territoire de Belfort',
    '91': 'Essonne', '92': 'Hauts-de-Seine', '93': 'Seine-Saint-Denis',
    '94': 'Val-de-Marne', '95': 'Val-d\'Oise', '2A': 'Corse-du-Sud', '2B': 'Haute-Corse'
  },

  delayBetweenRequests: 500
};

// ============================================
// SHOPIFY API (utilise les variables d'environnement)
// ============================================

const getShopifyAPI = () => {
  const shopifyStore = process.env.SHOPIFY_SHOP_NAME;
  const shopifyToken = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!shopifyStore || !shopifyToken) {
    throw new Error('Shopify credentials missing');
  }

  return axios.create({
    baseURL: `https://${shopifyStore}/admin/api/2024-01`,
    headers: {
      'X-Shopify-Access-Token': shopifyToken,
      'Content-Type': 'application/json'
    }
  });
};

let collectionsCache = null;

async function getCollections() {
  if (collectionsCache) return collectionsCache;

  try {
    const shopifyAPI = getShopifyAPI();
    const collections = {};
    let pageInfo = null;

    do {
      const params = pageInfo ? { page_info: pageInfo, limit: 250 } : { limit: 250 };
      const response = await shopifyAPI.get('/custom_collections.json', { params });

      for (const col of response.data.custom_collections) {
        collections[col.title] = col.id;
      }

      const link = response.headers.link;
      pageInfo = null;
      if (link && link.includes('rel="next"')) {
        const match = link.match(/page_info=([^>&]*)/);
        if (match) pageInfo = match[1];
      }
    } while (pageInfo);

    collectionsCache = collections;
    return collections;
  } catch (error) {
    console.error('Erreur collections:', error.message);
    return {};
  }
}

async function ensureCollection(name) {
  const collections = await getCollections();
  if (collections[name]) return collections[name];

  try {
    const shopifyAPI = getShopifyAPI();
    const response = await shopifyAPI.post('/custom_collections.json', {
      custom_collection: { title: name, published: true }
    });
    const newId = response.data.custom_collection.id;
    collectionsCache[name] = newId;
    return newId;
  } catch (error) {
    console.error(`Erreur création collection ${name}:`, error.message);
    return null;
  }
}

async function addProductToCollection(productId, collectionId) {
  try {
    const shopifyAPI = getShopifyAPI();
    await shopifyAPI.post('/collects.json', {
      collect: { product_id: productId, collection_id: collectionId }
    });
    return true;
  } catch (error) {
    return false;
  }
}

async function uploadImage(productId, imagePath, altText, position) {
  try {
    const shopifyAPI = getShopifyAPI();
    let imageData;

    if (imagePath.startsWith('http')) {
      imageData = { src: imagePath };
    } else if (fs.existsSync(imagePath)) {
      const buffer = fs.readFileSync(imagePath);
      const base64 = buffer.toString('base64');
      imageData = { attachment: base64, filename: path.basename(imagePath) };
    } else {
      return null;
    }

    const response = await shopifyAPI.post(`/products/${productId}/images.json`, {
      image: { ...imageData, alt: altText, position }
    });

    return response.data.image;
  } catch (error) {
    console.error(`Erreur upload image:`, error.message);
    return null;
  }
}

async function setColorMetafields(productId, colorsFond, colorsBordure) {
  try {
    const shopifyAPI = getShopifyAPI();
    
    await shopifyAPI.post(`/products/${productId}/metafields.json`, {
      metafield: {
        namespace: 'ppatch',
        key: 'colors_fond',
        value: JSON.stringify(colorsFond),
        type: 'json'
      }
    });

    await shopifyAPI.post(`/products/${productId}/metafields.json`, {
      metafield: {
        namespace: 'ppatch',
        key: 'colors_bordure',
        value: JSON.stringify(colorsBordure),
        type: 'json'
      }
    });

    console.log('   🎨 Metafields couleurs ajoutés');
    return true;
  } catch (error) {
    console.error('Erreur metafields:', error.message);
    return false;
  }
}

// ============================================
// EXTRACTION COULEURS LOGO
// ============================================

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function colorDistance(rgb1, rgb2) {
  return Math.sqrt(
    Math.pow(rgb1.r - rgb2.r, 2) +
    Math.pow(rgb1.g - rgb2.g, 2) +
    Math.pow(rgb1.b - rgb2.b, 2)
  );
}

function findClosestFil(hexColor) {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return null;

  let closestFil = null;
  let minDistance = Infinity;

  for (const fil of CONFIG.filsBroderie) {
    const filRgb = hexToRgb(fil.hex);
    const distance = colorDistance(rgb, filRgb);

    if (distance < minDistance) {
      minDistance = distance;
      closestFil = fil;
    }
  }

  if (minDistance > 150) return null;
  return closestFil;
}

function generateBordurePalette(logoColors = []) {
  const palette = [];
  const addedNames = new Set();

  for (const essential of CONFIG.colorsBordureEssentielles) {
    if (!addedNames.has(essential.name)) {
      palette.push({ name: essential.name, hex: essential.hex, isLogoColor: false });
      addedNames.add(essential.name);
    }
  }

  let logoColorCount = 0;
  for (const logoHex of logoColors) {
    if (logoColorCount >= 5) break;

    const matchedFil = findClosestFil(logoHex);
    if (matchedFil && !addedNames.has(matchedFil.name)) {
      palette.push({ name: matchedFil.name, hex: matchedFil.hex, isLogoColor: true });
      addedNames.add(matchedFil.name);
      logoColorCount++;
    }
  }

  return palette;
}

// ============================================
// SEO
// ============================================

function generateSEODescription(club) {
  const name = club.name || 'Club';
  const sport = club.sport || 'Sport';

  const intros = [
    `Affichez votre passion pour ${name} avec ce patch brodé premium.`,
    `Rejoignez la communauté des supporters de ${name} avec ce patch brodé d'exception.`,
    `Le logo de ${name} prend vie sur ce patch brodé professionnel.`,
    `Soutenez ${name} avec style grâce à ce patch brodé réaliste.`,
    `${name} mérite un patch brodé à sa hauteur.`
  ];

  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const intro = intros[hash % intros.length];

  return `${intro}

<h2>Caractéristiques</h2>
<p><strong>Choisissez vos couleurs de fond et de bordure</strong> parmi notre palette de tissus et fils broderie.</p>
<ul>
<li><strong>Dimensions</strong> : 6.5cm (taille optimale casquettes PPATCH)</li>
<li><strong>Forme</strong> : Carrée</li>
<li><strong>Fixation</strong> : Velcro haute qualité pour interchangeabilité</li>
<li><strong>Broderie</strong> : Fil premium haute densité</li>
<li><strong>Matière</strong> : Twill polyester résistant</li>
</ul>

<h2>Commandez</h2>
<p>Sélectionnez vos couleurs préférées et ajoutez au panier. Livraison sous 5-7 jours ouvrés.</p>

<p><small><em>Note : Les visuels sont des illustrations. Le patch final brodé peut présenter des variations mineures.</em></small></p>`;
}

function generateSEOMetadata(club) {
  const name = club.name || 'Club';
  const commune = club.commune || '';
  const deptNum = String(club.departement).padStart(2, '0');
  const departement = CONFIG.departements[deptNum] || '';
  const sport = club.sport || 'Sport';

  const handle = `patch-brode-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').substring(0, 80)}`;
  const title = `Patch Brodé ${name} | ${sport} | PPATCH`;
  const description = `Patch brodé officiel ${name} (${commune}). Patch ${sport} premium avec velcro pour casquettes PPATCH. Broderie haute qualité, 6.5cm.`;

  const tags = [
    'patch brodé', 'patch personnalisé', sport.toLowerCase(), name,
    commune, departement, 'supporter', 'club sportif', 'casquette patch'
  ].filter(Boolean).map(t => t.trim()).filter(t => t.length > 0);

  return { handle, title, description, tags };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// TRAITEMENT CLUB
// ============================================

export async function processClub(club) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🏆 ${club.name}`);
  console.log(`   📍 ${club.commune || 'N/A'} | 🏃 ${club.sport || 'N/A'}`);

  // Générer les visuels
  console.log('   🎨 Génération visuels...');
  let visuals;
  try {
    visuals = await generateClubVisuals(club);
  } catch (err) {
    console.error(`   ❌ Erreur visuels: ${err.message}`);
    return { success: false, error: err.message };
  }

  const imageCount = Object.keys(visuals?.images || {}).length;
  if (imageCount === 0) {
    console.log(`   ❌ Aucune image générée`);
    return { success: false, error: 'Aucune image générée' };
  }
  console.log(`   📦 ${imageCount} images`);

  // Palette couleurs
  const colorsFondPalette = CONFIG.colorsFond.map(c => ({
    name: c.name, hex: c.hex, isLogoColor: false
  }));

  const logoColors = visuals?.extractedColors || [];
  const colorsBordurePalette = generateBordurePalette(logoColors);

  console.log(`   🎨 Fond: ${colorsFondPalette.length} couleurs`);
  console.log(`   🎨 Bordure: ${colorsBordurePalette.length} couleurs`);

  const seoMeta = generateSEOMetadata(club);
  const description = generateSEODescription(club);

  // Créer les variantes
  const maxFond = Math.min(Math.floor(100 / colorsBordurePalette.length), colorsFondPalette.length);
  const fondOptions = colorsFondPalette.slice(0, maxFond);
  const bordureOptions = colorsBordurePalette;

  const variants = [];

  for (const fondColor of fondOptions) {
    for (const bordureColor of bordureOptions) {
      const sku = `PATCH-${club.name.substring(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, '')}-${fondColor.name.substring(0, 3).toUpperCase()}-${bordureColor.name.substring(0, 3).toUpperCase()}`;

      variants.push({
        option1: fondColor.name,
        option2: bordureColor.name,
        price: CONFIG.price,
        sku,
        inventory_management: null,
        requires_shipping: true,
        taxable: true,
        weight: 10,
        weight_unit: 'g'
      });
    }
  }

  console.log(`   📊 ${variants.length} variantes`);

  const productData = {
    product: {
      title: `Patch Brodé ${club.name}`,
      body_html: description,
      vendor: 'PPATCH',
      product_type: 'Patch',
      tags: seoMeta.tags,
      handle: seoMeta.handle,
      published: true,
      options: [
        { name: 'Couleur Fond', values: fondOptions.map(c => c.name) },
        { name: 'Couleur Bordure', values: bordureOptions.map(c => c.name) }
      ],
      variants,
      metafields_global_title_tag: seoMeta.title,
      metafields_global_description_tag: seoMeta.description
    }
  };

  try {
    const shopifyAPI = getShopifyAPI();
    const response = await shopifyAPI.post('/products.json', productData);
    const product = response.data.product;
    console.log(`   ✅ Produit créé: ${product.id}`);

    // Metafields couleurs
    await setColorMetafields(product.id, fondOptions, bordureOptions);

    // Upload images
    if (visuals?.images) {
      console.log('   📸 Upload images...');
      const imageNames = ['Patch seul', 'Casquette', 'Détail', 'Collection', 'Dos velcro'];
      let position = 1;

      for (const [key, imagePath] of Object.entries(visuals.images)) {
        const altText = `${club.name} - ${imageNames[position - 1] || 'Patch'}`;
        await uploadImage(product.id, imagePath, altText, position);
        position++;
        await delay(CONFIG.delayBetweenRequests);
      }
    }

    // Collections
    await assignToCollections(product, club);

    const shopName = process.env.SHOPIFY_SHOP_NAME?.replace('.myshopify.com', '') || 'ppatch';
    const productUrl = `https://${shopName}.myshopify.com/products/${product.handle}`;

    return {
      success: true,
      productId: product.id,
      productUrl: productUrl,
      product
    };

  } catch (error) {
    console.error(`Erreur création produit:`, error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.errors || error.message
    };
  }
}

async function assignToCollections(product, club) {
  const deptNum = String(club.departement).padStart(2, '0');
  const region = CONFIG.regions[deptNum] || club.region;
  const departement = CONFIG.departements[deptNum];

  const sportCollectionNames = {
    'Football': 'Patchs Football',
    'Basketball': 'Patchs Basket',
    'Handball': 'Patchs Handball',
    'Rugby': 'Patchs Rugby',
    'Volley': 'Patchs Volley'
  };

  const collections = [
    sportCollectionNames[club.sport] || `Patchs ${club.sport}`,
    region,
    departement ? `${departement} (${deptNum})` : null,
  ].filter(Boolean);

  const communeNorm = club.commune?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const ville of CONFIG.grandesVilles) {
    const villeNorm = ville.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (communeNorm?.includes(villeNorm)) {
      collections.push(ville);
      break;
    }
  }

  console.log(`   📂 Collections: ${collections.join(', ')}`);

  for (const collectionName of collections) {
    const collectionId = await ensureCollection(collectionName);
    if (collectionId) {
      await addProductToCollection(product.id, collectionId);
      await delay(CONFIG.delayBetweenRequests);
    }
  }
}

export default { processClub };