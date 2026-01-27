import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration
const PLANNING_BOT_TOKEN = process.env.PLANNING_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'OhLaPey/planning-urbansoccer';

// Liste complète des employés (dans l'ordre du tableau de HAUT en BAS)
const ALL_EMPLOYEES = [
    'BONILLO Matthieu',      // Ligne 1
    'BOULARDET Lucas',       // Ligne 2
    'CARRERE Peïo',          // Ligne 3
    'CASTELLON Pascaline',   // Ligne 4
    'COHAT Linda',           // Ligne 5
    'CRUZEL Quentin',        // Ligne 6
    'DE NOUEL Maxime',       // Ligne 7
    'DIVIEN Yohan',          // Ligne 8
    'DONAER Nicolas',        // Ligne 9
    'DOVINA Théo',           // Ligne 10
    'HEBERT Jean Baptiste',  // Ligne 11
    'JARGUEL Thomas',        // Ligne 12
    'KABUNDA NDEKE Marvyn',  // Ligne 13
    'MADIELE Henri',         // Ligne 14
    'MOSTEFA Yanis',         // Ligne 15
    'PEREZ Loic',            // Ligne 16
    'PISTORE Remi',          // Ligne 17
    'PUJOL Mathieu',         // Ligne 18
    'RABII Mehdi',           // Ligne 19
    'SEIGNE Kevin',          // Ligne 20
    'TINGUY Florian',        // Ligne 21
    'TOPPAN Mattis'          // Ligne 22
];

// Légende des codes d'activité
const LEGENDE = {
    "VDC": "Vie de centre",
    "EDF-A": "Vie de centre EDF",
    "EDF-B": "Baby Soccer",
    "EDF-C": "PSG Academy",
    "C-PAD": "Cours Padel",
    "PAD-A": "Administratif Padel",
    "CUP-R": "Régisseur Cup",
    "CUP-L": "League Cup",
    "L-REG": "Régisseur League",
    "L-ARB": "Arbitrage",
    "REU": "Réunion",
    "ANNIV": "Anniversaire",
    "AIDE": "Aide Anniversaire",
    "EV-RE": "Régisseur Event",
    "EV-LO": "Logistique Event",
    "FORE": "Formation",
    "FORP": "Formation"
};

// Mapping jours
const JOURS_MAP = {
    'Lu': 0, 'Lun': 0, 'Lundi': 0,
    'Ma': 1, 'Mar': 1, 'Mardi': 1,
    'Me': 2, 'Mer': 2, 'Mercredi': 2,
    'Je': 3, 'Jeu': 3, 'Jeudi': 3,
    'Ve': 4, 'Ven': 4, 'Vendredi': 4,
    'Sa': 5, 'Sam': 5, 'Samedi': 5,
    'Di': 6, 'Dim': 6, 'Dimanche': 6
};

let planningBot = null;

