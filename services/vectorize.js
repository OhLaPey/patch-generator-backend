import sharp from 'sharp';
import potrace from 'potrace';
import { promisify } from 'util';

const trace = promisify(potrace.trace);

/**
 * Quantifier les couleurs d'une image pour réduire à N couleurs distinctes
 * @param {Buffer} imageBuffer - Buffer de l'image
 * @param {number} maxColors - Nombre maximum de couleurs (défaut: 16)
 * @returns {Promise<{buffer: Buffer, colors: string[]}>}
 */
const quantizeColors = async (imageBuffer, maxColors = 16) => {
  // Récupérer les métadonnées et les pixels
  const image = sharp(imageBuffer);
  const { width, height } = await image.metadata();
  
  // Extraire les pixels bruts
  const { data } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  // Compter les couleurs
  const colorCounts = new Map();
  
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // Quantifier à des paliers de 32 pour regrouper les couleurs similaires
    const qr = Math.round(r / 32) * 32;
    const qg = Math.round(g / 32) * 32;
    const qb = Math.round(b / 32) * 32;
    
    const colorKey = `${qr},${qg},${qb}`;
    colorCounts.set(colorKey, (colorCounts.get(colorKey) || 0) + 1);
  }
  
  // Trier par fréquence et garder les N plus fréquentes
  const sortedColors = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([color]) => {
      const [r, g, b] = color.split(',').map(Number);
      return { r, g, b, hex: rgbToHex(r, g, b) };
    });
  
  console.log(`🎨 ${sortedColors.length} couleurs dominantes détectées`);
  
  return {
    colors: sortedColors,
    width,
    height
  };
};

/**
 * Convertir RGB en hex
 */
const rgbToHex = (r, g, b) => {
  return '#' + [r, g, b].map(x => {
    const hex = Math.min(255, Math.max(0, x)).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
};

/**
 * Créer un masque pour une couleur spécifique
 * @param {Buffer} imageBuffer - Buffer de l'image originale
 * @param {Object} targetColor - Couleur cible {r, g, b}
 * @param {number} tolerance - Tolérance de couleur (défaut: 50)
 * @returns {Promise<Buffer>} - Image noir et blanc (masque)
 */
const createColorMask = async (imageBuffer, targetColor, tolerance = 50) => {
  const image = sharp(imageBuffer);
  const { width, height } = await image.metadata();
  
  const { data } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  // Créer un buffer pour le masque (noir et blanc)
  const maskData = Buffer.alloc(width * height);
  
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // Calculer la distance de couleur
    const distance = Math.sqrt(
      Math.pow(r - targetColor.r, 2) +
      Math.pow(g - targetColor.g, 2) +
      Math.pow(b - targetColor.b, 2)
    );
    
    // Si la couleur est proche de la cible, pixel blanc (255), sinon noir (0)
    const pixelIndex = i / 3;
    maskData[pixelIndex] = distance <= tolerance ? 255 : 0;
  }
  
  // Créer l'image du masque
  return sharp(maskData, {
    raw: {
      width,
      height,
      channels: 1
    }
  })
    .png()
    .toBuffer();
};

/**
 * Vectoriser un masque en SVG path
 * @param {Buffer} maskBuffer - Buffer du masque noir et blanc
 * @param {string} color - Couleur hex pour le path
 * @returns {Promise<string>} - SVG path element
 */
const vectorizeMask = async (maskBuffer, color) => {
  try {
    const svg = await trace(maskBuffer, {
      color: color,
      threshold: 128,
      turdSize: 2,
      optTolerance: 0.4
    });
    
    // Extraire juste le path du SVG
    const pathMatch = svg.match(/<path[^>]*d="([^"]*)"[^>]*>/);
    if (pathMatch) {
      return `<path d="${pathMatch[1]}" fill="${color}" />`;
    }
    return '';
  } catch (error) {
    console.warn(`⚠️ Vectorisation échouée pour ${color}:`, error.message);
    return '';
  }
};

/**
 * Convertir une image en SVG avec calques par couleur
 * @param {Buffer} imageBuffer - Buffer de l'image à vectoriser
 * @param {Object} options - Options de vectorisation
 * @returns {Promise<{svg: string, colors: string[]}>}
 */
export const vectorizeImage = async (imageBuffer, options = {}) => {
  const {
    maxColors = 12,
    tolerance = 45,
    simplify = true
  } = options;
  
  console.log('🔄 Début de la vectorisation...');
  
  try {
    // 1. Redimensionner pour optimiser le traitement
    const resizedBuffer = await sharp(imageBuffer)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    
    // 2. Quantifier les couleurs
    const { colors, width, height } = await quantizeColors(resizedBuffer, maxColors);
    
    // 3. Créer les paths SVG pour chaque couleur
    const paths = [];
    
    for (const color of colors) {
      console.log(`  → Traitement couleur ${color.hex}...`);
      
      // Créer le masque pour cette couleur
      const maskBuffer = await createColorMask(resizedBuffer, color, tolerance);
      
      // Vectoriser le masque
      const pathElement = await vectorizeMask(maskBuffer, color.hex);
      
      if (pathElement) {
        paths.push({
          color: color.hex,
          path: pathElement
        });
      }
    }
    
    // 4. Assembler le SVG final avec des groupes par couleur
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     viewBox="0 0 ${width} ${height}" 
     width="${width}" 
     height="${height}">
  <title>Patch vectorisé - PPATCH</title>
  <desc>Généré automatiquement pour broderie</desc>
  
${paths.map((p, index) => `  <!-- Calque ${index + 1}: ${p.color} -->
  <g id="color-${index + 1}" data-color="${p.color}" class="color-layer">
    ${p.path}
  </g>`).join('\n\n')}
</svg>`;
    
    console.log(`✅ Vectorisation terminée: ${paths.length} calques de couleur`);
    
    return {
      svg: svgContent,
      colors: paths.map(p => p.color),
      layerCount: paths.length
    };
    
  } catch (error) {
    console.error('❌ Erreur de vectorisation:', error);
    throw new Error(`Vectorization failed: ${error.message}`);
  }
};

/**
 * Vectorisation simplifiée (noir et blanc) - fallback
 * @param {Buffer} imageBuffer 
 * @returns {Promise<string>} SVG content
 */
export const vectorizeSimple = async (imageBuffer) => {
  console.log('🔄 Vectorisation simplifiée (N&B)...');
  
  try {
    // Convertir en niveaux de gris
    const grayscaleBuffer = await sharp(imageBuffer)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .png()
      .toBuffer();
    
    const svg = await trace(grayscaleBuffer, {
      threshold: 128,
      turdSize: 2,
      optTolerance: 0.4
    });
    
    console.log('✅ Vectorisation simplifiée terminée');
    return svg;
    
  } catch (error) {
    console.error('❌ Erreur vectorisation simple:', error);
    throw error;
  }
};

export default {
  vectorizeImage,
  vectorizeSimple
};
