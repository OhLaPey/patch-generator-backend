import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Installer pandas et openpyxl au démarrage
async function ensurePythonDeps() {
    try {
        await execAsync('python3 -c "import pandas, openpyxl"');
        console.log('✅ Python deps OK');
    } catch (e) {
        console.log('📦 Installation pandas + openpyxl...');
        try {
            await execAsync('pip install pandas openpyxl --break-system-packages -q');
            console.log('✅ Python deps installés');
        } catch (err) {
            console.log('⚠️ Erreur installation Python deps:', err.message);
        }
    }
}

// Configuration
const PLANNING_BOT_TOKEN = process.env.PLANNING_BOT_TOKEN;
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
    "FORP": "Formation",
    "INVEN": "Inventaire",
    "COMMS": "Communication"
};

const MOIS_NOMS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 
                  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

let planningBot = null;

export async function startPlanningBot() {
    if (!PLANNING_BOT_TOKEN) {
        console.log('⚠️  Planning Bot: SKIPPED (PLANNING_BOT_TOKEN non défini)');
        return null;
    }

    await ensurePythonDeps();

    planningBot = new TelegramBot(PLANNING_BOT_TOKEN, { polling: true });
    console.log('✅ Planning Bot Urban 7D démarré');

    planningBot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        planningBot.sendMessage(chatId, 
            '👋 Bienvenue sur le Bot Planning Urban 7D!\n\n' +
            '📄 Envoyez-moi le fichier Excel (.xlsx) du planning et je génèrerai les fichiers calendrier pour toute l\'équipe.\n\n' +
            '⚡ Traitement instantané, 100% fiable!\n\n' +
            '🔗 Les liens seront disponibles sur:\nhttps://planning-urbansoccer.onrender.com'
        );
    });

    planningBot.on('document', async (msg) => {
        const chatId = msg.chat.id;
        const document = msg.document;
        const fileName = document.file_name.toLowerCase();

        if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
            planningBot.sendMessage(chatId, '❌ Veuillez envoyer un fichier Excel (.xlsx)');
            return;
        }

        const statusMsg = await planningBot.sendMessage(chatId, '📥 Fichier Excel reçu, traitement en cours...');

        try {
            const fileLink = await planningBot.getFileLink(document.file_id);
            const fileResponse = await axios.get(fileLink, { responseType: 'arraybuffer' });
            
            const tempDir = os.tmpdir();
            const timestamp = Date.now();
            const xlsxPath = path.join(tempDir, 'planning_' + timestamp + '.xlsx');
            fs.writeFileSync(xlsxPath, fileResponse.data);

            await planningBot.editMessageText('📊 Parsing du fichier Excel...', { chat_id: chatId, message_id: statusMsg.message_id });

            const pythonScript = generatePythonParser(xlsxPath);
            const scriptPath = path.join(tempDir, 'parser_' + timestamp + '.py');
            fs.writeFileSync(scriptPath, pythonScript);

            const { stdout, stderr } = await execAsync('python3 ' + scriptPath);
            
            if (stderr && !stderr.includes('UserWarning')) {
                console.error('Python stderr:', stderr);
            }

            const result = JSON.parse(stdout);
            
            if (result.error) {
                throw new Error(result.error);
            }

            const { semaine, annee, mois_debut, mois_fin, jours, planning } = result;

            await planningBot.editMessageText(
                '✅ Planning S' + semaine + ' parsé!\n' +
                '📅 ' + jours[0] + ' ' + MOIS_NOMS[mois_debut] + ' - ' + jours[6] + ' ' + MOIS_NOMS[mois_fin] + '\n' +
                '📊 Génération des fichiers...',
                { chat_id: chatId, message_id: statusMsg.message_id }
            );

            const mois_jours = jours.map((j, idx) => {
                if (idx > 0 && j < jours[idx - 1]) return mois_fin;
                return mois_debut;
            });

            const planningData = {
                semaine,
                annee,
                date_debut: jours[0] + ' ' + MOIS_NOMS[mois_debut],
                date_fin: jours[6] + ' ' + MOIS_NOMS[mois_fin],
                jours,
                mois_jours,
                employes: planning
            };

            const employesActifs = Object.keys(planning).filter(
                e => Object.keys(planning[e]).length > 0 && 
                     Object.values(planning[e]).some(arr => arr.length > 0)
            );
            
            let totalCreneaux = 0;
            for (const emp of Object.values(planning)) {
                for (const jour of Object.values(emp)) {
                    totalCreneaux += jour.length;
                }
            }

            await planningBot.editMessageText(
                '✅ Planning S' + semaine + ' analysé!\n' +
                '📅 ' + planningData.date_debut + ' - ' + planningData.date_fin + '\n' +
                '👥 ' + employesActifs.length + ' employés actifs\n' +
                '📊 ' + totalCreneaux + ' créneaux détectés\n\n' +
                '📝 Génération des fichiers iCal...',
                { chat_id: chatId, message_id: statusMsg.message_id }
            );

            let existingWeeks = await getExistingWeeks();
            if (!existingWeeks.includes(semaine)) {
                existingWeeks.push(semaine);
                existingWeeks.sort((a, b) => a - b);
            }

            const icsFiles = generateAllICS(planningData, employesActifs);
            const nbFichiers = Object.keys(icsFiles).length;
            
            const weekDataFile = 'data/S' + semaine + '.json';
            const weekData = {
                semaine,
                annee: planningData.annee,
                date_debut: planningData.date_debut,
                date_fin: planningData.date_fin,
                employesActifs
            };
            
            const indexHtml = generateWeekHtml(planningData, employesActifs, existingWeeks);
            const weekHtml = generateWeekHtml(planningData, employesActifs, existingWeeks);
            
            await planningBot.editMessageText(
                '📤 Upload sur GitHub (' + nbFichiers + ' fichiers + pages web)...',
                { chat_id: chatId, message_id: statusMsg.message_id }
            );

            const filesToUpload = {
                ...icsFiles,
                'index.html': indexHtml,
                ['S' + semaine + '.html']: weekHtml,
                [weekDataFile]: JSON.stringify(weekData, null, 2)
            };
            
            await uploadToGitHub(filesToUpload, semaine);

            const siteUrl = 'https://planning-urbansoccer.onrender.com';
            const employesRepos = ALL_EMPLOYEES.filter(e => !employesActifs.includes(e));
            
            let finalMessage = '🎉 Planning S' + semaine + ' publié!\n\n' +
                '📅 ' + planningData.date_debut + ' → ' + planningData.date_fin + '\n' +
                '👥 ' + employesActifs.length + ' actifs / ' + ALL_EMPLOYEES.length + ' total\n' +
                '📊 ' + totalCreneaux + ' créneaux\n\n' +
                '🔗 ' + siteUrl + '\n\n';
            
            if (employesRepos.length > 0 && employesRepos.length <= 10) {
                finalMessage += '😴 En repos: ' + employesRepos.join(', ');
            }
            
            await planningBot.sendMessage(chatId, finalMessage);

            try {
                fs.unlinkSync(xlsxPath);
                fs.unlinkSync(scriptPath);
            } catch (e) {}

        } catch (error) {
            console.error('Erreur bot planning:', error);
            planningBot.sendMessage(chatId, '❌ Erreur: ' + error.message);
        }
    });

    return planningBot;
}

