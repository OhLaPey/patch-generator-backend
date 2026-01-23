import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/mongodb.js';
import { initializeGCS } from './config/gcs.js';
import { initializeGemini, detectLogoName } from './config/gemini.js';
import { initializeShopify, createShopifyProduct } from './config/shopify.js';
import { initializeEmailService } from './services/emailService.js';
import rateLimiter from './middleware/rateLimiter.js';
import errorHandler from './middleware/errorHandler.js';
import { User } from './models/User.js';
import { getClientIP } from './utils/helpers.js';
import webhookRoutes from './routes/webhooks.js';
import { migrateImages } from './routes/migrate-images-route.js';
import {
  extractColors,
  generatePatch,
  getGallery,
  getPatch,
  getStats,
} from './controllers/patchController.js';

dotenv.config();

const app = express();

// ============================================
// MIDDLEWARES GLOBAUX
// ============================================

// ✅ CORS - Accepte tous les domaines
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logger
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

// ============================================
// INITIALIZATION DES SERVICES
// ============================================

const initializeServices = async () => {
  console.log('\n' + '='.repeat(60));
  console.log('🔧 Initializing Services...');
  console.log('='.repeat(60));

  try {
    // 1. MongoDB
    if (process.env.SKIP_MONGODB === 'true') {
      console.log('⚠️  MongoDB: SKIPPED (dev mode)');
    } else {
      await connectDB();
    }

    // 2. Google Cloud Storage
    initializeGCS();

    // 3. Gemini API
    initializeGemini();

    // 4. Shopify API
    initializeShopify();

    // 5. Email Service (Gmail)
    initializeEmailService();

    console.log('='.repeat(60));
    console.log('✅ All services initialized successfully');
    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('='.repeat(60));
    console.error('❌ Service initialization failed:', error.message);
    console.error('='.repeat(60));
    
    if (process.env.NODE_ENV === 'production') {
      console.error('Exiting in production mode...');
      process.exit(1);
    } else {
      console.warn('⚠️  Continuing in development mode despite errors...\n');
    }
  }
};

// ============================================
// ROUTES - HEALTH & MONITORING
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
  });
});

app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

app.get('/ready', (req, res) => {
  res.status(200).json({ ready: true });
});

// Route health pour keep-alive (alias)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ============================================
// ROUTES - USER MANAGEMENT
// ============================================

// Register or get existing user
app.post('/api/register-user', async (req, res, next) => {
  try {
    const { email, first_name, segment, optin_marketing } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'Valid email is required',
      });
    }

    const clientIP = getClientIP(req);

    // Vérifier si l'utilisateur existe déjà
    let user = await User.findOne({ email: email.toLowerCase().trim() });

    if (user) {
      // Utilisateur existant - mettre à jour l'activité
      user.last_activity = new Date();
      
      // Ajouter l'IP si nouvelle
      if (!user.ip_addresses.includes(clientIP)) {
        user.ip_addresses.push(clientIP);
      }
      
      await user.save();

      console.log('👤 User found:', user.user_id);

      return res.json({
        success: true,
        user_id: user.user_id,
        email: user.email,
        existing: true,
      });
    }

    // Nouvel utilisateur - créer
    const userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    user = new User({
      user_id: userId,
      email: email.toLowerCase().trim(),
      first_name: first_name || '',
      segment: segment || 'supporter',
      optin_marketing: optin_marketing || false,
      ip_addresses: [clientIP],
    });

    await user.save();

    console.log('✨ New user created:', userId);

    res.json({
      success: true,
      user_id: userId,
      email: user.email,
      existing: false,
    });
  } catch (error) {
    console.error('❌ Register user error:', error.message);
    next(error);
  }
});

// ============================================
// ROUTES - PATCH GENERATION
// ============================================

app.post('/api/extract-colors', extractColors);

// ============================================
// ROUTE: DÉTECTION NOM DU LOGO
// ============================================

app.post('/api/detect-logo-name', async (req, res, next) => {
  try {
    const { logo } = req.body;

    if (!logo) {
      return res.status(400).json({
        success: false,
        error: 'Logo image is required'
      });
    }

    console.log('🔍 Detecting logo name...');
    
    const result = await detectLogoName(logo);
    
    console.log('🏷️ Detection result:', result);

    res.json({
      success: true,
      name: result.name,
      confidence: result.confidence
    });

  } catch (error) {
    console.error('❌ Logo name detection error:', error.message);
    // Ne pas faire échouer, retourner vide
    res.json({
      success: true,
      name: '',
      confidence: 'none'
    });
  }
});

