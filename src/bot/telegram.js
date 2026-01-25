/**
 * PPATCH - Bot Telegram Unifié v5
 * - 6 images Google
 * - Recherche PNG HD prioritaire
 * - Pré-chargement 5 clubs d'avance
 */

import TelegramBot from 'node-telegram-bot-api';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import axios from 'axios';

const getConfig = () => ({
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  adminChatId: process.env.ADMIN_CHAT_ID || null,
  sheetId: process.env.GOOGLE_SHEET_ID,
  sheetName: 'Exploitables',
  googleClientEmail: process.env.GOOGLE_CLIENT_EMAIL,
  googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  brevoApiKey: process.env.BREVO_API_KEY,
  brevoListId: parseInt(process.env.BREVO_LIST_ID_DEMARCHAGE || process.env.BREVO_LIST_ID || '6'),
  shopifyStore: process.env.SHOPIFY_SHOP_NAME,
  shopifyAccessToken: process.env.SHOPIFY_ACCESS_TOKEN,
  googleApiKey: process.env.GOOGLE_API_KEY,
  googleCx: process.env.GOOGLE_CX,
});

let bot = null;
let doc = null;
let sheet = null;
let CONFIG = null;
const userState = new Map();

// Cache pour pré-chargement des clubs
const clubCache = [];
const CACHE_SIZE = 5;
let isCacheLoading = false;

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
    throw new Error('Feuille "' + CONFIG.sheetName + '" non trouvée');
  }
  console.log('📊 Google Sheets connecté: ' + doc.title);
  return sheet;
}

async function isValidImageUrl(url) {
  try {
    const response = await axios.head(url, { timeout: 5000 });
    const contentType = response.headers['content-type'] || '';
    return contentType.startsWith('image/');
  } catch (error) {
    try {
      const response = await axios.get(url, { timeout: 5000, responseType: 'arraybuffer', maxContentLength: 100000 });
      const contentType = response.headers['content-type'] || '';
      return contentType.startsWith('image/');
    } catch (e) {
      return false;
    }
  }
}

async function searchLogoWikipedia(clubName) {
  try {
    const searchUrl = 'https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(clubName) + '&format=json&origin=*';
    const searchRes = await axios.get(searchUrl, { timeout: 5000 });
    if (searchRes.data.query?.search?.length > 0) {
      const pageTitle = searchRes.data.query.search[0].title;
      const imagesUrl = 'https://fr.wikipedia.org/w/api.php?action=query&titles=' + encodeURIComponent(pageTitle) + '&prop=images&format=json&origin=*';
      const imagesRes = await axios.get(imagesUrl, { timeout: 5000 });
      const pages = imagesRes.data.query?.pages;
      if (pages) {
        const page = Object.values(pages)[0];
        const images = page.images || [];
        const logoImage = images.find(function(img) {
          const title = img.title.toLowerCase();
          return title.includes('logo') || title.includes('blason') || title.includes('écusson') || title.includes('emblem');
        });
        if (logoImage) {
          const imageInfoUrl = 'https://fr.wikipedia.org/w/api.php?action=query&titles=' + encodeURIComponent(logoImage.title) + '&prop=imageinfo&iiprop=url&format=json&origin=*';
          const imageInfoRes = await axios.get(imageInfoUrl, { timeout: 5000 });
          const imagePages = imageInfoRes.data.query?.pages;
          if (imagePages) {
            const imagePage = Object.values(imagePages)[0];
            const imageUrl = imagePage.imageinfo?.[0]?.url || null;
            if (imageUrl && await isValidImageUrl(imageUrl)) {
              return imageUrl;
            }
          }
        }
      }
    }
    return null;
  } catch (error) {
    console.log('⚠️ Wikipedia error for ' + clubName + ': ' + error.message);
    return null;
  }
}

