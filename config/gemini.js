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

    const prompt = 'Analyze this image and extract the 5 most dominant colors. Return ONLY these 5 hex colors as a JSON array. Nothing else. No explanation. Example format: ["#FF5733","#2E86AB","#A23B72","#F18F01","#C73E1D"]';

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
    
    console.log('Raw Gemini response:', responseText);
    
    // Clean up the response - remove markdown code blocks
    if (responseText.includes('```
      responseText = responseText.split('```json').split('```
    } else if (responseText.includes('```')) {
      responseText = responseText.split('``````')[0].trim();
    }
    
    // Extract JSON array if wrapped in text
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      responseText = jsonMatch[0];
    }
    
    const colors = JSON.parse(responseText);
    
    console.log('Extracted colors:', colors);
    
    // Return object with background and border options
    return {
      background_options: colors.slice(0, 3),
      border_options: colors.slice(2, 5)
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

    const prompt = 'Design an embroidered patch. Background: ' + backgroundColor + '. Border: ' + borderColor + '. Square format, professional style, production-ready.';

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
    
    console.log('Patch image generated');
    
    return responseText;
  } catch (error) {
    console.error('Patch generation error:', error.message);
    throw new Error('Failed to generate patch: ' + error.message);
  }
};

export const getGeminiClient = () => client;
