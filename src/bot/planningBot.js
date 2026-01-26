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

            await planningBot.sendMessage(chatId, '🖼️ Conversion en image...');

            // Convertir PDF en image avec pdftoppm (disponible sur Render)
            const imagePath = path.join(tempDir, `planning_${timestamp}.png`);
            
            try {
                await execAsync(`pdftoppm -png -r 200 -singlefile "${pdfPath}" "${path.join(tempDir, `planning_${timestamp}`)}"`);
            } catch (e) {
                // Fallback: essayer avec convert (ImageMagick)
                await execAsync(`convert -density 200 "${pdfPath}[0]" "${imagePath}"`);
            }

            const imageBuffer = fs.readFileSync(imagePath);
            const base64Image = imageBuffer.toString('base64');

            await planningBot.sendMessage(chatId, '🤖 Analyse du planning avec Gemini...');

            // Appeler Gemini Vision
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

            const prompt = `Analyse ce planning de travail et extrais les horaires de chaque employé.

IMPORTANT: Regarde bien les couleurs des lignes pour identifier à quel employé appartient chaque créneau. Chaque employé a une couleur de fond différente.

Pour chaque employé, donne-moi ses créneaux au format JSON comme ceci:
{
  "semaine": 5,
  "annee": 2026,
  "mois": 1,
  "jours": [26, 27, 28, 29, 30, 31, 1],
  "mois_jours": [1, 1, 1, 1, 1, 1, 2],
  "employes": {
    "NOM Prénom": {
      "26": [{"code": "VDC", "debut": "09:45", "fin": "17:30"}],
      "27": [{"code": "L-REG", "debut": "18:15", "fin": "21:45"}],
      ...
    },
    ...
  }
}

Les codes d'activité possibles sont: VDC, EDF-A, EDF-B, EDF-C, C-PAD, PAD-A, CUP-R, CUP-L, L-REG, L-ARB, REU, ANNIV, AIDE, EV-RE, EV-LO, FORE, FORP.

ATTENTION:
- Le champ "jours" contient les numéros de jours affichés dans le tableau
- Le champ "mois_jours" contient le mois correspondant à chaque jour (1=janvier, 2=février, etc.)
- Si un employé n'a pas de créneau un jour, ne mets pas ce jour dans son objet
- Fais attention à bien associer chaque créneau au bon employé en suivant les couleurs des lignes

Réponds UNIQUEMENT avec le JSON, sans texte avant ou après.`;

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
            
            // Extraire le JSON de la réponse
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

            const nbEmployes = Object.keys(planningData.employes).length;
            await planningBot.sendMessage(chatId, `✅ Planning S${planningData.semaine} analysé!\n👥 ${nbEmployes} employés détectés\n\n📝 Génération des fichiers iCal...`);

            // Générer les fichiers ICS
            const icsFiles = generateAllICS(planningData);
            const nbFichiers = Object.keys(icsFiles).length;
            
            await planningBot.sendMessage(chatId, `📤 Upload sur GitHub (${nbFichiers} fichiers)...`);

            // Upload sur GitHub
            await uploadToGitHub(icsFiles, planningData.semaine);

            // Envoyer le message final
            const siteUrl = 'https://planning-urbansoccer.onrender.com';
            await planningBot.sendMessage(chatId, 
                `🎉 Planning S${planningData.semaine} publié!\n\n` +
                `🔗 Lien à partager:\n${siteUrl}\n\n` +
                `📱 Chaque collègue clique sur son nom pour ajouter le planning à son calendrier.`
            );

            // Nettoyer les fichiers temporaires
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
