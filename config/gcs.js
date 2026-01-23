import { Storage } from '@google-cloud/storage';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

dotenv.config();

let storage;
let bucket;

export const initializeGCS = () => {
  try {
    // Handle service account JSON from environment variable
    let keyFilename = process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON;
    
    if (keyFilename && keyFilename.startsWith('{')) {
      // It's the JSON content as string, write it to a file
      const keyPath = path.join(process.cwd(), 'service-account.json');
      fs.writeFileSync(keyPath, keyFilename);
      keyFilename = keyPath;
    }

    // Initialize Google Cloud Storage
    storage = new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: keyFilename,
    });

    bucket = storage.bucket(process.env.GOOGLE_CLOUD_STORAGE_BUCKET);
    
    console.log('✅ Google Cloud Storage initialized');
    return bucket;
  } catch (error) {
    console.error('❌ GCS initialization error:', error.message);
    throw error;
  }
};

// ============================================
// ✅ NOUVELLE FONCTION: OPTIMISATION D'IMAGE
// ============================================

/**
 * Optimise une image avant upload sur GCS
 * - Redimensionne à la taille d'affichage réelle (550x550)
 * - Compresse en WebP qualité 80 (optimal qualité/poids)
 * - Réduit le poids de ~40% sans perte visible
 * 
 * @param {Buffer} imageBuffer - Buffer de l'image originale
 * @param {Object} options - Options d'optimisation
 * @param {number} options.width - Largeur cible (défaut: 550)
 * @param {number} options.height - Hauteur cible (défaut: 550)
 * @param {number} options.quality - Qualité WebP 1-100 (défaut: 80)
 * @returns {Promise<Buffer>} - Buffer de l'image optimisée
 */
export const optimizeImageForWeb = async (imageBuffer, options = {}) => {
  const {
    width = 550,      // Taille d'affichage réelle sur le site
    height = 550,
    quality = 80,     // Qualité optimale (invisible vs 85, mais -15% de poids)
  } = options;

  try {
    const originalSize = imageBuffer.length;

    // Optimisation avec Sharp
    const optimizedBuffer = await sharp(imageBuffer)
      .resize(width, height, {
        fit: 'cover',           // Remplit exactement les dimensions
        position: 'center',     // Centre l'image si crop nécessaire
      })
      .webp({
        quality: quality,       // Compression WebP
        effort: 6,              // Effort de compression (0-6, 6 = max)
        smartSubsample: true,   // Meilleure compression des couleurs
      })
      .toBuffer();

    const newSize = optimizedBuffer.length;
    const reduction = ((originalSize - newSize) / originalSize * 100).toFixed(1);

    console.log(`🗜️  Image optimized: ${(originalSize/1024).toFixed(1)}KB → ${(newSize/1024).toFixed(1)}KB (-${reduction}%)`);

    return optimizedBuffer;
  } catch (error) {
    console.error('⚠️  Image optimization failed, using original:', error.message);
    return imageBuffer; // Fallback: retourne l'original si erreur
  }
};

// ============================================
// ✅ UPLOAD AVEC OPTIMISATION AUTOMATIQUE
// ============================================

/**
 * Upload une image sur GCS avec optimisation automatique
 * @param {string} filename - Nom du fichier sur GCS
 * @param {Buffer} buffer - Buffer de l'image
 * @param {string} contentType - Type MIME (défaut: 'image/webp')
 * @param {Object} optimizeOptions - Options d'optimisation (null = pas d'optimisation)
 * @returns {Promise<string>} - URL publique de l'image
 */
export const uploadToGCS = async (filename, buffer, contentType = 'image/webp', optimizeOptions = null) => {
  try {
    let finalBuffer = buffer;

    // ✅ Optimisation automatique si options fournies
    if (optimizeOptions !== null) {
      finalBuffer = await optimizeImageForWeb(buffer, optimizeOptions);
    }

    const file = bucket.file(filename);
    
    // Upload sur GCS
    await file.save(finalBuffer, {
      metadata: {
        contentType: contentType,
        cacheControl: 'public, max-age=31536000', // 1 an de cache
      },
    });

    // URL publique
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
    
    console.log('✅ Uploaded to GCS:', publicUrl);
    return publicUrl;
  } catch (error) {
    console.error('❌ GCS upload error:', error.message);
    throw new Error('Failed to upload to GCS: ' + error.message);
  }
};

// ============================================
// ✅ UPLOAD OPTIMISÉ POUR LES PATCHS
// ============================================

/**
 * Upload un patch avec optimisation spécifique pour PageSpeed
 * Utilise les paramètres optimaux identifiés par l'analyse PageSpeed
 * @param {string} filename - Nom du fichier
 * @param {Buffer} buffer - Buffer de l'image du patch
 * @returns {Promise<string>} - URL publique
 */
export const uploadPatchOptimized = async (filename, buffer) => {
  return uploadToGCS(filename, buffer, 'image/webp', {
    width: 550,     // Taille d'affichage réelle (PageSpeed: 551x551)
    height: 550,
    quality: 80,    // Qualité optimale pour web
  });
};

export const getBucket = () => bucket;
export const getStorage = () => storage;
