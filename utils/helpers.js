import { v4 as uuidv4 } from 'uuid';

export const generatePatchId = () => {
  return `patch_${uuidv4()}`;
};

export const generateFilename = (patchId, format = 'png') => {
  const timestamp = Date.now();
  return `patches/${patchId}_${timestamp}.${format}`;
};

export const getClientIP = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim(); // ✅ Prendre la première IP seulement
  }
  return (
    req.headers['x-real-ip'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.ip ||
    'unknown'
  );
};

export const logActivity = (activity, data) => {
  console.log(`[${new Date().toISOString()}] ${activity}:`, data);
};

export const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
