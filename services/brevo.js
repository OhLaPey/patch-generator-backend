/**
 * PPATCH - Service Brevo
 * 
 * Envoie les contacts vers Brevo après génération de patch
 * pour déclencher les automations (email "Votre patch vous attend")
 */

import dotenv from 'dotenv';
dotenv.config();

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_LIST_ID = parseInt(process.env.BREVO_LIST_ID) || 2;

/**
 * Envoyer/mettre à jour un contact dans Brevo après génération de patch
 * 
 * @param {Object} data - Données du contact et du patch
 * @param {string} data.email - Email du contact
 * @param {string} data.firstName - Prénom
 * @param {string} data.segment - Segment (supporter, club, boutique, autre)
 * @param {string} data.patchImageUrl - URL de l'image du patch généré
 * @param {string} data.clubName - Nom du club détecté
 * @param {string} data.patchId - ID du patch
 * @param {number} data.patchesGenerated - Nombre total de patchs générés
 * @returns {Promise<{success: boolean, action?: string, error?: string}>}
 */
export async function sendContactToBrevo(data) {
  // Vérifier que l'API key est configurée
  if (!BREVO_API_KEY) {
    console.warn('⚠️ BREVO_API_KEY non configurée - contact non envoyé');
    return { success: false, error: 'API key manquante' };
  }

  // Vérifier l'email
  if (!data.email) {
    console.warn('⚠️ Email manquant - contact non envoyé à Brevo');
    return { success: false, error: 'Email manquant' };
  }

  const url = 'https://api.brevo.com/v3/contacts';

  // Préparer les attributs pour Brevo
  const attributes = {
    PRENOM: data.firstName || '',
    SEGMENT: data.segment || 'supporter',
    PATCHES_GENERES: data.patchesGenerated || 1,
    DERNIER_PATCH_URL: data.patchImageUrl || '',
    DERNIER_PATCH_ID: data.patchId || '',
    CLUB_NAME: data.clubName || '',
    DERNIER_PATCH_DATE: new Date().toISOString().split('T')[0],
    DERNIERE_ACTIVITE: new Date().toISOString().split('T')[0],
  };

  const body = {
    email: data.email.toLowerCase().trim(),
    attributes: attributes,
    listIds: [BREVO_LIST_ID],
    updateEnabled: true, // Met à jour si le contact existe déjà
  };

  try {
    console.log(`📧 Envoi contact Brevo: ${data.email}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 201) {
      console.log(`✅ Brevo: contact créé - ${data.email}`);
      return { success: true, action: 'created' };
    } else if (response.status === 204) {
      console.log(`🔄 Brevo: contact mis à jour - ${data.email}`);
      return { success: true, action: 'updated' };
    } else {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.message || `HTTP ${response.status}`;
      console.error(`❌ Brevo erreur: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    console.error(`❌ Brevo exception: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Marquer un contact comme "a acheté" dans Brevo
 * Utile pour exclure des automations de relance
 * 
 * @param {string} email - Email du contact
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function markContactAsPurchased(email) {
  if (!BREVO_API_KEY || !email) {
    return { success: false, error: 'Config manquante' };
  }

  const url = `https://api.brevo.com/v3/contacts/${encodeURIComponent(email.toLowerCase().trim())}`;

  const body = {
    attributes: {
      A_ACHETE: true,
      DATE_ACHAT: new Date().toISOString().split('T')[0],
    },
  };

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 204) {
      console.log(`✅ Brevo: contact marqué comme acheteur - ${email}`);
      return { success: true };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    console.error(`❌ Brevo markAsPurchased error: ${error.message}`);
    return { success: false, error: error.message };
  }
}
