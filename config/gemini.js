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

export const generatePatchImage = async (logoBase64, backgroundColor, borderColor) => {
  try {
    // MODE MOCK pour tests
    if (process.env.USE_MOCK_GENERATION === 'true') {
      console.log('⚠️  MOCK MODE: Returning original logo as base64');
      return `data:image/png;base64,${logoBase64}`;
    }

    if (!client) {
      initializeGemini();
    }

    console.log('🎨 Generating patch with:', { backgroundColor, borderColor });
    console.log('📏 Input logo size:', logoBase64.length, 'chars');

    const model = client.getGenerativeModel({ model: 'models/gemini-2.5-flash-image' });

    const prompt = `
Front view of a square embroidered fabric patch on a pure white background.
The patch has thick satin-stitched borders (bourdon stitch) in this color: ${borderColor}.
The main fabric background of the patch is this color: ${backgroundColor}.
Inside the square, the input logo is recreated with realistic embroidery thread texture and stitching, not flat print.
Photorealistic product shot, studio lighting, sharp details, no extra text, no additional graphics, high resolution.
`;

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

    const dataUrl = `data:image/png;base64,${base64Image}`;
    console.log('✅ Patch image generated successfully');

    return dataUrl;
  } catch (error) {
    console.error('❌ Patch generation error:', error.message);
    console.error('❌ Error stack:', error.stack);
    throw new Error('Failed to generate patch: ' + error.message);
  }
};
