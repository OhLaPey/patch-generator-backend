/**
 * PPATCH - Bot Telegram Unifié v2
 * - Validation Emails (/next)
 * - Validation Logos multi-sources (/logo)
 */

import TelegramBot from 'node-telegram-bot-api';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import axios from 'axios';

// ============================================
// CONFIGURATION
// ============================================

const getConfig = () => ({
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  adminChatId: process.env.ADMIN_CHAT_ID || null,

  sheetId: process.env.GOOGLE_SHEET_ID,
  sheetName: 'Exploitables',
  googleClientEmail: process.env.GOOGLE_CLIENT_EMAIL,
  googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),

  brevoApiKey: process.env.BREVO_API_KEY,
  brevoListId: parseInt(process.env.BREVO_LIST_ID || '6'),

  shopifyStore: process.env.SHOPIFY_SHOP_NAME,
  shopifyAccessToken: process.env.SHOPIFY_ACCESS_TOKEN,

  // Google Custom Search
  googleApiKey: process.env.GOOGLE_API_KEY,
  googleCx: process.env.GOOGLE_CX,
});

// ============================================
// VARIABLES GLOBALES
// ============================================

let bot = null;
let doc = null;
let sheet = null;
let CONFIG = null;

const userState = new Map();

// ============================================
// GOOGLE SHEETS
// ============================================