// ✅ LOGS DÉTAILLÉS pour debugger Android
app.post('/api/generate-patch', rateLimiter, (req, res, next) => {
  console.log('🔍 GENERATE-PATCH REQUEST RECEIVED:', {
    hasLogo: !!req.body.logo,
    logoLength: req.body.logo?.length || 0,
    email: req.body.email,
    backgroundColor: req.body.background_color,
    borderColor: req.body.border_color,
    userAgent: req.headers['user-agent'],
    origin: req.headers.origin,
  });
  next();
}, generatePatch);

// ============================================
// ROUTES - GALLERY & STATS
// ============================================

app.get('/api/gallery', getGallery);
app.get('/api/patch/:patchId', getPatch);
app.get('/api/stats', getStats);

// ============================================
// ROUTE PUBLIQUE: PATCHS POUR SLIDESHOW
// ============================================

app.get('/api/public-patches', async (req, res, next) => {
  try {
    const { Patch } = await import('./config/mongodb.js');
    
    // Récupérer les 10 derniers patchs générés avec succès
    const patches = await Patch.find({ 
      status: 'generated',
      generated_image_url: { $exists: true, $ne: null }
    })
      .sort({ created_at: -1 })
      .limit(10)
      .select('patch_id generated_image_url created_at background_color border_color')
      .lean();
    
    // Renommer generated_image_url → image_url pour le frontend
    const formattedPatches = patches.map(p => ({
      patch_id: p.patch_id,
      image_url: p.generated_image_url,
      created_at: p.created_at,
      background_color: p.background_color,
      border_color: p.border_color
    }));
    
    console.log(`📸 Slideshow: ${formattedPatches.length} patchs publics trouvés`);
    
    res.json({
      success: true,
      patches: formattedPatches,
      count: formattedPatches.length
    });
    
  } catch (error) {
    console.error('Error fetching public patches:', error);
    next(error);
  }
});

// ============================================
// ROUTE: CRÉATION PRODUIT SHOPIFY
// ============================================

app.post('/api/create-shopify-product', async (req, res, next) => {
  try {
    const { patch_id } = req.body;

    if (!patch_id) {
      return res.status(400).json({
        success: false,
        error: 'patch_id is required'
      });
    }

    // Récupérer le patch depuis MongoDB
    const { Patch } = await import('./config/mongodb.js');
    const patch = await Patch.findOne({ patch_id });

    if (!patch) {
      return res.status(404).json({
        success: false,
        error: 'Patch not found'
      });
    }

    // Vérifier si le produit Shopify existe déjà
    if (patch.shopify_product_url) {
      console.log(`ℹ️  Shopify product already exists for ${patch_id}`);
      return res.json({
        success: true,
        url: patch.shopify_product_url,
        product_id: patch.shopify_product_id,
        already_exists: true
      });
    }

    // Créer le produit Shopify
    console.log(`🛍️  Creating Shopify product for patch ${patch_id}...`);
    console.log(`📋 Patch data:`, {
      club_name: patch.club_name,
      shape: patch.shape,
      background_color: patch.background_color,
      border_color: patch.border_color
    });

    const shopifyProduct = await createShopifyProduct({
      patch_id: patch.patch_id,
      image_url: patch.generated_image_url,
      background_color: patch.background_color,
      border_color: patch.border_color,
      shape: patch.shape,
      club_name: patch.club_name,
      email: patch.email
    });

    // Mettre à jour le patch dans MongoDB
    patch.shopify_product_id = shopifyProduct.id;
    patch.shopify_product_url = shopifyProduct.url;
    patch.shopify_product_handle = shopifyProduct.handle;
    // Le statut reste 'generated' (pas de statut 'available_for_purchase' dans le schéma)
    await patch.save();

    console.log(`✅ Shopify product created and linked to patch ${patch_id}`);

    res.json({
      success: true,
      url: shopifyProduct.url,
      product_id: shopifyProduct.id,
      admin_url: shopifyProduct.admin_url,
      already_exists: false
    });

  } catch (error) {
    console.error('❌ Create Shopify product error:', error);
    next(error);
  }
});

// ============================================
// ROUTES - WEBHOOKS SHOPIFY
// ============================================

app.use('/api/webhooks', webhookRoutes);

// ============================================
// ROUTES - API INFO
// ============================================

app.get('/api', (req, res) => {
  res.json({
    name: 'PPATCH Backend API',
    version: '1.0.0',
    description: 'Backend for PPATCH embroidered patch generator',
  });
});

// ============================================
// ROUTE: MIGRATION DES IMAGES (1024→600)
// ============================================
app.get('/api/admin/migrate-images', migrateImages);

// ============================================
// ROUTE TEMPORAIRE: MIGRATION OPTIMISATION IMAGES PAGESPEED
// ⚠️ À SUPPRIMER APRÈS UTILISATION
// ============================================

