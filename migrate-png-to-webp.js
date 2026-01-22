/**
 * ============================================
 * SCRIPT DE MIGRATION PNG → WebP pour PPATCH
 * ============================================
 * 
 * Ce script convertit toutes les anciennes images PNG en WebP
 * et met à jour les URLs dans MongoDB.
 * 
 * Usage: node migrate-png-to-webp.js
 * 
 * Options:
 *   --dry-run    Simule sans modifier (recommandé pour tester)
 *   --delete     Supprime les PNG après conversion
 */

import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// ============================================
// CONFIGURATION
// ============================================

const BUCKET_NAME = 'patch-generator-images-ohlapey';
const PATCHES_FOLDER = 'patches/';
const DRY_RUN = process.argv.includes('--dry-run');
const DELETE_OLD = process.argv.includes('--delete');

// ============================================
// INITIALISATION
// ============================================

// Google Cloud Storage
let keyFilename = process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON;
if (keyFilename && keyFilename.startsWith('{')) {
  const keyPath = path.join(process.cwd(), 'service-account-temp.json');
  fs.writeFileSync(keyPath, keyFilename);
  keyFilename = keyPath;
}

const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  keyFilename: keyFilename,
});

const bucket = storage.bucket(BUCKET_NAME);

// ============================================
// SCHEMA MONGODB (simplifié)
// ============================================

const patchSchema = new mongoose.Schema({
  patch_id: String,
  generated_image_url: String,
  generated_image_gcs_path: String,
}, { collection: 'patches', strict: false });

const Patch = mongoose.model('Patch', patchSchema);

// ============================================
// FONCTIONS
// ============================================

/**
 * Liste tous les fichiers PNG dans le dossier patches
 */
async function listPngFiles() {
  console.log('📂 Scanning bucket for PNG files...');
  
  const [files] = await bucket.getFiles({ prefix: PATCHES_FOLDER });
  
  const pngFiles = files.filter(file => 
    file.name.toLowerCase().endsWith('.png') &&
    !file.name.includes('/logos/') &&
    !file.name.includes('/thumbnails/')
  );
  
  console.log(`📋 Found ${pngFiles.length} PNG files to convert\n`);
  return pngFiles;
}

/**
 * Convertit un fichier PNG en WebP
 */
async function convertToWebp(file) {
  const pngPath = file.name;
  const webpPath = pngPath.replace(/\.png$/i, '.webp');
  
  console.log(`\n🔄 Converting: ${pngPath}`);
  
  try {
    // 1. Télécharger le PNG
    const [pngBuffer] = await file.download();
    const originalSize = pngBuffer.length;
    console.log(`   📥 Downloaded: ${(originalSize / 1024).toFixed(0)} Ko`);
    
    // 2. Convertir en WebP avec Sharp
    const webpBuffer = await sharp(pngBuffer)
      .resize(1024, 1024, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({
        quality: 85,
        effort: 6,
      })
      .toBuffer();
    
    const newSize = webpBuffer.length;
    const savings = ((1 - newSize / originalSize) * 100).toFixed(1);
    console.log(`   📦 Converted: ${(newSize / 1024).toFixed(0)} Ko (-${savings}%)`);
    
    if (DRY_RUN) {
      console.log(`   🔍 DRY RUN - Would upload to: ${webpPath}`);
      return { 
        success: true, 
        pngPath, 
        webpPath, 
        originalSize, 
        newSize,
        savings: parseFloat(savings)
      };
    }
    
    // 3. Upload le WebP
    const webpFile = bucket.file(webpPath);
    await webpFile.save(webpBuffer, {
      metadata: {
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000', // 1 an
      },
    });
    console.log(`   📤 Uploaded: ${webpPath}`);
    
    // 4. Extraire le patch_id pour mettre à jour MongoDB
    // Format: patch_XXXXX-XXXX-XXXX_timestamp.png
    const filenameMatch = pngPath.match(/patch_([a-f0-9-]+)_/i);
    if (filenameMatch) {
      const patchIdPartial = filenameMatch[1];
      
      // Chercher dans MongoDB avec une regex
      const patch = await Patch.findOne({
        generated_image_gcs_path: { $regex: patchIdPartial }
      });
      
      if (patch) {
        const oldUrl = patch.generated_image_url;
        const newUrl = oldUrl.replace(/\.png$/i, '.webp');
        
        patch.generated_image_url = newUrl;
        patch.generated_image_gcs_path = webpPath;
        await patch.save();
        
        console.log(`   🔗 MongoDB updated: ${patch.patch_id}`);
      } else {
        console.log(`   ⚠️  No MongoDB record found for this image`);
      }
    }
    
    // 5. Supprimer l'ancien PNG si demandé
    if (DELETE_OLD) {
      await file.delete();
      console.log(`   🗑️  Deleted old PNG`);
    }
    
    return { 
      success: true, 
      pngPath, 
      webpPath, 
      originalSize, 
      newSize,
      savings: parseFloat(savings)
    };
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return { 
      success: false, 
      pngPath, 
      error: error.message 
    };
  }
}

/**
 * Fonction principale
 */
async function migrate() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     PPATCH - Migration PNG → WebP                      ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  if (DRY_RUN) {
    console.log('🔍 MODE DRY RUN - Aucune modification ne sera effectuée\n');
  }
  
  if (DELETE_OLD) {
    console.log('⚠️  MODE DELETE - Les anciens PNG seront supprimés\n');
  }
  
  // Connexion MongoDB
  console.log('🔌 Connecting to MongoDB...');
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected\n');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.log('⚠️  Continuing without MongoDB updates...\n');
  }
  
  // Lister les fichiers PNG
  const pngFiles = await listPngFiles();
  
  if (pngFiles.length === 0) {
    console.log('✅ No PNG files to convert. All done!');
    process.exit(0);
  }
  
  // Stats
  let totalOriginalSize = 0;
  let totalNewSize = 0;
  let successCount = 0;
  let errorCount = 0;
  
  // Convertir chaque fichier
  for (let i = 0; i < pngFiles.length; i++) {
    const file = pngFiles[i];
    console.log(`\n[${i + 1}/${pngFiles.length}]`);
    
    const result = await convertToWebp(file);
    
    if (result.success) {
      successCount++;
      totalOriginalSize += result.originalSize;
      totalNewSize += result.newSize;
    } else {
      errorCount++;
    }
    
    // Petit délai pour éviter les rate limits
    if (i < pngFiles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Résumé
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║                    RÉSUMÉ                              ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log(`✅ Fichiers convertis: ${successCount}`);
  console.log(`❌ Erreurs: ${errorCount}`);
  console.log(`📦 Taille avant: ${(totalOriginalSize / 1024 / 1024).toFixed(2)} Mo`);
  console.log(`📦 Taille après: ${(totalNewSize / 1024 / 1024).toFixed(2)} Mo`);
  console.log(`🎉 Économie totale: ${((1 - totalNewSize / totalOriginalSize) * 100).toFixed(1)}%`);
  console.log(`💾 Espace libéré: ${((totalOriginalSize - totalNewSize) / 1024 / 1024).toFixed(2)} Mo`);
  
  if (DRY_RUN) {
    console.log('\n🔍 C\'était un DRY RUN. Pour appliquer vraiment:');
    console.log('   node migrate-png-to-webp.js');
    console.log('\n   Pour aussi supprimer les anciens PNG:');
    console.log('   node migrate-png-to-webp.js --delete');
  }
  
  // Fermer MongoDB
  await mongoose.disconnect();
  console.log('\n✅ Migration terminée!');
}

// Exécution
migrate().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