async function initGoogleSheets() {
  const auth = new JWT({
    email: CONFIG.googleClientEmail,
    key: CONFIG.googlePrivateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  doc = new GoogleSpreadsheet(CONFIG.sheetId, auth);
  await doc.loadInfo();
  sheet = doc.sheetsByTitle[CONFIG.sheetName];

  if (!sheet) {
    throw new Error(`Feuille "${CONFIG.sheetName}" non trouvée`);
  }

  console.log(`📊 Google Sheets connecté: ${doc.title}`);
  return sheet;
}

// ============================================
// RECHERCHE LOGOS MULTI-SOURCES
// ============================================

async function searchLogoWikipedia(clubName) {
  try {
    const searchUrl = `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(clubName)}&format=json&origin=*`;
    const searchRes = await axios.get(searchUrl, { timeout: 5000 });

    if (searchRes.data.query?.search?.length > 0) {
      const pageTitle = searchRes.data.query.search[0].title;

      const imagesUrl = `https://fr.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=images&format=json&origin=*`;
      const imagesRes = await axios.get(imagesUrl, { timeout: 5000 });

      const pages = imagesRes.data.query?.pages;
      if (pages) {
        const page = Object.values(pages)[0];
        const images = page.images || [];

        const logoImage = images.find(img =>
          img.title.toLowerCase().includes('logo') ||
          img.title.toLowerCase().includes('blason') ||
          img.title.toLowerCase().includes('écusson') ||
          img.title.toLowerCase().includes('emblem')
        );

        if (logoImage) {
          const imageInfoUrl = `https://fr.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(logoImage.title)}&prop=imageinfo&iiprop=url&format=json&origin=*`;
          const imageInfoRes = await axios.get(imageInfoUrl, { timeout: 5000 });

          const imagePages = imageInfoRes.data.query?.pages;
          if (imagePages) {
            const imagePage = Object.values(imagePages)[0];
            return imagePage.imageinfo?.[0]?.url || null;
          }
        }
      }
    }
    return null;
  } catch (error) {
    console.log(`⚠️ Wikipedia error for ${clubName}:`, error.message);
    return null;
  }
}

async function searchLogoGoogle(clubName, numResults = 3) {
  if (!CONFIG.googleApiKey || !CONFIG.googleCx) {
    return [];
  }

  try {
    const query = `${clubName} logo png`;
    const url = `https://www.googleapis.com/customsearch/v1?key=${CONFIG.googleApiKey}&cx=${CONFIG.googleCx}&q=${encodeURIComponent(query)}&searchType=image&num=${numResults}`;

    const res = await axios.get(url, { timeout: 10000 });

    if (res.data.items?.length > 0) {
      return res.data.items.map(item => ({
        url: item.link,
        title: item.title,
        thumbnail: item.image?.thumbnailLink
      }));
    }
    return [];
  } catch (error) {
    console.log(`⚠️ Google error for ${clubName}:`, error.message);
    return [];
  }
}

async function findAllLogos(clubName, besportLogo) {
  const logos = [];

  // 1. Logo BeSport (si présent)
  if (besportLogo && besportLogo.startsWith('http')) {
    logos.push({
      source: 'BeSport',
      url: besportLogo,
      emoji: '🅱️'
    });
  }

  // 2. Wikipedia
  const wikiLogo = await searchLogoWikipedia(clubName);
  if (wikiLogo) {
    logos.push({
      source: 'Wikipedia',
      url: wikiLogo,
      emoji: '📚'
    });
  }

  // 3. Google Images (top 3)
  const googleLogos = await searchLogoGoogle(clubName, 3);
  googleLogos.forEach((logo, index) => {
    logos.push({
      source: `Google ${index + 1}`,
      url: logo.url,
      emoji: '🔍'
    });
  });

  return logos;
}

// ============================================
// FONCTIONS EMAILS (existantes)
// ============================================

async function getNextClubForEmail() {
  const rows = await sheet.getRows();

  for (const row of rows) {
    const shopifyUrl = row.get('Statut_Shopify');
    const email = row.get('Email_1');
    const status = row.get('Status');

    if (shopifyUrl && shopifyUrl.startsWith('http') && email && !status) {
      return {
        row,
        data: {
          club: row.get('Club') || row.get('Nom_Court'),
          email: email,
          sport: row.get('Sport'),
          ville: row.get('Ville'),
          departement: row.get('Departement'),
          codePostal: row.get('Code_Postal'),
          shopifyUrl: shopifyUrl,
          rowIndex: row.rowNumber
        }
      };
    }
  }

  return null;
}

// ============================================
// FONCTIONS LOGOS
// ============================================

async function getNextClubForLogo() {
  const rows = await sheet.getRows();

  for (const row of rows) {
    const logoUrl = row.get('Logo');
    const statutShopify = row.get('Statut_Shopify');

    const hasLogo = logoUrl && logoUrl.startsWith('http');
    const noShopifyStatus = !statutShopify || statutShopify.trim() === '';
    const notRejected = statutShopify !== 'rejected';

    if (hasLogo && noShopifyStatus && notRejected) {
      return {
        row,
        data: {
          club: row.get('Club') || row.get('Nom_Court'),
          logo: logoUrl,
          sport: row.get('Sport'),
          ville: row.get('Ville'),
          departement: row.get('Departement'),
          region: row.get('Region'),
          rowIndex: row.rowNumber
        }
      };
    }
  }

  return null;
}

async function updateLogoStatus(row, status) {
  row.set('Statut_Shopify', status);
  await row.save();
  console.log(`✅ Logo status mis à jour: ${status}`);
}

// ============================================
// SHOPIFY - Suppression
// ============================================

async function getProductHandleFromUrl(url) {
  const match = url.match(/\/products\/([^\/\?]+)/);
  return match ? match[1] : null;
}

async function getProductIdByHandle(handle) {
  if (!CONFIG.shopifyStore || !CONFIG.shopifyAccessToken) {
    return null;
  }

  try {
    const response = await fetch(
      `https://${CONFIG.shopifyStore}/admin/api/2024-01/products.json?handle=${handle}`,
      {
        headers: {
          'X-Shopify-Access-Token': CONFIG.shopifyAccessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      if (data.products && data.products.length > 0) {
        return data.products[0].id;
      }
    }
    return null;
  } catch (error) {
    console.error('❌ Erreur Shopify:', error.message);
    return null;
  }
}

async function deleteShopifyProduct(productId) {
  if (!CONFIG.shopifyStore || !CONFIG.shopifyAccessToken) {
    return { success: false, error: 'Shopify non configuré' };
  }

  try {
    const response = await fetch(
      `https://${CONFIG.shopifyStore}/admin/api/2024-01/products/${productId}.json`,
      {
        method: 'DELETE',
        headers: {
          'X-Shopify-Access-Token': CONFIG.shopifyAccessToken,
        }
      }
    );

    if (response.ok || response.status === 204) {
      return { success: true };
    } else {
      const error = await response.text();
      return { success: false, error };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// BREVO
// ============================================

async function addToBrevo(email, clubName, sport, ville) {
  if (!CONFIG.brevoApiKey) {
    return { success: false, error: 'API Key manquante' };
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': CONFIG.brevoApiKey
      },
      body: JSON.stringify({
        email: email,
        listIds: [CONFIG.brevoListId],
        attributes: {
          NOM_CLUB: clubName,
          SPORT: sport || '',
          VILLE: ville || ''
        },
        updateEnabled: true
      })
    });

    if (response.ok || response.status === 204) {
      return { success: true };
    } else {
      const error = await response.json();
      if (error.code === 'duplicate_parameter') {
        return { success: true, alreadyExists: true };
      }
      return { success: false, error: error.message };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// CRÉATION PAGE SHOPIFY
// ============================================

async function createClubShopifyPage(clubData, selectedLogoUrl) {
  try {
    const { processClub } = await import('../shopify/push-products.js');
    
    const club = {
      name: clubData.club,
      logo: selectedLogoUrl,
      logoHD: selectedLogoUrl,
      sport: clubData.sport,
      commune: clubData.ville,
      departement: clubData.departement,
      region: clubData.region
    };

    console.log(`🏭 Création page Shopify pour ${club.name} avec logo: ${selectedLogoUrl}`);
    
    const result = await processClub(club);
    
    if (result && result.success) {
      return {
        success: true,
        productUrl: result.productUrl,
        productId: result.productId
      };
    } else {
      return {
        success: false,
        error: result?.error || 'Erreur inconnue'
      };
    }
  } catch (error) {
    console.error('❌ Erreur création page:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================
// HELPERS
// ============================================

function isAuthorized(chatId) {
  if (!CONFIG.adminChatId) return true;
  return chatId.toString() === CONFIG.adminChatId.toString();
}

function getGoogleImagesLink(clubName) {
  const query = encodeURIComponent(`logo ${clubName}`);
  return `https://www.google.com/search?tbm=isch&q=${query}`;
}

async function getStats() {
  const rows = await sheet.getRows();

  let totalEmail = 0, pendingEmail = 0, sentEmail = 0, invalidEmail = 0;
  let totalLogo = 0, pendingLogo = 0, createdLogo = 0, rejectedLogo = 0;

  for (const row of rows) {
    const shopifyUrl = row.get('Statut_Shopify');
    const email = row.get('Email_1');
    const status = row.get('Status');
    const logo = row.get('Logo');

    if (shopifyUrl && shopifyUrl.startsWith('http') && email) {
      totalEmail++;
      if (status === 'sent') sentEmail++;
      else if (status === 'invalid') invalidEmail++;
      else pendingEmail++;
    }

    if (logo && logo.startsWith('http')) {
      totalLogo++;
      if (shopifyUrl && shopifyUrl.startsWith('http')) {
        createdLogo++;
      } else if (shopifyUrl === 'rejected') {
        rejectedLogo++;
      } else {
        pendingLogo++;
      }
    }
  }

  return { 
    totalEmail, pendingEmail, sentEmail, invalidEmail,
    totalLogo, pendingLogo, createdLogo, rejectedLogo
  };
}

// ============================================
// COMMANDES BOT
// ============================================

function setupBotCommands() {
  // /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) {
      return bot.sendMessage(chatId, '❌ Accès non autorisé\n\nTon Chat ID: ' + chatId);
    }

    const stats = await getStats();

    bot.sendMessage(chatId,
      `🎯 *PPATCH - Bot Unifié v2*\n\n` +
      `📧 *Emails:*\n` +
      `• À valider: ${stats.pendingEmail}\n` +
      `• Envoyés: ${stats.sentEmail}\n\n` +
      `🖼️ *Logos:*\n` +
      `• À valider: ${stats.pendingLogo}\n` +
      `• Pages créées: ${stats.createdLogo}\n` +
      `• Rejetés: ${stats.rejectedLogo}\n\n` +
      `*Commandes:*\n` +
      `/next - Valider emails\n` +
      `/logo - Valider logos + créer pages\n` +
      `/stats - Statistiques\n` +
      `/help - Aide`,
      { parse_mode: 'Markdown' }
    );
  });

  // /stats
  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;

    const stats = await getStats();

    bot.sendMessage(chatId,
      `📊 *Statistiques*\n\n` +
      `📧 *Emails:*\n` +
      `• Total avec page: ${stats.totalEmail}\n` +
      `• À valider: ${stats.pendingEmail}\n` +
      `• Envoyés Brevo: ${stats.sentEmail}\n` +
      `• Invalides: ${stats.invalidEmail}\n\n` +
      `🖼️ *Logos:*\n` +
      `• Total avec logo: ${stats.totalLogo}\n` +
      `• À valider: ${stats.pendingLogo}\n` +
      `• Pages créées: ${stats.createdLogo}\n` +
      `• Rejetés: ${stats.rejectedLogo}`,
      { parse_mode: 'Markdown' }
    );
  });

  // /next - Validation emails
  bot.onText(/\/next/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    await sendNextEmail(chatId);
  });

  // /logo - Validation logos
  bot.onText(/\/logo/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    await sendNextLogo(chatId);
  });

  // /help
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(chatId,
      `📖 *Aide*\n\n` +
      `*Validation Emails (/next):*\n` +
      `Valide les emails des clubs qui ont déjà une page Shopify.\n\n` +
      `*Validation Logos (/logo):*\n` +
      `1. Recherche logos sur BeSport, Wikipedia, Google\n` +
      `2. Tu choisis le meilleur logo\n` +
      `3. Création automatique de la page Shopify\n\n` +
      `*Actions logos:*\n` +
      `🅱️ 📚 🔍 → Choisir cette source\n` +
      `❌ Rejeter → Marque comme rejeté\n` +
      `⏭️ Passer → Passe sans rien faire`,
      { parse_mode: 'Markdown' }
    );
  });

  // Callback queries (boutons)
  bot.on('callback_query', handleCallbackQuery);
}

// ============================================
// ENVOI EMAILS
// ============================================

async function sendNextEmail(chatId) {
  const result = await getNextClubForEmail();

  if (!result) {
    return bot.sendMessage(chatId, '🎉 *Emails terminés !*\nTous les clubs ont été traités.', { parse_mode: 'Markdown' });
  }

  const { row, data } = result;
  userState.set(chatId, { mode: 'email', row, data });

  const googleImagesLink = getGoogleImagesLink(data.club);

  const message =
    `📧 *VALIDATION EMAIL*\n\n` +
    `🏆 *${data.club}*\n` +
    `⚽ Sport: ${data.sport || '-'}\n` +
    `📍 Ville: ${data.ville || '-'}\n\n` +
    `📧 *Email:* \`${data.email}\`\n\n` +
    `🔗 [Page Shopify](${data.shopifyUrl})\n` +
    `🔍 [Google Images](${googleImagesLink})`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Valide + Brevo', callback_data: 'email_valid' },
        { text: '❌ Invalide', callback_data: 'email_invalid' }
      ],
      [
        { text: '🗑️ Supprimer page', callback_data: 'email_delete' },
        { text: '⏭️ Passer', callback_data: 'email_skip' }
      ]
    ]
  };

  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
    disable_web_page_preview: false
  });
}