export async function startPlanningBot() {
    if (!PLANNING_BOT_TOKEN) {
        console.log('⚠️  Planning Bot: SKIPPED (PLANNING_BOT_TOKEN non défini)');
        return null;
    }

    if (!GEMINI_API_KEY) {
        console.log('⚠️  Planning Bot: SKIPPED (GEMINI_API_KEY non défini)');
        return null;
    }

    planningBot = new TelegramBot(PLANNING_BOT_TOKEN, { polling: true });
    console.log('✅ Planning Bot Urban 7D démarré');

    planningBot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        planningBot.sendMessage(chatId, 
            '👋 Bienvenue sur le Bot Planning Urban 7D!\n\n' +
            '📄 Envoyez-moi le PDF du planning et je génèrerai les fichiers calendrier pour toute l\'équipe.\n\n' +
            '⏱️ L\'analyse prend environ 2-3 minutes (22 employés à analyser).\n\n' +
            '🔗 Les liens seront disponibles sur:\nhttps://planning-urbansoccer.onrender.com'
        );
    });

    planningBot.on('document', async (msg) => {
        const chatId = msg.chat.id;
        const document = msg.document;

        if (!document.file_name.toLowerCase().endsWith('.pdf')) {
            planningBot.sendMessage(chatId, '❌ Veuillez envoyer un fichier PDF.');
            return;
        }

        const statusMsg = await planningBot.sendMessage(chatId, '📥 PDF reçu, analyse en cours...\n⏱️ Temps estimé: 2-3 minutes');

        try {
            // Télécharger le PDF
            const fileLink = await planningBot.getFileLink(document.file_id);
            const pdfResponse = await axios.get(fileLink, { responseType: 'arraybuffer' });
            
            const tempDir = os.tmpdir();
            const timestamp = Date.now();
            const pdfPath = path.join(tempDir, `planning_${timestamp}.pdf`);
            fs.writeFileSync(pdfPath, pdfResponse.data);

            await planningBot.editMessageText('🖼️ Conversion en image HD...', { chat_id: chatId, message_id: statusMsg.message_id });

            // Convertir PDF en image HAUTE RÉSOLUTION
            const imagePath = path.join(tempDir, `planning_${timestamp}.png`);
            
            try {
                await execAsync(`pdftoppm -png -r 300 -singlefile "${pdfPath}" "${path.join(tempDir, `planning_${timestamp}`)}"`);
            } catch (e) {
                await execAsync(`convert -density 300 "${pdfPath}[0]" "${imagePath}"`);
            }

            const imageBuffer = fs.readFileSync(imagePath);
            const base64Image = imageBuffer.toString('base64');

            // Initialiser Gemini
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

            // ÉTAPE 1 : Récupérer les métadonnées
            await planningBot.editMessageText('🤖 Lecture des métadonnées...', { chat_id: chatId, message_id: statusMsg.message_id });
            
            const metaPrompt = `Regarde ce planning et donne-moi UNIQUEMENT ces informations :
SEMAINE: <numéro>
ANNEE: <année>
JOURS: <liste des jours avec dates, ex: Lu 26, Ma 27, Me 28, Je 29, Ve 30, Sa 31, Di 1>
MOIS_DEBUT: <mois du premier jour, 1-12>
MOIS_FIN: <mois du dernier jour, 1-12>

Réponds UNIQUEMENT avec ces 5 lignes, rien d'autre.`;

            const metaResult = await model.generateContent([
                metaPrompt,
                { inlineData: { mimeType: 'image/png', data: base64Image } }
            ]);
            
            const metaText = metaResult.response.text();
            console.log('📋 Metadata:', metaText);
            
            const metadata = parseMetadata(metaText);
            const joursStr = metadata.jours.map((j, idx) => ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'][idx] + ' ' + j).join(', ');

            // ÉTAPE 2 : Analyser CHAQUE employé individuellement
            let allEmployeesData = {};
            let processedCount = 0;

            for (let i = 0; i < ALL_EMPLOYEES.length; i++) {
                const employee = ALL_EMPLOYEES[i];
                const lineNum = i + 1;
                
                processedCount++;
                await planningBot.editMessageText(
                    `🔍 Analyse employé ${processedCount}/${ALL_EMPLOYEES.length}\n👤 ${employee}...`, 
                    { chat_id: chatId, message_id: statusMsg.message_id }
                );

                const employeePrompt = `Ce planning a 22 lignes d'employés. Je veux UNIQUEMENT les créneaux de la LIGNE ${lineNum} : ${employee}

STRUCTURE DU TABLEAU :
- Colonne 1 (gauche) : Noms des employés
- Colonnes 2-8 : Les 7 jours de la semaine (${joursStr})
- Chaque ligne d'employé peut avoir plusieurs créneaux empilés verticalement

LIGNE ${lineNum} - ${employee} :
Regarde UNIQUEMENT cette ligne (la ${lineNum}ème ligne d'employé après l'en-tête).
Lis TOUS les créneaux de cette ligne, de gauche à droite (Lundi à Dimanche).
Un créneau = CODE HH:MM/HH:MM (ex: VDC 09:45/17:30)

CODES POSSIBLES : VDC, EDF-A, EDF-B, EDF-C, C-PAD, PAD-A, CUP-R, CUP-L, L-REG, L-ARB, REU, ANNIV, AIDE, EV-RE, EV-LO, FORE, FORP

FORMAT DE RÉPONSE (une seule ligne) :
${employee}: Lu CODE HH:MM/HH:MM, Ma CODE HH:MM/HH:MM, ...

Si cette ligne n'a AUCUN créneau visible (ligne vide), réponds :
${employee}: REPOS

IMPORTANT : Ne regarde QUE la ligne ${lineNum}, ignore toutes les autres lignes.`;

                try {
                    const empResult = await model.generateContent([
                        employeePrompt,
                        { inlineData: { mimeType: 'image/png', data: base64Image } }
                    ]);
                    
                    const empText = empResult.response.text().trim();
                    console.log(`📋 ${employee}:`, empText);
                    
                    // Parser la réponse
                    const creneaux = parseEmployeeResponse(empText, metadata.jours, employee);
                    allEmployeesData[employee] = creneaux;
                    
                    // Délai pour éviter rate limiting (Gemini 1.5 Pro = 2 req/min en gratuit)
                    // En payant c'est 1000 req/min, donc on met un petit délai
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                } catch (empError) {
                    console.error(`❌ Erreur ${employee}:`, empError.message);
                    allEmployeesData[employee] = {};
                    
                    // Si rate limit, attendre plus longtemps
                    if (empError.message.includes('429') || empError.message.includes('quota')) {
                        console.log('⏳ Rate limit, attente 30s...');
                        await planningBot.editMessageText(
                            `⏳ Pause API (rate limit)... Reprise dans 30s\n👤 ${employee}`, 
                            { chat_id: chatId, message_id: statusMsg.message_id }
                        );
                        await new Promise(resolve => setTimeout(resolve, 30000));
                    }
                }
            }

            // Construire planningData
            const planningData = {
                semaine: metadata.semaine,
                annee: metadata.annee,
                date_debut: metadata.date_debut,
                date_fin: metadata.date_fin,
                jours: metadata.jours,
                mois_jours: metadata.mois_jours,
                employes: allEmployeesData
            };

            const employesActifs = Object.keys(planningData.employes).filter(
                e => Object.keys(planningData.employes[e]).length > 0
            );
            const nbEmployes = employesActifs.length;
            const semaine = planningData.semaine;
            
            let totalCreneaux = 0;
            for (const emp of Object.values(planningData.employes)) {
                for (const jour of Object.values(emp)) {
                    totalCreneaux += jour.length;
                }
            }
            
            await planningBot.editMessageText(
                `✅ Planning S${semaine} analysé!\n` +
                `📅 ${planningData.date_debut} - ${planningData.date_fin}\n` +
                `👥 ${nbEmployes} employés actifs\n` +
                `📊 ${totalCreneaux} créneaux détectés\n\n` +
                `📝 Génération des fichiers iCal...`,
                { chat_id: chatId, message_id: statusMsg.message_id }
            );

            // Récupérer semaines existantes
            let existingWeeks = await getExistingWeeks();
            if (!existingWeeks.includes(semaine)) {
                existingWeeks.push(semaine);
                existingWeeks.sort((a, b) => a - b);
            }

            // Générer les fichiers
            const icsFiles = generateAllICS(planningData);
            const nbFichiers = Object.keys(icsFiles).length;
            
            const weekDataFile = `data/S${semaine}.json`;
            const weekData = {
                semaine,
                annee: planningData.annee,
                date_debut: planningData.date_debut,
                date_fin: planningData.date_fin,
                employesActifs: employesActifs
            };
            
            const indexHtml = generateWeekHtml(planningData, employesActifs, existingWeeks);
            const weekHtml = generateWeekHtml(planningData, employesActifs, existingWeeks);
            
            await planningBot.editMessageText(
                `📤 Upload sur GitHub (${nbFichiers} fichiers + pages web)...`,
                { chat_id: chatId, message_id: statusMsg.message_id }
            );

            const filesToUpload = {
                ...icsFiles,
                'index.html': indexHtml,
                [`S${semaine}.html`]: weekHtml,
                [weekDataFile]: JSON.stringify(weekData, null, 2)
            };
            
            await uploadToGitHub(filesToUpload, semaine);

            // Message final
            const siteUrl = 'https://planning-urbansoccer.onrender.com';
            
            const employesRepos = ALL_EMPLOYEES.filter(e => !employesActifs.includes(e));
            
            let finalMessage = `🎉 Planning S${semaine} publié!\n\n` +
                `📅 ${planningData.date_debut} → ${planningData.date_fin}\n` +
                `👥 ${nbEmployes} actifs / ${ALL_EMPLOYEES.length} total\n` +
                `📊 ${totalCreneaux} créneaux\n\n` +
                `🔗 ${siteUrl}\n\n`;
            
            if (employesRepos.length > 0 && employesRepos.length <= 10) {
                finalMessage += `😴 En repos: ${employesRepos.join(', ')}`;
            }
            
            await planningBot.sendMessage(chatId, finalMessage);

            // Nettoyer
            try {
                fs.unlinkSync(pdfPath);
                fs.unlinkSync(imagePath);
            } catch (e) {}

        } catch (error) {
            console.error('Erreur bot planning:', error);
            planningBot.sendMessage(chatId, `❌ Erreur: ${error.message}`);
        }
    });

    return planningBot;
}

