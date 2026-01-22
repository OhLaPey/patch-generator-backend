import { Patch } from '../config/mongodb.js';
import { User } from '../models/User.js';
import { uploadToGCS } from '../config/gcs.js';
import { generatePatchImage, extractDominantColors } from '../config/gemini.js';
import { sendContactToBrevo } from '../services/brevo.js';
import { 
  validateGenerationRequest, 
  validateColorExtractionRequest,
  sanitizeEmail 
} from '../utils/validators.js';
import { 
  generatePatchId, 
  generateFilename, 
  getClientIP, 
  logActivity 
} from '../utils/helpers.js';
import sharp from 'sharp';

// ============================================
// FONCTION UTILITAIRE: RECADRAGE CARRÉ
// ============================================

/**
 * Recadre une image en format carré (1:1)
 * Centre l'image et crop les bords si nécessaire
 * @param {Buffer} imageBuffer - Buffer de l'image originale
 * @param {number} targetSize - Taille cible en pixels (défaut: 1024)
 * @returns {Promise<Buffer>} - Buffer de l'image recadrée
 */
const cropToSquare = async (imageBuffer, targetSize = 600) => {
  try {
    // Obtenir les métadonnées de l'image
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height } = metadata;

    console.log(`📐 Original image: ${width}x${height}`);

    // Si déjà carré et bonne taille, juste redimensionner
    if (width === height) {
      console.log('✅ Image already square, resizing to', targetSize);
      return await sharp(imageBuffer)
        .resize(targetSize, targetSize, { fit: 'fill' })
        .webp({ quality: 85 })
        .toBuffer();
    }

    // Calculer le crop centré
    const minDimension = Math.min(width, height);
    const left = Math.floor((width - minDimension) / 2);
    const top = Math.floor((height - minDimension) / 2);

    console.log(`✂️ Cropping to square: ${minDimension}x${minDimension} from position (${left}, ${top})`);

    // Crop en carré puis redimensionner
    const croppedBuffer = await sharp(imageBuffer)
      .extract({
        left: left,
        top: top,
        width: minDimension,
        height: minDimension
      })
      .resize(targetSize, targetSize, { fit: 'fill' })
      .webp({ quality: 85 })
      .toBuffer();

    // Vérifier le résultat
    const finalMetadata = await sharp(croppedBuffer).metadata();
    console.log(`✅ Final image: ${finalMetadata.width}x${finalMetadata.height}`);

    return croppedBuffer;
  } catch (error) {
    console.error('❌ Error cropping to square:', error.message);
    // En cas d'erreur, retourner l'image originale redimensionnée
    return await sharp(imageBuffer)
      .resize(targetSize, targetSize, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .webp({ quality: 85 })
      .toBuffer();
  }
};

export const extractColors = async (req, res, next) => {
  try {
    const { logo } = req.body;

    validateColorExtractionRequest({ logo });

    logActivity('Color Extraction Started', { ipAddress: getClientIP(req) });

    const dominantColors = await extractDominantColors(logo);

    const allColors = ['#FFFFFF', ...dominantColors];

    res.json({
      success: true,
      dominant_colors: dominantColors,
      background_options: allColors,
      border_options: dominantColors,
    });
  } catch (error) {
    logActivity('Color Extraction Error', { message: error.message });
    next(error);
  }
};

