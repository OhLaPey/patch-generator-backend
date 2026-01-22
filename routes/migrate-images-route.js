/**
 * ============================================
 * MIGRATION DES IMAGES EXISTANTES
 * 1024x1024 → 600x600
 * ============================================
 * 
 * Appeler via: GET /api/admin/migrate-images?limit=50
 */

import sharp from 'sharp';
import { getBucket } from '../config/gcs.js';  // ✅ Utilise ta config existante

// ============================================
// CONFIGURATION
// ============================================
const TARGET_SIZE = 600;
const WEBP_QUALITY = 85;

/**
 * Redimensionne une image
 */
const resizeImage = async (buffer) => {
  const metadata = await sharp(buffer).metadata();
  
  if (metadata.width <= TARGET_SIZE && metadata.height <= TARGET_SIZE) {
    return null;
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
 * Endpoint de migration
 * GET /api/admin/migrate-images?limit=50
 * GET /api/admin/migrate-images?limit=10&dry=true  (test sans modifier)
 */
export const migrateImages = async (req, res) => {
  const startTime = Date.now();
  const limit = parseInt(req.query.limit) || 50;
  const dryRun = req.query.dry === 'true';
  
  console.log('🚀 Starting image migration...');
  console.log(`📋 Limit: ${limit}, Dry run: ${dryRun}`);
  
  // ✅ Utilise le bucket de ta config existante
  const bucket = getBucket();
  
  if (!bucket) {
    return res.status(500).json({
      success: false,
      error: 'GCS bucket not initialized. Make sure initializeGCS() was called.'
    });
  }
  
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
        
        const [buffer] = await file.download();
        const originalSize = buffer.length;
        results.totalOriginalSize += originalSize;
        
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
          reduction: `${reduction}%`
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
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 MIGRATION COMPLETE');
    console.log(`✅ Resized: ${results.resized}`);
    console.log(`⏭️  Skipped: ${results.skipped}`);
    console.log(`❌ Errors: ${results.errors}`);
    console.log(`📦 Total reduction: ${totalReduction}%`);
    
    res.json({
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
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