function generatePythonParser(xlsxPath) {
    return `
import pandas as pd
import json
import sys
import re

try:
    df = pd.read_excel('` + xlsxPath + `', header=None)
    
    semaine = None
    annee = None
    mois_debut = None
    mois_fin = None
    jours = []
    
    for idx, row in df.iterrows():
        for cell in row:
            if pd.notna(cell) and isinstance(cell, str):
                if 'Sem' in cell:
                    match = re.search(r'Sem\\s*(\\d+)', cell)
                    if match:
                        semaine = int(match.group(1))
                if any(m in cell for m in ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 
                                            'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']):
                    year_match = re.search(r'(\\d{4})', cell)
                    if year_match:
                        annee = int(year_match.group(1))
                    mois_map = {'Janvier': 1, 'Février': 2, 'Mars': 3, 'Avril': 4, 'Mai': 5, 'Juin': 6,
                               'Juillet': 7, 'Août': 8, 'Septembre': 9, 'Octobre': 10, 'Novembre': 11, 'Décembre': 12}
                    for m_name, m_num in mois_map.items():
                        if m_name in cell:
                            if mois_debut is None:
                                mois_debut = m_num
                            mois_fin = m_num
        if semaine and annee:
            break
    
    jours_row = None
    for idx, row in df.iterrows():
        cell0 = row[0]
        if pd.notna(cell0) and isinstance(cell0, str) and 'Nom' in cell0:
            jours_row = idx
            break
    
    if jours_row is not None:
        for col in range(1, 8):
            cell = df.iloc[jours_row, col]
            if pd.notna(cell) and isinstance(cell, str):
                match = re.search(r'(\\d+)', cell)
                if match:
                    jours.append(int(match.group(1)))
    
    if len(jours) == 7:
        for i in range(1, 7):
            if jours[i] < jours[i-1]:
                mois_fin = mois_debut + 1 if mois_debut < 12 else 1
                break
    
    LEGENDE = ["VDC", "EDF-A", "EDF-B", "EDF-C", "C-PAD", "PAD-A", "CUP-R", "CUP-L", 
               "L-REG", "L-ARB", "REU", "ANNIV", "AIDE", "EV-RE", "EV-LO", "FORE", "FORP", 
               "INVEN", "COMMS"]
    
    planning = {}
    employee_rows = {}
    
    for idx, row in df.iterrows():
        if idx <= jours_row:
            continue
        name = row[0]
        if pd.notna(name) and isinstance(name, str) and name.strip():
            employee_rows[idx] = name.strip()
    
    emp_indices = sorted(employee_rows.keys())
    
    for i, start_idx in enumerate(emp_indices):
        emp_name = employee_rows[start_idx]
        end_idx = emp_indices[i + 1] if i + 1 < len(emp_indices) else len(df)
        
        planning[emp_name] = {}
        
        for col_idx, jour in enumerate(jours):
            col = col_idx + 1
            codes = []
            times = []
            
            for row_idx in range(start_idx, end_idx):
                cell = df.iloc[row_idx, col]
                if pd.notna(cell) and isinstance(cell, str):
                    cell = cell.strip()
                    if cell in LEGENDE:
                        codes.append(cell)
                    elif '/' in cell and ':' in cell:
                        time_str = cell.replace('+', '')
                        times.append(time_str)
            
            if codes and times:
                planning[emp_name][str(jour)] = []
                for code, time in zip(codes, times):
                    parts = time.split('/')
                    if len(parts) >= 2:
                        debut = parts[0].strip()
                        fin = parts[1].strip()
                        if fin == '00':
                            fin = '24:00'
                        planning[emp_name][str(jour)].append({
                            'code': code,
                            'debut': debut,
                            'fin': fin
                        })
    
    result = {
        'semaine': semaine or 1,
        'annee': annee or 2026,
        'mois_debut': mois_debut or 1,
        'mois_fin': mois_fin or mois_debut or 1,
        'jours': jours,
        'planning': planning
    }
    
    print(json.dumps(result))

except Exception as e:
    print(json.dumps({'error': str(e)}))
    sys.exit(1)
`;
}

