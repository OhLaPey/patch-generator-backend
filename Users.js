import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  user_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  first_name: {
    type: String,
    trim: true,
  },
  segment: {
    type: String,
    enum: ['supporter', 'club', 'boutique', 'autre'],
    default: 'supporter',
  },
  optin_marketing: {
    type: Boolean,
    default: false,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  last_activity: {
    type: Date,
    default: Date.now,
  },
  patches_generated: {
    type: Number,
    default: 0,
  },
  ip_addresses: [{
    type: String,
  }],
});

// Index pour rechercher par email rapidement
userSchema.index({ email: 1 });

// Méthode pour mettre à jour la dernière activité
userSchema.methods.updateActivity = function() {
  this.last_activity = new Date();
  return this.save();
};

export const User = mongoose.model('User', userSchema);