function parseMetadata(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    
    let semaine = 1, annee = 2026, jours = [], moisDebut = 1, moisFin = 1;
    
    for (const line of lines) {
        if (line.startsWith('SEMAINE:')) {
            semaine = parseInt(line.replace('SEMAINE:', '').trim()) || 1;
        } else if (line.startsWith('ANNEE:')) {
            annee = parseInt(line.replace('ANNEE:', '').trim()) || 2026;
        } else if (line.startsWith('JOURS:')) {
            const joursStr = line.replace('JOURS:', '').trim();
            const joursMatch = joursStr.match(/\d+/g);
            if (joursMatch) {
                jours = joursMatch.map(j => parseInt(j));
            }
        } else if (line.startsWith('MOIS_DEBUT:')) {
            moisDebut = parseInt(line.replace('MOIS_DEBUT:', '').trim()) || 1;
        } else if (line.startsWith('MOIS_FIN:')) {
            moisFin = parseInt(line.replace('MOIS_FIN:', '').trim()) || 1;
        }
    }
    
    const mois_jours = jours.map((j, idx) => {
        if (idx > 0 && j < jours[idx - 1]) return moisFin;
        return moisDebut;
    });
    
    const moisNoms = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 
                     'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    
    return {
        semaine, annee, jours, mois_jours, moisDebut, moisFin,
        date_debut: jours.length > 0 ? `${jours[0]} ${moisNoms[moisDebut]}` : '',
        date_fin: jours.length > 0 ? `${jours[jours.length - 1]} ${moisNoms[moisFin]}` : ''
    };
}

