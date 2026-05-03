/**
 * examples/sse-stream.ts
 * ------------------------------------------------------------
 * Subscribe to live attestation events. Press Ctrl-C to stop —
 * the example aborts the controller cleanly so the iterator
 * resolves.
 *
 * Run:
 *   npx tsx examples/sse-stream.ts
 *   npx tsx examples/sse-stream.ts --max 10
 */

import { createClient } from "../src/index.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const maxIdx = argv.indexOf("--max");
  const max =
    maxIdx >= 0 && argv[maxIdx + 1]
      ? Number.parseInt(argv[maxIdx + 1] as string, 10)
      : Infinity;

  const apiUrl =
    process.env.DEEPIDV_API_URL ?? "https://staging-api.deepidv.com";
  const client = createClient({ apiUrl });

  const ctrl = new AbortController();
  process.on("SIGINT", () => {
    console.log("\n# stopping (SIGINT)");
    ctrl.abort();
  });

  console.log(`# subscribing to ${apiUrl}/v1/stream`);
  let count = 0;
  for await (const ev of client.streamAttestations({ signal: ctrl.signal })) {
    count += 1;
    switch (ev.type) {
      case "attestation.minted":
        console.log(
          `[mint]   ${ev.payload.id}` +
            ` t=${ev.payload.recordType}` +
            ` seg=${ev.payload.segment}/${ev.payload.leafIndex}`,
        );
        break;
      case "sth.signed":
        console.log(
          `[sth]    seg=${ev.payload.segment}` +
            ` size=${ev.payload.treeSize}` +
            ` checkpoint=${ev.payload.checkpoint}`,
        );
        break;
      case "anchor.confirmed":
        console.log(
          `[anchor] seg=${ev.payload.segment}` +
            ` net=${ev.payload.network}` +
            ` tx=${ev.payload.txHash}`,
        );
        break;
      default: {
        // Unknown event types are ignored — the SDK's StreamEvent
        // union is intentionally open so future minor versions can
        // add types without breaking consumers.
        const unknown = ev as { type: string };
        console.log(`[?]      ${unknown.type}`);
      }
    }
    if (count >= max) {
      ctrl.abort();
      break;
    }
  }
  console.log(`# saw ${count} event${count === 1 ? "" : "s"}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
