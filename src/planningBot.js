const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdf = require('pdf-poppler');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
const PLANNING_BOT_TOKEN = process.env.PLANNING_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'OhLaPey/planning-urbansoccer';

// Liste des employés
const EMPLOYEES = [
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

function initPlanningBot() {
    if (!PLANNING_BOT_TOKEN) {
        console.log('⚠️ PLANNING_BOT_TOKEN non défini, bot planning désactivé');
        return null;
    }

    planningBot = new TelegramBot(PLANNING_BOT_TOKEN, { polling: true });
    console.log('🤖 Bot Planning Urban 7D démarré');

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
            const pdfPath = path.join(tempDir, `planning_${Date.now()}.pdf`);
            fs.writeFileSync(pdfPath, pdfResponse.data);

            planningBot.sendMessage(chatId, '🖼️ Conversion en image...');

            // Convertir PDF en image
            const outputPath = path.join(tempDir, `planning_${Date.now()}`);
            const opts = {
                format: 'png',
                out_dir: tempDir,
                out_prefix: `planning_${Date.now()}`,
                page: 1,
                scale: 2048
            };
            
            await pdf.convert(pdfPath, opts);
            
            // Trouver l'image générée
            const files = fs.readdirSync(tempDir);
            const imageFile = files.find(f => f.startsWith(opts.out_prefix) && f.endsWith('.png'));
            
            if (!imageFile) {
                throw new Error('Erreur lors de la conversion PDF en image');
            }
            
            const imagePath = path.join(tempDir, imageFile);
            const imageBuffer = fs.readFileSync(imagePath);
            const base64Image = imageBuffer.toString('base64');

            planningBot.sendMessage(chatId, '🤖 Analyse du planning avec Gemini...');

            // Appeler Gemini Vision
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

            const prompt = `Analyse ce planning de travail et extrais les horaires de chaque employé.

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

Si un employé n'a pas de créneau un jour, ne mets pas ce jour dans son objet.
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
                // Nettoyer la réponse (enlever les ```json si présents)
                let jsonStr = responseText;
                if (jsonStr.includes('```json')) {
                    jsonStr = jsonStr.split('```json')[1].split('```')[0];
                } else if (jsonStr.includes('```')) {
                    jsonStr = jsonStr.split('```')[1].split('```')[0];
                }
                planningData = JSON.parse(jsonStr.trim());
            } catch (e) {
                console.error('Erreur parsing JSON:', responseText);
                throw new Error('Erreur lors de l\'analyse du planning');
            }

            planningBot.sendMessage(chatId, `✅ Planning S${planningData.semaine} analysé!\n\n📝 Génération des fichiers iCal...`);

            // Générer les fichiers ICS
            const icsFiles = generateAllICS(planningData);
            
            planningBot.sendMessage(chatId, `📤 Upload sur GitHub (${Object.keys(icsFiles).length} fichiers)...`);

            // Upload sur GitHub
            await uploadToGitHub(icsFiles, planningData.semaine);

            // Envoyer le message final
            const siteUrl = 'https://planning-urbansoccer.onrender.com';
            planningBot.sendMessage(chatId, 
                `🎉 Planning S${planningData.semaine} publié!\n\n` +
                `🔗 Lien à partager:\n${siteUrl}\n\n` +
                `📱 Chaque collègue clique sur son nom pour ajouter le planning à son calendrier.`
            );

            // Nettoyer les fichiers temporaires
            fs.unlinkSync(pdfPath);
            fs.unlinkSync(imagePath);

        } catch (error) {
            console.error('Erreur bot planning:', error);
            planningBot.sendMessage(chatId, `❌ Erreur: ${error.message}`);
        }
    });

    return planningBot;
}

function generateICS(employeeName, creneaux, planningData) {
    const { semaine, annee, mois, jours, mois_jours } = planningData;
    
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
        const jourIndex = jours.indexOf(parseInt(jourStr));
        const moisJour = jourIndex >= 0 ? mois_jours[jourIndex] : mois;
        const jour = parseInt(jourStr);
        
        for (const event of events) {
            const code = event.code;
            const description = LEGENDE[code] || code;
            
            const [hDebut, mDebut] = event.debut.split(':').map(Number);
            const [hFin, mFin] = event.fin.split(':').map(Number);
            
            // Gérer minuit (24:00)
            let jourFin = jour;
            let moisFin = moisJour;
            let hFinAdjusted = hFin;
            
            if (hFin === 24) {
                hFinAdjusted = 0;
                jourFin = jour + 1;
                // Gérer le changement de mois si nécessaire
            }
            
            const dateDebut = `${annee}${String(moisJour).padStart(2, '0')}${String(jour).padStart(2, '0')}T${String(hDebut).padStart(2, '0')}${String(mDebut).padStart(2, '0')}00`;
            const dateFin = `${annee}${String(moisFin).padStart(2, '0')}${String(jourFin).padStart(2, '0')}T${String(hFinAdjusted).padStart(2, '0')}${String(mFin).padStart(2, '0')}00`;
            
            const uid = `${employeeName.toLowerCase().replace(/\s+/g, '-')}-s${semaine}-${eventId}@urban7d`;
            
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
            // Vérifier si le fichier existe déjà
            let sha = null;
            try {
                const existingFile = await axios.get(url, {
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                sha = existingFile.data.sha;
            } catch (e) {
                // Fichier n'existe pas, c'est OK
            }
            
            // Créer ou mettre à jour le fichier
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
            
            console.log(`✅ Uploaded: ${filePath}`);
        } catch (error) {
            console.error(`❌ Error uploading ${filePath}:`, error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = { initPlanningBot };
