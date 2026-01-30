/**
 * PPATCH - Enrichisseur de Logos v1.0
 * 
 * Programme séparé pour enrichir la BDD avec des logos officiels
 * depuis les fédérations sportives (FFBB, FFF, FFR, FFHandball)
 * 
 * Usage: node src/enrichment/federation-logos.js [options]
 * 
 * Options:
 *   --limit=N     Nombre de clubs à traiter (défaut: 50)
 *   --sport=X     Filtrer par sport (basket, football, rugby, handball)
 *   --dry-run     Simulation sans écriture dans la BDD
 */

import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import axios from 'axios';
import dotenv from 'dotenv';
import { detectLogoName } from '../../config/gemini.js';

dotenv.config();

// ============ CONFIGURATION ============

const CONFIG = {
  sheetId: process.env.GOOGLE_SHEET_ID,
  sheetName: 'Exploitables',
  logosSheetName: 'Logos_DB',
  googleClientEmail: process.env.GOOGLE_CLIENT_EMAIL,
  googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  googleApiKey: process.env.GOOGLE_API_KEY,
  googleCx: process.env.GOOGLE_CX,
};

// Arguments CLI
const args = process.argv.slice(2);
const getArg = (name, defaultValue) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : defaultValue;
};

const LIMIT = parseInt(getArg('limit', '50'));
const SPORT_FILTER = getArg('sport', null);
const DRY_RUN = args.includes('--dry-run');

// ============ FÉDÉRATIONS ============

