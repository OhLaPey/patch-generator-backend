/**
 * ============================================
 * MIGRATION DES IMAGES EXISTANTES
 * 1024x1024 → 600x600
 * ============================================
 * 
 * Ce script redimensionne toutes les images WebP existantes
 * dans ton bucket GCS de 1024x1024 à 600x600
 * 
 * À ajouter dans ton fichier routes (ex: routes/admin.js ou routes/migration.js)
 * Puis appeler via: GET /api/admin/migrate-images
 */

import sharp from 'sharp';
import { Storage } from '@google-cloud/storage';

// ============================================
// CONFIGURATION
// ============================================
const BUCKET_NAME = 'patch-generator-images-ohlapey';
const TARGET_SIZE = 600;
const WEBP_QUALITY = 85;

// Initialiser GCS (utilise tes credentials existants)
const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

/**
 * Redimensionne une image de 1024x1024 à 600x600
 */
const resizeImage = async (buffer) => {
  const metadata = await sharp(buffer).metadata();
  
  // Si déjà à la bonne taille ou plus petit, on skip
  if (metadata.width <= TARGET_SIZE && metadata.height <= TARGET_SIZE) {
    return null; // Signale qu'on skip
  }
  
  return await sharp(buffer)
    .resize(TARGET_SIZE, TARGET_SIZE, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
};

/**
 * Endpoint de migration - à appeler via URL
 * GET /api/admin/migrate-images?limit=50
 */
export const migrateImages = async (req, res) => {
  const startTime = Date.now();
  const limit = parseInt(req.query.limit) || 50; // Traiter par lots
  const dryRun = req.query.dry === 'true'; // Mode test sans modification
  
  console.log('🚀 Starting image migration...');
  console.log(`📋 Limit: ${limit}, Dry run: ${dryRun}`);
  
  const results = {
    processed: 0,
    resized: 0,
    skipped: 0,
    errors: 0,
    totalOriginalSize: 0,
    totalNewSize: 0,
    details: []
  };
  
  try {
    // Lister les fichiers WebP dans patches/
    const [files] = await bucket.getFiles({ 
      prefix: 'patches/',
      maxResults: limit 
    });
    
    const webpFiles = files.filter(f => 
      f.name.endsWith('.webp') && 
      !f.name.includes('/thumbs/') &&
      !f.name.includes('/thumbnails/')
    );
    
    console.log(`📁 Found ${webpFiles.length} WebP files to process`);
    
    for (const file of webpFiles) {
      try {
        results.processed++;
        
        // Télécharger l'image
        const [buffer] = await file.download();
        const originalSize = buffer.length;
        results.totalOriginalSize += originalSize;
        
        // Vérifier les dimensions
        const metadata = await sharp(buffer).metadata();
        
        if (metadata.width <= TARGET_SIZE && metadata.height <= TARGET_SIZE) {
          console.log(`⏭️  Skip (already ${metadata.width}x${metadata.height}): ${file.name}`);
          results.skipped++;
          results.totalNewSize += originalSize;
          results.details.push({
            file: file.name,
            status: 'skipped',
            reason: `Already ${metadata.width}x${metadata.height}`
          });
          continue;
        }
        
        // Redimensionner
        const resizedBuffer = await resizeImage(buffer);
        
        if (!resizedBuffer) {
          results.skipped++;
          results.totalNewSize += originalSize;
          continue;
        }
        
        const newSize = resizedBuffer.length;
        const reduction = ((1 - newSize / originalSize) * 100).toFixed(1);
        
        console.log(`🔄 ${file.name}: ${metadata.width}x${metadata.height} → ${TARGET_SIZE}x${TARGET_SIZE}`);
        console.log(`   📦 ${(originalSize/1024).toFixed(0)} Ko → ${(newSize/1024).toFixed(0)} Ko (-${reduction}%)`);
        
        if (!dryRun) {
          // Ré-uploader (écrase l'ancien)
          await file.save(resizedBuffer, {
            metadata: {
              contentType: 'image/webp',
              cacheControl: 'public, max-age=31536000, immutable',
            }
          });
          console.log(`   ✅ Saved!`);
        } else {
          console.log(`   🧪 Dry run - not saved`);
        }
        
        results.resized++;
        results.totalNewSize += newSize;
        results.details.push({
          file: file.name,
          status: 'resized',
          originalSize: `${(originalSize/1024).toFixed(0)} Ko`,
          newSize: `${(newSize/1024).toFixed(0)} Ko`,
          reduction: `${reduction}%`,
          originalDimensions: `${metadata.width}x${metadata.height}`,
          newDimensions: `${TARGET_SIZE}x${TARGET_SIZE}`
        });
        
      } catch (fileError) {
        console.error(`❌ Error processing ${file.name}:`, fileError.message);
        results.errors++;
        results.details.push({
          file: file.name,
          status: 'error',
          error: fileError.message
        });
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalReduction = results.totalOriginalSize > 0 
      ? ((1 - results.totalNewSize / results.totalOriginalSize) * 100).toFixed(1)
      : 0;
    
    const summary = {
      success: true,
      dryRun,
      duration: `${duration}s`,
      stats: {
        processed: results.processed,
        resized: results.resized,
        skipped: results.skipped,
        errors: results.errors,
        totalOriginalSize: `${(results.totalOriginalSize / 1024 / 1024).toFixed(2)} Mo`,
        totalNewSize: `${(results.totalNewSize / 1024 / 1024).toFixed(2)} Mo`,
        totalReduction: `${totalReduction}%`
      },
      details: results.details
    };
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 MIGRATION COMPLETE');
    console.log('='.repeat(50));
    console.log(`✅ Resized: ${results.resized}`);
    console.log(`⏭️  Skipped: ${results.skipped}`);
    console.log(`❌ Errors: ${results.errors}`);
    console.log(`📦 Total reduction: ${totalReduction}%`);
    console.log(`⏱️  Duration: ${duration}s`);
    
    res.json(summary);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Endpoint pour voir les stats avant migration
 * GET /api/admin/migration-stats
 */
export const getMigrationStats = async (req, res) => {
  try {
    const [files] = await bucket.getFiles({ prefix: 'patches/' });
    
    const webpFiles = files.filter(f => 
      f.name.endsWith('.webp') && 
      !f.name.includes('/thumbs/') &&
      !f.name.includes('/thumbnails/')
    );
    
    let totalSize = 0;
    let needsResize = 0;
    let alreadyOptimized = 0;
    
    // Échantillon de 10 fichiers pour estimer
    const sample = webpFiles.slice(0, 10);
    
    for (const file of sample) {
      const [buffer] = await file.download();
      totalSize += buffer.length;
      
      const metadata = await sharp(buffer).metadata();
      if (metadata.width > TARGET_SIZE || metadata.height > TARGET_SIZE) {
        needsResize++;
      } else {
        alreadyOptimized++;
      }
    }
    
    const estimatedNeedsResize = Math.round((needsResize / sample.length) * webpFiles.length);
    const estimatedAlreadyOptimized = Math.round((alreadyOptimized / sample.length) * webpFiles.length);
    
    res.json({
      success: true,
      stats: {
        totalFiles: webpFiles.length,
        sampleSize: sample.length,
        sampleTotalSize: `${(totalSize / 1024 / 1024).toFixed(2)} Mo`,
        estimated: {
          needsResize: estimatedNeedsResize,
          alreadyOptimized: estimatedAlreadyOptimized,
          potentialSavings: '~50%' // Estimation conservatrice
        }
      },
      recommendation: `Run migration with: GET /api/admin/migrate-images?limit=${webpFiles.length}&dry=true`
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// ============================================
// EXPORT POUR UTILISATION DANS TES ROUTES
// ============================================
export default {
  migrateImages,
  getMigrationStats
};
