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
    
    const prompt = `Analyze this image and extract the 5 most dominant colors. 
For each color, provide:
1. The hex color code (e.g., #FF5733)
2. Whether it's suitable for background (bright) or border (dark/saturated)

Return ONLY valid JSON, no markdown, no extra text:
{
  "background_options": ["#FFFFFF", "#F0F0F0", ...],
  "border_options": ["#000000", "#333333", ...],
  "dominant_colors": ["#...", "#...", ...]
}`;

    const response = await model.generateContent([
      {
        inlineData: {
          mimeType: 'image/png',
          data: base64Image,
        },
      },
      prompt,
    ]);

    const text = response.response.text();
    console.log('📝 Raw response:', text);

    // Parse JSON - remove markdown if present
    let jsonText = text;
    if (text.includes('```
      jsonText = text.split('```json').split('```
    } else if (text.includes('```')) {
      jsonText = text.split('``````')[0];
    }
    
    const colors = JSON.parse(jsonText.trim());
    
    return {
      success: true,
      background_options: colors.background_options || ['#FFFFFF', '#F0F0F0', '#E8E8E8'],
      border_options: colors.border_options || ['#000000', '#333333', '#666666'],
    };
  } catch (error) {
    console.error('❌ Color extraction error:', error.message);
    throw new Error(`Failed to extract colors: ${error.message}`);
  }
}

export async function generatePatchImage(options) {
  try {
    console.log('🎨 Generating patch image...');
    
    const model = genAI.getGenerativeModel({ model: 'models/gemini-2.5-flash-image' });
    
    const prompt = `Create a professional embroidered patch design with these specifications:
- Background color: ${options.background_color}
- Border/thread color: ${options.border_color}
- Style: Professional embroidered patch, realistic stitching
- Size: Square, 512x512px
- White background for the preview

Generate a realistic embroidered patch that would look like a professional product photo.`;

    const response = await model.generateContent(prompt);
    
    const imageData = response.response.candidates[0].content.parts[0].inlineData.data;
    return {
      success: true,
      image_url: `data:image/png;base64,${imageData}`,
    };
  } catch (error) {
    console.error('❌ Image generation error:', error.message);
    throw new Error(`Failed to generate patch: ${error.message}`);
  }
}