function parseEmployeeResponse(text, jours, employeeName) {
    const result = {};
    
    // Nettoyer le texte
    let cleanText = text;
    if (cleanText.includes(':')) {
        cleanText = cleanText.substring(cleanText.indexOf(':') + 1).trim();
    }
    
    // Si REPOS
    if (cleanText.toUpperCase().includes('REPOS') || cleanText === '-' || cleanText === '') {
        return {};
    }
    
    // Parser les créneaux
    const regex = /(Lu|Ma|Me|Je|Ve|Sa|Di|Lun|Mar|Mer|Jeu|Ven|Sam|Dim)\s+([A-Z][A-Z0-9\-]+)\s+(\d{1,2}:\d{2})\/(\d{1,2}:\d{2})/gi;
    
    let match;
    while ((match = regex.exec(cleanText)) !== null) {
        const jourAbbr = match[1].substring(0, 2);
        const jourAbbrNorm = jourAbbr.charAt(0).toUpperCase() + jourAbbr.charAt(1).toLowerCase();
        const code = match[2].toUpperCase();
        const debut = match[3];
        const fin = match[4];
        
        const jourIndex = JOURS_MAP[jourAbbrNorm];
        
        if (jourIndex !== undefined && jours[jourIndex] !== undefined) {
            const jourNum = jours[jourIndex].toString();
            
            if (!result[jourNum]) {
                result[jourNum] = [];
            }
            
            result[jourNum].push({ code, debut, fin });
        }
    }
    
    return result;
}

