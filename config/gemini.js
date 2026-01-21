import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

let client;

export const initializeGemini = () => {
  try {
    client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    console.log('✅ Gemini API initialized');
    return client;
  } catch (error) {
    console.error('❌ Gemini init error:', error.message);
    throw error;
  }
};

export const extractDominantColors = async (imageBase64) => {
  try {
    if (!client) {
      initializeGemini();
    }

    const model = client.getGenerativeModel({ model: 'models/gemini-2.5-flash' });

    const prompt =
      'Analyze this image and extract the 5 most dominant colors. ' +
      'Return ONLY a JSON array of hex colors. Example: ["#FF5733","#2E86AB","#A23B72","#F18F01","#C73E1D"].';

    const response = await model.generateContent([
      {
        inlineData: {
          data: imageBase64,
          mimeType: 'image/png',
        },
      },
      prompt,
    ]);

    let responseText = response.response.text().trim();
    console.log('📊 Raw response:', responseText);

    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }

    const colors = JSON.parse(jsonMatch[0]);
    console.log('🎨 Colors extracted:', colors);

    return {
      background_options: colors.slice(0, 3),
      border_options: colors.slice(2, 5),
    };
  } catch (error) {
    console.error('❌ Color extraction error:', error.message);
    throw new Error('Failed to extract colors: ' + error.message);
  }
};

/**
 * Détecter le nom du club/équipe/marque à partir d'un logo
 * @param {string} imageBase64 - Image en base64
 * @returns {Promise<{name: string, confidence: string}>}
 */
export const detectLogoName = async (imageBase64) => {
  try {
    if (!client) {
      initializeGemini();
    }

    const model = client.getGenerativeModel({ model: 'models/gemini-2.5-flash' });

    const prompt = `Analyze this logo image and try to identify the organization name (sports club, team, company, association, etc.).

Look for:
- Text written on the logo
- Known sports club emblems (football, rugby, basketball, etc.)
- Brand or company logos
- Association or organization symbols

Return ONLY a JSON object with this exact format:
{
  "name": "Detected Name Here",
  "confidence": "high" | "medium" | "low" | "none"
}

Rules:
- If you can clearly read text or recognize the organization, confidence is "high"
- If you can partially read or make an educated guess, confidence is "medium"  
- If you're unsure but have a guess, confidence is "low"
- If you cannot identify any name, return {"name": "", "confidence": "none"}
- Return the name in its original language (French club names stay French)
- Don't add generic words like "FC", "Club", "Team" if they're not in the original
- Keep the name concise (e.g., "US Valcourt" not "Union Sportive de Valcourt Football Club")`;

    const response = await model.generateContent([
      {
        inlineData: {
          data: imageBase64,
          mimeType: 'image/png',
        },
      },
      prompt,
    ]);

    let responseText = response.response.text().trim();
    console.log('🔍 Logo detection raw response:', responseText);

    // Extraire le JSON de la réponse
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('⚠️ No JSON found in logo detection response');
      return { name: '', confidence: 'none' };
    }

    const result = JSON.parse(jsonMatch[0]);
    console.log('🏷️ Logo name detected:', result);

    return {
      name: result.name || '',
      confidence: result.confidence || 'none'
    };

  } catch (error) {
    console.error('❌ Logo name detection error:', error.message);
    // Ne pas faire échouer le flow, retourner vide
    return { name: '', confidence: 'none' };
  }
};

/**
 * Générer le prompt selon la forme sélectionnée
 * VERSION AMÉLIORÉE avec instructions pour format carré et détails broderie
 * + SUPPORT COMMENTAIRE UTILISATEUR pour regénération V2
 * 
 * @param {string} shape - Forme du patch
 * @param {string} backgroundColor - Couleur de fond
 * @param {string} borderColor - Couleur de bordure
 * @param {string} userComment - Commentaire optionnel de l'utilisateur pour améliorer la génération
 * @returns {string} - Prompt pour Gemini
 */
