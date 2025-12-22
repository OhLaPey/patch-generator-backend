// 🧩 Imports
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import fs from 'fs/promises';
import { initializeGemini, extractDominantColors, generatePatchImage } from './config/gemini.js';
import patchRoutes from './routes/patchRoutes.js';

// 🏁 App & upload
const app = express();
const upload = multer({ dest: '/tmp' });

// 🌍 CORS (une seule fois)
app.use(cors({
  origin: ['https://ppatch.shop', 'https://www.ppatch.shop'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// 🧱 Middlewares JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ⏱️ Rate limit (si tu l’utilises déjà)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
});
app.use(limiter);

// ✅ Route generate-patch (nouvelle version)
app.post('/api/generate-patch', upload.single('logo'), async (req, res) => {
  try {
    const bgColor = req.body.bg_color || req.body.background_color;
    const borderColor = req.body.border_color;
    const email = req.body.email;

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Logo file missing' });
    }
    if (!bgColor || !borderColor) {
      return res.status(400).json({ success: false, error: 'Missing colors' });
    }

    // Fichier → base64 pour réutiliser generatePatchImage
    const fileBuffer = await fs.readFile(req.file.path);
    const logoBase64 = fileBuffer.toString('base64');

    const patchImage = await generatePatchImage(logoBase64, bgColor, borderColor);

    res.json({
      success: true,
      patch_id: 'patch_' + Date.now(),
      image_url: patchImage,
      background_color: bgColor,
      border_color: borderColor,
      email,
    });
  } catch (error) {
    console.error('Generate patch error:', error);
    res.status(500).json({ success: false, error: error.message });
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
});
