/**

- PPATCH - Bot Telegram Unifié v5.6
- - /logo : Valider logos + créer pages
- - /mail : Valider emails
- - /sync : Synchroniser avec Shopify
- - /stats : Statistiques
- 
- FIX v5.4: Correction du bug de réapparition des clubs validés
- FIX v5.5: Suppression Wikipedia (toujours 403)
- FIX v5.6: Anti-crash (try-catch + gestion erreurs polling + pas de Markdown)
  */

import TelegramBot from ‘node-telegram-bot-api’;
import { GoogleSpreadsheet } from ‘google-spreadsheet’;
import { JWT } from ‘google-auth-library’;
import axios from ‘axios’;

const getConfig = () => ({
telegramToken: process.env.TELEGRAM_BOT_TOKEN,
adminChatId: process.env.ADMIN_CHAT_ID || null,
sheetId: process.env.GOOGLE_SHEET_ID,
sheetName: ‘Exploitables’,
googleClientEmail: process.env.GOOGLE_CLIENT_EMAIL,
googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\n/g, ‘\n’),
brevoApiKey: process.env.BREVO_API_KEY,
brevoListId: parseInt(process.env.BREVO_LIST_ID_DEMARCHAGE || process.env.BREVO_LIST_ID || ‘6’),
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
// IMPORTANT: On stocke rowIndex (number) au lieu de l’objet row
const clubCache = [];
const CACHE_SIZE = 5;
let isCacheLoading = false;

// Set des rowIndex en cours de traitement (pour éviter les doublons)
const processingRows = new Set();

async function initGoogleSheets() {
const auth = new JWT({
email: CONFIG.googleClientEmail,
key: CONFIG.googlePrivateKey,
scopes: [‘https://www.googleapis.com/auth/spreadsheets’],
});
doc = new GoogleSpreadsheet(CONFIG.sheetId, auth);
await doc.loadInfo();
sheet = doc.sheetsByTitle[CONFIG.sheetName];
if (!sheet) {
throw new Error(‘Feuille “’ + CONFIG.sheetName + ‘” non trouvée’);
}
console.log(’📊 Google Sheets connecté: ’ + doc.title);
return sheet;
}

async function isValidImageUrl(url) {
try {
const response = await axios.head(url, { timeout: 5000 });
const contentType = response.headers[‘content-type’] || ‘’;
return contentType.startsWith(‘image/’);
} catch (error) {
try {
const response = await axios.get(url, { timeout: 5000, responseType: ‘arraybuffer’, maxContentLength: 100000 });
const contentType = response.headers[‘content-type’] || ‘’;
return contentType.startsWith(‘image/’);
} catch (e) {
return false;
}
}
}

async function searchLogoGoogle(clubName, sport, targetCount) {
targetCount = targetCount || 6;
if (!CONFIG.googleApiKey || !CONFIG.googleCx) {
return [];
}

const validLogos = [];
const seenUrls = new Set();

const queries = [
clubName + ’ ’ + (sport || ‘’) + ’ logo’,
clubName + ’ logo png’
];

for (let q = 0; q < queries.length && validLogos.length < targetCount; q++) {
try {
const query = queries[q].trim().replace(/\s+/g, ’ ’);
const numToFetch = Math.min(10, (targetCount - validLogos.length) + 3);
const url = ‘https://www.googleapis.com/customsearch/v1?key=’ + CONFIG.googleApiKey + ‘&cx=’ + CONFIG.googleCx + ‘&q=’ + encodeURIComponent(query) + ‘&searchType=image&num=’ + numToFetch;

```
  const res = await axios.get(url, { timeout: 10000 });
  
  if (res.data.items?.length > 0) {
    for (let i = 0; i < res.data.items.length && validLogos.length < targetCount; i++) {
      const item = res.data.items[i];
      
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
```

}

return validLogos;
}

async function findAllLogos(clubName, besportLogo, sport) {
const logos = [];

// Logo BeSport
if (besportLogo && besportLogo.startsWith(‘http’)) {
const isValid = await isValidImageUrl(besportLogo);
if (isValid) {
logos.push({ source: ‘BeSport’, url: besportLogo, emoji: ‘🅱️’ });
}
}

// Logos Google (6 max)
const googleLogos = await searchLogoGoogle(clubName, sport, 6);
googleLogos.forEach(function(logo, index) {
logos.push({ source: ’Google ’ + (index + 1), url: logo.url, emoji: ‘🔍’ });
});

return logos;
}

// ============ PRÉ-CHARGEMENT (CORRIGÉ v5.4) ============

/**

- Récupère une ligne fraîche depuis le Google Sheet par son numéro
  */
  async function getFreshRow(rowNumber) {
  try {
  const rows = await sheet.getRows();
  for (let i = 0; i < rows.length; i++) {
  if (rows[i].rowNumber === rowNumber) {
  return rows[i];
  }
  }
  return null;
  } catch (error) {
  console.log(’⚠️ Erreur getFreshRow: ’ + error.message);
  return null;
  }
  }

/**

- Vérifie si une ligne est éligible pour validation de logo
  */
  function isRowEligibleForLogo(row) {
  const logoUrl = row.get(‘Logo’);
  const statutShopify = row.get(‘Statut_Shopify’);

const hasLogo = logoUrl && logoUrl.startsWith(‘http’);
const noShopifyStatus = !statutShopify || statutShopify.trim() === ‘’;

return hasLogo && noShopifyStatus;
}

/**

- Récupère les prochains clubs éligibles pour validation logo
- Exclut les clubs déjà en cours de traitement
  */
  async function getNextClubsForLogo(count) {
  const rows = await sheet.getRows();
  const clubs = [];

for (let i = 0; i < rows.length && clubs.length < count; i++) {
const row = rows[i];
const rowIndex = row.rowNumber;

```
// Exclure les clubs déjà en cours de traitement
if (processingRows.has(rowIndex)) {
  continue;
}

// Exclure les clubs déjà dans le cache
const alreadyInCache = clubCache.some(c => c.rowIndex === rowIndex);
if (alreadyInCache) {
  continue;
}

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
    rowIndex: rowIndex,
    data: {
      club: row.get('Club') || row.get('Nom_Court'),
      logo: logoUrl,
      sport: row.get('Sport'),
      ville: row.get('Ville'),
      departement: row.get('Departement'),
      region: row.get('Region'),
      rowIndex: rowIndex
    }
  });
}
```

}

return clubs;
}

/**

- Pré-charge les logos pour les prochains clubs
- Stocke rowIndex au lieu de l’objet row
  */
  async function preloadClubLogos() {
  if (isCacheLoading) return;
  isCacheLoading = true;

try {
while (clubCache.length < CACHE_SIZE) {
const clubs = await getNextClubsForLogo(CACHE_SIZE - clubCache.length + 2);

```
  if (clubs.length === 0) break;
  
  for (const clubInfo of clubs) {
    // Double vérification: pas déjà dans le cache
    const alreadyCached = clubCache.some(c => c.rowIndex === clubInfo.rowIndex);
    if (alreadyCached) continue;
    
    console.log('📦 Pré-chargement: ' + clubInfo.data.club);
    const logos = await findAllLogos(clubInfo.data.club, clubInfo.data.logo, clubInfo.data.sport);
    
    clubCache.push({
      rowIndex: clubInfo.rowIndex,
      data: clubInfo.data,
      logos: logos
    });
    
    if (clubCache.length >= CACHE_SIZE) break;
  }
  
  break;
}

console.log('📦 Cache: ' + clubCache.length + '/' + CACHE_SIZE + ' clubs pré-chargés');
```

} catch (error) {
console.log(’⚠️ Erreur pré-chargement: ’ + error.message);
}

isCacheLoading = false;
}

/**

- Nettoie le cache des clubs qui ont été traités
- Appelé après chaque validation
  */
  function cleanCache(processedRowIndex) {
  // Retirer du cache
  const indexInCache = clubCache.findIndex(c => c.rowIndex === processedRowIndex);
  if (indexInCache !== -1) {
  clubCache.splice(indexInCache, 1);
  console.log(’🧹 Club retiré du cache (rowIndex: ’ + processedRowIndex + ‘)’);
  }

// Retirer du set de traitement après un délai (laisser le temps à la création Shopify)
setTimeout(function() {
processingRows.delete(processedRowIndex);
}, 60000); // 1 minute
}

/**

- Récupère le prochain club depuis le cache avec vérification fraîche
  */
  async function getNextClubFromCache() {
  while (clubCache.length > 0) {
  const cached = clubCache.shift();
  
  // Récupérer la ligne fraîche depuis le Sheet
  const freshRow = await getFreshRow(cached.rowIndex);
  
  if (!freshRow) {
  console.log(‘⚠️ Ligne ’ + cached.rowIndex + ’ introuvable, passage au suivant’);
  continue;
  }
  
  // Vérifier que le statut est toujours vide
  const currentStatus = freshRow.get(‘Statut_Shopify’);
  if (currentStatus && currentStatus.trim() !== ‘’) {
  console.log(’⚠️ Club ’ + cached.data.club + ’ déjà traité (status: ’ + currentStatus + ‘), passage au suivant’);
  continue;
  }
  
  // Marquer comme en cours de traitement
  processingRows.add(cached.rowIndex);
  
  // Lancer le pré-chargement en arrière-plan
  setTimeout(preloadClubLogos, 100);
  
  return {
  row: freshRow,
  rowIndex: cached.rowIndex,
  data: cached.data,
  logos: cached.logos
  };
  }

// Cache vide, chercher directement
const clubs = await getNextClubsForLogo(1);
if (clubs.length === 0) return null;

const clubInfo = clubs[0];

// Récupérer la ligne fraîche
const freshRow = await getFreshRow(clubInfo.rowIndex);
if (!freshRow) return null;

// Marquer comme en cours
processingRows.add(clubInfo.rowIndex);

const logos = await findAllLogos(clubInfo.data.club, clubInfo.data.logo, clubInfo.data.sport);

setTimeout(preloadClubLogos, 100);

return {
row: freshRow,
rowIndex: clubInfo.rowIndex,
data: clubInfo.data,
logos: logos
};
}

// ============ SYNC SHOPIFY ============

async function checkProductExists(handle) {
if (!CONFIG.shopifyStore || !CONFIG.shopifyAccessToken) {
return false;
}
try {
const response = await fetch(
‘https://’ + CONFIG.shopifyStore + ‘/admin/api/2024-01/products.json?handle=’ + handle,
{
headers: {
‘X-Shopify-Access-Token’: CONFIG.shopifyAccessToken,
‘Content-Type’: ‘application/json’
}
}
);
if (response.ok) {
const data = await response.json();
return data.products && data.products.length > 0;
}
return false;
} catch (error) {
console.error(’❌ Erreur vérification Shopify: ’ + error.message);
return false;
}
}

async function syncShopifyProducts(chatId) {
await bot.sendMessage(chatId, ‘🔄 *Synchronisation en cours…*\nVérification des produits Shopify…’, { parse_mode: ‘Markdown’ });

const rows = await sheet.getRows();
let checkedCount = 0;
let deletedCount = 0;
let errorCount = 0;

for (const row of rows) {
const statutShopify = row.get(‘Statut_Shopify’);

```
if (statutShopify && statutShopify.startsWith('http')) {
  checkedCount++;
  
  const match = statutShopify.match(/\/products\/([^\/\?]+)/);
  if (match) {
    const handle = match[1];
    
    try {
      const exists = await checkProductExists(handle);
      
      if (!exists) {
        const clubName = row.get('Club') || row.get('Nom_Court');
        console.log('🗑️ Produit supprimé détecté: ' + clubName);
        
        row.set('Statut_Shopify', 'deleted_from_shopify');
        await row.save();
        deletedCount++;
      }
    } catch (error) {
      errorCount++;
    }
  }
  
  if (checkedCount % 20 === 0) {
    await bot.sendMessage(chatId, '⏳ ' + checkedCount + ' produits vérifiés...', { parse_mode: 'Markdown' });
  }
}
```

}

await bot.sendMessage(chatId,
‘✅ *Synchronisation terminée !*\n\n’ +
’📊 Produits vérifiés: ’ + checkedCount + ‘\n’ +
’🗑️ Suppressions détectées: ’ + deletedCount + ‘\n’ +
(errorCount > 0 ? ’⚠️ Erreurs: ’ + errorCount : ‘’),
{ parse_mode: ‘Markdown’ }
);
}

// ============ EMAILS ============

async function getNextClubForEmail() {
const rows = await sheet.getRows();
for (let i = 0; i < rows.length; i++) {
const row = rows[i];
const shopifyUrl = row.get(‘Statut_Shopify’);
const email = row.get(‘Email_1’);
const status = row.get(‘Status’);
if (shopifyUrl && shopifyUrl.startsWith(‘http’) && email && !status) {
return {
row: row,
data: {
club: row.get(‘Club’) || row.get(‘Nom_Court’),
email: email,
sport: row.get(‘Sport’),
ville: row.get(‘Ville’),
departement: row.get(‘Departement’),
codePostal: row.get(‘Code_Postal’),
shopifyUrl: shopifyUrl,
rowIndex: row.rowNumber
}
};
}
}
return null;
}

async function updateLogoStatus(row, status) {
row.set(‘Statut_Shopify’, status);
await row.save();
console.log(’✅ Logo status mis à jour: ’ + status);
}

async function getProductHandleFromUrl(url) {
const match = url.match(//products/([^/?]+)/);
return match ? match[1] : null;
}

async function getProductIdByHandle(handle) {
if (!CONFIG.shopifyStore || !CONFIG.shopifyAccessToken) {
return null;
}
try {
const response = await fetch(
‘https://’ + CONFIG.shopifyStore + ‘/admin/api/2024-01/products.json?handle=’ + handle,
{
headers: {
‘X-Shopify-Access-Token’: CONFIG.shopifyAccessToken,
‘Content-Type’: ‘application/json’
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
console.error(’❌ Erreur Shopify: ’ + error.message);
return null;
}
}

async function deleteShopifyProduct(productId) {
if (!CONFIG.shopifyStore || !CONFIG.shopifyAccessToken) {
return { success: false, error: ‘Shopify non configuré’ };
}
try {
const response = await fetch(
‘https://’ + CONFIG.shopifyStore + ‘/admin/api/2024-01/products/’ + productId + ‘.json’,
{
method: ‘DELETE’,
headers: {
‘X-Shopify-Access-Token’: CONFIG.shopifyAccessToken,
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
return { success: false, error: ‘API Key manquante’ };
}
try {
const response = await fetch(‘https://api.brevo.com/v3/contacts’, {
method: ‘POST’,
headers: {
‘accept’: ‘application/json’,
‘content-type’: ‘application/json’,
‘api-key’: CONFIG.brevoApiKey
},
body: JSON.stringify({
email: email,
listIds: [CONFIG.brevoListId],
attributes: {
NOM_CLUB: clubName,
SPORT: sport || ‘’,
VILLE: ville || ‘’
},
updateEnabled: true
})
});
if (response.ok || response.status === 204) {
return { success: true };
} else {
const error = await response.json();
if (error.code === ‘duplicate_parameter’) {
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
const { processClub } = await import(’../shopify/push-products.js’);
const club = {
name: clubData.club,
logo: selectedLogoUrl,
logoHD: selectedLogoUrl,
sport: clubData.sport,
commune: clubData.ville,
departement: clubData.departement,
region: clubData.region
};
console.log(’🏭 Création page Shopify pour ’ + club.name + ’ avec logo: ’ + selectedLogoUrl);
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
error: result?.error || ‘Erreur inconnue’
};
}
} catch (error) {
console.error(’❌ Erreur création page: ’ + error.message);
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
let query = ’logo ’ + clubName;
if (sport) {
query = ’logo ’ + clubName + ’ ’ + sport;
}
return ‘https://www.google.com/search?tbm=isch&q=’ + encodeURIComponent(query);
}

async function getStats() {
const rows = await sheet.getRows();
let totalEmail = 0, pendingEmail = 0, sentEmail = 0, invalidEmail = 0;
let totalLogo = 0, pendingLogo = 0, createdLogo = 0, rejectedLogo = 0, deletedLogo = 0;
for (let i = 0; i < rows.length; i++) {
const row = rows[i];
const shopifyUrl = row.get(‘Statut_Shopify’);
const email = row.get(‘Email_1’);
const status = row.get(‘Status’);
const logo = row.get(‘Logo’);
if (shopifyUrl && shopifyUrl.startsWith(‘http’) && email) {
totalEmail++;
if (status === ‘sent’) sentEmail++;
else if (status === ‘invalid’) invalidEmail++;
else pendingEmail++;
}
if (logo && logo.startsWith(‘http’)) {
totalLogo++;
if (shopifyUrl && shopifyUrl.startsWith(‘http’)) {
createdLogo++;
} else if (shopifyUrl === ‘rejected’) {
rejectedLogo++;
} else if (shopifyUrl === ‘deleted_from_shopify’) {
deletedLogo++;
} else {
pendingLogo++;
}
}
}
return { totalEmail, pendingEmail, sentEmail, invalidEmail, totalLogo, pendingLogo, createdLogo, rejectedLogo, deletedLogo };
}

function setupBotCommands() {
bot.onText(//start/, async function(msg) {
const chatId = msg.chat.id;
if (!isAuthorized(chatId)) {
return bot.sendMessage(chatId, ’❌ Accès non autorisé\n\nTon Chat ID: ’ + chatId);
}
const stats = await getStats();
bot.sendMessage(chatId,
‘🎯 PPATCH Bot v5.6\n\n’ +
‘🖼️ Logos: ’ + stats.pendingLogo + ’ à valider | ’ + stats.createdLogo + ’ créés\n’ +
‘📧 Emails: ’ + stats.pendingEmail + ’ à valider | ’ + stats.sentEmail + ’ envoyés\n\n’ +
‘📦 Cache: ’ + clubCache.length + ’ clubs pré-chargés\n’ +
‘🔄 Processing: ’ + processingRows.size + ’ en cours’
);
preloadClubLogos();
});

bot.onText(//stats/, async function(msg) {
const chatId = msg.chat.id;
if (!isAuthorized(chatId)) return;
const stats = await getStats();
bot.sendMessage(chatId,
‘📊 Statistiques\n\n’ +
‘🖼️ Logos:\n’ +
’• À valider: ’ + stats.pendingLogo + ‘\n’ +
’• Pages créées: ’ + stats.createdLogo + ‘\n’ +
’• Rejetés: ’ + stats.rejectedLogo + ‘\n’ +
’• Supprimés: ’ + stats.deletedLogo + ‘\n\n’ +
‘📧 Emails:\n’ +
’• À valider: ’ + stats.pendingEmail + ‘\n’ +
’• Envoyés: ’ + stats.sentEmail + ‘\n’ +
’• Invalides: ’ + stats.invalidEmail + ‘\n\n’ +
‘📦 Cache: ’ + clubCache.length + ’ clubs\n’ +
‘🔄 Processing: ’ + processingRows.size + ’ en cours’
);
});

bot.onText(//mail/, async function(msg) {
const chatId = msg.chat.id;
if (!isAuthorized(chatId)) return;
await sendNextEmail(chatId);
});

bot.onText(//logo/, async function(msg) {
const chatId = msg.chat.id;
if (!isAuthorized(chatId)) return;
await sendNextLogo(chatId);
});

bot.onText(//sync/, async function(msg) {
const chatId = msg.chat.id;
if (!isAuthorized(chatId)) return;
await syncShopifyProducts(chatId);
});

// Commande pour vider le cache (debug)
bot.onText(//clearcache/, async function(msg) {
const chatId = msg.chat.id;
if (!isAuthorized(chatId)) return;
clubCache.length = 0;
processingRows.clear();
bot.sendMessage(chatId, ‘🧹 Cache vidé !’);
preloadClubLogos();
});

bot.on(‘callback_query’, handleCallbackQuery);
}

async function sendNextEmail(chatId) {
try {
const result = await getNextClubForEmail();
if (!result) {
return bot.sendMessage(chatId, ‘🎉 Emails terminés ! Tous les clubs ont été traités.’);
}
const row = result.row;
const data = result.data;
userState.set(chatId, { mode: ‘email’, row: row, data: data });
const googleImagesLink = getGoogleImagesLink(data.club, data.sport);
const message =
‘📧 VALIDATION EMAIL\n\n’ +
’🏆 ’ + data.club + ‘\n’ +
’⚽ Sport: ’ + (data.sport || ‘-’) + ‘\n’ +
’📍 Ville: ’ + (data.ville || ‘-’) + ‘\n\n’ +
’📧 Email: ’ + data.email + ‘\n\n’ +
’🔗 Page Shopify: ’ + data.shopifyUrl + ‘\n’ +
’🔍 Google Images: ’ + googleImagesLink;
const keyboard = {
inline_keyboard: [
[
{ text: ‘✅ Valide + Brevo’, callback_data: ‘email_valid’ },
{ text: ‘❌ Invalide’, callback_data: ‘email_invalid’ }
],
[
{ text: ‘🗑️ Supprimer page’, callback_data: ‘email_delete’ },
{ text: ‘⏭️ Passer’, callback_data: ‘email_skip’ }
]
]
};
await bot.sendMessage(chatId, message, {
reply_markup: keyboard,
disable_web_page_preview: true
});
} catch (error) {
console.log(’❌ Erreur sendNextEmail: ’ + error.message);
bot.sendMessage(chatId, ’❌ Erreur: ’ + error.message + ‘\n\nTape /mail pour réessayer.’);
}
}

async function sendNextLogo(chatId) {
try {
const loadingMsg = await bot.sendMessage(chatId, ‘🔍 Chargement…’);

```
const cached = await getNextClubFromCache();

try {
  await bot.deleteMessage(chatId, loadingMsg.message_id);
} catch (e) {}

if (!cached) {
  return bot.sendMessage(chatId, '🎉 Logos terminés ! Tous les logos ont été traités.');
}

const row = cached.row;
const rowIndex = cached.rowIndex;
const data = cached.data;
const logos = cached.logos;

// Stocker rowIndex dans le state pour le nettoyage après validation
userState.set(chatId, { mode: 'logo', row: row, rowIndex: rowIndex, data: data, logos: logos });

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
    '🏆 ' + data.club + '\n' +
    '⚽ ' + (data.sport || '-') + ' | 📍 ' + (data.ville || '-') + '\n\n' +
    '❌ Aucun logo valide trouvé\n\n' +
    '🔍 Chercher: ' + getGoogleImagesLink(data.club, data.sport) + '\n\n' +
    '📦 Cache: ' + clubCache.length + ' clubs restants',
    { reply_markup: keyboard }
  );
}

for (let i = 0; i < logos.length; i++) {
  const logo = logos[i];
  try {
    await bot.sendPhoto(chatId, logo.url, {
      caption: logo.emoji + ' ' + logo.source
    });
  } catch (e) {
    await bot.sendMessage(chatId, logo.emoji + ' ' + logo.source + ': ' + logo.url);
  }
}

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
  '🏆 ' + data.club + '\n' +
  '⚽ ' + (data.sport || '-') + ' | 📍 ' + (data.ville || '-') + '\n\n' +
  '📸 ' + logos.length + ' logo(s) trouvé(s)\n\n' +
  '👆 Choisis le meilleur logo:\n\n' +
  '📦 Cache: ' + clubCache.length + ' clubs restants',
  { reply_markup: keyboard }
);
```

} catch (error) {
console.log(’❌ Erreur sendNextLogo: ’ + error.message);
bot.sendMessage(chatId, ’❌ Erreur: ’ + error.message + ‘\n\nTape /logo pour réessayer.’);
}
}

async function handleCallbackQuery(query) {
const chatId = query.message.chat.id;
const action = query.data;
if (!isAuthorized(chatId)) return;
const state = userState.get(chatId);

try {
if (action.startsWith(‘email_’)) {
if (!state || state.mode !== ‘email’) {
return bot.answerCallbackQuery(query.id, { text: ‘❌ Tapez /mail d'abord’ });
}
const row = state.row;
const data = state.data;

```
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
      await bot.sendMessage(chatId, '✅ ' + data.club + ' ajouté à Brevo !');
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
    await bot.sendMessage(chatId, '❌ ' + data.club + ' marqué invalide');
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
    await bot.sendMessage(chatId, '🗑️ ' + data.club + ' supprimé');
    userState.delete(chatId);
    setTimeout(function() { sendNextEmail(chatId); }, 500);
  }
}

if (action.startsWith('logo_')) {
  if (!state || state.mode !== 'logo') {
    return bot.answerCallbackQuery(query.id, { text: '❌ Tapez /logo d\'abord' });
  }
  const row = state.row;
  const rowIndex = state.rowIndex;
  const data = state.data;
  const logos = state.logos;

  if (action === 'logo_skip') {
    await bot.answerCallbackQuery(query.id, { text: '⏭️ Passé' });
    await updateLogoStatus(row, 'skipped');
    cleanCache(rowIndex);
    userState.delete(chatId);
    return sendNextLogo(chatId);
  }
  if (action === 'logo_reject') {
    await bot.answerCallbackQuery(query.id, { text: '❌ Logo rejeté' });
    await updateLogoStatus(row, 'rejected');
    cleanCache(rowIndex);
    await bot.sendMessage(chatId, '❌ ' + data.club + ' logo rejeté');
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
    
    // Marquer comme processing AVANT de continuer
    await updateLogoStatus(row, 'processing');
    
    // Nettoyer le cache pour ce club
    cleanCache(rowIndex);
    
    await bot.sendMessage(chatId,
      '⏳ Création de la page Shopify pour ' + data.club + '...\n' +
      '📸 Logo: ' + selectedLogo.source + '\n' +
      '(génération visuels + produit, ~2-3 min)'
    );
    
    // Lancer la création en arrière-plan
    createClubShopifyPage(data, selectedLogo.url).then(function(result) {
      if (result.success) {
        updateLogoStatus(row, result.productUrl);
        bot.sendMessage(chatId,
          '✅ ' + data.club + ' page créée !\n\n' +
          '🔗 Voir la page: ' + result.productUrl
        );
      } else {
        updateLogoStatus(row, 'error: ' + result.error);
        bot.sendMessage(chatId, '❌ Erreur création pour ' + data.club + ': ' + result.error);
      }
    }).catch(function(error) {
      console.log('❌ Erreur création page: ' + error.message);
      updateLogoStatus(row, 'error: ' + error.message);
      bot.sendMessage(chatId, '❌ Erreur création pour ' + data.club + ': ' + error.message);
    });
    
    userState.delete(chatId);
    setTimeout(function() { sendNextLogo(chatId); }, 500);
  }
}
```

} catch (error) {
console.log(’❌ Erreur handleCallbackQuery: ’ + error.message);
bot.sendMessage(chatId, ’❌ Erreur: ’ + error.message);
}
}

async function stopBot() {
if (bot) {
try {
await bot.stopPolling();
console.log(‘🛑 Bot polling arrêté’);
} catch (e) {
console.log(’⚠️ Erreur arrêt polling: ’ + e.message);
}
}
}

process.on(‘SIGTERM’, stopBot);
process.on(‘SIGINT’, stopBot);

export async function startTelegramBot() {
CONFIG = getConfig();
if (!CONFIG.telegramToken) {
console.warn(‘⚠️ TELEGRAM_BOT_TOKEN non configuré - Bot désactivé’);
return null;
}
if (!CONFIG.sheetId || !CONFIG.googleClientEmail || !CONFIG.googlePrivateKey) {
console.warn(‘⚠️ Google Sheets non configuré - Bot désactivé’);
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

```
// Gestion des erreurs de polling pour éviter les crashes
bot.on('polling_error', function(error) {
  console.log('⚠️ Polling error: ' + error.message);
  // Ne pas crasher, juste logger
});

// Gestion des erreurs générales du bot
bot.on('error', function(error) {
  console.log('⚠️ Bot error: ' + error.message);
});

setupBotCommands();
console.log('✅ Bot Telegram démarré');

preloadClubLogos();

if (CONFIG.adminChatId) {
  try {
    await bot.sendMessage(CONFIG.adminChatId, '🤖 Bot PPATCH v5.6 redémarré !\n\n✨ Anti-crash amélioré');
  } catch (e) {
    console.log('⚠️ Impossible de notifier l\'admin');
  }
}
return bot;
```

} catch (error) {
console.error(’❌ Erreur démarrage bot: ’ + error.message);
return null;
}
}

export default { startTelegramBot };
