/**
 * examples/registry-search.ts
 * ------------------------------------------------------------
 * Paginate the public registry, optionally filtering by record
 * type and issuer. Demonstrates cursor-style pagination and the
 * RegistryRow shape.
 *
 * Run:
 *   npx tsx examples/registry-search.ts
 *   npx tsx examples/registry-search.ts --type IDV --issuer iss_acme_prod
 *   npx tsx examples/registry-search.ts --pages 3
 */

import { createClient } from "../src/index.js";
import type { RecordType, RegistryRow } from "../src/types/index.js";

interface Args {
  type?: RecordType;
  issuer?: string;
  q?: string;
  pages: number;
}

function parseArgs(): Args {
  const args: Args = { pages: 1 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--type" && value) {
      args.type = value as RecordType;
      i += 1;
    } else if (flag === "--issuer" && value) {
      args.issuer = value;
      i += 1;
    } else if (flag === "--q" && value) {
      args.q = value;
      i += 1;
    } else if (flag === "--pages" && value) {
      args.pages = Number.parseInt(value, 10);
      i += 1;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const apiUrl =
    process.env.DEEPIDV_API_URL ?? "https://staging-api.proof.deepidv.com";
  const client = createClient({ apiUrl });

  let cursor: string | undefined;
  let pageNum = 0;
  let total = 0;

  while (pageNum < args.pages) {
    const filters: Parameters<typeof client.listRegistry>[0] = {};
    if (args.type) filters.type = args.type;
    if (args.issuer) filters.issuer = args.issuer;
    if (args.q) filters.q = args.q;
    if (cursor) filters.cursor = cursor;

    const page = await client.listRegistry(filters);
    pageNum += 1;
    total += page.items.length;

    console.log(`# page ${pageNum} — ${page.items.length} rows`);
    for (const row of page.items) {
      console.log(formatRow(row));
    }

    if (!page.nextCursor) {
      console.log(`# end of registry (no next cursor)`);
      break;
    }
    cursor = page.nextCursor;
  }

  console.log(`# total rows scanned: ${total}`);
}

function formatRow(r: RegistryRow): string {
  const labels = r.labels
    .map((l) => (l.revealed && l.value ? `${l.name}=${l.value}` : l.name))
    .join(", ");
  return (
    `${r.id}` +
    `  ${r.recordType}` +
    `  seg=${r.segment}/${r.leafIndex}` +
    `  issuer=${r.issuerId}` +
    `  anchored=${r.anchored}` +
    (labels ? `  labels=[${labels}]` : "")
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
