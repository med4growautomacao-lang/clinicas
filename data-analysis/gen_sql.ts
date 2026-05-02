import fs from 'fs';
import { randomUUID } from 'crypto';

function parseCSVBetter(content: string) {
  const lines: string[][] = [];
  let currentLine: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentLine.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (currentField || currentLine.length > 0) {
        currentLine.push(currentField);
        lines.push(currentLine);
        currentLine = [];
        currentField = '';
      }
      if (char === '\r' && nextChar === '\n') i++;
    } else {
      currentField += char;
    }
  }
  if (currentField || currentLine.length > 0) {
    currentLine.push(currentField);
    lines.push(currentLine);
  }

  if (lines.length === 0) return [];
  const headers = lines[0].map(h => h.trim());
  return lines.slice(1).map(row => {
    const obj: any = {};
    headers.forEach((h, i) => {
      obj[h] = row[i]?.trim();
    });
    return obj;
  });
}

const METALTRES_CLINIC_ID = '43575057-f20a-40a3-8805-200384d0b867';
const WHATSAPP_STAGE_ID = 'c625557d-f0ac-4b23-91e4-95d03fe0a525';

function escape(str) {
  if (!str) return 'NULL';
  return "'" + String(str).replace(/'/g, "''") + "'";
}

function isValidUUID(uuid: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
}

const idMapping = new Map<string, string>();

function getValidId(originalId: string) {
  if (!originalId) return randomUUID();
  if (isValidUUID(originalId)) return originalId;
  
  if (idMapping.has(originalId)) return idMapping.get(originalId);
  
  const newId = randomUUID();
  idMapping.set(originalId, newId);
  return newId;
}

function writeBatch(name, i, batchSql) {
  fs.writeFileSync(`data-analysis/batch_${name}_${i}.sql`, batchSql, 'utf8');
}

// 1. Process Leads
const leadsRaw = fs.readFileSync('data-analysis/leads_rows metaltres.csv', 'utf8');
const leads = parseCSVBetter(leadsRaw);

console.log(`Processing ${leads.length} leads...`);
for (let i = 0; i < leads.length; i += 200) {
  const batch = leads.slice(i, i + 200);
  const values = batch.map(l => {
    const validId = getValidId(l.id);
    const name = l.name || `Lead ${l.phone || 'Sem Nome'}`;
    return `(${escape(validId)}, '${METALTRES_CLINIC_ID}', ${escape(name)}, ${escape(l.email)}, ${escape(l.phone)}, 'Importação', '${WHATSAPP_STAGE_ID}', ${parseFloat(l.estimated_value) || 0}, ${escape(l.created_at)})`;
  }).join(',\n');
  
  const sql = `INSERT INTO public.leads (id, clinic_id, name, email, phone, source, stage_id, estimated_value, created_at) VALUES\n${values}\nON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;`;
  writeBatch('leads', Math.floor(i/200), sql);
}

// 2. Process Messages
const msgsRaw = fs.readFileSync('data-analysis/chat_messages_rows metaltres.csv', 'utf8');
const msgs = parseCSVBetter(msgsRaw);

console.log(`Processing ${msgs.length} messages...`);
for (let i = 0; i < msgs.length; i += 1000) {
  const batch = msgs.slice(i, i + 1000);
  const values = batch.map(m => {
    const validMsgId = getValidId(m.id);
    const validLeadId = getValidId(m.lead_id);
    
    let msgContent = m.message;
    if (msgContent && msgContent.startsWith('{')) {
    } else {
        msgContent = JSON.stringify({ type: 'human', content: msgContent });
    }
    return `(${escape(validMsgId)}, '${METALTRES_CLINIC_ID}', ${escape(validLeadId)}, ${escape(m.direction)}, ${escape(m.sender)}, ${escape(m.phone)}, ${escape(msgContent)}, ${escape(m.metadata || '{}')}, ${escape(m.created_at)}, ${escape(m.session_id)})`;
  }).join(',\n');
  
  const sql = `INSERT INTO public.chat_messages (id, clinic_id, lead_id, direction, sender, phone, message, metadata, created_at, session_id) VALUES\n${values}\nON CONFLICT (id) DO NOTHING;`;
  writeBatch('msgs', Math.floor(i/1000), sql);
}

console.log('Done generating batches.');
