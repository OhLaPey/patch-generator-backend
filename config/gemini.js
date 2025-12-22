import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

let client;

export const initializeGemini = () => {
  try {
    client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    console.log('✅ Google Gemini API initialized');
    return client;
  } catch (error) {
    console.error('❌ Gemini initialization error:', error.message);
    throw error;
  }
};

export const extractDominantColors = async (imageBase64) => {
  try {
    if (!client) {
      initializeGemini();
    }

    const model = client.getGenerativeModel({ model: 'models/gemini-2.5-flash' });

    const prompt = `Analyze this image and extract the 5 most dominant colors. Return ONLY a JSON array with hex color codes, nothing else. Format: ["#FF5733", "#2E86AB", "#A23B72", "#F18F01", "#C73E1D"]`;

    const response = await model.generateContent([
      {
        inlineData: {
          data: imageBase64,
          mimeType: 'image/png',
        },
      },
      prompt,
    ]);

    const responseText = response.response.text();
    
    // Parse the JSON response
    const colors = JSON.parse(responseText);
    
    console.log('✅ Dominant colors extracted:', colors);
    return colors;
  } catch (error) {
    console.error('❌ Color extraction error:', error.message);
    throw new Error(`Failed to extract colors: ${error.message}`);
  }
};

export const generatePatchImage = async (logoBase64, backgroundColor, borderColor) => {
  try {
    if (!client) {
      initializeGemini();
    }

    const model = client.getGenerativeModel({ model: 'models/gemini-2.5-flash-image' });

    const prompt = `You are an expert embroidery patch designer. Generate a perfectly square embroidered patch design with these specifications:

REQUIREMENTS:
- Square format (1:1 aspect ratio) - ideal for embroidery machines
- Background color (solid): ${backgroundColor}
- Border/edging color (embroidered edge): ${borderColor}
- Border width: 3-4mm effect
- Include the provided logo/motif centered in the patch
- Style: Clean, vectorial, crisp lines suitable for embroidery machine
- Resolution: 2K quality (2048x2048 pixels ideal)
- No gradients, no complex patterns
- No text or watermarks
- Make it production-ready for embroidery

The patch should look professional and ready to be embroidered on apparel.`;

    const response = await model.generateContent([
      {
        inlineData: {
          data: logoBase64,
          mimeType: 'image/png',
        },
      },
      prompt,
    ]);

    const responseText = response.response.text();
    
    console.log('✅ Patch image generated via Gemini');
    
    return responseText;
  } catch (error) {
    console.error('❌ Gemini generation error:', error.message);
    throw new Error(`Failed to generate patch image: ${error.message}`);
  }
};

export const getGeminiClient = () => client;
