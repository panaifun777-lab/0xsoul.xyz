const fs = require('fs');

const requiredFiles = [
  'docs/01_SYSTEM_ARCHITECTURE.md',
  'docs/02_SOLANA_ANCHOR_SPEC.md',
  'docs/03_SOUL_DID_INTEGRATION.md',
  'docs/04_AGENT_WALLET_AND_JITO.md',
  'docs/05_GATEWAY_AND_API_SPEC.md',
  'docs/06_X402_PAYMENT_AND_SIGNALS.md',
  'docs/07_SIX_AGENTS_CLUSTER_RBAC.md',
  'docs/08_CLI_AND_MCP_SPEC.md',
  'docs/09_ZERO_UI_AND_DEPLOYMENT.md',
  'docs/10_CORE_REFERENCE_IMPLEMENTATION.md',
  'docs/11_ROADMAP_AND_MILESTONES.md',
  'docs/12_MULTI_AGENT_WORK_BREAKDOWN.md',
  'docs/13_MULTI_AGENT_PARALLEL_DEV_PRINCIPLES.md',
  'docs/13_SYSTEM_USER_MANUAL.md',
  'docs/14_AFC_SOUL_DID_BRIDGE_AND_AGENT_IDENTITY.md',
  'README.md'
];

let allValid = true;
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    console.error(`Missing required document: ${file}`);
    allValid = false;
  }
}

if (!allValid) {
  process.exit(1);
}

console.log(`All ${requiredFiles.length} technical documents and standards are verified successfully.`);
process.exit(0);
