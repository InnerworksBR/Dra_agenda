// Script de diagnóstico: chama freebusy.query do Google direto
// para os dias 18..24/set/2026 e imprime o JSON bruto + uma versão
// resumida em horário local America/Sao_Paulo.
//
// Rodar com:  NODE_ENV=production npx tsx scripts/diagnose-freebusy.ts

import { google } from 'googleapis';
import * as fs from 'node:fs';

function readEnv(name: string): string {
  // Carrega .env manualmente. O JSON de credenciais fica numa única linha
  // com `\n` literais (escapados) dentro da string — não devemos juntar
  // linhas com newline real, isso quebraria o JSON.
  const txt = fs.readFileSync('.env', 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || m[1] !== name) continue;
    let value = m[2] ?? '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    return value;
  }
  throw new Error(`env var ${name} not found`);
}

async function main() {
  const credsRaw = readEnv('GOOGLE_CALENDAR_CREDENTIALS');
  const calendarId = readEnv('GOOGLE_CALENDAR_ID');
  const tz = readEnv('GOOGLE_CALENDAR_TIMEZONE');

  const creds = JSON.parse(credsRaw);
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: (creds.private_key as string).replace(/\\n/g, '\n'),
    scopes: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
  });
  const calendar = google.calendar({ version: 'v3', auth });

  // Janela: 2026-09-17 00:00 → 2026-09-25 00:00 em America/Sao_Paulo.
  const timeMin = new Date('2026-09-17T03:00:00.000Z'); // 00:00 SP
  const timeMax = new Date('2026-09-25T03:00:00.000Z'); // 00:00 SP do dia 25

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: calendarId }],
      timeZone: tz,
    },
  });

  console.log('=== RAW RESPONSE ===');
  console.log(JSON.stringify(res.data, null, 2));

  const item = res.data.calendars?.[calendarId];
  const busy = (item?.busy ?? []) as Array<{ start?: string; end?: string }>;

  console.log(`\n=== SUMMARY (${busy.length} busy intervals) ===`);
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  for (const b of busy) {
    if (!b.start || !b.end) continue;
    const s = fmt.format(new Date(b.start));
    const e = fmt.format(new Date(b.end));
    console.log(`  ${s} → ${e}`);
  }
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
