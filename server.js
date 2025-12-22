import express from 'express';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { initializeGemini, extractDominantColors, generatePatchImage } from './config/gemini.js';

const app = express();
const upload = multer({ dest: '/tmp' });

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));

// Rate limiter
const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '86400000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '5'),
  message: 'Too many patch generations, try again later',
  skip: (req) => !req.path.includes('/generate-patch'),
  keyGenerator: (req) => req.ip || req.connection.remoteAddress,
});

app.use(rateLimiter);

// Initialize Gemini
initializeGemini();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Extraire les couleurs du logo
async function extractColors() {
  if (!uploadedImageBase64) return;

  try {
    console.log('Appel API extract-colors...');
    const res = await fetch(API_URL + '/api/extract-colors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logo: uploadedImageBase64 })
    });

    const data = await res.json();
    console.log('Réponse API:', data);
    
    if (!data.success) {
      console.error('Erreur API:', data.error);
      return;
    }

    // Récupérer les options de couleurs
    const bgColors = data.background_options || [];
    const borderColors = data.border_options || [];

    console.log('Couleurs fond:', bgColors);
    console.log('Couleurs bordure:', borderColors);

    if (bgColors.length > 0) {
      displayColorPalette('ppatch-bg-colors-grid', bgColors, 'bg');
      selectedBgColor = bgColors[0];
    }

    if (borderColors.length > 0) {
      displayColorPalette('ppatch-border-colors-grid', borderColors, 'border');
      selectedBorderColor = borderColors[0];
    }
  } catch (e) {
    console.error('Erreur extraction couleurs:', e);
  }
}


// Generate patch
app.post('/api/generate-patch', async (req, res) => {
  try {
    const { logo, background_color, border_color, email } = req.body;
    
    if (!logo || !background_color || !border_color) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }

    const patchImage = await generatePatchImage(logo, background_color, border_color);
    
    res.json({
      success: true,
      patch_id: 'patch_' + Date.now(),
      image_url: patchImage,
      background_color,
      border_color
    });
  } catch (error) {
    console.error('Generate patch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create product
app.post('/api/create-product', async (req, res) => {
  try {
    const { patch_id, image_url, background_color, border_color, customer_email } = req.body;
    
    res.json({
      success: true,
      product_id: 'prod_' + Date.now(),
      product_handle: 'patch-' + patch_id,
      price: 1000
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Error handler
const errorHandler = (err, req, res, next) => {
  console.error('Error:', { message: err.message, path: req.path });
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({ success: false, error: err.message || 'Server error' });
};

app.use(errorHandler);

// Start
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