app.get('/api/migrate-optimize', async (req, res) => {
  // Clé secrète pour sécuriser la route
  const secretKey = req.query.key;
  if (secretKey !== 'ppatch2024optimize') {
    return res.status(403).json({ error: 'Invalid key' });
  }

  // Mode dry-run pour tester sans modifier
  const dryRun = req.query.dry === 'true';
  
  // Limite optionnelle (pour tester sur quelques images d'abord)
  const limit = parseInt(req.query.limit) || 0;

  console.log('\n🔄 MIGRATION: Optimisation des images pour PageSpeed');
  console.log('📋 Mode:', dryRun ? 'DRY RUN (simulation)' : 'PRODUCTION');
  if (limit > 0) console.log('📋 Limite:', limit, 'images');
  console.log('');

  try {
    const { Patch } = await import('./config/mongodb.js');
    const { getBucket } = await import('./config/gcs.js');
    const sharp = (await import('sharp')).default;
    const https = await import('https');
    const http = await import('http');

    const bucket = getBucket();
    
    if (!bucket) {
      throw new Error('GCS bucket not initialized. Make sure initializeGCS() is called.');
    }

    // Récupérer tous les patchs avec une image
    let query = Patch.find({ 
      status: 'generated',
      generated_image_url: { $exists: true, $ne: null }
    }).select('patch_id generated_image_url generated_image_gcs_path');

    if (limit > 0) {
      query = query.limit(limit);
    }

    const patches = await query;
    console.log('📊 Found', patches.length, 'patches to optimize\n');

    const results = {
      total: patches.length,
      optimized: 0,
      skipped: 0,
      errors: [],
      totalSavedKB: 0,
    };

    // Fonction pour télécharger une image depuis URL
    const downloadImage = (url) => {
      return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        protocol.get(url, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            // Follow redirect
            downloadImage(response.headers.location).then(resolve).catch(reject);
            return;
          }
          if (response.statusCode !== 200) {
            reject(new Error('HTTP ' + response.statusCode));
            return;
          }
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks)));
          response.on('error', reject);
        }).on('error', reject);
      });
    };

    // Traiter chaque patch
    for (let i = 0; i < patches.length; i++) {
      const patch = patches[i];
      const progress = '[' + (i + 1) + '/' + patches.length + ']';

      try {
        console.log(progress, '🔍 Processing:', patch.patch_id);

        // Télécharger l'image actuelle
        const imageUrl = patch.generated_image_url;
        const originalBuffer = await downloadImage(imageUrl);
        const originalSize = originalBuffer.length;

        console.log(progress, '   📥 Downloaded:', (originalSize / 1024).toFixed(1), 'KB');

        // Obtenir les métadonnées
        const metadata = await sharp(originalBuffer).metadata();
        console.log(progress, '   📐 Current size:', metadata.width + 'x' + metadata.height);

        // Vérifier si déjà optimisé (550x550)
        if (metadata.width === 550 && metadata.height === 550 && originalSize < 50000) {
          console.log(progress, '   ✅ Already optimized, skipping');
          results.skipped++;
          continue;
        }

        // Optimiser l'image
        const optimizedBuffer = await sharp(originalBuffer)
          .resize(550, 550, {
            fit: 'cover',
            position: 'center',
          })
          .webp({
            quality: 80,
            effort: 6,
            smartSubsample: true,
          })
          .toBuffer();

        const newSize = optimizedBuffer.length;
        const savedKB = (originalSize - newSize) / 1024;
        const reduction = ((originalSize - newSize) / originalSize * 100).toFixed(1);

        console.log(progress, '   🗜️  Optimized:', (newSize / 1024).toFixed(1), 'KB (-' + reduction + '%)');

        if (!dryRun) {
          // Déterminer le chemin GCS
          let gcsPath = patch.generated_image_gcs_path;
          
          if (!gcsPath) {
            // Extraire le path depuis l'URL
            const urlParts = imageUrl.split('/');
            gcsPath = urlParts.slice(4).join('/'); // Après le bucket name
          }

          // Assurer l'extension .webp
          if (!gcsPath.endsWith('.webp')) {
            gcsPath = gcsPath.replace(/\.(png|jpg|jpeg)$/i, '.webp');
          }

          console.log(progress, '   📤 Uploading to:', gcsPath);

          // Upload l'image optimisée
          const file = bucket.file(gcsPath);
          await file.save(optimizedBuffer, {
            metadata: {
              contentType: 'image/webp',
              cacheControl: 'public, max-age=31536000',
            },
          });

          // Mettre à jour l'URL si nécessaire (changement d'extension)
          const newUrl = 'https://storage.googleapis.com/' + bucket.name + '/' + gcsPath;
          if (newUrl !== patch.generated_image_url) {
            await Patch.updateOne(
              { patch_id: patch.patch_id },
              { 
                generated_image_url: newUrl,
                generated_image_gcs_path: gcsPath,
              }
            );
            console.log(progress, '   📝 Updated URL in MongoDB');
          }
        }

        results.optimized++;
        results.totalSavedKB += savedKB;
        console.log(progress, '   ✅ Done!\n');

      } catch (error) {
        console.error(progress, '   ❌ Error:', error.message, '\n');
        results.errors.push({
          patch_id: patch.patch_id,
          error: error.message,
        });
      }

      // Pause pour éviter de surcharger
      await new Promise(r => setTimeout(r, 100));
    }

    // Résumé final
    console.log('\n========================================');
    console.log('📊 MIGRATION COMPLETE');
    console.log('========================================');
    console.log('Total patches:', results.total);
    console.log('Optimized:', results.optimized);
    console.log('Skipped (already optimized):', results.skipped);
    console.log('Errors:', results.errors.length);
    console.log('Total saved:', results.totalSavedKB.toFixed(1), 'KB');
    console.log('========================================\n');

    res.json({
      success: true,
      mode: dryRun ? 'dry-run' : 'production',
      results: results,
    });

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// FIN ROUTE MIGRATION PAGESPEED
// ============================================