async function getExistingWeeks() {
    try {
        const url = 'https://api.github.com/repos/' + GITHUB_REPO + '/contents/data';
        const response = await axios.get(url, {
            headers: { 'Authorization': 'token ' + GITHUB_TOKEN, 'Accept': 'application/vnd.github.v3+json' }
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
        const href = w === semaine ? '#' : 'S' + w + '.html';
        const activeClass = isActive ? 'active' : '';
        return '            <a href="' + href + '" class="week-tab ' + activeClass + '">S' + w + '</a>';
    }).join('\n');
    
    const employeesHtml = ALL_EMPLOYEES.map(emp => {
        const fileName = emp.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const isActif = employesActifs.includes(emp);
        
        if (isActif) {
            return '            <a href="ics/' + fileName + '.ics" class="employee">' + emp + '</a>';
        } else {
            return '            <div class="employee repos">' + emp + ' <span class="badge">Repos</span></div>';
        }
    }).join('\n');

    return '<!DOCTYPE html>\n' +
'<html lang="fr">\n' +
'<head>\n' +
'    <meta charset="UTF-8">\n' +
'    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'    <title>Planning Urban 7D - S' + semaine + '</title>\n' +
'    <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
'    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">\n' +
'    <style>\n' +
'        * { margin: 0; padding: 0; box-sizing: border-box; }\n' +
'        body { font-family: \'Inter\', sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); min-height: 100vh; padding: 20px; }\n' +
'        .container { max-width: 500px; margin: 0 auto; }\n' +
'        .header { text-align: center; margin-bottom: 20px; padding: 20px; }\n' +
'        .logo { font-size: 48px; margin-bottom: 10px; }\n' +
'        h1 { color: #FF6B35; font-size: 28px; font-weight: 700; margin-bottom: 8px; }\n' +
'        .subtitle { color: #888; font-size: 14px; margin-bottom: 5px; }\n' +
'        .dates { color: #FF6B35; font-size: 18px; font-weight: 600; background: rgba(255, 107, 53, 0.1); padding: 10px 20px; border-radius: 20px; display: inline-block; margin-top: 10px; }\n' +
'        .week-selector { display: flex; justify-content: center; gap: 8px; margin-bottom: 25px; flex-wrap: wrap; }\n' +
'        .week-tab { padding: 10px 18px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 25px; color: #888; text-decoration: none; font-weight: 500; font-size: 14px; transition: all 0.2s ease; }\n' +
'        .week-tab:hover { background: rgba(255, 107, 53, 0.1); border-color: rgba(255, 107, 53, 0.3); color: #FF6B35; }\n' +
'        .week-tab.active { background: #FF6B35; border-color: #FF6B35; color: white; }\n' +
'        .employees { display: flex; flex-direction: column; gap: 8px; }\n' +
'        .employee { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: rgba(255, 255, 255, 0.05); border-radius: 12px; color: white; text-decoration: none; font-weight: 500; transition: all 0.2s ease; border: 1px solid rgba(255, 255, 255, 0.1); }\n' +
'        a.employee:hover { background: rgba(255, 107, 53, 0.2); border-color: #FF6B35; transform: translateX(5px); }\n' +
'        a.employee::after { content: \'📅\'; font-size: 20px; }\n' +
'        .employee.repos { color: #555; background: rgba(255, 255, 255, 0.02); border-color: rgba(255, 255, 255, 0.05); }\n' +
'        .badge { font-size: 11px; padding: 4px 10px; background: rgba(255, 255, 255, 0.1); border-radius: 20px; color: #555; font-weight: 400; }\n' +
'        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }\n' +
'    </style>\n' +
'</head>\n' +
'<body>\n' +
'    <div class="container">\n' +
'        <div class="header">\n' +
'            <div class="logo">⚽</div>\n' +
'            <h1>Planning Urban 7D</h1>\n' +
'            <p class="subtitle">Semaine ' + semaine + '</p>\n' +
'            <div class="dates">' + (date_debut || '') + ' → ' + (date_fin || '') + '</div>\n' +
'        </div>\n' +
'        <div class="week-selector">\n' +
weeksTabsHtml + '\n' +
'        </div>\n' +
'        <div class="employees">\n' +
employeesHtml + '\n' +
'        </div>\n' +
'        <div class="footer"><p>Cliquez sur votre nom pour ajouter le planning à votre calendrier</p></div>\n' +
'    </div>\n' +
'</body>\n' +
'</html>';
}

function generateICS(employeeName, creneaux, planningData) {
    const { semaine, annee, jours, mois_jours } = planningData;
    
    let ics = 'BEGIN:VCALENDAR\n' +
'VERSION:2.0\n' +
'PRODID:-//Planning Urban 7D//FR\n' +
'CALSCALE:GREGORIAN\n' +
'METHOD:PUBLISH\n' +
'X-WR-CALNAME:Planning ' + employeeName + '\n' +
'X-WR-TIMEZONE:Europe/Paris\n' +
'BEGIN:VTIMEZONE\n' +
'TZID:Europe/Paris\n' +
'BEGIN:STANDARD\n' +
'TZOFFSETFROM:+0200\n' +
'TZOFFSETTO:+0100\n' +
'TZNAME:CET\n' +
'DTSTART:19701025T030000\n' +
'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\n' +
'END:STANDARD\n' +
'BEGIN:DAYLIGHT\n' +
'TZOFFSETFROM:+0100\n' +
'TZOFFSETTO:+0200\n' +
'TZNAME:CEST\n' +
'DTSTART:19700329T020000\n' +
'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\n' +
'END:DAYLIGHT\n' +
'END:VTIMEZONE\n';

    let eventId = 1;
    
    for (const [jourStr, events] of Object.entries(creneaux)) {
        const jour = parseInt(jourStr);
        const jourIndex = jours.indexOf(jour);
        const moisJour = jourIndex >= 0 ? mois_jours[jourIndex] : mois_jours[0];
        
        for (const event of events) {
            const description = LEGENDE[event.code] || event.code;
            const [hDebut, mDebut] = event.debut.split(':').map(Number);
            
            let hFin, mFin;
            const finParts = event.fin.split(':');
            hFin = parseInt(finParts[0]);
            mFin = parseInt(finParts[1]) || 0;
            
            let jourFin = jour, moisFin = moisJour, hFinAdjusted = hFin;
            if (hFin >= 24) { 
                hFinAdjusted = hFin - 24; 
                jourFin = jour + 1;
                const maxJour = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][moisJour - 1];
                if (jourFin > maxJour) {
                    jourFin = 1;
                    moisFin = moisJour + 1;
                }
            }
            
            const pad = (n) => String(n).padStart(2, '0');
            const dateDebut = annee + pad(moisJour) + pad(jour) + 'T' + pad(hDebut) + pad(mDebut) + '00';
            const dateFin = annee + pad(moisFin) + pad(jourFin) + 'T' + pad(hFinAdjusted) + pad(mFin) + '00';
            const uid = employeeName.toLowerCase().replace(/\s+/g, '-').normalize('NFD').replace(/[\u0300-\u036f]/g, '') + '-s' + semaine + '-' + eventId + '@urban7d';
            
            ics += 'BEGIN:VEVENT\n' +
'UID:' + uid + '\n' +
'DTSTAMP:' + dateDebut + '\n' +
'DTSTART:' + dateDebut + '\n' +
'DTEND:' + dateFin + '\n' +
'SUMMARY:' + description + '\n' +
'DESCRIPTION:' + description + '\n' +
'END:VEVENT\n';
            eventId++;
        }
    }
    
    ics += 'END:VCALENDAR';
    return ics;
}