// ============================================
// ENVOI LOGOS (MULTI-SOURCES)
// ============================================

async function sendNextLogo(chatId) {
  await bot.sendMessage(chatId, '🔍 Recherche du prochain club et des logos...');

  const result = await getNextClubForLogo();

  if (!result) {
    return bot.sendMessage(chatId, '🎉 *Logos terminés !*\nTous les logos ont été traités.', { parse_mode: 'Markdown' });
  }

  const { row, data } = result;

  // Rechercher tous les logos disponibles
  await bot.sendMessage(chatId, `🔎 Recherche logos pour *${data.club}*...`, { parse_mode: 'Markdown' });
  
  const logos = await findAllLogos(data.club, data.logo);

  // Sauvegarder l'état
  userState.set(chatId, { mode: 'logo', row, data, logos });

  if (logos.length === 0) {
    const keyboard = {
      inline_keyboard: [
        [
          { text: '❌ Rejeter', callback_data: 'logo_reject' },
          { text: '⏭️ Passer', callback_data: 'logo_skip' }
        ]
      ]
    };

    return bot.sendMessage(chatId,
      `🏆 *${data.club}*\n` +
      `⚽ ${data.sport || '-'} | 📍 ${data.ville || '-'}\n\n` +
      `❌ *Aucun logo trouvé*\n\n` +
      `🔍 [Chercher manuellement](${getGoogleImagesLink(data.club)})`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  }

  // Envoyer chaque logo trouvé
  for (let i = 0; i < logos.length; i++) {
    const logo = logos[i];
    try {
      await bot.sendPhoto(chatId, logo.url, {
        caption: `${logo.emoji} *${logo.source}*`,
        parse_mode: 'Markdown'
      });
    } catch (e) {
      await bot.sendMessage(chatId, `${logo.emoji} *${logo.source}*: ${logo.url}`, { parse_mode: 'Markdown' });
    }
  }

  // Construire les boutons de sélection
  const logoButtons = logos.map((logo, index) => ({
    text: `${logo.emoji} ${logo.source}`,
    callback_data: `logo_select_${index}`
  }));

  // Organiser en rangées de 2-3 boutons
  const buttonRows = [];
  for (let i = 0; i < logoButtons.length; i += 3) {
    buttonRows.push(logoButtons.slice(i, i + 3));
  }

  // Ajouter les boutons Rejeter et Passer
  buttonRows.push([
    { text: '❌ Rejeter', callback_data: 'logo_reject' },
    { text: '⏭️ Passer', callback_data: 'logo_skip' }
  ]);

  const keyboard = { inline_keyboard: buttonRows };

  await bot.sendMessage(chatId,
    `🏆 *${data.club}*\n` +
    `⚽ ${data.sport || '-'} | 📍 ${data.ville || '-'}\n\n` +
    `📸 *${logos.length} logo(s) trouvé(s)*\n\n` +
    `👆 *Choisis le meilleur logo:*`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ============================================
// GESTION CALLBACKS
// ============================================

async function handleCallbackQuery(query) {
  const chatId = query.message.chat.id;
  const action = query.data;

  if (!isAuthorized(chatId)) return;

  const state = userState.get(chatId);

  // Actions emails
  if (action.startsWith('email_')) {
    if (!state || state.mode !== 'email') {
      return bot.answerCallbackQuery(query.id, { text: '❌ Tapez /next d\'abord' });
    }

    const { row, data } = state;

    if (action === 'email_skip') {
      await bot.answerCallbackQuery(query.id, { text: '⏭️ Passé' });
      userState.delete(chatId);
      return sendNextEmail(chatId);
    }

    if (action === 'email_valid') {
      await bot.answerCallbackQuery(query.id, { text: '⏳ Ajout Brevo...' });
      const brevoResult = await addToBrevo(data.email, data.club, data.sport, data.ville);
      
      if (brevoResult.success) {
        row.set('Status', 'sent');
        await row.save();
        await bot.sendMessage(chatId, `✅ *${data.club}* ajouté à Brevo !`, { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, `⚠️ Erreur Brevo: ${brevoResult.error}`);
      }
      
      userState.delete(chatId);
      setTimeout(() => sendNextEmail(chatId), 500);
    }

    if (action === 'email_invalid') {
      await bot.answerCallbackQuery(query.id, { text: '❌ Marqué invalide' });
      row.set('Status', 'invalid');
      await row.save();
      await bot.sendMessage(chatId, `❌ *${data.club}* marqué invalide`, { parse_mode: 'Markdown' });
      
      userState.delete(chatId);
      setTimeout(() => sendNextEmail(chatId), 500);
    }

    if (action === 'email_delete') {
      await bot.answerCallbackQuery(query.id, { text: '⏳ Suppression...' });
      
      const handle = await getProductHandleFromUrl(data.shopifyUrl);
      if (handle) {
        const productId = await getProductIdByHandle(handle);
        if (productId) {
          await deleteShopifyProduct(productId);
        }
      }
      
      row.set('Statut_Shopify', '');
      row.set('Status', 'deleted');
      await row.save();
      
      await bot.sendMessage(chatId, `🗑️ *${data.club}* supprimé`, { parse_mode: 'Markdown' });
      
      userState.delete(chatId);
      setTimeout(() => sendNextEmail(chatId), 500);
    }
  }

  // Actions logos
  if (action.startsWith('logo_')) {
    if (!state || state.mode !== 'logo') {
      return bot.answerCallbackQuery(query.id, { text: '❌ Tapez /logo d\'abord' });
    }

    const { row, data, logos } = state;

    if (action === 'logo_skip') {
      await bot.answerCallbackQuery(query.id, { text: '⏭️ Passé' });
      userState.delete(chatId);
      return sendNextLogo(chatId);
    }

    if (action === 'logo_reject') {
      await bot.answerCallbackQuery(query.id, { text: '❌ Logo rejeté' });
      await updateLogoStatus(row, 'rejected');
      await bot.sendMessage(chatId, `❌ *${data.club}* logo rejeté`, { parse_mode: 'Markdown' });
      
      userState.delete(chatId);
      setTimeout(() => sendNextLogo(chatId), 500);
    }

    // Sélection d'un logo spécifique
    if (action.startsWith('logo_select_')) {
      const logoIndex = parseInt(action.replace('logo_select_', ''));
      const selectedLogo = logos[logoIndex];

      if (!selectedLogo) {
        return bot.answerCallbackQuery(query.id, { text: '❌ Logo non trouvé' });
      }

      await bot.answerCallbackQuery(query.id, { text: '⏳ Création en cours...' });
      await bot.sendMessage(chatId, 
        `⏳ Création de la page Shopify pour *${data.club}*...\n` +
        `📸 Logo: ${selectedLogo.source}\n` +
        `_(génération visuels + produit, ~2-3 min)_`, 
        { parse_mode: 'Markdown' }
      );

      const result = await createClubShopifyPage(data, selectedLogo.url);

      if (result.success) {
        await updateLogoStatus(row, result.productUrl);
        await bot.sendMessage(chatId, 
          `✅ *${data.club}* page créée !\n\n` +
          `🔗 [Voir la page](${result.productUrl})`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await bot.sendMessage(chatId, `❌ Erreur création: ${result.error}`);
      }

      userState.delete(chatId);
      setTimeout(() => sendNextLogo(chatId), 1000);
    }
  }
}

// ============================================
// EXPORT - Fonction de démarrage
// ============================================

export async function startTelegramBot() {
  CONFIG = getConfig();

  if (!CONFIG.telegramToken) {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN non configuré - Bot désactivé');
    return null;
  }

  if (!CONFIG.sheetId || !CONFIG.googleClientEmail || !CONFIG.googlePrivateKey) {
    console.warn('⚠️ Google Sheets non configuré - Bot désactivé');
    return null;
  }

  try {
    await initGoogleSheets();

    bot = new TelegramBot(CONFIG.telegramToken, { polling: true });

    setupBotCommands();

    console.log('✅ Bot Telegram démarré');

    if (CONFIG.adminChatId) {
      try {
        await bot.sendMessage(CONFIG.adminChatId, '🤖 Bot PPATCH v2 redémarré !\n\n/logo pour valider les logos avec recherche multi-sources');
      } catch (e) {
        console.log('⚠️ Impossible de notifier l\'admin');
      }
    }

    return bot;
  } catch (error) {
    console.error('❌ Erreur démarrage bot:', error.message);
    return null;
  }
}

export default { startTelegramBot };