import validator from 'validator';

export const validateEmail = (email) => {
  return validator.isEmail(email);
};

export const validateHexColor = (color) => {
  return /^#[0-9A-F]{6}$/i.test(color);
};

export const validateBase64Image = (base64String) => {
  try {
    if (!base64String || typeof base64String !== 'string') {
      return false;
    }
    
    return /^[A-Za-z0-9+/=]+$/.test(base64String);
  } catch {
    return false;
  }
};

export const validateLogoFile = (buffer, maxSizeMB = 5) => {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  
  if (!buffer || buffer.length === 0) {
    throw new Error('Logo file is empty');
  }
  
  if (buffer.length > maxSizeBytes) {
    throw new Error(`Logo file exceeds ${maxSizeMB}MB limit`);
  }

  return true;
};

export const sanitizeEmail = (email) => {
  return email.toLowerCase().trim();
};

export const validateGenerationRequest = (data) => {
  const errors = [];

  if (!data.email || !validateEmail(data.email)) {
    errors.push('Invalid email address');
  }

  if (!data.background_color || !validateHexColor(data.background_color)) {
    errors.push('Invalid background color format');
  }

  if (!data.border_color || !validateHexColor(data.border_color)) {
    errors.push('Invalid border color format');
  }

  if (!data.logo) {
    errors.push('Logo is required');
  }

  if (errors.length > 0) {
    throw new Error(`Validation error: ${errors.join(', ')}`);
  }

  return true;
};

export const validateColorExtractionRequest = (data) => {
  if (!data.logo) {
    throw new Error('Logo is required for color extraction');
  }

  if (!validateBase64Image(data.logo)) {
    throw new Error('Invalid base64 image format');
  }

  return true;
};
