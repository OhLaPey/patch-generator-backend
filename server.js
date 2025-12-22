import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/mongodb.js';
import { initializeGCS } from './config/gcs.js';
import { initializeGemini } from './config/gemini.js';
import patchRoutes from './routes/patchRoutes.js';
import errorHandler from './middleware/errorHandler.js';
import rateLimiter from './middleware/rateLimiter.js';
import mongoose from 'mongoose';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Initialize Services
(async () => {
  try {
    await connectDB();
    console.log('✅ Database connected');
    
    initializeGemini();
    console.log('✅ Gemini initialized');
    
    initializeGCS();
    console.log('✅ Google Cloud Storage initialized');
  } catch (error) {
    console.error('❌ Initialization error:', error.message);
    process.exit(1);
  }
})();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api', rateLimiter, patchRoutes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Créer un produit Shopify automatiquement
app.post('/api/create-product', async (req, res) => {
  try {
    const { patch_id, image_url, background_color, border_color, customer_email } = req.body;

    const shopName = process.env.SHOPIFY_SHOP_NAME;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shopName || !accessToken) {
      return res.status(500).json({ success: false, error: 'Shopify credentials missing' });
    }

    // Créer le produit
    const productData = {
      product: {
        title: `Patch Personnalisé - ${patch_id}`,
        body_html: `<p>Patch brodé personnalisé selon votre création</p>
                    <p><strong>Fond:</strong> ${background_color}</p>
                    <p><strong>Bordure:</strong> ${border_color}</p>
                    <p><strong>Référence:</strong> ${patch_id}</p>`,
        vendor: 'PPATCH',
        product_type: 'Patch Personnalisé',
        tags: 'personnalisé, brodé, patch',
        images: [
          {
            src: image_url,
            alt: `Patch Personnalisé ${patch_id}`
          }
        ],
        variants: [
          {
            title: 'Default Title',
            price: '10.00',
            sku: patch_id,
            barcode: patch_id,
            metafields: [
              {
                namespace: 'custom',
                key: 'patch_id',
                value: patch_id,
                type: 'single_line_text_field'
              },
              {
                namespace: 'custom',
                key: 'background_color',
                value: background_color,
                type: 'single_line_text_field'
              },
              {
                namespace: 'custom',
                key: 'border_color',
                value: border_color,
                type: 'single_line_text_field'
              },
              {
                namespace: 'custom',
                key: 'customer_email',
                value: customer_email,
                type: 'single_line_text_field'
              }
            ]
          }
        ],
        metafields: [
          {
            namespace: 'custom',
            key: 'patch_id',
            value: patch_id,
            type: 'single_line_text_field'
          }
        ]
      }
    };

    const response = await fetch(
      `https://${shopName}/admin/api/2024-01/products.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken
        },
        body: JSON.stringify(productData)
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error('Shopify error:', result);
      return res.status(400).json({ success: false, error: result.errors });
    }

    // Sauvegarder dans MongoDB que ce patch a été commandé
    const db = mongoose.connection.db;
    await db.collection('patches').updateOne(
      { patch_id: patch_id },
      {
        $set: {
          shopify_product_id: result.product.id,
          shopify_handle: result.product.handle,
          ordered: true,
          ordered_at: new Date(),
          customer_email: customer_email
        }
      }
    );

    res.json({
      success: true,
      product_id: result.product.id,
      product_handle: result.product.handle,
      shop_url: `https://${shopName}/products/${result.product.handle}`
    });

  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// AJOUT APRÈS TES IMPORTS

import { extractDominantColors, generatePatchImage, initializeGemini } from './config/gemini.js';
import multer from 'multer';

const upload = multer({ dest: '/tmp' });

// TE ENDPOINTS QUI MANQUENT
app.post('/api/extract-colors', upload.single('logo'), async (req, res) => {
  try {
    const base64 = req.body.logo;
    if (!base64) {
      return res.status(400).json({ success: false, error: 'No logo provided' });
    }

    const colors = await extractDominantColors(base64);
    
    res.json({
      success: true,
      background_options: colors.slice(0, 3),
      border_options: colors.slice(2, 5)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/generate-patch', async (req, res) => {
  try {
    const { logo, background_color, border_color, email } = req.body;
    
    if (!logo || !background_color || !border_color) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
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
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/create-product', async (req, res) => {
  try {
    const { patch_id, image_url, background_color, border_color, customer_email } = req.body;
    
    res.json({
      success: true,
      product_id: 'prod_' + Date.now(),
      product_handle: 'patch-' + patch_id,
      price: 1000 // €10.00
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});

export default app;