const FEDERATIONS = {
  'basketball': {
    name: 'FFBB',
    searchDomain: 'ffbb.com',
    logoPatterns: [
      /https?:\/\/[^"'\s]+\.ffbb\.com[^"'\s]*\.(?:png|jpg|jpeg|webp)/gi,
      /https?:\/\/[^"'\s]*competitions\.ffbb[^"'\s]*\.(?:png|jpg|jpeg|webp)/gi
    ]
  },
  'football': {
    name: 'FFF',
    searchDomain: 'fff.fr',
    logoPatterns: [
      /https?:\/\/[^"'\s]+\.fff\.fr[^"'\s]*\.(?:png|jpg|jpeg|webp)/gi,
      /https?:\/\/[^"'\s]*epreuves\.fff[^"'\s]*\.(?:png|jpg|jpeg|webp)/gi
    ]
  },
  'rugby': {
    name: 'FFR',
    searchDomain: 'ffr.fr',
    logoPatterns: [
      /https?:\/\/[^"'\s]+\.ffr\.fr[^"'\s]*\.(?:png|jpg|jpeg|webp)/gi
    ]
  },
  'handball': {
    name: 'FFHandball',
    searchDomain: 'ffhandball.fr',
    logoPatterns: [
      /https?:\/\/[^"'\s]+\.ffhandball\.fr[^"'\s]*\.(?:png|jpg|jpeg|webp)/gi,
      /https?:\/\/[^"'\s]*monclub\.ffhandball[^"'\s]*\.(?:png|jpg|jpeg|webp)/gi
    ]
  }
};

// ============ UTILITAIRES ============

function normalizeSport(sport) {
  if (!sport) return null;
  const s = sport.toLowerCase().trim();
  
  if (s.includes('basket')) return 'basketball';
  if (s.includes('foot') && !s.includes('volley')) return 'football';
  if (s.includes('rugby')) return 'rugby';
  if (s.includes('hand') && !s.includes('beach')) return 'handball';
  
  return null; // Sport non supporté
}

async function isValidImageUrl(url) {
  try {
    const response = await axios.head(url, { timeout: 5000 });
    const contentType = response.headers['content-type'] || '';
    return contentType.startsWith('image/');
  } catch {
    try {
      const response = await axios.get(url, { 
        timeout: 5000, 
        responseType: 'arraybuffer', 
        maxContentLength: 100000 
      });
      const contentType = response.headers['content-type'] || '';
      return contentType.startsWith('image/');
    } catch {
      return false;
    }
  }
}

async function imageUrlToBase64(url) {
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      responseType: 'arraybuffer',
      maxContentLength: 500000
    });
    return Buffer.from(response.data, 'binary').toString('base64');
  } catch {
    return null;
  }
}

// ============ RECHERCHE FÉDÉRATION ============

async function searchLogoFromFederation(clubName, sport) {
  const normalizedSport = normalizeSport(sport);
  const federation = FEDERATIONS[normalizedSport];
  
  if (!federation) return null;
  
  console.log(`  🏛️ Recherche ${federation.name}...`);
  
  try {
    // Recherche Google sur le site de la fédération
    const query = `site:${federation.searchDomain} "${clubName}"`;
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${CONFIG.googleApiKey}&cx=${CONFIG.googleCx}&q=${encodeURIComponent(query)}&num=3`;
    
    const res = await axios.get(searchUrl, { timeout: 10000 });
    
    if (!res.data.items || res.data.items.length === 0) {
      console.log(`  ⚠️ Aucun résultat sur ${federation.name}`);
      return null;
    }
    
    // Parcourir les pages trouvées
    for (const item of res.data.items) {
      const pageUrl = item.link;
      console.log(`  📄 Page: ${pageUrl}`);
      
      const logo = await extractLogoFromPage(pageUrl, federation);
      if (logo) {
        return { 
          url: logo, 
          source: federation.name, 
          pageUrl: pageUrl 
        };
      }
    }
    
    return null;
  } catch (error) {
    console.log(`  ❌ Erreur ${federation.name}: ${error.message}`);
    return null;
  }
}

async function extractLogoFromPage(pageUrl, federation) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  
  try {
    const response = await axios.get(pageUrl, {
      timeout: 8000,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      maxContentLength: 500000
    });
    
    clearTimeout(timeoutId);
    
    const html = response.data;
    if (!html || typeof html !== 'string') return null;
    
    const foundUrls = [];
    
    // Patterns spécifiques à la fédération
    for (const pattern of federation.logoPatterns) {
      pattern.lastIndex = 0;
      const matches = html.match(pattern);
      if (matches) {
        for (const match of matches) {
          if (!match.includes('favicon') && !match.includes('icon') && !match.includes('banner')) {
            if (!foundUrls.includes(match)) foundUrls.push(match);
          }
        }
      }
    }
    
    // Chercher les balises img avec logo/club/ecusson
    const imgMatches = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
    if (imgMatches) {
      for (const imgTag of imgMatches) {
        if (imgTag.includes('logo') || imgTag.includes('club') || imgTag.includes('ecusson') || imgTag.includes('blason')) {
          const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
          if (srcMatch && srcMatch[1]) {
            let imgUrl = srcMatch[1];
            
            // URL absolue
            if (imgUrl.startsWith('//')) {
              imgUrl = 'https:' + imgUrl;
            } else if (imgUrl.startsWith('/')) {
              try {
                const baseUrl = new URL(pageUrl);
                imgUrl = baseUrl.origin + imgUrl;
              } catch { continue; }
            } else if (!imgUrl.startsWith('http')) {
              continue;
            }
            
            if (!imgUrl.includes('favicon') && !foundUrls.includes(imgUrl)) {
              foundUrls.push(imgUrl);
            }
          }
        }
      }
    }
    
    // og:image fallback
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogMatch && ogMatch[1] && !foundUrls.includes(ogMatch[1])) {
      foundUrls.push(ogMatch[1]);
    }
    
    // Valider les URLs trouvées
    for (const logoUrl of foundUrls.slice(0, 5)) {
      const isValid = await isValidImageUrl(logoUrl);
      if (isValid) {
        console.log(`  ✅ Logo trouvé: ${logoUrl.substring(0, 80)}...`);
        return logoUrl;
      }
    }
    
    return null;
  } catch (error) {
    clearTimeout(timeoutId);
    return null;
  }
}

// ============ GOOGLE SHEETS ============

let doc = null;
let sheet = null;
let logosSheet = null;

async function initGoogleSheets() {
  const auth = new JWT({
    email: CONFIG.googleClientEmail,
    key: CONFIG.googlePrivateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  
  doc = new GoogleSpreadsheet(CONFIG.sheetId, auth);
  await doc.loadInfo();
  
  sheet = doc.sheetsByTitle[CONFIG.sheetName];
  if (!sheet) throw new Error(`Feuille "${CONFIG.sheetName}" non trouvée`);
  
  // Créer Logos_DB si n'existe pas
  logosSheet = doc.sheetsByTitle[CONFIG.logosSheetName];
  if (!logosSheet) {
    console.log('📝 Création de la feuille Logos_DB...');
    logosSheet = await doc.addSheet({
      title: CONFIG.logosSheetName,
      headerValues: ['URL', 'Detected_Name', 'Confidence', 'Source', 'Club_Name', 'Club_RowIndex', 'Status', 'Created_At', 'Verified_At']
    });
  }
  
  console.log(`📊 Connecté à: ${doc.title}`);
}

async function getClubsToEnrich() {
  const rows = await sheet.getRows();
  const clubs = [];
  
  for (const row of rows) {
    const clubName = row.get('Club') || row.get('Nom');
    const sport = row.get('Sport');
    const statutShopify = row.get('Statut_Shopify') || '';
    
    if (!clubName) continue;
    
    // Filtrer par sport si demandé
    const normalizedSport = normalizeSport(sport);
    if (SPORT_FILTER && normalizedSport !== SPORT_FILTER) continue;
    
    // Ne prendre que les sports supportés
    if (!normalizedSport) continue;
    
    // Exclure les clubs déjà traités ou avec logo enrichi
    if (statutShopify.includes('enriched')) continue;
    
    clubs.push({
      row: row,
      rowNumber: row.rowNumber,
      name: clubName,
      sport: sport,
      normalizedSport: normalizedSport,
      ville: row.get('Commune') || row.get('Ville') || ''
    });
    
    if (clubs.length >= LIMIT) break;
  }
  
  return clubs;
}

async function logoExistsInDB(url) {
  const rows = await logosSheet.getRows();
  return rows.some(r => r.get('URL') === url);
}

async function saveLogoToDB(logoData) {
  if (DRY_RUN) {
    console.log(`  📝 [DRY-RUN] Aurait sauvegardé: ${logoData.detected_name || 'inconnu'}`);
    return;
  }
  
  await logosSheet.addRow({
    'URL': logoData.url,
    'Detected_Name': logoData.detected_name || '',
    'Confidence': logoData.confidence || 'none',
    'Source': logoData.source,
    'Club_Name': logoData.club_name,
    'Club_RowIndex': String(logoData.row_number),
    'Status': 'pending',
    'Created_At': new Date().toISOString(),
    'Verified_At': ''
  });
}

async function markClubAsEnriched(row, logoUrl) {
  if (DRY_RUN) {
    console.log(`  📝 [DRY-RUN] Aurait marqué comme enrichi`);
    return;
  }
  
  // Optionnel: ajouter une colonne ou un tag pour indiquer que le logo a été trouvé
  // Pour l'instant on ne modifie pas la ligne principale
}

// ============ PROGRAMME PRINCIPAL ============

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  🏛️ PPATCH - Enrichisseur de Logos v1.0');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log(`📋 Configuration:`);
  console.log(`   • Limite: ${LIMIT} clubs`);
  console.log(`   • Sport: ${SPORT_FILTER || 'tous'}`);
  console.log(`   • Mode: ${DRY_RUN ? 'SIMULATION (dry-run)' : 'PRODUCTION'}`);
  console.log('');
  
  // Init
  console.log('🔌 Connexion Google Sheets...');
  await initGoogleSheets();
  
  // Récupérer les clubs à enrichir
  console.log('📥 Récupération des clubs...');
  const clubs = await getClubsToEnrich();
  console.log(`📊 ${clubs.length} clubs à traiter`);
  console.log('');
  
  if (clubs.length === 0) {
    console.log('✅ Aucun club à enrichir !');
    return;
  }
  
  // Stats
  const stats = {
    total: clubs.length,
    found: 0,
    notFound: 0,
    errors: 0,
    alreadyExists: 0
  };
  
  // Traitement
  console.log('═══════════════════════════════════════════════════════');
  console.log('  🔍 RECHERCHE DES LOGOS');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  
  for (let i = 0; i < clubs.length; i++) {
    const club = clubs[i];
    const progress = `[${i + 1}/${clubs.length}]`;
    
    console.log(`${progress} 🏆 ${club.name}`);
    console.log(`       Sport: ${club.sport} | Ville: ${club.ville}`);
    
    try {
      // Recherche sur la fédération
      const result = await searchLogoFromFederation(club.name, club.sport);
      
      if (result && result.url) {
        // Vérifier si déjà en BDD
        const exists = await logoExistsInDB(result.url);
        if (exists) {
          console.log(`  ⏭️ Logo déjà en base`);
          stats.alreadyExists++;
          console.log('');
          continue;
        }
        
        // Détecter le nom avec Gemini
        console.log(`  🤖 Détection Gemini...`);
        let detection = { name: '', confidence: 'none' };
        try {
          const base64 = await imageUrlToBase64(result.url);
          if (base64) {
            detection = await detectLogoName(base64);
            console.log(`  🏷️ Détecté: "${detection.name}" (${detection.confidence})`);
          }
        } catch (e) {
          console.log(`  ⚠️ Erreur Gemini: ${e.message}`);
        }
        
        // Sauvegarder
        await saveLogoToDB({
          url: result.url,
          detected_name: detection.name,
          confidence: detection.confidence,
          source: `federation_${result.source.toLowerCase()}`,
          club_name: club.name,
          row_number: club.rowNumber
        });
        
        await markClubAsEnriched(club.row, result.url);
        
        stats.found++;
        console.log(`  ✅ Logo sauvegardé !`);
      } else {
        stats.notFound++;
        console.log(`  ❌ Aucun logo trouvé`);
      }
    } catch (error) {
      stats.errors++;
      console.log(`  ❌ Erreur: ${error.message}`);
    }
    
    console.log('');
    
    // Pause pour éviter le rate limiting
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // Rapport final
  console.log('═══════════════════════════════════════════════════════');
  console.log('  📊 RAPPORT FINAL');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log(`  📋 Clubs traités:     ${stats.total}`);
  console.log(`  ✅ Logos trouvés:     ${stats.found}`);
  console.log(`  ❌ Non trouvés:       ${stats.notFound}`);
  console.log(`  ⏭️ Déjà en base:      ${stats.alreadyExists}`);
  console.log(`  ⚠️ Erreurs:           ${stats.errors}`);
  console.log('');
  console.log(`  📈 Taux de réussite:  ${Math.round((stats.found / stats.total) * 100)}%`);
  console.log('');
  
  if (DRY_RUN) {
    console.log('  ⚠️ MODE SIMULATION - Aucune donnée n\'a été écrite');
    console.log('     Relancez sans --dry-run pour enregistrer les résultats');
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ✅ Enrichissement terminé !');
  console.log('═══════════════════════════════════════════════════════');
}

// Lancer
main().catch(error => {
  console.error('');
  console.error('❌ ERREUR FATALE:', error.message);
  console.error(error.stack);
  process.exit(1);
});
