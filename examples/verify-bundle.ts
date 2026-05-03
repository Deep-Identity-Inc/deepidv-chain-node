/**
 * examples/verify-bundle.ts
 * ------------------------------------------------------------
 * Download a `.dpiv-bundle` for a given attestation id and verify
 * it offline (5 of 6 checks; TSA is deliberately skipped — see the
 * README "Verification scope" section).
 *
 * Run:
 *   npx tsx examples/verify-bundle.ts <attestation_id>
 *
 * Optional env:
 *   DEEPIDV_API_URL   override the default staging API URL.
 */

import { createClient, verifyBundle } from "../src/index.js";

async function main(): Promise<void> {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: tsx examples/verify-bundle.ts <attestation_id>");
    process.exit(2);
  }
  const apiUrl =
    process.env.DEEPIDV_API_URL ?? "https://staging-api.deepidv.com";

  const client = createClient({ apiUrl });
  console.log(`fetching ${id} from ${apiUrl} ...`);

  const attestation = await client.getAttestation(id);
  console.log(
    `  recordType=${attestation.recordType}` +
      ` issuerId=${attestation.issuerId}` +
      ` segment=${attestation.segment}` +
      ` leafIndex=${attestation.leafIndex}`,
  );

  const zipBytes = await client.downloadBundle(id);
  console.log(`  bundle size: ${zipBytes.byteLength} bytes`);

  const result = await verifyBundle(zipBytes);

  console.log("");
  console.log(`  ok: ${result.ok}`);
  console.log(`  envelope_hash:        ${result.checks.envelope_hash}`);
  console.log(`  issuer_signature:     ${result.checks.issuer_signature}`);
  console.log(
    `  tsa_tokens:           ${result.checks.tsa_tokens}` +
      ` (run verify.sh from the bundle for the canonical TSA check)`,
  );
  console.log(`  merkle_inclusion:     ${result.checks.merkle_inclusion}`);
  console.log(`  master_sth_signature: ${result.checks.master_sth_signature}`);
  console.log(`  onchain_anchor:       ${result.checks.onchain_anchor}`);
  if (result.onchainReference) {
    console.log("");
    console.log(`  on-chain reference (informational, not RPC-verified):`);
    console.log(`    network:   ${result.onchainReference.chain}`);
    console.log(`    contract:  ${result.onchainReference.contract}`);
    console.log(`    tx:        ${result.onchainReference.tx}`);
    console.log(`    block:     ${result.onchainReference.block}`);
    console.log(`    treeSize:  ${result.onchainReference.treeSize}`);
  }
  if (!result.ok) {
    console.error(`  reason: ${result.reason}`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
