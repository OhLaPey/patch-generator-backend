import express from 'express';
import { migrateImages } from './migrate-images-route.js';
import {
  extractColors,
  generatePatch,
  getGallery,
  getPatch,
  getStats,
} from '../controllers/patchController.js';

const router = express.Router();

router.post('/extract-colors', extractColors);
router.post('/generate-patch', generatePatch);
router.get('/gallery', getGallery);
router.get('/patch/:patchId', getPatch);
router.get('/stats', getStats);
router.get('/admin/migrate-images', migrateImages);

export default router;
