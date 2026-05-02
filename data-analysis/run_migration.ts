import fs from 'fs';
import { execSync } from 'child_process';

const project_id = 'yzpclhuifquhfqpiwysh';

async function run() {
  const files = fs.readdirSync('data-analysis').filter(f => f.startsWith('batch_') && f.endsWith('.sql')).sort();
  
  // Sort leads first, then messages
  const leadFiles = files.filter(f => f.includes('leads'));
  const msgFiles = files.filter(f => f.includes('msgs'));
  
  const allFiles = [...leadFiles, ...msgFiles];
  
  for (const f of allFiles) {
    console.log(`Executing ${f}...`);
    const sql = fs.readFileSync(`data-analysis/${f}`, 'utf8');
    
    // We can't easily call MCP from here, but we can use supabase CLI query
    // But since CLI was failing with quoting, I'll try to use a temp file and supabase db query --file
    // Wait, the help said "unknown flag: --file". Let's check "supabase db query --help"
    
    fs.writeFileSync('temp.sql', sql, 'utf8');
    try {
      // Try to use supabase db query < temp.sql or similar
      // The CLI usually supports pipe
      execSync(`npx supabase db query < temp.sql`, { stdio: 'inherit', shell: true });
      console.log(`Successfully executed ${f}`);
    } catch (e) {
      console.error(`Error executing ${f}:`, e.message);
    }
  }
  if (fs.existsSync('temp.sql')) fs.unlinkSync('temp.sql');
}

run();
