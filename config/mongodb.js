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
    
    // Original uploaded logo
    original_logo_filename: String,
    original_logo_size: Number,
    original_logo_url: String,
    original_logo_gcs_path: String,
    
    // Generated patch data (rendu final)
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
    shape: {
      type: String,
      enum: ['square', 'logo_shape', 'circle', 'rectangle_h', 'rectangle_v', 'shield'],
      default: 'square',
    },
    size: {
      type: Number,
      min: 5,
      max: 10,
      default: 6.5,
    },
    club_name: {
      type: String,
      trim: true,
      default: '',
    },
    dominant_colors: [
      {
        type: String,
        match: /^#[0-9A-F]{6}$/i,
      }
    ],
    
    // Shopify Product
    shopify_product_id: String,
    shopify_variant_id: String,
    shopify_product_url: String,
    shopify_product_handle: String,
    
    // Shopify Order (après achat)
    shopify_order_id: {
      type: String,
      index: true,
    },
    shopify_order_number: String,
    purchase_date: Date,
    
    // Vectorisation
    vectorized: {
      type: Boolean,
      default: false,
    },
    vectorized_at: Date,
    vectorized_svg_url: String,
    
    // Email notification
    email_sent: {
      type: Boolean,
      default: false,
    },
    email_sent_at: Date,
    
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
