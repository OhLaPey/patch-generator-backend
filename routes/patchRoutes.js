import express from 'express';
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

export default router;
