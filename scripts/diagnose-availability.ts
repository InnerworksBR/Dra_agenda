// Smoke test: roda computeAvailability com eventos REAIS do Google
// e imprime a contagem por dia. Útil pra conferir visualmente que
// a nova lógica bate com o esperado antes de subir pra produção.
//
// Rodar com: NODE_ENV=production npx tsx scripts/diagnose-availability.ts

import { google } from 'googleapis';
import * as fs from 'node:fs';
import { computeAvailability, type EventInterval } from '../lib/scheduler/availability';

function readEnv(name: string): string {
  const txt = fs.readFileSync('.env', 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || m[1] !== name) continue;
    let v = m[2] ?? '';
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    return v;
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

  const now = new Date();
  const timeMin = now;
  const timeMax = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);

  const res = await calendar.events.list({
    calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    showDeleted: false,
  });

  type Ev = { startsAt: Date; endsAt: Date; transparent: boolean };
  const events: Ev[] = [];
  for (const item of res.data.items ?? []) {
    if (!item.start?.dateTime || !item.end?.dateTime) continue; // ignora dia inteiro
    const status = item.status ?? 'confirmed';
    if (status === 'cancelled') continue;
    events.push({
      startsAt: new Date(item.start.dateTime),
      endsAt: new Date(item.end.dateTime),
      transparent: item.transparency === 'transparent',
    });
  }

  console.log(`Eventos confirmados coletados: ${events.length}`);

  const intervals: EventInterval[] = events.map((e) => ({
    start: e.startsAt,
    end: e.endsAt,
    transparent: e.transparent,
  }));

  const r = await computeAvailability({ now, events: intervals });
  console.log(`\nDias com slots: ${r.windowDays.length}`);
  for (const d of r.windowDays) {
    console.log(`  ${d.date}: ${d.slots.length} slots -> [${d.slots.slice(0, 5).join(', ')}${d.slots.length > 5 ? ', ...' : ''}]`);
  }
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
