/**
 * Script de migration : Recadrer toutes les images existantes en format carré
 * 
 * Usage : node scripts/migrate-square-images.js
 * 
 * Ce script va :
 * 1. Récupérer tous les patchs générés depuis MongoDB
 * 2. Télécharger chaque image depuis GCS
 * 3. Recadrer en carré (1024x1024)
 * 4. Ré-uploader sur GCS (même URL)
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';

dotenv.config();

// ============================================
// CONFIGURATION
// ============================================

const MONGODB_URI = process.env.MONGODB_URI;
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;
const TARGET_SIZE = 1024; // Taille finale en pixels

// Initialiser Google Cloud Storage
const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID,
  credentials: JSON.parse(process.env.GCS_CREDENTIALS || '{}')
});
const bucket = storage.bucket(GCS_BUCKET_NAME);

// ============================================
// SCHÉMA MONGODB (simplifié pour le script)
// ============================================

const patchSchema = new mongoose.Schema({
  patch_id: String,
  generated_image_url: String,
  generated_image_gcs_path: String,
  status: String,
}, { collection: 'patches' });

const Patch = mongoose.model('Patch', patchSchema);

// ============================================
// FONCTION DE RECADRAGE
// ============================================

const cropToSquare = async (imageBuffer, targetSize = 1024) => {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height } = metadata;

    console.log(`  📐 Original: ${width}x${height}`);

    // Si déjà carré
    if (width === height) {
      console.log(`  ✅ Already square, resizing to ${targetSize}x${targetSize}`);
      return await sharp(imageBuffer)
        .resize(targetSize, targetSize, { fit: 'fill' })
        .png({ quality: 90 })
        .toBuffer();
    }

    // Calculer le crop centré
    const minDimension = Math.min(width, height);
    const left = Math.floor((width - minDimension) / 2);
    const top = Math.floor((height - minDimension) / 2);

    console.log(`  ✂️ Cropping: ${minDimension}x${minDimension} from (${left}, ${top})`);

    return await sharp(imageBuffer)
      .extract({
        left: left,
        top: top,
        width: minDimension,
        height: minDimension
      })
      .resize(targetSize, targetSize, { fit: 'fill' })
      .png({ quality: 90 })
      .toBuffer();

  } catch (error) {
    console.error(`  ❌ Crop error: ${error.message}`);
    throw error;
  }
};

// ============================================
// FONCTION PRINCIPALE
// ============================================

const migrateImages = async () => {
  console.log('\n' + '='.repeat(60));
  console.log('🔄 MIGRATION: Recadrage des images en format carré');
  console.log('='.repeat(60) + '\n');

  try {
    // Connexion MongoDB
    console.log('📦 Connexion à MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connecté\n');

    // Récupérer tous les patchs générés
    const patches = await Patch.find({
      status: 'generated',
      generated_image_gcs_path: { $exists: true, $ne: null }
    }).lean();

    console.log(`📊 ${patches.length} patchs à traiter\n`);

    if (patches.length === 0) {
      console.log('ℹ️ Aucun patch à migrer.');
      return;
    }

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < patches.length; i++) {
      const patch = patches[i];
      const progress = `[${i + 1}/${patches.length}]`;

      console.log(`${progress} 🔄 Traitement: ${patch.patch_id}`);

      try {
        const gcsPath = patch.generated_image_gcs_path;

        if (!gcsPath) {
          console.log(`${progress} ⏭️ Skipped: pas de chemin GCS`);
          skippedCount++;
          continue;
        }

        // Télécharger l'image depuis GCS
        console.log(`  📥 Téléchargement: ${gcsPath}`);
        const file = bucket.file(gcsPath);
        
        const [exists] = await file.exists();
        if (!exists) {
          console.log(`  ⏭️ Skipped: fichier non trouvé sur GCS`);
          skippedCount++;
          continue;
        }

        const [imageBuffer] = await file.download();
        console.log(`  📦 Taille originale: ${(imageBuffer.length / 1024).toFixed(0)} KB`);

        // Vérifier si déjà carré
        const metadata = await sharp(imageBuffer).metadata();
        if (metadata.width === metadata.height && metadata.width === TARGET_SIZE) {
          console.log(`  ⏭️ Skipped: déjà ${TARGET_SIZE}x${TARGET_SIZE}`);
          skippedCount++;
          continue;
        }

        // Recadrer en carré
        const squareBuffer = await cropToSquare(imageBuffer, TARGET_SIZE);
        console.log(`  📦 Nouvelle taille: ${(squareBuffer.length / 1024).toFixed(0)} KB`);

        // Ré-uploader sur GCS (même chemin = écrase)
        console.log(`  📤 Upload: ${gcsPath}`);
        await file.save(squareBuffer, {
          metadata: {
            contentType: 'image/png',
            cacheControl: 'public, max-age=31536000',
          },
        });

        console.log(`  ✅ Terminé!\n`);
        successCount++;

      } catch (error) {
        console.error(`  ❌ Erreur: ${error.message}\n`);
        errorCount++;
      }

      // Petite pause pour ne pas surcharger GCS
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Résumé
    console.log('\n' + '='.repeat(60));
    console.log('📊 RÉSUMÉ DE LA MIGRATION');
    console.log('='.repeat(60));
    console.log(`✅ Succès:    ${successCount}`);
    console.log(`⏭️ Skipped:   ${skippedCount}`);
    console.log(`❌ Erreurs:   ${errorCount}`);
    console.log(`📊 Total:     ${patches.length}`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Erreur fatale:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('👋 MongoDB déconnecté');
  }
};

// ============================================
// EXÉCUTION
// ============================================

migrateImages()
  .then(() => {
    console.log('\n🎉 Migration terminée!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Erreur:', error);
    process.exit(1);
  });
