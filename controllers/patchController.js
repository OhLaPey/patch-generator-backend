import { Patch } from '../config/mongodb.js';
import { User } from '../models/User.js';
import { uploadToGCS } from '../config/gcs.js';
import { generatePatchImage, extractDominantColors } from '../config/gemini.js';
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
      source = req.body.source || 'generator-page';

      console.log('📱 FormData upload (Android):', {
        fileSize: req.file.size,
        email: email,
        shape: shape,
        size: size,
        club_name: club_name,
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
      source = req.body.source || 'generator-page';

      console.log('💻 JSON upload (iPhone/PC)', { shape: shape, size: size, club_name: club_name });
    }

    validateGenerationRequest({ logo, background_color, border_color, email });

    const clientIP = getClientIP(req);
    const patchId = generatePatchId();

    logActivity('Patch Generation Started', { 
      patchId, 
      email, 
      ipAddress: clientIP 
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
      source,
      status: 'processing',
    });

    await patch.save();

    const logoBuffer = Buffer.from(logo, 'base64');

    if (logoBuffer.length > 5 * 1024 * 1024) {
      throw new Error('Logo file exceeds 5MB limit');
    }

    // ✅ NOUVEAU: Sauvegarder le logo original sur GCS
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

    // Génération de l'image du patch avec Gemini
    const patchImageBase64 = await generatePatchImage(
      optimizedLogoBuffer.toString('base64'),
      background_color,
      border_color,
      shape
    );

    // ✅ LOGS DE DEBUG
    console.log('🔍 Received base64 length:', patchImageBase64.length);
    console.log('🔍 Starts with:', patchImageBase64.substring(0, 50));

    // Conversion base64 → Buffer
    const generatedImageBuffer = Buffer.from(patchImageBase64, 'base64');
    console.log('🔍 Buffer length:', generatedImageBuffer.length, 'bytes');

    // Upload vers GCS
    const gcsFilename = generateFilename(patchId, 'png');
    const publicImageUrl = await uploadToGCS(gcsFilename, generatedImageBuffer, 'image/png');

    // Mise à jour du patch dans MongoDB
    patch.generated_image_url = publicImageUrl;
    patch.generated_image_gcs_path = gcsFilename;
    patch.status = 'generated';
    await patch.save();

    // ✅ Incrémenter le compteur de patchs pour l'utilisateur
    try {
      await User.updateOne(
        { email: sanitizeEmail(email) },
        { 
          $inc: { patches_generated: 1 },
          $set: { last_activity: new Date() }
        }
      );
    } catch (userError) {
      console.warn('⚠️  Could not update user patch count:', userError.message);
    }

    logActivity('Patch Generation Success', { patchId, imageUrl: publicImageUrl });

    res.json({
      success: true,
      patch_id: patchId,
      image_url: publicImageUrl,
      background_color,
      border_color,
      shape,
      size,
      club_name,
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
