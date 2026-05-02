import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { randomUUID } from 'crypto';

const supabaseUrl = 'https://yzpclhuifquhfqpiwysh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6cGNsaHVpZnF1aGZxcGl3eXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTUxNDcsImV4cCI6MjA4ODgzMTE0N30.DXuX6KDpEPMoCAVpH2gs6reGTC97RZiNA_IUPT0Inos';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const METALTRES_CLINIC_ID = '43575057-f20a-40a3-8805-200384d0b867';
const WHATSAPP_STAGE_ID = 'c625557d-f0ac-4b23-91e4-95d03fe0a525';

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

async function run() {
  console.log('--- STARTING IMPORT ---');

  // 1. LEADS
  try {
    console.log('Reading leads...');
    const leadsRaw = fs.readFileSync('data-analysis/leads_rows metaltres.csv', 'utf8');
    const leadsData = parseCSVBetter(leadsRaw);
    console.log(`Found ${leadsData.length} leads.`);

    const mappedLeads = leadsData.map(l => ({
      id: getValidId(l.id),
      clinic_id: METALTRES_CLINIC_ID,
      name: l.name || `Lead ${l.phone || 'Sem Nome'}`,
      email: l.email || null,
      phone: l.phone,
      source: l.source || 'Importação',
      stage_id: WHATSAPP_STAGE_ID,
      estimated_value: parseFloat(l.estimated_value) || 0,
      created_at: l.created_at || new Date().toISOString(),
    }));

    for (let i = 0; i < mappedLeads.length; i += 100) {
      const batch = mappedLeads.slice(i, i + 100);
      const { error } = await supabase.from('leads').upsert(batch);
      if (error) console.error(`Error inserting leads batch ${i}:`, error);
      else console.log(`Inserted leads ${i} to ${Math.min(i + 100, mappedLeads.length)}`);
    }
  } catch (e) {
    console.error('Failed to process leads:', e);
  }

  // 2. MESSAGES
  try {
    console.log('Reading messages...');
    // For large files, we'll read it in chunks if possible, but 93k lines is ~30MB, Node can handle it.
    const msgsRaw = fs.readFileSync('data-analysis/chat_messages_rows metaltres.csv', 'utf8');
    const msgsData = parseCSVBetter(msgsRaw);
    console.log(`Found ${msgsData.length} messages.`);

    const mappedMsgs = msgsData.map(m => {
      let msgContent = m.message;
      if (msgContent && msgContent.startsWith('{')) {
          try {
              msgContent = JSON.parse(msgContent);
          } catch (e) {
              msgContent = { type: 'human', content: String(m.message) };
          }
      } else {
          msgContent = { type: 'human', content: String(m.message || '') };
      }

      let metadata = {};
      try {
          metadata = m.metadata ? JSON.parse(m.metadata) : {};
      } catch (e) {}

      return {
        id: getValidId(m.id),
        clinic_id: METALTRES_CLINIC_ID,
        lead_id: getValidId(m.lead_id),
        direction: m.direction || 'outbound',
        sender: m.sender || 'system',
        phone: m.phone,
        message: msgContent,
        metadata: metadata,
        created_at: m.created_at || new Date().toISOString(),
        session_id: m.session_id || null
      };
    });

    console.log('Inserting messages in batches...');
    const BATCH_SIZE = 200;
    for (let i = 0; i < mappedMsgs.length; i += BATCH_SIZE) {
      const batch = mappedMsgs.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from('chat_messages').upsert(batch);
      if (error) {
          console.error(`Error inserting messages batch ${i}:`, error);
          // If a batch fails, we could try smaller batches or log individual errors
      } else {
          if (i % 2000 === 0) console.log(`Processed ${i} / ${mappedMsgs.length} messages...`);
      }
    }
  } catch (e) {
    console.error('Failed to process messages:', e);
  }

  console.log('--- IMPORT COMPLETED ---');
}

run();
