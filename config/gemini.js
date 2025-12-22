import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

let client;

export const initializeGemini = () => {
  try {
    client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    console.log('Gemini API initialized');
    return client;
  } catch (error) {
    console.error('Gemini init error:', error.message);
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
    console.log('Raw response:', responseText);

    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }

    const colors = JSON.parse(jsonMatch[0]);
    console.log('Colors extracted:', colors);

    return {
      background_options: colors.slice(0, 3),
      border_options: colors.slice(2, 5),
    };
  } catch (error) {
    console.error('Color extraction error:', error.message);
    throw new Error('Failed to extract colors: ' + error.message);
  }
};

export const generatePatchImage = async (logoBase64, backgroundColor, borderColor) => {
  try {
    if (!client) {
      initializeGemini();
    }

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

    const imagePart = result.response.candidates[0].content.parts.find(
      (p) => p.inlineData
    );

    if (!imagePart || !imagePart.inlineData || !imagePart.inlineData.data) {
      throw new Error('No image data returned by Gemini');
    }

    const base64Image = imagePart.inlineData.data;
    const dataUrl = `data:image/png;base64,${base64Image}`;

    console.log('Patch image generated');
    return dataUrl;
  } catch (error) {
    console.error('Patch generation error:', error.message);
    throw new Error('Failed to generate patch: ' + error.message);
  }
};

    // Récupérer la partie image générée
    const imagePart = result.response.candidates[0].content.parts.find(
      (p) => p.inlineData
    );

    if (!imagePart || !imagePart.inlineData || !imagePart.inlineData.data) {
      throw new Error('No image data returned by Gemini');
    }

    const base64Image = imagePart.inlineData.data; // déjà base64
    const dataUrl = `data:image/png;base64,${base64Image}`;

    console.log('Patch image generated');
    return dataUrl;
  } catch (error) {
    console.error('Patch generation error:', error.message);
    throw new Error('Failed to generate patch: ' + error.message);
  }
};

export const getGeminiClient = () => client;
