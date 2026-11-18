// Generates samples/meetuniversity-sales-SYNTHETIC.csv: a made-up sales funnel for
// the "Business Analysis" demo. It is SYNTHETIC: no real MeetUniversity data.
// A fixed random seed makes the output identical on every run, so anyone can
// regenerate it and check it hasn't been edited:  node samples/generate-sales-sample.mjs
//
// Deliberate patterns, so an analysis has something real to find:
// - Instagram brings many leads but converts poorly to counselling sessions.
// - School events convert best at every stage.
// - The East region loses most students between application and enrolment.
// - Study Abroad has the highest revenue per enrolment; Aspirations the most volume.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Small seeded random number generator (mulberry32): same seed, same numbers. */
function seededRandom(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = seededRandom(20261118);
const between = (low, high) => low + (high - low) * random();

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
const REGIONS = { North: 1.0, South: 1.1, East: 0.9, West: 1.05 };
const CHANNELS = {
  // leads per month (base), lead→session rate, session→application rate
  Instagram: { leads: 420, toSession: 0.07, toApplication: 0.35 },
  "Google Ads": { leads: 260, toSession: 0.16, toApplication: 0.4 },
  "School events": { leads: 140, toSession: 0.42, toApplication: 0.55 },
  Referrals: { leads: 80, toSession: 0.38, toApplication: 0.5 },
  Webinars: { leads: 180, toSession: 0.22, toApplication: 0.42 },
};
const PRODUCTS = {
  // share of leads, application→enrolment rate, revenue per enrolment (INR)
  Aspirations: { share: 0.5, toEnrolment: 0.6, revenue: 4999 },
  "Study Abroad": { share: 0.3, toEnrolment: 0.35, revenue: 85000 },
  "School Partnerships": { share: 0.2, toEnrolment: 0.5, revenue: 25000 },
};

const rows = [["month", "region", "channel", "product_line", "leads", "counselling_sessions", "applications", "enrolments", "revenue_inr"]];
for (const month of MONTHS) {
  for (const [region, regionFactor] of Object.entries(REGIONS)) {
    for (const [channel, c] of Object.entries(CHANNELS)) {
      for (const [product, p] of Object.entries(PRODUCTS)) {
        const leads = Math.round(c.leads * p.share * regionFactor * between(0.8, 1.2));
        const sessions = Math.round(leads * c.toSession * between(0.85, 1.15));
        const applications = Math.round(sessions * c.toApplication * between(0.85, 1.15));
        const eastPenalty = region === "East" ? 0.55 : 1; // the East enrolment bottleneck
        const enrolments = Math.round(applications * p.toEnrolment * eastPenalty * between(0.85, 1.15));
        rows.push([month, region, channel, product, leads, sessions, applications, enrolments, enrolments * p.revenue]);
      }
    }
  }
}

const csv = rows.map((r) => r.map((v) => (String(v).includes(",") ? `"${v}"` : v)).join(",")).join("\n") + "\n";
const out = fileURLToPath(new URL("./meetuniversity-sales-SYNTHETIC.csv", import.meta.url));
writeFileSync(out, csv);
console.log(`Wrote ${rows.length - 1} rows to ${out}`);
