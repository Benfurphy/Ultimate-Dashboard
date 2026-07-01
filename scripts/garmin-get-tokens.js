#!/usr/bin/env node
// One-time fallback for connecting Garmin when the in-app login (/api/garmin/login)
// gets blocked by Garmin's cloud-IP verification challenge. Run this from your own
// computer (a normal home/office network, not a server) — Garmin trusts that IP more
// than Vercel's, so the login is far less likely to get challenged:
//
//   node scripts/garmin-get-tokens.js
//
// It prints a JSON blob. Paste it into the dashboard's Today's vitals → Garmin →
// "paste tokens instead" box. See GARMIN_SETUP.md.
const readline = require('readline');
const { GarminConnect } = require('garmin-connect');

function ask(question, hide) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hide) {
      rl._writeToOutput = (s) => { if (s.trim() && s !== '\n') rl.output.write('*'); else rl.output.write(s); };
    }
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  const username = await ask('Garmin username/email: ', false);
  const password = await ask('Garmin password: ', true);
  const client = new GarminConnect({ username, password });
  try {
    await client.login();
  } catch (e) {
    console.error('\nLogin failed:', e.message);
    console.error('If this mentions "AccountLocked", open connect.garmin.com in a browser to clear it, then re-run this script.');
    process.exit(1);
  }
  console.log('\nConnected. Paste this whole line into the dashboard:\n');
  console.log(JSON.stringify(client.exportToken()));
})();
