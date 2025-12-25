import mongoose from 'mongoose';

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');
    return conn;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Patch Generation Schema
const patchSchema = new mongoose.Schema(
  {
    patch_id: {
      type: String,
      unique: true,
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    ip_address: String,
    user_agent: String,
    
    // Original uploaded data
    original_logo_filename: String,
    original_logo_size: Number,
    
    // Generated patch data
    generated_image_url: String,
    generated_image_gcs_path: String,
    
    // Colors
    background_color: {
      type: String,
      required: true,
      match: /^#[0-9A-F]{6}$/i,
    },
    border_color: {
      type: String,
      required: true,
      match: /^#[0-9A-F]{6}$/i,
    },
    dominant_colors: [
      {
        type: String,
        match: /^#[0-9A-F]{6}$/i,
      }
    ],
    
    // Shopify integration
    shopify_product_id: String,
    shopify_variant_id: String,
    shopify_product_url: String,
    
    // Status
    status: {
      type: String,
      enum: ['processing', 'generated', 'sold', 'archived'],
      default: 'processing',
    },
    
    // Analytics
    view_count: {
      type: Number,
      default: 0,
    },
    purchased: {
      type: Boolean,
      default: false,
    },
    
    // Metadata
    source: {
      type: String,
      enum: ['homepage', 'generator-page'],
      default: 'generator-page',
    },
    
    error_message: String,
    
    created_at: {
      type: Date,
      default: Date.now,
    },
    updated_at: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Index for faster queries
patchSchema.index({ created_at: -1 });
patchSchema.index({ email: 1 });
patchSchema.index({ patch_id: 1 });

export const Patch = mongoose.model('Patch', patchSchema);