async function searchLogoGoogle(clubName, sport, targetCount) {
  targetCount = targetCount || 6;
  if (!CONFIG.googleApiKey || !CONFIG.googleCx) {
    return [];
  }
  
  const validLogos = [];
  const seenUrls = new Set();
  
  // Requêtes de recherche optimisées (PNG HD en priorité)
  const queries = [
    clubName + ' ' + (sport || '') + ' logo png transparent HD',
    clubName + ' ' + (sport || '') + ' logo officiel',
    clubName + ' blason écusson png'
  ];
  
  for (let q = 0; q < queries.length && validLogos.length < targetCount; q++) {
    try {
      const query = queries[q].trim().replace(/\s+/g, ' ');
      const numToFetch = Math.min(10, (targetCount - validLogos.length) + 3);
      const url = 'https://www.googleapis.com/customsearch/v1?key=' + CONFIG.googleApiKey + '&cx=' + CONFIG.googleCx + '&q=' + encodeURIComponent(query) + '&searchType=image&num=' + numToFetch + '&imgType=photo&imgSize=large';
      
      const res = await axios.get(url, { timeout: 10000 });
      
      if (res.data.items?.length > 0) {
        for (let i = 0; i < res.data.items.length && validLogos.length < targetCount; i++) {
          const item = res.data.items[i];
          
          // Éviter les doublons
          if (seenUrls.has(item.link)) continue;
          seenUrls.add(item.link);
          
          const isValid = await isValidImageUrl(item.link);
          if (isValid) {
            validLogos.push({
              url: item.link,
              title: item.title,
              thumbnail: item.image?.thumbnailLink
            });
          }
        }
      }
    } catch (error) {
      console.log('⚠️ Google error: ' + error.message);
    }
  }
  
  return validLogos;
}

async function findAllLogos(clubName, besportLogo, sport) {
  const logos = [];
  
  // 1. Logo BeSport
  if (besportLogo && besportLogo.startsWith('http')) {
    const isValid = await isValidImageUrl(besportLogo);
    if (isValid) {
      logos.push({ source: 'BeSport', url: besportLogo, emoji: '🅱️' });
    }
  }
  
  // 2. Wikipedia
  const wikiLogo = await searchLogoWikipedia(clubName);
  if (wikiLogo) {
    logos.push({ source: 'Wikipedia', url: wikiLogo, emoji: '📚' });
  }
  
  // 3. Google Images - 6 images HD
  const googleLogos = await searchLogoGoogle(clubName, sport, 6);
  googleLogos.forEach(function(logo, index) {
    logos.push({ source: 'Google ' + (index + 1), url: logo.url, emoji: '🔍' });
  });
  
  return logos;
}

// ============ PRÉ-CHARGEMENT ============

async function getNextClubsForLogo(count) {
  const rows = await sheet.getRows();
  const clubs = [];
  
  for (let i = 0; i < rows.length && clubs.length < count; i++) {
    const row = rows[i];
    const logoUrl = row.get('Logo');
    const statutShopify = row.get('Statut_Shopify');
    const hasLogo = logoUrl && logoUrl.startsWith('http');
    const noShopifyStatus = !statutShopify || statutShopify.trim() === '';
    const notRejected = statutShopify !== 'rejected';
    const notProcessing = statutShopify !== 'processing';
    const notSkipped = statutShopify !== 'skipped';
    const notError = !statutShopify || !statutShopify.startsWith('error');
    
    if (hasLogo && noShopifyStatus && notRejected && notProcessing && notSkipped && notError) {
      clubs.push({
        row: row,
        data: {
          club: row.get('Club') || row.get('Nom_Court'),
          logo: logoUrl,
          sport: row.get('Sport'),
          ville: row.get('Ville'),
          departement: row.get('Departement'),
          region: row.get('Region'),
          rowIndex: row.rowNumber
        }
      });
    }
  }
  
  return clubs;
}

