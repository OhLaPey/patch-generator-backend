/**
 * PPATCH - Génération de Visuels avec Gemini API (SDK) v2
 * 
 * Corrections:
 * - Extrait 5 couleurs dominantes du logo (pas juste 1)
 * - Retourne extractedColors dans les résultats
 * - Image 4: Utilise patch de base + logo brodé pour multitude (30-50 patches)
 * - Normalisation de la taille du patch pour l'image 1 (consistance)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  referenceImages: {
    casquette: path.join(__dirname, '../../assets/reference/casquette.webp'),
    dosVelcro: path.join(__dirname, '../../assets/reference/dos_velcro.png'),
    patchBase: path.join(__dirname, '../../assets/reference/patch_base.jpeg')
  },
outputDir: process.env.VISUALS_OUTPUT_DIR || '/tmp/ppatch-visuals',
  delayBetweenGenerations: 2000,
  
  imageSize: 2048,
  targetPatchSize: 1536, // 75% de 2048px - Taille normalisée du patch
  imageFormat: 'webp',
  imageQuality: 90
};

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// ============================================
// UTILITAIRES
// ============================================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function convertToWebP(inputPath, outputPath) {
  try {
    await sharp(inputPath)
      .resize(CONFIG.imageSize, CONFIG.imageSize, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .webp({ quality: CONFIG.imageQuality })
      .toFile(outputPath);
    
    if (inputPath !== outputPath && fs.existsSync(inputPath)) {
      fs.unlinkSync(inputPath);
    }
    return true;
  } catch (e) {
    console.error(`      ❌ Conversion WebP échouée: ${e.message}`);
    return false;
  }
}

async function convertSvgToPng(svgBuffer) {
  // Essayer avec resvg-js d'abord (meilleur support SVG)
  try {
    const { Resvg } = await import('@resvg/resvg-js');
    const resvg = new Resvg(svgBuffer, {
      fitTo: { mode: 'width', value: 1024 },
      background: '#FFFFFF'
    });
    const pngData = resvg.render();
    console.log('      ✅ SVG converti avec resvg-js');
    return pngData.asPng();
  } catch (resvgError) {
    console.log('      ⚠️ resvg-js non disponible, essai avec sharp...');
  }
  
  // Essayer avec sharp ensuite
  try {
    const pngBuffer = await sharp(svgBuffer)
      .resize(1024, 1024, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toBuffer();
    console.log('      ✅ SVG converti avec sharp');
    return pngBuffer;
  } catch (sharpError) {
    console.log('      ❌ Sharp ne peut pas convertir ce SVG');
  }
  
  // Aucune solution n'a marché
  throw new Error('SVG non supporté - veuillez sélectionner une version PNG/JPG du logo. Installez @resvg/resvg-js pour le support SVG: npm install @resvg/resvg-js');
}

async function loadImageAsBase64(imagePath) {
  let imageBase64, mimeType;
  
  if (imagePath.startsWith('http')) {
    try {
      const response = await axios.get(imagePath, { 
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      mimeType = response.headers['content-type'] || '';
      
      // Détecter SVG même si le content-type est mal défini
      let imageBuffer = Buffer.from(response.data);
      const bufferStart = imageBuffer.toString('utf8', 0, 100);
      const isSvg = mimeType === 'image/svg+xml' || 
                    imagePath.toLowerCase().endsWith('.svg') ||
                    bufferStart.includes('<svg') ||
                    bufferStart.includes('<?xml');
      
      if (isSvg) {
        console.log('      🔄 Conversion SVG → PNG...');
        try {
          imageBuffer = await convertSvgToPng(imageBuffer);
          mimeType = 'image/png';
        } catch (convError) {
          throw new Error(`SVG détecté mais conversion impossible: ${convError.message}`);
        }
      } else if (!mimeType.startsWith('image/')) {
        throw new Error(`Not an image: ${mimeType}`);
      } else {
        mimeType = mimeType.split(';')[0].trim();
      }
      
      imageBase64 = imageBuffer.toString('base64');
      
    } catch (err) {
      throw new Error(`Failed to load image from URL: ${err.message}`);
    }
  } else if (fs.existsSync(imagePath)) {
    let imageBuffer = fs.readFileSync(imagePath);
    
    // Détecter SVG par contenu ou extension
    const bufferStart = imageBuffer.toString('utf8', 0, 100);
    const isSvg = imagePath.toLowerCase().endsWith('.svg') ||
                  bufferStart.includes('<svg') ||
                  bufferStart.includes('<?xml');
    
    if (isSvg) {
      console.log('      🔄 Conversion SVG → PNG...');
      try {
        imageBuffer = await convertSvgToPng(imageBuffer);
        mimeType = 'image/png';
      } catch (convError) {
        throw new Error(`SVG détecté mais conversion impossible: ${convError.message}`);
      }
    } else if (imagePath.endsWith('.png')) {
      mimeType = 'image/png';
    } else if (imagePath.endsWith('.webp')) {
      mimeType = 'image/webp';
    } else if (imagePath.endsWith('.jpeg') || imagePath.endsWith('.jpg')) {
      mimeType = 'image/jpeg';
    } else {
      mimeType = 'image/jpeg';
    }
    
    imageBase64 = imageBuffer.toString('base64');
  } else {
    throw new Error(`Image not found: ${imagePath}`);
  }
  
  return { data: imageBase64, mimeType };
}

// ============================================
// NORMALISATION DE TAILLE DU PATCH
// ============================================

async function normalizePatchSize(inputPath, outputPath) {
  try {
    const image = sharp(inputPath);
    const metadata = await image.metadata();
    
    const targetPatchSize = CONFIG.targetPatchSize;  // 1536px (75% de 2048)
    const imageSize = CONFIG.imageSize;              // 2048px
    
    // Lire l'image en raw pour analyser les pixels
    const { data, info } = await image
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    // Trouver les bounds du patch (zone non-blanche)
    // On utilise un seuil plus élevé pour ignorer les ombres légères
    let minX = info.width, maxX = 0, minY = info.height, maxY = 0;
    const threshold = 245; // Pixels très proches du blanc (ignorer ombres légères)
    
    // Compter les pixels non-blancs par ligne/colonne pour être plus robuste
    const rowCounts = new Array(info.height).fill(0);
    const colCounts = new Array(info.width).fill(0);
    
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const idx = (y * info.width + x) * info.channels;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        // Si le pixel n'est pas blanc/presque blanc
        if (r < threshold || g < threshold || b < threshold) {
          rowCounts[y]++;
          colCounts[x]++;
        }
      }
    }
    
    // Trouver les limites en ignorant les lignes/colonnes avec peu de pixels
    // (ça élimine les ombres légères et le bruit)
    const minPixelsThreshold = Math.min(info.width, info.height) * 0.02; // 2% minimum
    
    for (let y = 0; y < info.height; y++) {
      if (rowCounts[y] > minPixelsThreshold) {
        if (y < minY) minY = y;
        maxY = y;
      }
    }
    
    for (let x = 0; x < info.width; x++) {
      if (colCounts[x] > minPixelsThreshold) {
        if (x < minX) minX = x;
        maxX = x;
      }
    }
    
    // Vérifier qu'on a trouvé quelque chose
    if (minX >= maxX || minY >= maxY) {
      console.log(`      ⚠️ Impossible de détecter le patch, copie sans modification`);
      fs.copyFileSync(inputPath, outputPath);
      return false;
    }
    
    // Calculer la taille actuelle du patch
    const patchWidth = maxX - minX + 1;
    const patchHeight = maxY - minY + 1;
    const currentPatchSize = Math.max(patchWidth, patchHeight);
    
    // Si la taille est déjà proche de la cible (±10%), ne pas modifier
    const tolerance = 0.10;
    if (Math.abs(currentPatchSize - targetPatchSize) / targetPatchSize < tolerance) {
      console.log(`      📏 Taille OK: ${currentPatchSize}px (cible: ${targetPatchSize}px)`);
      fs.copyFileSync(inputPath, outputPath);
      return true;
    }
    
    // Calculer le scaling pour atteindre la taille cible
    const scale = targetPatchSize / currentPatchSize;
    
    // Extraire le patch, le redimensionner, puis le recentrer sur fond blanc
    const padding = 20; // Petite marge autour du patch extrait
    const extractX = Math.max(0, minX - padding);
    const extractY = Math.max(0, minY - padding);
    const extractW = Math.min(info.width - extractX, patchWidth + padding * 2);
    const extractH = Math.min(info.height - extractY, patchHeight + padding * 2);
    
    // Nouvelle taille du patch après scaling
    const newPatchSize = Math.round(currentPatchSize * scale);
    
    await sharp(inputPath)
      .extract({ left: extractX, top: extractY, width: extractW, height: extractH })
      .resize(Math.round(extractW * scale), Math.round(extractH * scale), {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .extend({
        top: Math.round((imageSize - Math.round(extractH * scale)) / 2),
        bottom: Math.round((imageSize - Math.round(extractH * scale)) / 2),
        left: Math.round((imageSize - Math.round(extractW * scale)) / 2),
        right: Math.round((imageSize - Math.round(extractW * scale)) / 2),
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .resize(imageSize, imageSize, {
        fit: 'cover',
        position: 'centre'
      })
      .toFile(outputPath);
    
    console.log(`      📏 Patch normalisé: ${currentPatchSize}px → ${targetPatchSize}px (scale: ${scale.toFixed(2)}x)`);
    return true;
    
  } catch (error) {
    console.error(`      ⚠️ Normalisation échouée: ${error.message}`);
    // En cas d'erreur, on copie simplement le fichier
    fs.copyFileSync(inputPath, outputPath);
    return false;
  }
}

// ============================================
// EXTRACTION DE COULEURS (5 couleurs dominantes)
// ============================================

async function extractColors(logoPath) {
  try {
    const model = genAI.getGenerativeModel({ model: 'models/gemini-2.5-flash' });
    
    const image = await loadImageAsBase64(logoPath);
    
    const prompt = `Analyze this logo and extract its colors.

Return ONLY a JSON object with:
- "dominantColor": the MAIN/PRIMARY color of the logo in hex format (e.g., "#FF0000")
- "colors": an array of the 5 most dominant/prominent colors in the logo, in hex format, ordered by prominence

Example response (JSON only, no markdown, no backticks):
{"dominantColor": "#FF0000", "colors": ["#FF0000", "#0000FF", "#FFFFFF", "#000000", "#FFFF00"]}

Important: 
- Include the actual colors visible in the logo
- Do NOT include white (#FFFFFF) or very light colors if they are just background
- Do NOT include black (#000000) if it's just outline/border
- Focus on the meaningful brand colors`;

    const result = await model.generateContent([
      { inlineData: { data: image.data, mimeType: image.mimeType } },
      prompt
    ]);
    
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Nettoyer et valider les couleurs
      let extractedColors = parsed.colors || [];
      
      // S'assurer qu'on a bien des hex valides
      extractedColors = extractedColors
        .filter(c => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c))
        .slice(0, 5);
      
      // Ajouter la couleur dominante si pas déjà présente
      if (parsed.dominantColor && !extractedColors.includes(parsed.dominantColor)) {
        extractedColors.unshift(parsed.dominantColor);
      }
      
      console.log(`   → Couleurs extraites: ${extractedColors.join(', ')}`);
      
      return {
        backgroundColor: '#FFFFFF',
        borderColor: parsed.dominantColor || '#000000',
        extractedColors: extractedColors
      };
    }
    
    return { 
      backgroundColor: '#FFFFFF', 
      borderColor: '#000000',
      extractedColors: []
    };
    
  } catch (error) {
    console.error('Erreur extraction couleurs:', error.message);
    return { 
      backgroundColor: '#FFFFFF', 
      borderColor: '#000000',
      extractedColors: []
    };
  }
}

// ============================================
// GÉNÉRATION D'IMAGES
// ============================================

async function generateImage(prompt, referenceImagePaths, outputPath, forceSquare = true, normalizeSize = false) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: 'models/gemini-2.5-flash-image',
      generationConfig: {
        responseModalities: ['image', 'text'],
      }
    });
    
    const parts = [];
    
    for (const imgPath of referenceImagePaths) {
      try {
        const image = await loadImageAsBase64(imgPath);
        parts.push({ inlineData: { data: image.data, mimeType: image.mimeType } });
      } catch (e) {
        console.log(`      ⚠️ Image non trouvée: ${imgPath}`);
      }
    }
    
    const finalPrompt = `${prompt}

CRITICAL OUTPUT REQUIREMENTS:
- Image MUST be perfectly SQUARE (1:1 aspect ratio)
- Resolution: 2048x2048 pixels
- Product centered with 10-15% white/neutral margin on all sides
- No letterboxing, no black bars, no cropping
- Clean e-commerce ready composition`;
    
    parts.push(finalPrompt);
    
    const result = await model.generateContent(parts);
    const response = result.response;
    
    if (response.candidates && response.candidates[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          const tempPath = outputPath.replace('.webp', '_temp.png');
          const imageBuffer = Buffer.from(part.inlineData.data, 'base64');
          fs.writeFileSync(tempPath, imageBuffer);
          
          // ✅ Normalisation de la taille du patch si demandé
          if (normalizeSize) {
            const normalizedPath = outputPath.replace('.webp', '_normalized.png');
            await normalizePatchSize(tempPath, normalizedPath);
            // Remplacer le temp par le normalized
            fs.unlinkSync(tempPath);
            fs.renameSync(normalizedPath, tempPath);
          }
          
          const webpPath = outputPath.endsWith('.webp') ? outputPath : outputPath.replace(/\.[^.]+$/, '.webp');
          const converted = await convertToWebP(tempPath, webpPath);
          
          if (converted) {
            console.log(`      ✅ ${path.basename(webpPath)}`);
            return webpPath;
          }
          return false;
        }
      }
    }
    
    return false;
    
  } catch (error) {
    console.error('Erreur génération:', error.message);
    return false;
  }
}

// ============================================
// PROMPTS - Optimisés pour consistance
// ============================================

const PROMPTS = {
  patchSeul: (backgroundColor, borderColor) => `
Generate a HIGH RESOLUTION product photograph (2048x2048 pixels, 1:1 square ratio).

YOU HAVE 1 REFERENCE IMAGE:
- REFERENCE IMAGE 1: The CLUB LOGO to embroider

YOUR TASK: Create a hyper-realistic photograph of a MACHINE-EMBROIDERED fabric patch.

===== CRITICAL: THIS IS EMBROIDERY, NOT PRINT =====
This patch is made with REAL EMBROIDERY THREADS sewn into fabric.
It is NOT a printed image. It is NOT a sticker. It is NOT digital art.
The entire surface must show THREAD TEXTURE like a real embroidered patch you can buy.

===== MANDATORY COLORS - DO NOT CHANGE =====
- PATCH BORDER COLOR: ${borderColor} (THIS IS MANDATORY - do NOT use green, do NOT use any other color)
- PATCH BACKGROUND FABRIC: ${backgroundColor} (THIS IS MANDATORY - usually white)
- LOGO COLORS: Use the exact same colors as shown in the reference logo

EMBROIDERY THREAD TEXTURE (MANDATORY):
- Every colored area must show INDIVIDUAL THREAD LINES running parallel
- Satin stitch: Tight parallel threads for borders, text, and thin lines
- Fill stitch: Dense parallel threads at 45° angle for large solid areas
- The threads must have subtle 3D RELIEF - they sit ABOVE the fabric surface
- Show realistic THREAD SHINE - embroidery threads are slightly glossy
- Threads should show micro-variations in direction

PATCH CONSTRUCTION:
- Shape: PERFECT SQUARE patch with SHARP 90-degree corners
- Border: 4mm wide satin stitch border in ${borderColor} - NOT GREEN, use ${borderColor}
- Background fabric: ${backgroundColor} twill weave - visible texture
- The logo is INSIDE the square patch, surrounded by the border
- IMPORTANT: Even if the logo has its own shape (shield, circle, crest), it must be PLACED INSIDE the square patch
- The square patch frame with ${borderColor} border is ALWAYS visible around the logo
- Do NOT make the patch shape match the logo shape - the patch is ALWAYS a square

SIZE REQUIREMENTS:
- The SQUARE PATCH occupies EXACTLY 75% of the image width
- Perfectly centered with equal white margins on all sides
- The logo inside the patch fills 75-80% of the patch interior

LOGO REPRODUCTION:
- Recreate the logo from Reference Image 1 using embroidery techniques
- Same shapes, same colors, same proportions as the original
- Rendered as STITCHED THREADS, not flat print
- Logo fills 75-80% of the patch interior

PHOTOGRAPHY STYLE:
- Pure white seamless background (#FFFFFF)
- Soft shadow underneath (bottom-right, 15% opacity)
- Studio lighting that reveals the 3D thread texture
- Tack-sharp focus on thread details

REMEMBER: Border color is ${borderColor}, NOT green. Background is ${backgroundColor}.
`.trim(),

  patchCasquette: (backgroundColor, borderColor) => `
Generate a HIGH RESOLUTION product photograph (2048x2048 pixels, 1:1 square ratio).

TASK: Place the embroidered patch from the first reference image onto the cap from the second reference image.

REQUIREMENTS:
- The patch MUST be placed on the front center of the cap, replacing/covering the black velcro area
- Patch must maintain its EXACT appearance from image 1: same logo, same ${borderColor} border, same ${backgroundColor} background
- Patch should look naturally attached to the cap with proper perspective
- Realistic shadows and fabric integration

COMPOSITION:
- Cap centered in frame
- 10-15% white margin around
- Professional product photography lighting
`.trim(),

  patchDetail: (backgroundColor, borderColor) => `
Generate a HIGH RESOLUTION macro photograph (2048x2048 pixels, 1:1 square ratio).

EXTREME CLOSE-UP MACRO SHOT of the embroidered patch from the reference image.

SHOW:
- Zoom 400-500% on a portion of the embroidered logo
- Individual thread fibers and stitch patterns clearly visible
- Fabric texture at high detail level
- The ${borderColor} border stitching if visible in frame
- The ${backgroundColor} fabric background texture

PHOTOGRAPHY:
- Sharp macro focus
- Professional macro lighting
- Centered composition with 10-15% margin
`.trim(),

  patchMultitude: (backgroundColor, borderColor) => `
Generate a HIGH RESOLUTION flat lay photograph (2048x2048 pixels, 1:1 square ratio).

YOU HAVE 2 REFERENCE IMAGES:
REFERENCE IMAGE 1: The BASE PATCH TEMPLATE - shows the structure, shape, and layout of a patch (currently has green borders in the template)
REFERENCE IMAGE 2: The EMBROIDERED CLUB LOGO - shows the specific club's logo already in embroidered style with proper colors

YOUR TASK: Create a flat lay composition showing 30-50 IDENTICAL embroidered patches that combine both references.

HOW TO CONSTRUCT EACH PATCH (CRITICAL):
1. Take the SHAPE and STRUCTURE from Reference Image 1 (the base patch template)
2. Take the LOGO DESIGN from Reference Image 2 (the embroidered club logo)
3. Replace the green border with ${borderColor}
4. Use ${backgroundColor} as the fabric background (ensure good contrast with the logo)
5. The logo must be embroidered style, centered, filling 75-80% of the patch interior

CRITICAL - CONSISTENCY:
- ALL 30-50 patches must be IDENTICAL - exact same logo, colors, size, proportions
- Use the club logo from Reference Image 2 EXACTLY as shown
- Do NOT modify, simplify, or reinterpret the logo design
- Every patch is the same product, just arranged at different angles

PATCH SPECIFICATIONS:
- Perfect square shape with SHARP 90-degree corners (like Reference Image 1)
- Thick embroidered satin stitch border in ${borderColor}, 4mm width
- Background fabric in ${backgroundColor} with realistic twill texture
- Logo from Reference Image 2, embroidered style, properly centered

COMPOSITION & LAYOUT:
- 30-50 patches arranged in the frame
- Patches overlapping and stacked organically (like a pile/heap of patches)
- Various rotation angles (0° to 360°) for natural, casual arrangement
- Some patches fully visible, others partially covered by patches on top
- Create depth with natural layering and shadows between patches
- All patches should be in focus (no blur)

LIGHTING & BACKGROUND:
- Soft neutral beige/cream background visible between patches
- Professional flat lay lighting from above
- Realistic shadows between overlapping patches for depth
- Even illumination across the entire composition

REMEMBER: You're combining the STRUCTURE of Reference Image 1 with the LOGO from Reference Image 2, then creating 30-50 copies with updated colors (${borderColor} border, ${backgroundColor} background).
`.trim(),

  patchDos: (borderColor) => `
Generate a HIGH RESOLUTION product photograph (2048x2048 pixels, 1:1 square ratio).

SCENE: The BACK side of a square embroidered patch, showing the velcro attachment.

PATCH BACK SPECIFICATIONS:
- Square shape with ${borderColor} embroidered border visible from behind
- BLACK hook velcro covering the entire back surface
- Velcro texture clearly visible and realistic
- Professional stitching visible on edges

BACKGROUND: Use the reference image background (bicolor: beige top, terracotta/red bottom)

COMPOSITION:
- Patch centered with 10-15% margin
- Slightly angled to show velcro texture
- Professional product photography lighting
`.trim()
};

// ============================================
// GÉNÉRATION COMPLÈTE POUR UN CLUB
// ============================================

export async function generateClubVisuals(club) {
  const clubId = club.name.toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 50);
  
  const outputDir = path.join(CONFIG.outputDir, clubId);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  console.log(`\n🎨 Génération visuels: ${club.name}`);
  console.log(`   📐 Format: ${CONFIG.imageSize}x${CONFIG.imageSize}px WebP`);
  console.log(`   📏 Taille patch normalisée: ${CONFIG.targetPatchSize}px`);
  
  if (!club.logoHD && !club.logo?.startsWith('http')) {
    throw new Error('Aucun logo HD disponible');
  }
  
  const logoPath = club.logoHD || club.logo;
  
  try {
    await loadImageAsBase64(logoPath);
    console.log('   📸 Logo HD validé');
  } catch (err) {
    throw new Error(`Logo HD invalide: ${err.message}`);
  }
  
  // Extraire les couleurs (5 couleurs dominantes)
  console.log('   📊 Extraction couleurs...');
  const colors = await extractColors(logoPath);
  console.log(`   → Background: ${colors.backgroundColor}, Bordure: ${colors.borderColor}`);
  
  const results = {
    clubId,
    clubName: club.name,
    colors,
    extractedColors: colors.extractedColors || [],
    images: {}
  };
  
  // 1. Patch seul - SANS RÉFÉRENCE patch_base (cause des hallucinations de couleur)
  console.log('   1️⃣ Patch seul...');
  const patch1 = path.join(outputDir, '1_patch_seul.webp');
  const result1 = await generateImage(
    PROMPTS.patchSeul(colors.backgroundColor, colors.borderColor), 
    [logoPath],  // ✅ Seulement le logo, pas de patch_base
    patch1,
    true,
    true  // ✅ Normalisation de taille activée
  );
  if (result1) {
    results.images.patchSeul = result1;
  }
  await delay(CONFIG.delayBetweenGenerations);
  
  // 2. Patch sur casquette
  console.log('   2️⃣ Patch sur casquette...');
  const patch2 = path.join(outputDir, '2_patch_casquette.webp');
  const patchSeulPath = results.images.patchSeul || logoPath;
  const result2 = await generateImage(
    PROMPTS.patchCasquette(colors.backgroundColor, colors.borderColor), 
    [patchSeulPath, CONFIG.referenceImages.casquette], 
    patch2
  );
  if (result2) {
    results.images.patchCasquette = result2;
  }
  await delay(CONFIG.delayBetweenGenerations);
  
  // 3. Détail zoomé
  console.log('   3️⃣ Détail zoomé...');
  const patch3 = path.join(outputDir, '3_patch_detail.webp');
  const result3 = await generateImage(
    PROMPTS.patchDetail(colors.backgroundColor, colors.borderColor), 
    [patchSeulPath], 
    patch3
  );
  if (result3) {
    results.images.patchDetail = result3;
  }
  await delay(CONFIG.delayBetweenGenerations);
  
  // 4. Multitude (30-50 patches)
  console.log('   4️⃣ Multitude de patchs (30-50)...');
  const patch4 = path.join(outputDir, '4_patch_multitude.webp');
  const result4 = await generateImage(
    PROMPTS.patchMultitude(colors.backgroundColor, colors.borderColor), 
    [CONFIG.referenceImages.patchBase, patchSeulPath], 
    patch4
  );
  if (result4) {
    results.images.patchMultitude = result4;
  }
  await delay(CONFIG.delayBetweenGenerations);
  
  // 5. Dos velcro
  console.log('   5️⃣ Dos velcro...');
  const patch5 = path.join(outputDir, '5_patch_dos.webp');
  const result5 = await generateImage(
    PROMPTS.patchDos(colors.borderColor), 
    [CONFIG.referenceImages.dosVelcro, logoPath], 
    patch5
  );
  if (result5) {
    results.images.patchDos = result5;
  }
  
  // Sauvegarder les métadonnées
  const metaPath = path.join(outputDir, 'metadata.json');
  fs.writeFileSync(metaPath, JSON.stringify(results, null, 2));
  
  const successCount = Object.keys(results.images).length;
  console.log(`   📦 ${successCount}/5 images générées (WebP ${CONFIG.imageSize}px)`);
  console.log(`   🎨 ${results.extractedColors.length} couleurs logo extraites`);
  
  return results;
}

// ============================================
// TEST
// ============================================

async function testGeneration() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         PPATCH - TEST GÉNÉRATION VISUELS                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  const progressFile = path.join(__dirname, '../../data/scraped/progress.json');
  
  let testClub;
  
  if (fs.existsSync(progressFile)) {
    const progress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    if (progress.clubs && progress.clubs.length > 0) {
      testClub = progress.clubs[0];
      console.log(`\n📂 Premier club scrapé trouvé: ${testClub.name}`);
    }
  }
  
  if (!testClub) {
    console.log('\n⚠️  Aucun club scrapé trouvé, utilisation du club test');
    testClub = {
      name: 'Toulouse FC',
      logo: 'https://img.besport.com/96/T_rkUn6CRuPJgmOaetaWrWU3HlA',
      commune: 'Toulouse',
      departement: 31,
      sport: 'Football'
    };
  }
  
  console.log(`\n🎯 Club: ${testClub.name}`);
  console.log(`   Logo: ${testClub.logo || testClub.logoHD}`);
  console.log(`   Sport: ${testClub.sport}`);
  console.log(`   Commune: ${testClub.commune}`);
  
  const results = await generateClubVisuals(testClub);
  
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    RÉSUMÉ                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`Club: ${results.clubName}`);
  console.log(`Couleurs: BG=${results.colors.backgroundColor}, Border=${results.colors.borderColor}`);
  console.log(`Couleurs logo extraites: ${results.extractedColors.join(', ')}`);
  console.log(`Images générées: ${Object.keys(results.images).length}/5`);
  Object.entries(results.images).forEach(([key, path]) => {
    console.log(`   ✅ ${key}: ${path}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  testGeneration().catch(console.error);
}

export { extractColors, PROMPTS };