async function getExistingWeeks() {
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/data`;
        const response = await axios.get(url, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        return response.data
            .filter(f => f.name.match(/^S\d+\.json$/))
            .map(f => parseInt(f.name.replace('S', '').replace('.json', '')))
            .sort((a, b) => a - b);
    } catch (e) {
        return [];
    }
}

function generateWeekHtml(planningData, employesActifs, allWeeks) {
    const { semaine, date_debut, date_fin } = planningData;
    
    const weeksTabsHtml = allWeeks.map(w => {
        const isActive = w === semaine;
        return `            <a href="${w === semaine ? '#' : `S${w}.html`}" class="week-tab ${isActive ? 'active' : ''}">S${w}</a>`;
    }).join('\n');
    
    const employeesHtml = ALL_EMPLOYEES.map(emp => {
        const fileName = emp.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const isActif = employesActifs.includes(emp);
        
        if (isActif) {
            return `            <a href="ics/${fileName}.ics" class="employee">${emp}</a>`;
        } else {
            return `            <div class="employee repos">${emp} <span class="badge">Repos</span></div>`;
        }
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Planning Urban 7D - S${semaine}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); min-height: 100vh; padding: 20px; }
        .container { max-width: 500px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 20px; padding: 20px; }
        .logo { font-size: 48px; margin-bottom: 10px; }
        h1 { color: #FF6B35; font-size: 28px; font-weight: 700; margin-bottom: 8px; }
        .subtitle { color: #888; font-size: 14px; margin-bottom: 5px; }
        .dates { color: #FF6B35; font-size: 18px; font-weight: 600; background: rgba(255, 107, 53, 0.1); padding: 10px 20px; border-radius: 20px; display: inline-block; margin-top: 10px; }
        .week-selector { display: flex; justify-content: center; gap: 8px; margin-bottom: 25px; flex-wrap: wrap; }
        .week-tab { padding: 10px 18px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 25px; color: #888; text-decoration: none; font-weight: 500; font-size: 14px; transition: all 0.2s ease; }
        .week-tab:hover { background: rgba(255, 107, 53, 0.1); border-color: rgba(255, 107, 53, 0.3); color: #FF6B35; }
        .week-tab.active { background: #FF6B35; border-color: #FF6B35; color: white; }
        .employees { display: flex; flex-direction: column; gap: 8px; }
        .employee { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: rgba(255, 255, 255, 0.05); border-radius: 12px; color: white; text-decoration: none; font-weight: 500; transition: all 0.2s ease; border: 1px solid rgba(255, 255, 255, 0.1); }
        a.employee:hover { background: rgba(255, 107, 53, 0.2); border-color: #FF6B35; transform: translateX(5px); }
        a.employee::after { content: '📅'; font-size: 20px; }
        .employee.repos { color: #555; background: rgba(255, 255, 255, 0.02); border-color: rgba(255, 255, 255, 0.05); }
        .badge { font-size: 11px; padding: 4px 10px; background: rgba(255, 255, 255, 0.1); border-radius: 20px; color: #555; font-weight: 400; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">⚽</div>
            <h1>Planning Urban 7D</h1>
            <p class="subtitle">Semaine ${semaine}</p>
            <div class="dates">${date_debut || ''} → ${date_fin || ''}</div>
        </div>
        <div class="week-selector">
${weeksTabsHtml}
        </div>
        <div class="employees">
${employeesHtml}
        </div>
        <div class="footer"><p>Cliquez sur votre nom pour ajouter le planning à votre calendrier</p></div>
    </div>
</body>
</html>`;
}

