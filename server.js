import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/mongodb.js';
import { initializeGCS } from './config/gcs.js';
import { initializeGemini } from './config/gemini.js';
import rateLimiter from './middleware/rateLimiter.js';
import errorHandler from './middleware/errorHandler.js';
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

// CORS
app.use(cors({
  origin: '*',  // ✅ Accepte tous les domaines (temporaire pour tester)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
    
    // Permettre les requêtes sans origin (Postman, curl) en dev
    if (!origin && process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
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
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip}`);
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  const healthData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    services: {
      mongodb: process.env.SKIP_MONGODB === 'true' ? 'skipped' : 'connected',
      gcs: 'configured',
      gemini: 'configured',
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
    },
  };

  res.json(healthData);
});

// Liveness probe (pour Kubernetes/Cloud Run)
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// Readiness probe
app.get('/ready', (req, res) => {
  res.status(200).json({ ready: true });
});

// ============================================
// ROUTES - PATCH GENERATION
// ============================================

// Extract dominant colors from logo
app.post('/api/extract-colors', extractColors);

// Generate patch (avec rate limiting)
app.post('/api/generate-patch', rateLimiter, generatePatch);

// ============================================
// ROUTES - GALLERY & STATS
// ============================================

// Get gallery of generated patches
app.get('/api/gallery', getGallery);

// Get specific patch details
app.get('/api/patch/:patchId', getPatch);

// Get platform statistics
app.get('/api/stats', getStats);

// ============================================
// ROUTES - API INFO & DOCUMENTATION
// ============================================

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'PPATCH Backend API',
    version: '1.0.0',
    description: 'Backend for PPATCH embroidered patch generator',
    endpoints: {
      health: 'GET /api/health',
      extractColors: 'POST /api/extract-colors',
      generatePatch: 'POST /api/generate-patch',
      gallery: 'GET /api/gallery',
      patchDetails: 'GET /api/patch/:patchId',
      stats: 'GET /api/stats',
    },
    documentation: 'https://github.com/yourusername/ppatch-backend',
  });
});

// ============================================
// ERROR HANDLERS
// ============================================

// 404 handler (doit être avant errorHandler)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.path,
    method: req.method,
    availableRoutes: [
      'GET /api/health',
      'POST /api/extract-colors',
      'POST /api/generate-patch',
      'GET /api/gallery',
      'GET /api/patch/:patchId',
      'GET /api/stats',
    ],
  });
});

// Global error handler (doit être en dernier)
app.use(errorHandler);

// ============================================
// SERVER START
// ============================================

const PORT = process.env.PORT || 10000;
const HOST = process.env.HOST || '0.0.0.0';

// Initialize services then start server
initializeServices().then(() => {
  const server = app.listen(PORT, HOST, () => {
    console.log('\n' + '█'.repeat(60));
    console.log('🚀 PPATCH Backend Server Started Successfully');
    console.log('█'.repeat(60));
    console.log(`📡 Server URL: http://${HOST}:${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`☁️  GCS Bucket: ${process.env.GOOGLE_CLOUD_STORAGE_BUCKET || 'Not configured'}`);
    console.log(`🗄️  MongoDB: ${process.env.SKIP_MONGODB === 'true' ? 'Disabled' : 'Enabled'}`);
    console.log(`🎨 Gemini Model: ${process.env.USE_MOCK_GENERATION === 'true' ? 'Mock Mode' : 'Production'}`);
    console.log('█'.repeat(60));
    console.log('\n📋 Available Routes:');
    console.log('  ├─ GET  /api/health          - Health check');
    console.log('  ├─ GET  /api                 - API info');
    console.log('  ├─ POST /api/extract-colors  - Extract colors from logo');
    console.log('  ├─ POST /api/generate-patch  - Generate embroidered patch');
    console.log('  ├─ GET  /api/gallery         - Get patches gallery');
    console.log('  ├─ GET  /api/patch/:id       - Get patch details');
    console.log('  └─ GET  /api/stats           - Platform statistics');
    console.log('\n' + '█'.repeat(60));
    console.log('✨ Server is ready to accept requests!');
    console.log('█'.repeat(60) + '\n');

    // Log configuration warnings
    if (process.env.USE_MOCK_GENERATION === 'true') {
      console.warn('⚠️  WARNING: Running in MOCK MODE - Patches will not be generated properly');
    }
    if (process.env.SKIP_MONGODB === 'true') {
      console.warn('⚠️  WARNING: MongoDB is DISABLED - Data will not be persisted');
    }
    if (!process.env.GOOGLE_API_KEY) {
      console.error('❌ ERROR: GOOGLE_API_KEY is not set!');
    }
    if (!process.env.GOOGLE_CLOUD_STORAGE_BUCKET) {
      console.error('❌ ERROR: GOOGLE_CLOUD_STORAGE_BUCKET is not set!');
    }
  });

  // ============================================
  // GRACEFUL SHUTDOWN
  // ============================================

  const gracefulShutdown = (signal) => {
    console.log(`\n🛑 ${signal} received, shutting down gracefully...`);
    
    server.close(() => {
      console.log('✅ HTTP server closed');
      console.log('👋 Goodbye!');
      process.exit(0);
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
      console.error('⚠️  Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('UNHANDLED_REJECTION');
  });
}).catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

export default app;
