const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

/**
 * @typedef {Object} ZapAlert
 * @property {string=} riskcode
 * @property {string=} riskdesc
 */

/**
 * @typedef {Object} ZapSite
 * @property {ZapAlert[]=} alerts
 */

/**
 * @typedef {Object} ZapReport
 * @property {ZapSite|ZapSite[]=} site
 */

const args = process.argv.slice(2);
const failOnHigh = args.includes('--fail-on-high');
const targetArg = args.find(arg => !arg.startsWith('-') && arg !== '--fail-on-high');
const reportPath = path.resolve(process.cwd(), targetArg || 'zap-report.json');

if (!existsSync(reportPath)) {
  console.error(`ZAP report not found at ${reportPath}`);
  process.exit(failOnHigh ? 1 : 0);
}

const raw = readFileSync(reportPath, 'utf8');
let json;
try {
  json = JSON.parse(raw);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Failed to parse zap-report.json:', message);
  process.exit(failOnHigh ? 1 : 1);
}

const counts = {
  High: 0,
  Medium: 0,
  Low: 0,
  Informational: 0
};

/** @type {Record<string, keyof typeof counts>} */
const severityLabels = {
  '0': 'Informational',
  '1': 'Low',
  '2': 'Medium',
  '3': 'High'
};

/**
 * @param {ZapAlert} alert
 */
function registerAlert(alert) {
  if (!alert) return;
  const riskKey = (alert.riskcode ?? '').toString();
  const labelFromCode = severityLabels[riskKey];
  const desc = typeof alert.riskdesc === 'string' ? alert.riskdesc.trim() : '';
  const labelFromDesc = desc && counts[desc] !== undefined ? desc : undefined;
  const normalizedLabel = labelFromCode || labelFromDesc || 'Informational';
  if (counts[normalizedLabel] !== undefined) {
    counts[normalizedLabel] += 1;
  } else {
    counts.Informational += 1;
  }
}

const sites = Array.isArray(json.site) ? json.site : json.site ? [json.site] : [];
for (const site of sites) {
  const alerts = Array.isArray(site?.alerts) ? site.alerts : [];
  for (const alert of alerts) {
    registerAlert(alert);
  }
}

const total = counts.High + counts.Medium + counts.Low + counts.Informational;

let output = '# OWASP ZAP Baseline Summary\n\n';
output += '| Severity | Count |\n';
output += '| --- | ---: |\n';
output += `| High | ${counts.High} |\n`;
output += `| Medium | ${counts.Medium} |\n`;
output += `| Low | ${counts.Low} |\n`;
output += `| Informational | ${counts.Informational} |\n`;
output += `\nTotal alerts: **${total}**\n`;

console.log(output.trim());

if (failOnHigh && counts.High > 0) {
  process.exit(1);
}
