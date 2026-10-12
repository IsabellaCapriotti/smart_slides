// Generates a deterministic sample CSV of anonymized social posts with
// sentiment labels, containing a few planted trends worth discovering:
//  - Brazil's "angry" share spikes from 2023 to 2024
//  - Users who post less often are more positive
//  - Germany's volume grows steadily while Japan's is flat
// Run: npm run sample
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (weights) => {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of weights) {
    r -= w;
    if (r <= 0) return v;
  }
  return weights[weights.length - 1][0];
};

const countries = ['United States', 'Brazil', 'Germany', 'Japan', 'India', 'United Kingdom'];
const sentiments = ['positive', 'neutral', 'angry', 'paranoid', 'sad'];
const rows = [['post_id', 'user_id', 'timestamp', 'country', 'posts_per_day', 'sentiment']];

const users = Array.from({ length: 600 }, (_, i) => ({
  id: `u${String(i + 1).padStart(4, '0')}`,
  country: pick([
    ['United States', 30],
    ['Brazil', 18],
    ['Germany', 14],
    ['Japan', 12],
    ['India', 16],
    ['United Kingdom', 10],
  ]),
  freq: Math.max(1, Math.round(-Math.log(1 - rand()) * 4)),
}));

let id = 1;
for (let n = 0; n < 6000; n++) {
  const u = users[Math.floor(rand() * users.length)];
  const year = pick([
    [2022, 18],
    [2023, 28],
    [2024, 54],
  ]);
  // Germany grows year over year; Japan stays flat.
  if (u.country === 'Germany' && year === 2022 && rand() < 0.6) continue;
  if (u.country === 'Japan' && year === 2024 && rand() < 0.5) continue;
  const month = 1 + Math.floor(rand() * 12);
  const day = 1 + Math.floor(rand() * 28);
  const hh = Math.floor(rand() * 24);
  const mm = Math.floor(rand() * 60);

  const w = { positive: 30, neutral: 35, angry: 12, paranoid: 8, sad: 15 };
  if (u.freq <= 2) {
    w.positive += 25;
    w.angry -= 6;
    w.paranoid -= 4;
  } else if (u.freq >= 8) {
    w.positive -= 14;
    w.angry += 10;
    w.paranoid += 8;
  }
  if (u.country === 'Brazil') {
    if (year === 2024) {
      w.angry += 34;
      w.paranoid += 10;
      w.positive -= 20;
    } else if (year === 2023) {
      w.angry += 4;
    }
  }
  const sentiment = pick(sentiments.map((s) => [s, Math.max(1, w[s])]));
  const ts = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
  rows.push([`p${String(id++).padStart(5, '0')}`, u.id, ts, u.country, u.freq, sentiment]);
}

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../web/public/sample');
mkdirSync(dir, { recursive: true });
const writeCsv = (name, data) => {
  writeFileSync(resolve(dir, name), data.map((r) => r.join(',')).join('\n') + '\n');
  console.log(`Wrote ${data.length - 1} rows to ${name}`);
};
writeCsv('social_posts.csv', rows);

// ---- Multi-table sample: customers + products + orders -------------------------------------
// Planted cross-table trends:
//  - Enterprise customers buy far more Hardware than other segments (orders x customers x products)
//  - Discounts >= 20% sharply lift quantity, but only for the Accessories category
//  - The West region's order volume grows strongly from 2023 to 2024
seed = 7;
const customers = Array.from({ length: 400 }, (_, i) => ({
  customer_id: 1000 + i,
  region: pick([['West', 30], ['East', 28], ['South', 22], ['North', 20]]),
  segment: pick([['Enterprise', 15], ['SMB', 35], ['Consumer', 50]]),
  signup_date: `${2019 + Math.floor(rand() * 5)}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`,
}));
const categories = { Hardware: 900, Software: 300, Accessories: 40, Services: 600 };
const products = [];
let pid = 1;
for (const [category, base] of Object.entries(categories)) {
  for (let k = 0; k < 6; k++) {
    products.push({ product_id: `P${String(pid++).padStart(3, '0')}`, category, unit_price: Math.round(base * (0.6 + rand() * 0.9)) });
  }
}
const orders = [];
for (let n = 1; n <= 5000; n++) {
  const c = customers[Math.floor(rand() * customers.length)];
  const year = pick([[2022, 25], [2023, 33], [2024, c.region === 'West' ? 70 : 42]]);
  const weights = products.map((p) => {
    let weight = 10;
    if (p.category === 'Hardware') weight = c.segment === 'Enterprise' ? 40 : 6;
    if (p.category === 'Services' && c.segment === 'Consumer') weight = 2;
    return [p, weight];
  });
  const p = pick(weights);
  const discount = pick([[0, 50], [10, 25], [20, 15], [30, 10]]);
  let qty = 1 + Math.floor(rand() * 3);
  if (p.category === 'Accessories' && discount >= 20) qty += 3 + Math.floor(rand() * 4);
  const month = String(1 + Math.floor(rand() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(rand() * 28)).padStart(2, '0');
  orders.push({
    order_id: `O${String(n).padStart(5, '0')}`,
    customer_id: c.customer_id,
    product_id: p.product_id,
    order_date: `${year}-${month}-${day}`,
    quantity: qty,
    discount_pct: discount,
  });
}
const table = (items) => [Object.keys(items[0]), ...items.map((o) => Object.values(o))];
writeCsv('customers.csv', table(customers));
writeCsv('products.csv', table(products));
writeCsv('orders.csv', table(orders));