function generateICS(employeeName, creneaux, planningData) {
    const { semaine, annee, jours, mois_jours } = planningData;
    
    let ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Planning Urban 7D//FR
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Planning ${employeeName}
X-WR-TIMEZONE:Europe/Paris
BEGIN:VTIMEZONE
TZID:Europe/Paris
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
END:VTIMEZONE
`;

    let eventId = 1;
    
    for (const [jourStr, events] of Object.entries(creneaux)) {
        const jour = parseInt(jourStr);
        const jourIndex = jours.indexOf(jour);
        const moisJour = jourIndex >= 0 ? mois_jours[jourIndex] : 1;
        
        for (const event of events) {
            const description = LEGENDE[event.code] || event.code;
            const [hDebut, mDebut] = event.debut.split(':').map(Number);
            const [hFin, mFin] = event.fin.split(':').map(Number);
            
            let jourFin = jour, moisFin = moisJour, hFinAdjusted = hFin;
            if (hFin === 24 || hFin === 0) { hFinAdjusted = 0; jourFin = jour + 1; }
            
            const dateDebut = `${annee}${String(moisJour).padStart(2, '0')}${String(jour).padStart(2, '0')}T${String(hDebut).padStart(2, '0')}${String(mDebut).padStart(2, '0')}00`;
            const dateFin = `${annee}${String(moisFin).padStart(2, '0')}${String(jourFin).padStart(2, '0')}T${String(hFinAdjusted).padStart(2, '0')}${String(mFin).padStart(2, '0')}00`;
            const uid = `${employeeName.toLowerCase().replace(/\s+/g, '-').normalize('NFD').replace(/[\u0300-\u036f]/g, '')}-s${semaine}-${eventId}@urban7d`;
            
            ics += `BEGIN:VEVENT
UID:${uid}
DTSTAMP:${dateDebut}
DTSTART:${dateDebut}
DTEND:${dateFin}
SUMMARY:${description}
DESCRIPTION:${description}
END:VEVENT
`;
            eventId++;
        }
    }
    
    ics += 'END:VCALENDAR';
    return ics;
}

function generateAllICS(planningData) {
    const files = {};
    
    for (const [employeeName, creneaux] of Object.entries(planningData.employes)) {
        if (Object.keys(creneaux).length === 0) continue;
        
        const fileName = employeeName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        files[`ics/${fileName}.ics`] = generateICS(employeeName, creneaux, planningData);
    }
    
    return files;
}

async function uploadToGitHub(files, semaine) {
    const baseUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents`;
    
    for (const [filePath, content] of Object.entries(files)) {
        const url = `${baseUrl}/${filePath}`;
        const contentBase64 = Buffer.from(content).toString('base64');
        
        try {
            let sha = null;
            try {
                const existingFile = await axios.get(url, {
                    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
                });
                sha = existingFile.data.sha;
            } catch (e) {}
            
            const data = { message: `Mise à jour planning S${semaine}`, content: contentBase64 };
            if (sha) data.sha = sha;
            
            await axios.put(url, data, {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
            });
            
            console.log(`✅ Planning: Uploaded ${filePath}`);
        } catch (error) {
            console.error(`❌ Planning: Error uploading ${filePath}:`, error.response?.data || error.message);
            throw error;
        }
    }
}

export default { startPlanningBot };
