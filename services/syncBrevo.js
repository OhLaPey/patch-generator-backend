/**
 * PPATCH - Sync MongoDB → Brevo
 * 
 * Synchronise les utilisateurs ayant généré des patchs mais pas acheté
 * vers Brevo pour les campagnes de relance panier abandonné.
 * 
 * Usage: node services/syncBrevo.js
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  mongoUri: process.env.MONGODB_URI,
  brevoApiKey: process.env.BREVO_API_KEY,
  brevoListId: parseInt(process.env.BREVO_LIST_ID) || 2,
  minPatchesGenerated: 1,
};

// ============================================
// SCHEMAS MONGOOSE (inline pour script standalone)
// ============================================

const userSchema = new mongoose.Schema({
  user_id: String,
  email: String,
  first_name: String,
  segment: String,
  optin_marketing: Boolean,
  patches_generated: { type: Number, default: 0 },
  ip_addresses: [String],
  created_at: { type: Date, default: Date.now },
  last_activity: { type: Date, default: Date.now },
});

const patchSchema = new mongoose.Schema({
  patch_id: String,
  user_id: String,
  email: String,
  generated_image_url: String,
  background_color: String,
  border_color: String,
  shape: String,
  club_name: String,
  status: String,
  created_at: { type: Date, default: Date.now },
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Patch = mongoose.models.Patch || mongoose.model('Patch', patchSchema);

// ============================================
// MONGODB
// ============================================

async function connectDB() {
  try {
    await mongoose.connect(CONFIG.mongoUri);
    console.log('✅ MongoDB connecté');
  } catch (error) {
    console.error('❌ Erreur MongoDB:', error.message);
    process.exit(1);
  }
}

async function getAbandonedCarts() {
  // Récupérer les users avec patchs générés
  const users = await User.find({
    patches_generated: { $gte: CONFIG.minPatchesGenerated },
    email: { $exists: true, $ne: '' },
  }).lean();

  console.log(`📊 ${users.length} utilisateurs avec patchs générés`);

  // Pour chaque user, récupérer ses patchs
  const usersWithPatches = [];

  for (const user of users) {
    const patches = await Patch.find({
      $or: [
        { user_id: user.user_id },
        { email: user.email }
      ]
    })
      .sort({ created_at: -1 })
      .limit(5)
      .lean();

    usersWithPatches.push({
      ...user,
      patches: patches,
    });
  }

  return usersWithPatches;
}

// ============================================
// BREVO API
// ============================================

async function createOrUpdateBrevoContact(user) {
  const url = 'https://api.brevo.com/v3/contacts';

  // Préparer les attributs
  const attributes = {
    PRENOM: user.first_name || '',
    SEGMENT: user.segment || 'supporter',
    PATCHES_GENERES: user.patches_generated || 0,
    DATE_INSCRIPTION: user.created_at
      ? new Date(user.created_at).toISOString().split('T')[0]
      : '',
    DERNIERE_ACTIVITE: user.last_activity
      ? new Date(user.last_activity).toISOString().split('T')[0]
      : '',
  };

  // Ajouter l'URL du dernier patch si disponible
  if (user.patches && user.patches.length > 0) {
    attributes.DERNIER_PATCH_URL = user.patches[0].generated_image_url || '';
    attributes.DERNIER_PATCH_DATE = user.patches[0].created_at
      ? new Date(user.patches[0].created_at).toISOString().split('T')[0]
      : '';
    attributes.CLUB_NAME = user.patches[0].club_name || '';
  }

  const body = {
    email: user.email,
    attributes: attributes,
    listIds: [CONFIG.brevoListId],
    updateEnabled: true,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': CONFIG.brevoApiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 201) {
      return { success: true, action: 'created' };
    } else if (response.status === 204) {
      return { success: true, action: 'updated' };
    } else {
      const error = await response.json();
      return { success: false, error: error.message || response.status };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getBrevoLists() {
  const url = 'https://api.brevo.com/v3/contacts/lists?limit=50';

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'api-key': CONFIG.brevoApiKey,
      },
    });

    if (response.ok) {
      const data = await response.json();
      return data.lists || [];
    }
    return [];
  } catch (error) {
    console.error('Erreur récupération listes:', error);
    return [];
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('🚀 PPATCH - Sync MongoDB → Brevo');
  console.log('='.repeat(50));

  // Vérifier les variables d'environnement
  if (!CONFIG.mongoUri) {
    console.error('❌ MONGODB_URI manquant dans .env');
    process.exit(1);
  }
  if (!CONFIG.brevoApiKey) {
    console.error('❌ BREVO_API_KEY manquant dans .env');
    console.log('💡 Crée un compte sur brevo.com et récupère ta clé API');
    process.exit(1);
  }

  console.log('📋 Configuration:');
  console.log(`   Liste Brevo ID: ${CONFIG.brevoListId}`);
  console.log(`   Min patchs générés: ${CONFIG.minPatchesGenerated}`);
  console.log('');

  // Connexion MongoDB
  await connectDB();

  // Afficher les listes Brevo existantes
  console.log('📂 Listes Brevo existantes:');
  const lists = await getBrevoLists();
  if (lists.length > 0) {
    lists.forEach((list) => {
      console.log(`   - [${list.id}] ${list.name} (${list.totalSubscribers} contacts)`);
    });
  } else {
    console.log('   Aucune liste trouvée (ou erreur API)');
  }
  console.log('');

  // Récupérer les paniers abandonnés
  console.log('🔍 Récupération des paniers abandonnés...');
  const users = await getAbandonedCarts();

  if (users.length === 0) {
    console.log('✅ Aucun panier abandonné à synchroniser.');
    await mongoose.disconnect();
    return;
  }

  console.log(`📊 ${users.length} utilisateurs à synchroniser\n`);

  // Synchroniser vers Brevo
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const user of users) {
    const result = await createOrUpdateBrevoContact(user);

    if (result.success) {
      if (result.action === 'created') {
        created++;
        console.log(`   ✅ ${user.email} - créé`);
      } else {
        updated++;
        console.log(`   🔄 ${user.email} - mis à jour`);
      }
    } else {
      errors++;
      console.log(`   ❌ ${user.email} - ${result.error}`);
    }

    // Petit délai pour respecter les rate limits
    await new Promise((r) => setTimeout(r, 100));
  }

  // Résumé
  console.log('\n' + '='.repeat(50));
  console.log('📊 RÉSUMÉ');
  console.log('='.repeat(50));
  console.log(`   Contacts créés: ${created}`);
  console.log(`   Contacts mis à jour: ${updated}`);
  console.log(`   Erreurs: ${errors}`);
  console.log('\n✅ Synchronisation terminée!');

  await mongoose.disconnect();
}

// Exécuter si appelé directement
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Erreur:', error);
    process.exit(1);
  });
}

// Export pour utilisation par le cron
export async function syncToBrevo() {
  // Vérifier les variables d'environnement
  if (!CONFIG.mongoUri) {
    throw new Error('MONGODB_URI manquant');
  }
  if (!CONFIG.brevoApiKey) {
    throw new Error('BREVO_API_KEY manquant');
  }

  // Connexion MongoDB (si pas déjà connecté)
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(CONFIG.mongoUri);
  }

  // Récupérer les paniers abandonnés
  const users = await getAbandonedCarts();

  if (users.length === 0) {
    console.log('   Aucun panier abandonné à synchroniser.');
    return { created: 0, updated: 0, errors: 0 };
  }

  console.log(`   ${users.length} utilisateurs à synchroniser`);

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const user of users) {
    const result = await createOrUpdateBrevoContact(user);

    if (result.success) {
      if (result.action === 'created') created++;
      else updated++;
    } else {
      errors++;
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`   Résultat: ${created} créés, ${updated} mis à jour, ${errors} erreurs`);
  
  return { created, updated, errors };
}
