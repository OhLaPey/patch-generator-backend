import { Storage } from '@google-cloud/storage';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

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

export const uploadToGCS = async (filename, buffer, contentType = 'image/png') => {
  try {
    const file = bucket.file(filename);
    
    await file.save(buffer, {
      metadata: {
        contentType: contentType,
        cacheControl: 'public, max-age=86400', // 24h cache
      },
    });

    // Make file public
    await file.makePublic();

    // Get public URL
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
    
    console.log(`✅ Uploaded to GCS: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    console.error('❌ GCS upload error:', error.message);
    throw new Error(`Failed to upload to GCS: ${error.message}`);
  }
};

export const getBucket = () => bucket;
export const getStorage = () => storage;