async function preloadClubLogos() {
  if (isCacheLoading) return;
  isCacheLoading = true;
  
  try {
    // Charger les prochains clubs si le cache est bas
    while (clubCache.length < CACHE_SIZE) {
      const clubs = await getNextClubsForLogo(CACHE_SIZE - clubCache.length + 2);
      
      if (clubs.length === 0) break;
      
      for (const clubInfo of clubs) {
        // Vérifier si déjà en cache
        const alreadyCached = clubCache.some(c => c.data.rowIndex === clubInfo.data.rowIndex);
        if (alreadyCached) continue;
        
        // Charger les logos
        console.log('📦 Pré-chargement: ' + clubInfo.data.club);
        const logos = await findAllLogos(clubInfo.data.club, clubInfo.data.logo, clubInfo.data.sport);
        
        clubCache.push({
          row: clubInfo.row,
          data: clubInfo.data,
          logos: logos
        });
        
        if (clubCache.length >= CACHE_SIZE) break;
      }
      
      // Éviter boucle infinie
      break;
    }
    
    console.log('📦 Cache: ' + clubCache.length + '/' + CACHE_SIZE + ' clubs pré-chargés');
  } catch (error) {
    console.log('⚠️ Erreur pré-chargement: ' + error.message);
  }
  
  isCacheLoading = false;
}

async function getNextClubFromCache() {
  // Chercher dans le cache d'abord
  while (clubCache.length > 0) {
    const cached = clubCache.shift();
    
    // Vérifier que le club n'a pas été traité entre-temps
    await cached.row.load();
    const currentStatus = cached.row.get('Statut_Shopify');
    
    if (!currentStatus || currentStatus.trim() === '') {
      // Relancer le pré-chargement en arrière-plan
      setTimeout(preloadClubLogos, 100);
      return cached;
    }
  }
  
  // Cache vide, charger directement
  const clubs = await getNextClubsForLogo(1);
  if (clubs.length === 0) return null;
  
  const clubInfo = clubs[0];
  const logos = await findAllLogos(clubInfo.data.club, clubInfo.data.logo, clubInfo.data.sport);
  
  // Relancer le pré-chargement en arrière-plan
  setTimeout(preloadClubLogos, 100);
  
  return {
    row: clubInfo.row,
    data: clubInfo.data,
    logos: logos
  };
}

// ============ EMAILS ============

