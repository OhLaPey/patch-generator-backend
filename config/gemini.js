import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  throw new Error('GOOGLE_API_KEY not set in environment variables');
}

const genAI = new GoogleGenerativeAI(apiKey);

export async function extractDominantColors(base64Image) {
  try {
    console.log('🎨 Extracting colors from image...');
    
    const model = genAI.getGenerativeModel({ model: 'models/gemini-2.5-flash' });
    
    const prompt = 'Analyze this image and extract the 5 most dominant colors. Return ONLY valid JSON with background_options and border_options arrays. Example: {"background_options": ["#FFFFFF", "#F0F0F0"], "border_options": ["#000000", "#333333"]}';

    const response = await model.generateContent([
      {
        inlineData: {
          mimeType: 'image/png',
          data: base64Image,
        },
      },
      prompt,
    ]);

    const text = response.response.text().trim();
    console.log('📝 Raw response:', text);

    let jsonText = text;
    
    // Remove markdown code blocks if present
    if (text.includes('```
      jsonText = text.split('```json').split('```
    } else if (text.includes('```')) {
      jsonText = text.split('``````')[0].trim();
    }
    
    const colors = JSON.parse(jsonText);
    
    return {
      success: true,
      background_options: colors.background_options || ['#FFFFFF', '#F0F0F0', '#E8E8E8'],
      border_options: colors.border_options || ['#000000', '#333333', '#666666'],
    };
  } catch (error) {
    console.error('❌ Color extraction error:', error.message);
    throw new Error('Failed to extract colors: ' + error.message);
  }
}

export async function generatePatchImage(options) {
  try {
    console.log('🎨 Generating patch image...');
    
    const model = genAI.getGenerativeModel({ model: 'models/gemini-2.5-flash-image' });
    
    const prompt = 'Create a professional embroidered patch design. Background color: ' + options.background_color + '. Border/thread color: ' + options.border_color + '. Style: Professional embroidered patch with realistic stitching. Size: Square 512x512px. White background for preview.';

    const response = await model.generateContent(prompt);
    
    const imageData = response.response.candidates[0].content.parts[0].inlineData.data;
    return {
      success: true,
      image_url: 'data:image/png;base64,' + imageData,
    };
  } catch (error) {
    console.error('❌ Image generation error:', error.message);
    throw new Error('Failed to generate patch: ' + error.message);
  }
}