export const generatePatch = async (req, res, next) => {
  try {
    // ✅ Support FormData (Android) ET JSON (iPhone/PC)
    let logo, background_color, border_color, email, source;

    let shape;
    let size;
    let club_name;
    let user_comment;  // ✅ NOUVEAU: Commentaire utilisateur
    let version;       // ✅ NOUVEAU: Version du patch (1, 2, 3...)
    let parent_patch_id; // ✅ NOUVEAU: ID du patch parent (pour regénération)

    if (req.is('multipart/form-data')) {
      // Android envoie FormData avec fichier
      const multer = (await import('multer')).default;
      const upload = multer({ storage: multer.memoryStorage() });
      
      await new Promise((resolve, reject) => {
        upload.single('logo')(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      if (!req.file) {
        throw new Error('No logo file uploaded');
      }

      logo = req.file.buffer.toString('base64');
      background_color = req.body.background_color;
      border_color = req.body.border_color;
      email = req.body.email;
      shape = req.body.shape || 'square';
      size = parseFloat(req.body.size) || 6.5;
      club_name = req.body.club_name || '';
      user_comment = req.body.user_comment || '';  // ✅ NOUVEAU
      version = parseInt(req.body.version) || 1;   // ✅ NOUVEAU
      parent_patch_id = req.body.parent_patch_id || null; // ✅ NOUVEAU
      source = req.body.source || 'generator-page';

      console.log('📱 FormData upload (Android):', {
        fileSize: req.file.size,
        email: email,
        shape: shape,
        size: size,
        club_name: club_name,
        user_comment: user_comment ? '✅ présent' : '❌ absent',
        version: version,
      });
    } else {
      // iPhone/PC envoient du JSON avec base64
      logo = req.body.logo;
      background_color = req.body.background_color;
      border_color = req.body.border_color;
      email = req.body.email;
      shape = req.body.shape || 'square';
      size = parseFloat(req.body.size) || 6.5;
      club_name = req.body.club_name || '';
      user_comment = req.body.user_comment || '';  // ✅ NOUVEAU
      version = parseInt(req.body.version) || 1;   // ✅ NOUVEAU
      parent_patch_id = req.body.parent_patch_id || null; // ✅ NOUVEAU
      source = req.body.source || 'generator-page';

      console.log('💻 JSON upload (iPhone/PC)', { 
        shape: shape, 
        size: size, 
        club_name: club_name,
        user_comment: user_comment ? '✅ présent' : '❌ absent',
        version: version,
      });
    }

    // ✅ Log du commentaire si présent
    if (user_comment) {
      console.log('💬 User comment for generation:', user_comment);
    }

    validateGenerationRequest({ logo, background_color, border_color, email });

    const clientIP = getClientIP(req);
    const patchId = generatePatchId();

    logActivity('Patch Generation Started', { 
      patchId, 
      email, 
      ipAddress: clientIP,
      version: version,
      hasComment: !!user_comment,
    });

    const patch = new Patch({
      patch_id: patchId,
      email: sanitizeEmail(email),
      ip_address: clientIP,
      user_agent: req.headers['user-agent'],
      background_color,
      border_color,
      shape,
      size,
      club_name,
      user_comment,        // ✅ NOUVEAU: Sauvegarder le commentaire
      version,             // ✅ NOUVEAU: Sauvegarder la version
      parent_patch_id,     // ✅ NOUVEAU: Lien vers patch parent
      source,
      status: 'processing',
    });

    await patch.save();

    const logoBuffer = Buffer.from(logo, 'base64');

    if (logoBuffer.length > 5 * 1024 * 1024) {
      throw new Error('Logo file exceeds 5MB limit');
    }

    // ✅ Sauvegarder le logo original sur GCS (seulement pour V1)
    if (version === 1) {
      console.log('📤 Sauvegarde du logo original sur GCS...');
      const originalLogoFilename = `logos/original_${patchId}_${Date.now()}.png`;
      
      // Convertir en PNG propre avant upload
      const originalLogoPng = await sharp(logoBuffer)
        .png()
        .toBuffer();
      
      const originalLogoUrl = await uploadToGCS(originalLogoFilename, originalLogoPng, 'image/png');
      console.log('✅ Logo original sauvegardé:', originalLogoUrl);

      // Mettre à jour le patch avec l'URL du logo original
      patch.original_logo_url = originalLogoUrl;
      patch.original_logo_gcs_path = originalLogoFilename;
      await patch.save();
    } else {
      console.log('🔄 Regénération V' + version + ' - Réutilisation du logo existant');
    }

    // ✅ Compression adaptative selon la taille
    let optimizedLogoBuffer;
    const sizeInKB = logoBuffer.length / 1024;

    if (sizeInKB > 1500) {
      // Fichier lourd (>1.5MB) - compression forte + résolution réduite pour vitesse
      console.log('🔧 Heavy compression for large file:', sizeInKB.toFixed(0) + 'KB');
      optimizedLogoBuffer = await sharp(logoBuffer)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
    } else if (sizeInKB > 500) {
      // Fichier moyen (500KB-1.5MB) - compression modérée
      console.log('🔧 Medium compression:', sizeInKB.toFixed(0) + 'KB');
      optimizedLogoBuffer = await sharp(logoBuffer)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
    } else {
      // Petit fichier (<500KB) - résolution optimale pour vitesse
      console.log('✅ Light compression:', sizeInKB.toFixed(0) + 'KB');
      optimizedLogoBuffer = await sharp(logoBuffer)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .png({ quality: 85 })
        .toBuffer();
    }

    console.log('📦 Optimized size:', (optimizedLogoBuffer.length / 1024).toFixed(0) + 'KB');

    // ============================================
    // ✅ GÉNÉRATION AVEC COMMENTAIRE UTILISATEUR
    // ============================================
    const patchImageBase64 = await generatePatchImage(
      optimizedLogoBuffer.toString('base64'),
      background_color,
      border_color,
      shape,
      user_comment  // ✅ NOUVEAU: Passer le commentaire à Gemini
    );

    // ✅ LOGS DE DEBUG
    console.log('🔍 Received base64 length:', patchImageBase64.length);
    console.log('🔍 Starts with:', patchImageBase64.substring(0, 50));

    // Conversion base64 → Buffer
    const generatedImageBuffer = Buffer.from(patchImageBase64, 'base64');
    console.log('🔍 Buffer length:', generatedImageBuffer.length, 'bytes');

    // ============================================
    // ✅ RECADRAGE EN FORMAT CARRÉ
    // ============================================
console.log('📐 Cropping generated image to square format (600x600)...');
const squareImageBuffer = await cropToSquare(generatedImageBuffer, 600);
    console.log('✅ Image cropped to square:', squareImageBuffer.length, 'bytes');

    // Upload vers GCS (image carrée) - avec version dans le nom
    const gcsFilename = version > 1 
      ? generateFilename(patchId, 'webp').replace('.webp', `_v${version}.webp`)
      : generateFilename(patchId, 'webp');
    const publicImageUrl = await uploadToGCS(gcsFilename, squareImageBuffer, 'image/webp');

    // Mise à jour du patch dans MongoDB
    patch.generated_image_url = publicImageUrl;
    patch.generated_image_gcs_path = gcsFilename;
    patch.status = 'generated';
    await patch.save();

    // ✅ Incrémenter le compteur de patchs pour l'utilisateur
    let patchesCount = 1;
    try {
      const userUpdate = await User.findOneAndUpdate(
        { email: sanitizeEmail(email) },
        { 
          $inc: { patches_generated: 1 },
          $set: { last_activity: new Date() }
        },
        { new: true }
      );
      patchesCount = userUpdate?.patches_generated || 1;
    } catch (userError) {
      console.warn('⚠️  Could not update user patch count:', userError.message);
    }

    // ✅ Envoyer le contact à Brevo pour l'automation email
    try {
      await sendContactToBrevo({
        email: sanitizeEmail(email),
        firstName: req.body.first_name || '',
        segment: req.body.segment || 'supporter',
        patchImageUrl: publicImageUrl,
        clubName: club_name,
        patchId: patchId,
        patchesGenerated: patchesCount,
      });
    } catch (brevoError) {
      console.warn('⚠️  Brevo sync error (non-blocking):', brevoError.message);
    }

    logActivity('Patch Generation Success', { 
      patchId, 
      imageUrl: publicImageUrl,
      version: version,
      hadComment: !!user_comment,
    });

    res.json({
      success: true,
      patch_id: patchId,
      image_url: publicImageUrl,
      background_color,
      border_color,
      shape,
      size,
      club_name,
      version,           // ✅ NOUVEAU: Retourner la version
      user_comment,      // ✅ NOUVEAU: Retourner le commentaire utilisé
      created_at: patch.created_at,
    });
  } catch (error) {
    logActivity('Patch Generation Error', { message: error.message });
    
    try {
      await Patch.updateOne(
        { patch_id: req.body.patch_id },
        { status: 'error', error_message: error.message }
      );
    } catch {}

    next(error);
  }
};

export const getGallery = async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 12, 100);
    const skip = parseInt(req.query.skip) || 0;

    const patches = await Patch.find({ status: 'generated' })
      .select('patch_id generated_image_url background_color border_color created_at view_count')
      .sort({ created_at: -1 })
      .limit(limit)
      .skip(skip);

    const total = await Patch.countDocuments({ status: 'generated' });

    await Promise.all(
      patches.map((patch) =>
        Patch.updateOne({ patch_id: patch.patch_id }, { $inc: { view_count: 1 } })
      )
    );

    res.json({
      success: true,
      patches: patches.map((p) => ({
        patch_id: p.patch_id,
        image_url: p.generated_image_url,
        background_color: p.background_color,
        border_color: p.border_color,
        created_at: p.created_at,
        views: p.view_count + 1,
      })),
      pagination: {
        total,
        limit,
        skip,
        hasMore: skip + limit < total,
      },
    });
  } catch (error) {
    logActivity('Gallery Error', { message: error.message });
    next(error);
  }
};