async function getNextClubForEmail() {
  const rows = await sheet.getRows();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const shopifyUrl = row.get('Statut_Shopify');
    const email = row.get('Email_1');
    const status = row.get('Status');
    if (shopifyUrl && shopifyUrl.startsWith('http') && email && !status) {
      return {
        row: row,
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

async function updateLogoStatus(row, status) {
  row.set('Statut_Shopify', status);
  await row.save();
  console.log('✅ Logo status mis à jour: ' + status);
}

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
      'https://' + CONFIG.shopifyStore + '/admin/api/2024-01/products.json?handle=' + handle,
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
    console.error('❌ Erreur Shopify: ' + error.message);
    return null;
  }
}

async function deleteShopifyProduct(productId) {
  if (!CONFIG.shopifyStore || !CONFIG.shopifyAccessToken) {
    return { success: false, error: 'Shopify non configuré' };
  }
  try {
    const response = await fetch(
      'https://' + CONFIG.shopifyStore + '/admin/api/2024-01/products/' + productId + '.json',
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
      return { success: false, error: error };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

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
    console.log('🏭 Création page Shopify pour ' + club.name + ' avec logo: ' + selectedLogoUrl);
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
    console.error('❌ Erreur création page: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

function isAuthorized(chatId) {
  if (!CONFIG.adminChatId) return true;
  return chatId.toString() === CONFIG.adminChatId.toString();
}

function getGoogleImagesLink(clubName, sport) {
  let query = 'logo ' + clubName;
  if (sport) {
    query = 'logo ' + clubName + ' ' + sport;
  }
  return 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(query);
}

async function getStats() {
  const rows = await sheet.getRows();
  let totalEmail = 0, pendingEmail = 0, sentEmail = 0, invalidEmail = 0;
  let totalLogo = 0, pendingLogo = 0, createdLogo = 0, rejectedLogo = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
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
  return { totalEmail, pendingEmail, sentEmail, invalidEmail, totalLogo, pendingLogo, createdLogo, rejectedLogo };
}

function setupBotCommands() {
  bot.onText(/\/start/, async function(msg) {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) {
      return bot.sendMessage(chatId, '❌ Accès non autorisé\n\nTon Chat ID: ' + chatId);
    }
    const stats = await getStats();
    bot.sendMessage(chatId,
      '🎯 *PPATCH - Bot Unifié v5*\n\n' +
      '📧 *Emails:*\n' +
      '• À valider: ' + stats.pendingEmail + '\n' +
      '• Envoyés: ' + stats.sentEmail + '\n\n' +
      '🖼️ *Logos:*\n' +
      '• À valider: ' + stats.pendingLogo + '\n' +
      '• Pages créées: ' + stats.createdLogo + '\n' +
      '• Rejetés: ' + stats.rejectedLogo + '\n\n' +
      '📦 *Cache:* ' + clubCache.length + ' clubs pré-chargés\n\n' +
      '*Commandes:*\n' +
      '/next - Valider emails\n' +
      '/logo - Valider logos + créer pages\n' +
      '/stats - Statistiques\n' +
      '/help - Aide',
      { parse_mode: 'Markdown' }
    );
    
    // Lancer le pré-chargement
    preloadClubLogos();
  });

  bot.onText(/\/stats/, async function(msg) {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    const stats = await getStats();
    bot.sendMessage(chatId,
      '📊 *Statistiques*\n\n' +
      '📧 *Emails:*\n' +
      '• Total avec page: ' + stats.totalEmail + '\n' +
      '• À valider: ' + stats.pendingEmail + '\n' +
      '• Envoyés Brevo: ' + stats.sentEmail + '\n' +
      '• Invalides: ' + stats.invalidEmail + '\n\n' +
      '🖼️ *Logos:*\n' +
      '• Total avec logo: ' + stats.totalLogo + '\n' +
      '• À valider: ' + stats.pendingLogo + '\n' +
      '• Pages créées: ' + stats.createdLogo + '\n' +
      '• Rejetés: ' + stats.rejectedLogo + '\n\n' +
      '📦 *Cache:* ' + clubCache.length + ' clubs pré-chargés',
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/\/next/, async function(msg) {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    await sendNextEmail(chatId);
  });

  bot.onText(/\/logo/, async function(msg) {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) return;
    await sendNextLogo(chatId);
  });

  bot.onText(/\/help/, function(msg) {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
      '📖 *Aide*\n\n' +
      '*Validation Emails (/next):*\n' +
      'Valide les emails des clubs qui ont déjà une page Shopify.\n\n' +
      '*Validation Logos (/logo):*\n' +
      '1. Recherche logos sur BeSport, Wikipedia, Google HD\n' +
      '2. Tu choisis le meilleur logo\n' +
      '3. Création automatique de la page Shopify\n\n' +
      '*Nouveautés v5:*\n' +
      '• 6 images Google (au lieu de 3)\n' +
      '• Recherche PNG HD prioritaire\n' +
      '• Pré-chargement 5 clubs\n\n' +
      '*Actions logos:*\n' +
      '🅱️ 📚 🔍 → Choisir cette source\n' +
      '❌ Rejeter → Marque comme rejeté\n' +
      '⏭️ Passer → Passe sans rien faire',
      { parse_mode: 'Markdown' }
    );
  });

  bot.on('callback_query', handleCallbackQuery);
}

async function sendNextEmail(chatId) {
  const result = await getNextClubForEmail();
  if (!result) {
    return bot.sendMessage(chatId, '🎉 *Emails terminés !*\nTous les clubs ont été traités.', { parse_mode: 'Markdown' });
  }
  const row = result.row;
  const data = result.data;
  userState.set(chatId, { mode: 'email', row: row, data: data });
  const googleImagesLink = getGoogleImagesLink(data.club, data.sport);
  const message =
    '📧 *VALIDATION EMAIL*\n\n' +
    '🏆 *' + data.club + '*\n' +
    '⚽ Sport: ' + (data.sport || '-') + '\n' +
    '📍 Ville: ' + (data.ville || '-') + '\n\n' +
    '📧 *Email:* `' + data.email + '`\n\n' +
    '🔗 [Page Shopify](' + data.shopifyUrl + ')\n' +
    '🔍 [Google Images](' + googleImagesLink + ')';
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

async function sendNextLogo(chatId) {
  // Afficher message de chargement
  const loadingMsg = await bot.sendMessage(chatId, '🔍 Chargement...');
  
  const cached = await getNextClubFromCache();
  
  // Supprimer le message de chargement
  try {
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (e) {}
  
  if (!cached) {
    return bot.sendMessage(chatId, '🎉 *Logos terminés !*\nTous les logos ont été traités.', { parse_mode: 'Markdown' });
  }
  
  const row = cached.row;
  const data = cached.data;
  const logos = cached.logos;
  
  userState.set(chatId, { mode: 'logo', row: row, data: data, logos: logos });
  
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
      '🏆 *' + data.club + '*\n' +
      '⚽ ' + (data.sport || '-') + ' | 📍 ' + (data.ville || '-') + '\n\n' +
      '❌ *Aucun logo valide trouvé*\n\n' +
      '🔍 [Chercher manuellement](' + getGoogleImagesLink(data.club, data.sport) + ')\n\n' +
      '📦 Cache: ' + clubCache.length + ' clubs restants',
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  }
  
  // Envoyer les images
  for (let i = 0; i < logos.length; i++) {
    const logo = logos[i];
    try {
      await bot.sendPhoto(chatId, logo.url, {
        caption: logo.emoji + ' *' + logo.source + '*',
        parse_mode: 'Markdown'
      });
    } catch (e) {
      await bot.sendMessage(chatId, logo.emoji + ' *' + logo.source + '*: ' + logo.url, { parse_mode: 'Markdown' });
    }
  }
  
  // Boutons
  const logoButtons = logos.map(function(logo, index) {
    return {
      text: logo.emoji + ' ' + logo.source,
      callback_data: 'logo_select_' + index
    };
  });
  const buttonRows = [];
  for (let i = 0; i < logoButtons.length; i += 3) {
    buttonRows.push(logoButtons.slice(i, i + 3));
  }
  buttonRows.push([
    { text: '❌ Rejeter', callback_data: 'logo_reject' },
    { text: '⏭️ Passer', callback_data: 'logo_skip' }
  ]);
  const keyboard = { inline_keyboard: buttonRows };
  
  await bot.sendMessage(chatId,
    '🏆 *' + data.club + '*\n' +
    '⚽ ' + (data.sport || '-') + ' | 📍 ' + (data.ville || '-') + '\n\n' +
    '📸 *' + logos.length + ' logo(s) trouvé(s)*\n\n' +
    '👆 *Choisis le meilleur logo:*\n\n' +
    '📦 Cache: ' + clubCache.length + ' clubs restants',
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

async function handleCallbackQuery(query) {
  const chatId = query.message.chat.id;
  const action = query.data;
  if (!isAuthorized(chatId)) return;
  const state = userState.get(chatId);

  if (action.startsWith('email_')) {
    if (!state || state.mode !== 'email') {
      return bot.answerCallbackQuery(query.id, { text: '❌ Tapez /next d\'abord' });
    }
    const row = state.row;
    const data = state.data;

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
        await bot.sendMessage(chatId, '✅ *' + data.club + '* ajouté à Brevo !', { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, '⚠️ Erreur Brevo: ' + brevoResult.error);
      }
      userState.delete(chatId);
      setTimeout(function() { sendNextEmail(chatId); }, 500);
    }
    if (action === 'email_invalid') {
      await bot.answerCallbackQuery(query.id, { text: '❌ Marqué invalide' });
      row.set('Status', 'invalid');
      await row.save();
      await bot.sendMessage(chatId, '❌ *' + data.club + '* marqué invalide', { parse_mode: 'Markdown' });
      userState.delete(chatId);
      setTimeout(function() { sendNextEmail(chatId); }, 500);
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
      await bot.sendMessage(chatId, '🗑️ *' + data.club + '* supprimé', { parse_mode: 'Markdown' });
      userState.delete(chatId);
      setTimeout(function() { sendNextEmail(chatId); }, 500);
    }
  }

  if (action.startsWith('logo_')) {
    if (!state || state.mode !== 'logo') {
      return bot.answerCallbackQuery(query.id, { text: '❌ Tapez /logo d\'abord' });
    }
    const row = state.row;
    const data = state.data;
    const logos = state.logos;

    if (action === 'logo_skip') {
      await bot.answerCallbackQuery(query.id, { text: '⏭️ Passé' });
      await updateLogoStatus(row, 'skipped');
      userState.delete(chatId);
      return sendNextLogo(chatId);
    }
    if (action === 'logo_reject') {
      await bot.answerCallbackQuery(query.id, { text: '❌ Logo rejeté' });
      await updateLogoStatus(row, 'rejected');
      await bot.sendMessage(chatId, '❌ *' + data.club + '* logo rejeté', { parse_mode: 'Markdown' });
      userState.delete(chatId);
      setTimeout(function() { sendNextLogo(chatId); }, 500);
    }
    if (action.startsWith('logo_select_')) {
      const logoIndex = parseInt(action.replace('logo_select_', ''));
      const selectedLogo = logos[logoIndex];
      if (!selectedLogo) {
        return bot.answerCallbackQuery(query.id, { text: '❌ Logo non trouvé' });
      }
      await bot.answerCallbackQuery(query.id, { text: '⏳ Création en cours...' });
      
      await updateLogoStatus(row, 'processing');
      
      await bot.sendMessage(chatId,
        '⏳ Création de la page Shopify pour *' + data.club + '*...\n' +
        '📸 Logo: ' + selectedLogo.source + '\n' +
        '_(génération visuels + produit, ~2-3 min)_',
        { parse_mode: 'Markdown' }
      );
      
      createClubShopifyPage(data, selectedLogo.url).then(function(result) {
        if (result.success) {
          updateLogoStatus(row, result.productUrl);
          bot.sendMessage(chatId,
            '✅ *' + data.club + '* page créée !\n\n' +
            '🔗 [Voir la page](' + result.productUrl + ')',
            { parse_mode: 'Markdown' }
          );
        } else {
          updateLogoStatus(row, 'error: ' + result.error);
          bot.sendMessage(chatId, '❌ Erreur création pour ' + data.club + ': ' + result.error);
        }
      });
      
      userState.delete(chatId);
      setTimeout(function() { sendNextLogo(chatId); }, 500);
    }
  }
}

async function stopBot() {
  if (bot) {
    try {
      await bot.stopPolling();
      console.log('🛑 Bot polling arrêté');
    } catch (e) {
      console.log('⚠️ Erreur arrêt polling: ' + e.message);
    }
  }
}

process.on('SIGTERM', stopBot);
process.on('SIGINT', stopBot);

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
    await stopBot();
    await initGoogleSheets();
    bot = new TelegramBot(CONFIG.telegramToken, { 
      polling: { 
        interval: 1000, 
        autoStart: true, 
        params: { timeout: 10 } 
      } 
    });
    setupBotCommands();
    console.log('✅ Bot Telegram démarré');
    
    // Lancer le pré-chargement au démarrage
    preloadClubLogos();
    
    if (CONFIG.adminChatId) {
      try {
        await bot.sendMessage(CONFIG.adminChatId, '🤖 Bot PPATCH v5 redémarré !\n\n📦 Pré-chargement de 5 clubs en cours...\n\n/logo pour valider les logos');
      } catch (e) {
        console.log('⚠️ Impossible de notifier l\'admin');
      }
    }
    return bot;
  } catch (error) {
    console.error('❌ Erreur démarrage bot: ' + error.message);
    return null;
  }
}

export default { startTelegramBot };
