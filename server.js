// 🧩 Imports
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import fs from 'fs/promises';
import { Storage } from '@google-cloud/storage';
import { initializeGemini, extractDominantColors, generatePatchImage } from './config/gemini.js';
import patchRoutes from './routes/patchRoutes.js';

// 🏁 App & upload
const app = express();
const upload = multer({ dest: '/tmp' });

// ☁️ Google Cloud Storage
const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
  credentials: JSON.parse(process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON || '{}'),
});
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);

// 🌍 CORS (une seule fois)
app.use(cors({
  origin: ['https://ppatch.shop', 'https://www.ppatch.shop'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// 🧱 Middlewares JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ⏱️ Rate limit
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
});
app.use(limiter);

// ✅ Route generate-patch (NOUVELLE VERSION AVEC GCS)
app.post('/api/generate-patch', upload.single('logo'), async (req, res) => {
  let tempFilePath = null;
  try {
    const bgColor = req.body.bg_color || req.body.background_color;
    const borderColor = req.body.border_color;
    const userId = req.body.user_id;
    const email = req.body.email;

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Logo file missing' });
    }
    if (!bgColor || !borderColor) {
      return res.status(400).json({ success: false, error: 'Missing colors' });
    }

    tempFilePath = req.file.path;

    // 1️⃣ Convertir le fichier en base64 pour generatePatchImage
    const fileBuffer = await fs.readFile(tempFilePath);
    const logoBase64 = fileBuffer.toString('base64');

    // 2️⃣ Générer l'image du patch (retourne base64)
    const patchImageBase64 = await generatePatchImage(logoBase64, bgColor, borderColor);

    // 3️⃣ Extraire les données base64 (enlever "data:image/png;base64," si présent)
    const base64Data = patchImageBase64.includes(',') 
      ? patchImageBase64.split(',')[1] 
      : patchImageBase64;

    // 4️⃣ Créer un nom de fichier unique
    const patchId = 'patch_' + userId + '_' + Date.now();
    const fileName = `${patchId}.png`;

    // 5️⃣ Convertir base64 → Buffer
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // 6️⃣ Sauvegarder en Google Cloud Storage
    const file = bucket.file(fileName);
    await file.save(imageBuffer, {
      metadata: {
        contentType: 'image/png',
        metadata: {
          user_id: userId || 'anonymous',
          email: email || 'unknown',
          bg_color: bgColor,
          border_color: borderColor,
          created_at: new Date().toISOString(),
        },
      },
    });

    // 7️⃣ Générer l'URL publique GCS
    const imageUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${fileName}`;

    console.log('✅ Patch sauvegardé:', { patchId, imageUrl });

    res.json({
      success: true,
      patch_id: patchId,
      image_url: imageUrl, // URL GCS complète
      background_color: bgColor,
      border_color: borderColor,
      email: email,
    });

  } catch (error) {
    console.error('❌ Generate patch error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    // 8️⃣ Nettoyer le fichier temporaire
    if (tempFilePath) {
      try {
        await fs.unlink(tempFilePath);
      } catch (e) {
        console.warn('Impossible de supprimer le fichier temp:', tempFilePath);
      }
    }
  }
});

// ✅ Route create-product (tu gardes la base)
app.post('/api/create-product', async (req, res) => {
  try {
    const { patch_id, image_url, background_color, border_color, customer_email } = req.body;

    res.json({
      success: true,
      product_id: 'prod_' + Date.now(),
      product_handle: 'patch-' + patch_id,
      price: 1000,
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// (optionnel) autres routes
app.use('/api', patchRoutes);

// 🧯 Error handler
const errorHandler = (err, req, res, next) => {
  console.error('Error:', { message: err.message, path: req.path });
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({ success: false, error: err.message || 'Server error' });
};
app.use(errorHandler);

// 🚀 Start
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`GCS Bucket: ${process.env.GCS_BUCKET_NAME || 'ppatch-images'}`);
});