const getShapePrompt = (shape, backgroundColor, borderColor, userComment = '') => {
  // ============================================
  // SÉLECTEUR DE FORMES
  // ============================================
  const shapeDescriptions = {
    'square': {
      shape: 'Square',
      description: 'perfectly square embroidered patch with equal sides, 1:1 aspect ratio'
    },
    'logo_shape': {
      shape: 'Custom contour',
      description: 'embroidered patch that follows the exact contour/outline shape of the input logo, cut precisely around the logo edges'
    },
    'circle': {
      shape: 'Circular/Round',
      description: 'perfectly round circular embroidered patch'
    },
    'rectangle_h': {
      shape: 'Horizontal rectangle',
      description: 'horizontal rectangular embroidered patch, wider than tall (landscape orientation)'
    },
    'rectangle_v': {
      shape: 'Vertical rectangle',
      description: 'vertical rectangular embroidered patch, taller than wide (portrait orientation)'
    },
    'shield': {
      shape: 'Shield/Crest',
      description: 'traditional shield/crest/blazon shaped embroidered patch, like a classic sports team badge'
    }
  };

  const shapeInfo = shapeDescriptions[shape] || shapeDescriptions['square'];

  // ============================================
  // PROMPT DE BASE
  // ============================================
  let prompt = `Create a realistic ${shapeInfo.description} based on the input logo.

CRITICAL REQUIREMENTS:
- Output image MUST be SQUARE format (1:1 aspect ratio, same width and height)
- The patch must be CENTERED in the square image
- Leave some margin/padding around the patch edges

PATCH SPECIFICATIONS:
- Shape: ${shapeInfo.shape}
- Background fill: ${backgroundColor} (solid fabric texture with embroidery fill stitches)
- Border: Thick satin stitch border in ${borderColor} (3-4mm wide, clean edges)
- The input logo must be faithfully reproduced with realistic embroidery thread texture

EMBROIDERY STYLE:
- Realistic thread texture with visible individual stitches
- Satin stitch for borders and text
- Fill stitch for large colored areas
- Proper thread direction following the contours
- Slight 3D relief effect typical of embroidered patches

PHOTOGRAPHY STYLE:
- Clean white or light gray background
- Professional product photography
- Soft studio lighting with subtle shadows
- High resolution, sharp details
- Patch photographed from directly above (flat lay)

DO NOT:
- Add extra text or elements not in the original logo
- Distort or stretch the logo
- Make the patch too small in the frame
- Add excessive decorative elements`;

  // ============================================
  // AJOUT COMMENTAIRE UTILISATEUR (pour V2, V3...)
  // ============================================
  if (userComment && userComment.trim()) {
    prompt += `

USER FEEDBACK FOR IMPROVEMENT:
The user has requested the following modifications for this version:
"${userComment.trim()}"

Please take this feedback into account and adjust the patch design accordingly.`;
    
    console.log('📝 User comment added to prompt:', userComment.trim());
  }

  return prompt;
};

/**
 * Générer une image de patch brodé
 * 
 * @param {string} logoBase64 - Logo en base64
 * @param {string} backgroundColor - Couleur de fond
 * @param {string} borderColor - Couleur de bordure
 * @param {string} shape - Forme du patch
 * @param {string} userComment - Commentaire optionnel pour améliorer la génération
 * @returns {Promise<string>} - Image générée en base64
 */
export const generatePatchImage = async (logoBase64, backgroundColor, borderColor, shape = 'square', userComment = '') => {
  try {
    // MODE MOCK pour tests
    if (process.env.USE_MOCK_GENERATION === 'true') {
      console.log('⚠️  MOCK MODE: Returning original logo as base64');
      return `data:image/png;base64,${logoBase64}`;
    }

    if (!client) {
      initializeGemini();
    }

    console.log('🎨 Generating patch with:', { backgroundColor, borderColor, shape, hasComment: !!userComment });
    console.log('📏 Input logo size:', logoBase64.length, 'chars');
    
    if (userComment) {
      console.log('💬 User comment:', userComment);
    }

    // ============================================
    // ✅ MODÈLE QUI FONCTIONNE (version décembre)
    // NE PAS CHANGER CE MODÈLE !
    // ============================================
    const model = client.getGenerativeModel({ model: 'models/gemini-2.5-flash-image' });

    // Générer le prompt selon la forme (avec commentaire si présent)
    const prompt = getShapePrompt(shape, backgroundColor, borderColor, userComment);
    console.log('📝 Prompt length:', prompt.length, 'chars');

    const result = await model.generateContent([
      {
        inlineData: {
          data: logoBase64,
          mimeType: 'image/png',
        },
      },
      prompt,
    ]);

    console.log('🔍 Gemini response received');
    console.log('🔍 Response structure:', JSON.stringify(result.response, null, 2).substring(0, 500));

    // Vérifier la structure de la réponse
    if (!result.response || !result.response.candidates || !result.response.candidates[0]) {
      console.error('❌ Invalid response structure:', result.response);
      throw new Error('Invalid response structure from Gemini');
    }

    const candidate = result.response.candidates[0];
    console.log('🔍 Candidate content:', JSON.stringify(candidate.content, null, 2).substring(0, 500));

    const imagePart = candidate.content.parts.find((p) => p.inlineData);

    if (!imagePart || !imagePart.inlineData || !imagePart.inlineData.data) {
      console.error('❌ No image data in response');
      console.error('Parts:', JSON.stringify(candidate.content.parts, null, 2));
      throw new Error('No image data returned by Gemini');
    }

    const base64Image = imagePart.inlineData.data;
    console.log('📏 Generated image size:', base64Image.length, 'chars');
    console.log('🔍 Image data starts with:', base64Image.substring(0, 50));

    // Vérifier que c'est bien du base64 valide
    if (base64Image.length < 100) {
      throw new Error('Generated image data too short: ' + base64Image.length);
    }

    // Vérifier le format
    const base64Regex = /^[A-Za-z0-9+/=]+$/;
    if (!base64Regex.test(base64Image.substring(0, 100))) {
      throw new Error('Invalid base64 format');
    }

    console.log('✅ Patch image generated successfully');

    // ✅ Retourner juste le base64 (sans préfixe data:image/png)
    return base64Image;
  } catch (error) {
    console.error('❌ Patch generation error:', error.message);
    console.error('❌ Error stack:', error.stack);
    throw new Error('Failed to generate patch: ' + error.message);
  }
};
