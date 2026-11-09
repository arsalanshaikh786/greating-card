// Sends greetings saved in Firestore collection "greet_schedule" when their time arrives.
// Setup (once):  firebase init functions  ->  put this file in functions/index.js
//   firebase functions:secrets:set ULTRA_TOKEN      (paste your Ultramsg token)
//   firebase deploy --only functions
// Needs the Firebase Blaze plan. Node 18+ (global fetch).
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();
const ULTRA_TOKEN = defineSecret("ULTRA_TOKEN");
const BASE = "https://api.ultramsg.com/instance192669";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ultra(endpoint, params) {
  const r = await fetch(`${BASE}/messages/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: ULTRA_TOKEN.value(), ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(JSON.stringify(j.error || r.status));
}

exports.sendScheduledGreetings = onSchedule(
  { schedule: "every 1 minutes", secrets: [ULTRA_TOKEN], timeoutSeconds: 300 },
  async () => {
    const db = getFirestore();
    const snap = await db.collection("greet_schedule").where("sendAt", "<=", Date.now()).limit(25).get();
    for (const d of snap.docs) {
      const j = d.data();
      let status = "sent", error = null;
      try {
        if (j.cardUrl) { await ultra("image", { to: j.to, image: j.cardUrl, caption: j.caption }); await sleep(600); }
        await ultra("chat", { to: j.to, body: j.body });
        for (const a of j.atts || []) {
          await sleep(600);
          if (a.img) await ultra("image", { to: j.to, image: a.url, caption: `🖼️ ${j.emoji || ""}` });
          else await ultra("document", { to: j.to, document: a.url, filename: a.name, caption: "📎 File" });
        }
      } catch (e) { status = "failed"; error = String(e.message || e); }
      await db.collection("greet_shares").add({ receiverName: j.name, receiverNumber: "+" + j.to, message: j.body, mode: "scheduled-" + status, error, sentAt: Date.now() });
      await d.ref.delete();
      await sleep(1500);
    }
  }
);

/* Firestore rules to add (clients may only CREATE schedule entries, never read them):
   match /greet_schedule/{id} { allow create: if true; allow read, update, delete: if false; }
*/