export const getPatch = async (req, res, next) => {
  try {
    const { patchId } = req.params;

    const patch = await Patch.findOne({ patch_id: patchId });

    if (!patch) {
      return res.status(404).json({ error: 'Patch not found' });
    }

    patch.view_count += 1;
    await patch.save();

    res.json({
      success: true,
      patch: {
        patch_id: patch.patch_id,
        image_url: patch.generated_image_url,
        background_color: patch.background_color,
        border_color: patch.border_color,
        created_at: patch.created_at,
        views: patch.view_count,
        purchased: patch.purchased,
        version: patch.version || 1,
        user_comment: patch.user_comment || '',
      },
    });
  } catch (error) {
    logActivity('Get Patch Error', { message: error.message });
    next(error);
  }
};

export const getStats = async (req, res, next) => {
  try {
    const totalPatches = await Patch.countDocuments();
    const generatedPatches = await Patch.countDocuments({ status: 'generated' });
    const soldPatches = await Patch.countDocuments({ purchased: true });
    
    const totalViews = await Patch.aggregate([
      { $group: { _id: null, total_views: { $sum: '$view_count' } } }
    ]);

    res.json({
      success: true,
      stats: {
        total_patches: totalPatches,
        generated_patches: generatedPatches,
        sold_patches: soldPatches,
        total_views: totalViews[0]?.total_views || 0,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logActivity('Stats Error', { message: error.message });
    next(error);
  }
};
