import sharp from 'sharp';
import potrace from 'potrace';
import { promisify } from 'util';

const trace = promisify(potrace.trace);
const posterize = promisify(potrace.posterize);

/**
 * Vectoriser une image en SVG avec plusieurs niveaux de gris
 * Produit des contours propres exploitables pour la broderie
 * @param {Buffer} imageBuffer - Buffer de l'image à vectoriser
 * @param {Object} options - Options de vectorisation
 * @returns {Promise<{svg: string, layerCount: number}>}
 */
export const vectorizeImage = async (imageBuffer, options = {}) => {
  const {
    levels = 4,          // Nombre de niveaux de couleur (2-6 recommandé)
    threshold = 128,     // Seuil pour le mode N&B simple
    turnPolicy = 'minority',
    turdSize = 2,        // Supprime les petits artefacts
    optCurve = true,     // Optimise les courbes
    optTolerance = 0.2   // Tolérance d'optimisation
  } = options;

  console.log('🔄 Début de la vectorisation (posterize)...');

  try {
    // 1. Redimensionner et préparer l'image
    const preparedBuffer = await sharp(imageBuffer)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .normalize()  // Améliore le contraste
      .png()
      .toBuffer();

    // 2. Utiliser posterize pour créer plusieurs niveaux
    const svg = await posterize(preparedBuffer, {
      steps: levels,
      turnPolicy: turnPolicy,
      turdSize: turdSize,
      optCurve: optCurve,
      optTolerance: optTolerance,
      fillStrategy: 'dominant'
    });

    console.log(`✅ Vectorisation terminée: ${levels} niveaux`);

    return {
      svg: svg,
      layerCount: levels
    };

  } catch (error) {
    console.error('❌ Erreur vectorisation posterize:', error.message);
    
    // Fallback sur vectorisation simple N&B
    console.log('🔄 Fallback sur vectorisation N&B simple...');
    return await vectorizeSimple(imageBuffer, { threshold });
  }
};

/**
 * Vectorisation simple noir et blanc
 * @param {Buffer} imageBuffer 
 * @param {Object} options
 * @returns {Promise<{svg: string, layerCount: number}>}
 */
export const vectorizeSimple = async (imageBuffer, options = {}) => {
  const {
    threshold = 128,
    color = '#000000',
    background = '#ffffff'
  } = options;

  console.log('🔄 Vectorisation N&B simple...');

  try {
    // Convertir en niveaux de gris et optimiser le contraste
    const grayscaleBuffer = await sharp(imageBuffer)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .normalize()
      .png()
      .toBuffer();

    const svg = await trace(grayscaleBuffer, {
      threshold: threshold,
      color: color,
      background: background,
      turdSize: 2,
      optCurve: true,
      optTolerance: 0.2
    });

    console.log('✅ Vectorisation N&B terminée');

    return {
      svg: svg,
      layerCount: 1
    };

  } catch (error) {
    console.error('❌ Erreur vectorisation simple:', error);
    throw error;
  }
};

/**
 * Vectorisation avec extraction des couleurs principales
 * Crée un SVG multi-calques basé sur les couleurs dominantes
 * @param {Buffer} imageBuffer 
 * @param {Object} options
 * @returns {Promise<{svg: string, layerCount: number, colors: string[]}>}
 */
export const vectorizeWithColors = async (imageBuffer, options = {}) => {
  const {
    colorCount = 4,
    threshold = 40
  } = options;

  console.log(`🔄 Vectorisation multi-couleurs (${colorCount} couleurs)...`);

  try {
    // Préparer l'image
    const image = sharp(imageBuffer)
      .resize(600, 600, { fit: 'inside', withoutEnlargement: true });

    const { data, info } = await image
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height } = info;

    // Extraire les couleurs dominantes par quantification simple
    const colorBuckets = new Map();
    
    for (let i = 0; i < data.length; i += 3) {
      // Quantifier à des paliers de 64
      const r = Math.round(data[i] / 64) * 64;
      const g = Math.round(data[i + 1] / 64) * 64;
      const b = Math.round(data[i + 2] / 64) * 64;
      
      const key = `${r},${g},${b}`;
      colorBuckets.set(key, (colorBuckets.get(key) || 0) + 1);
    }

    // Trier et garder les N couleurs les plus fréquentes
    const dominantColors = [...colorBuckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, colorCount)
      .map(([color]) => {
        const [r, g, b] = color.split(',').map(Number);
        return { r, g, b, hex: rgbToHex(r, g, b) };
      });

    console.log('🎨 Couleurs dominantes:', dominantColors.map(c => c.hex));

    // Créer un SVG pour chaque couleur
    const svgPaths = [];

    for (let i = 0; i < dominantColors.length; i++) {
      const color = dominantColors[i];
      
      // Créer un masque pour cette couleur
      const maskData = Buffer.alloc(width * height);
      
      for (let p = 0; p < data.length; p += 3) {
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        
        // Distance de couleur
        const dist = Math.sqrt(
          Math.pow(r - color.r, 2) +
          Math.pow(g - color.g, 2) +
          Math.pow(b - color.b, 2)
        );
        
        maskData[p / 3] = dist < threshold ? 255 : 0;
      }

      // Créer l'image du masque
      const maskBuffer = await sharp(maskData, {
        raw: { width, height, channels: 1 }
      }).png().toBuffer();

      // Vectoriser le masque
      try {
        const pathSvg = await trace(maskBuffer, {
          color: color.hex,
          threshold: 128,
          turdSize: 5,
          optCurve: true
        });

        // Extraire le path
        const pathMatch = pathSvg.match(/<path[^>]*\/>/g);
        if (pathMatch) {
          svgPaths.push({
            color: color.hex,
            paths: pathMatch.join('\n')
          });
        }
      } catch (e) {
        console.warn(`⚠️ Pas de contenu pour ${color.hex}`);
      }
    }

    // Assembler le SVG final
    const finalSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <title>Patch vectorisé - PPATCH</title>
${svgPaths.map((p, i) => `  <g id="layer-${i + 1}" data-color="${p.color}">
    ${p.paths}
  </g>`).join('\n')}
</svg>`;

    console.log(`✅ Vectorisation multi-couleurs terminée: ${svgPaths.length} calques`);

    return {
      svg: finalSvg,
      layerCount: svgPaths.length,
      colors: svgPaths.map(p => p.color)
    };

  } catch (error) {
    console.error('❌ Erreur vectorisation couleurs:', error);
    // Fallback
    return vectorizeImage(imageBuffer, options);
  }
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

export default {
  vectorizeImage,
  vectorizeSimple,
  vectorizeWithColors
};
