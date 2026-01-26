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

// Liste complète des employés
const ALL_EMPLOYEES = [
    'BONILLO Matthieu', 'BOULARDET Lucas', 'CARRERE Peïo', 'CASTELLON Pascaline',
    'COHAT Linda', 'CRUZEL Quentin', 'DE NOUEL Maxime', 'DIVIEN Yohan',
    'DONAER Nicolas', 'DOVINA Théo', 'HEBERT Jean Baptiste', 'JARGUEL Thomas',
    'KABUNDA NDEKE Marvyn', 'MADIELE Henri', 'MOSTEFA Yanis', 'PEREZ Loic',
    'PISTORE Remi', 'PUJOL Mathieu', 'RABII Mehdi', 'SEIGNE Kevin',
    'TINGUY Florian', 'TOPPAN Mattis'
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

    // Commande /start
    planningBot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        planningBot.sendMessage(chatId, 
            '👋 Bienvenue sur le Bot Planning Urban 7D!\n\n' +
            '📄 Envoyez-moi le PDF du planning et je génèrerai les fichiers calendrier pour toute l\'équipe.\n\n' +
            '🔗 Les liens seront disponibles sur:\nhttps://planning-urbansoccer.onrender.com'
        );
    });

    // Réception d'un document (PDF)
    planningBot.on('document', async (msg) => {
        const chatId = msg.chat.id;
        const document = msg.document;

        if (!document.file_name.toLowerCase().endsWith('.pdf')) {
            planningBot.sendMessage(chatId, '❌ Veuillez envoyer un fichier PDF.');
            return;
        }

        planningBot.sendMessage(chatId, '📥 PDF reçu, analyse en cours...');

        try {
            // Télécharger le PDF
            const fileLink = await planningBot.getFileLink(document.file_id);
            const pdfResponse = await axios.get(fileLink, { responseType: 'arraybuffer' });
            
            // Sauvegarder temporairement
            const tempDir = os.tmpdir();
            const timestamp = Date.now();
            const pdfPath = path.join(tempDir, `planning_${timestamp}.pdf`);
            fs.writeFileSync(pdfPath, pdfResponse.data);

            await planningBot.sendMessage(chatId, '🖼️ Conversion en image HD...');

            // Convertir PDF en image HAUTE RÉSOLUTION
            const imagePath = path.join(tempDir, `planning_${timestamp}.png`);
            
            try {
                // Résolution 300 DPI pour meilleure lecture
                await execAsync(`pdftoppm -png -r 300 -singlefile "${pdfPath}" "${path.join(tempDir, `planning_${timestamp}`)}"`);
            } catch (e) {
                await execAsync(`convert -density 300 "${pdfPath}[0]" "${imagePath}"`);
            }

            const imageBuffer = fs.readFileSync(imagePath);
            const base64Image = imageBuffer.toString('base64');

            await planningBot.sendMessage(chatId, '🤖 Analyse du planning avec Gemini...');

            // Appeler Gemini Vision
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

            const prompt = `Tu es un expert en lecture de tableaux de planning. Analyse cette image de planning de travail.

=== STRUCTURE DU TABLEAU ===
- C'est un tableau avec des LIGNES HORIZONTALES
- Première colonne: NOM Prénom de l'employé
- Colonnes suivantes: les 7 jours de la semaine (Lundi à Dimanche)
- Chaque employé a une COULEUR DE FOND UNIQUE pour sa ligne
- Dans chaque cellule jour, il peut y avoir PLUSIEURS créneaux empilés verticalement

=== MÉTHODE DE LECTURE (TRÈS IMPORTANT) ===
1. Identifie d'abord l'en-tête: numéro de semaine, dates, jours
2. Pour CHAQUE employé, lis sa ligne HORIZONTALEMENT de gauche à droite:
   - Repère le nom dans la première colonne
   - Pour chaque jour (colonne), lis TOUS les créneaux de cette cellule
   - Un créneau = CODE HH:MM/HH:MM (ex: VDC 09:45/17:30)
   - Attention: plusieurs créneaux peuvent être empilés dans une même cellule
3. La COULEUR de fond délimite les créneaux d'un employé - ne mélange pas avec l'employé au-dessus ou en-dessous

=== LISTE DES EMPLOYÉS À CHERCHER ===
${ALL_EMPLOYEES.join(', ')}

=== CODES D'ACTIVITÉ POSSIBLES ===
VDC, EDF-A, EDF-B, EDF-C, C-PAD, PAD-A, CUP-R, CUP-L, L-REG, L-ARB, REU, ANNIV, AIDE, EV-RE, EV-LO, FORE, FORP

=== FORMAT DE SORTIE JSON ===
{
  "semaine": <numéro>,
  "annee": <année>,
  "date_debut": "<jour> <mois>",
  "date_fin": "<jour> <mois>",
  "jours": [<num jour 1>, <num jour 2>, ...],
  "mois_jours": [<mois du jour 1>, <mois du jour 2>, ...],
  "employes": {
    "NOM Prénom": {
      "<num_jour>": [
        {"code": "CODE", "debut": "HH:MM", "fin": "HH:MM"},
        {"code": "CODE2", "debut": "HH:MM", "fin": "HH:MM"}
      ],
      "<num_jour2>": [...]
    }
  }
}

=== RÈGLES IMPORTANTES ===
- N'inclus QUE les employés qui ont AU MOINS UN créneau
- Si un employé n'a rien sur sa ligne = il est en repos, ne l'inclus pas
- Vérifie bien que chaque créneau est attribué au BON employé (même couleur de fond)
- Les heures sont au format HH:MM (ex: 09:45, 17:30, 24:00 pour minuit)
- mois_jours: 1=janvier, 2=février, etc.

Réponds UNIQUEMENT avec le JSON valide, sans texte avant ou après.`;

            const result = await model.generateContent([
                prompt,
                {
                    inlineData: {
                        mimeType: 'image/png',
                        data: base64Image
                    }
                }
            ]);

            const responseText = result.response.text();
            
            // Extraire le JSON
            let planningData;
            try {
                let jsonStr = responseText;
                if (jsonStr.includes('```json')) {
                    jsonStr = jsonStr.split('```json')[1].split('```')[0];
                } else if (jsonStr.includes('```')) {
                    jsonStr = jsonStr.split('```')[1].split('```')[0];
                }
                planningData = JSON.parse(jsonStr.trim());
            } catch (e) {
                console.error('Erreur parsing JSON:', responseText);
                throw new Error('Erreur lors de l\'analyse du planning. Réessayez.');
            }

            const employesActifs = Object.keys(planningData.employes);
            const nbEmployes = employesActifs.length;
            const semaine = planningData.semaine;
            
            // Compter le nombre total de créneaux
            let totalCreneaux = 0;
            for (const emp of Object.values(planningData.employes)) {
                for (const jour of Object.values(emp)) {
                    totalCreneaux += jour.length;
                }
            }
            
            await planningBot.sendMessage(chatId, 
                `✅ Planning S${semaine} analysé!\n` +
                `📅 ${planningData.date_debut || ''} - ${planningData.date_fin || ''}\n` +
                `👥 ${nbEmployes} employés actifs\n` +
                `📊 ${totalCreneaux} créneaux détectés\n\n` +
                `📝 Génération des fichiers iCal...`
            );

            // Récupérer la liste des semaines existantes
            let existingWeeks = await getExistingWeeks();
            if (!existingWeeks.includes(semaine)) {
                existingWeeks.push(semaine);
                existingWeeks.sort((a, b) => a - b);
            }

            // Générer les fichiers ICS
            const icsFiles = generateAllICS(planningData);
            const nbFichiers = Object.keys(icsFiles).length;
            
            // Sauvegarder les données de la semaine
            const weekDataFile = `data/S${semaine}.json`;
            const weekData = {
                semaine,
                annee: planningData.annee,
                date_debut: planningData.date_debut,
                date_fin: planningData.date_fin,
                employesActifs: employesActifs
            };
            
            // Générer le index.html principal
            const indexHtml = generateWeekHtml(planningData, employesActifs, existingWeeks);
            
            // Générer la page de la semaine spécifique
            const weekHtml = generateWeekHtml(planningData, employesActifs, existingWeeks);
            
            await planningBot.sendMessage(chatId, `📤 Upload sur GitHub (${nbFichiers} fichiers + pages web)...`);

            // Upload sur GitHub
            const filesToUpload = {
                ...icsFiles,
                'index.html': indexHtml,
                [`S${semaine}.html`]: weekHtml,
                [weekDataFile]: JSON.stringify(weekData, null, 2)
            };
            
            await uploadToGitHub(filesToUpload, semaine);

            // Envoyer le message final avec résumé
            const siteUrl = 'https://planning-urbansoccer.onrender.com';
            
            // Créer un résumé des employés
            const employesRepos = ALL_EMPLOYEES.filter(e => {
                const eNorm = e.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                return !employesActifs.some(ea => {
                    const eaNorm = ea.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                    return eaNorm.includes(eNorm.split(' ')[0]) || eNorm.includes(eaNorm.split(' ')[0]);
                });
            });
            
            let finalMessage = `🎉 Planning S${semaine} publié!\n\n` +
                `📅 ${planningData.date_debut || ''} → ${planningData.date_fin || ''}\n` +
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

async function getExistingWeeks() {
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/data`;
        const response = await axios.get(url, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        const weeks = response.data
            .filter(f => f.name.match(/^S\d+\.json$/))
            .map(f => parseInt(f.name.replace('S', '').replace('.json', '')))
            .sort((a, b) => a - b);
        
        return weeks;
    } catch (e) {
        return [];
    }
}

function generateWeekHtml(planningData, employesActifs, allWeeks) {
    const { semaine, date_debut, date_fin } = planningData;
    
    // Normaliser les noms des employés actifs pour comparaison
    const employesActifsNormalises = employesActifs.map(e => 
        e.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    );
    
    // Générer les onglets de semaines
    const weeksTabsHtml = allWeeks.map(w => {
        const isActive = w === semaine;
        const href = w === semaine ? '#' : `S${w}.html`;
        return `            <a href="${href}" class="week-tab ${isActive ? 'active' : ''}">S${w}</a>`;
    }).join('\n');
    
    // Générer la liste des employés
    const employeesHtml = ALL_EMPLOYEES.map(emp => {
        const fileName = emp
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '');
        
        const empNormalise = emp.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const isActif = employesActifsNormalises.some(e => {
            const eParts = e.split(' ');
            const empParts = empNormalise.split(' ');
            // Match sur le nom de famille (premier élément)
            return eParts[0] === empParts[0];
        });
        
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
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 500px;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            margin-bottom: 20px;
            padding: 20px;
        }
        
        .logo {
            font-size: 48px;
            margin-bottom: 10px;
        }
        
        h1 {
            color: #FF6B35;
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 8px;
        }
        
        .subtitle {
            color: #888;
            font-size: 14px;
            margin-bottom: 5px;
        }
        
        .dates {
            color: #FF6B35;
            font-size: 18px;
            font-weight: 600;
            background: rgba(255, 107, 53, 0.1);
            padding: 10px 20px;
            border-radius: 20px;
            display: inline-block;
            margin-top: 10px;
        }
        
        /* Week Tabs */
        .week-selector {
            display: flex;
            justify-content: center;
            gap: 8px;
            margin-bottom: 25px;
            flex-wrap: wrap;
        }
        
        .week-tab {
            padding: 10px 18px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 25px;
            color: #888;
            text-decoration: none;
            font-weight: 500;
            font-size: 14px;
            transition: all 0.2s ease;
        }
        
        .week-tab:hover {
            background: rgba(255, 107, 53, 0.1);
            border-color: rgba(255, 107, 53, 0.3);
            color: #FF6B35;
        }
        
        .week-tab.active {
            background: #FF6B35;
            border-color: #FF6B35;
            color: white;
        }
        
        .employees {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .employee {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            color: white;
            text-decoration: none;
            font-weight: 500;
            transition: all 0.2s ease;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        a.employee:hover {
            background: rgba(255, 107, 53, 0.2);
            border-color: #FF6B35;
            transform: translateX(5px);
        }
        
        a.employee::after {
            content: '📅';
            font-size: 20px;
        }
        
        .employee.repos {
            color: #555;
            background: rgba(255, 255, 255, 0.02);
            border-color: rgba(255, 255, 255, 0.05);
        }
        
        .badge {
            font-size: 11px;
            padding: 4px 10px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            color: #555;
            font-weight: 400;
        }
        
        .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 12px;
        }
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
        
        <div class="footer">
            <p>Cliquez sur votre nom pour ajouter le planning à votre calendrier</p>
        </div>
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
        const moisJour = jourIndex >= 0 ? mois_jours[jourIndex] : planningData.mois;
        
        for (const event of events) {
            const code = event.code;
            const description = LEGENDE[code] || code;
            
            const [hDebut, mDebut] = event.debut.split(':').map(Number);
            const [hFin, mFin] = event.fin.split(':').map(Number);
            
            let jourFin = jour;
            let moisFin = moisJour;
            let hFinAdjusted = hFin;
            
            if (hFin === 24 || hFin === 0) {
                hFinAdjusted = 0;
                jourFin = jour + 1;
            }
            
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
        
        const fileName = employeeName
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '');
        
        const icsContent = generateICS(employeeName, creneaux, planningData);
        files[`ics/${fileName}.ics`] = icsContent;
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
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                sha = existingFile.data.sha;
            } catch (e) {}
            
            const data = {
                message: `Mise à jour planning S${semaine}`,
                content: contentBase64
            };
            
            if (sha) {
                data.sha = sha;
            }
            
            await axios.put(url, data, {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            console.log(`✅ Planning: Uploaded ${filePath}`);
        } catch (error) {
            console.error(`❌ Planning: Error uploading ${filePath}:`, error.response?.data || error.message);
            throw error;
        }
    }
}

export default { startPlanningBot };