// ============================================
// ERROR HANDLERS
// ============================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.path,
  });
});

app.use(errorHandler);

// ============================================
// SERVER START
// ============================================

const PORT = process.env.PORT || 10000;
const HOST = process.env.HOST || '0.0.0.0';

initializeServices().then(() => {
  const server = app.listen(PORT, HOST, () => {
    console.log('\n' + '█'.repeat(60));
    console.log('🚀 PPATCH Backend Server Started');
    console.log('█'.repeat(60));
    console.log(`📡 URL: http://${HOST}:${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔓 CORS: OPEN (all origins)`);
    console.log('█'.repeat(60) + '\n');
    
    // ============================================
    // KEEP-ALIVE: Ping automatique toutes les 10 min
    // ============================================
    const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes
    const SERVER_URL = process.env.SERVER_URL || `http://${HOST}:${PORT}`;
    
    const ping = async () => {
      try {
        const response = await fetch(`${SERVER_URL}/health`);
        if (response.ok) {
          console.log(`[${new Date().toISOString()}] 💚 Keep-alive ping OK`);
        }
      } catch (error) {
        console.log(`[${new Date().toISOString()}] ⚠️ Keep-alive ping failed`);
      }
    };
    
    // Premier ping après 1 minute, puis toutes les 10 minutes
    setTimeout(ping, 60 * 1000);
    setInterval(ping, PING_INTERVAL);
    console.log(`🏃 Keep-alive activé (ping toutes les 10 minutes)`);
    
    // ============================================
    // CRON: Sync Brevo tous les jours à 9h
    // ============================================
    const syncBrevoToList = async () => {
      if (!process.env.BREVO_API_KEY) {
        console.log(`[${new Date().toISOString()}] ⏭️ Sync Brevo ignoré (BREVO_API_KEY non configuré)`);
        return;
      }
      
      console.log(`[${new Date().toISOString()}] 📧 Démarrage sync Brevo...`);
      
      try {
        // Import dynamique du service
        const { syncToBrevo } = await import('./services/syncBrevo.js');
        await syncToBrevo();
        console.log(`[${new Date().toISOString()}] ✅ Sync Brevo terminé`);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Sync Brevo erreur:`, error.message);
      }
    };
    
    // Calculer le délai jusqu'à 9h demain
    const scheduleBrevoSync = () => {
      const now = new Date();
      const next9am = new Date();
      next9am.setHours(9, 0, 0, 0);
      
      // Si 9h est déjà passé aujourd'hui, planifier pour demain
      if (now >= next9am) {
        next9am.setDate(next9am.getDate() + 1);
      }
      
      const msUntil9am = next9am - now;
      const hoursUntil = Math.round(msUntil9am / 1000 / 60 / 60 * 10) / 10;
      
      console.log(`📅 Prochaine sync Brevo dans ${hoursUntil}h (${next9am.toLocaleString('fr-FR')})`);
      
      // Premier sync à 9h
      setTimeout(() => {
        syncBrevoToList();
        // Puis toutes les 24h
        setInterval(syncBrevoToList, 24 * 60 * 60 * 1000);
      }, msUntil9am);
    };
    
    scheduleBrevoSync();
  });

  const gracefulShutdown = (signal) => {
    console.log(`\n🛑 ${signal} received, shutting down...`);
    server.close(() => {
      console.log('✅ Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}).catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

export default app;