function generateAllICS(planningData, employesActifs) {
    const files = {};
    
    for (const employeeName of employesActifs) {
        const creneaux = planningData.employes[employeeName];
        if (!creneaux || Object.keys(creneaux).length === 0) continue;
        
        const fileName = employeeName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        files['ics/' + fileName + '.ics'] = generateICS(employeeName, creneaux, planningData);
    }
    
    return files;
}

async function uploadToGitHub(files, semaine) {
    const baseUrl = 'https://api.github.com/repos/' + GITHUB_REPO + '/contents';
    
    for (const [filePath, content] of Object.entries(files)) {
        const url = baseUrl + '/' + filePath;
        const contentBase64 = Buffer.from(content).toString('base64');
        
        try {
            let sha = null;
            try {
                const existingFile = await axios.get(url, {
                    headers: { 'Authorization': 'token ' + GITHUB_TOKEN, 'Accept': 'application/vnd.github.v3+json' }
                });
                sha = existingFile.data.sha;
            } catch (e) {}
            
            const data = { message: 'Mise à jour planning S' + semaine, content: contentBase64 };
            if (sha) data.sha = sha;
            
            await axios.put(url, data, {
                headers: { 'Authorization': 'token ' + GITHUB_TOKEN, 'Accept': 'application/vnd.github.v3+json' }
            });
            
            console.log('✅ Planning: Uploaded ' + filePath);
        } catch (error) {
            console.error('❌ Planning: Error uploading ' + filePath + ':', error.response?.data || error.message);
            throw error;
        }
    }
}

export default { startPlanningBot };
