const API_BASE = "https://data-api.polymarket.com/trades";
const PAGE_SIZE = 1000;
const MAX_OFFSET = 3000;
const REQUEST_DELAY_MS = 55;
const MAX_RETRIES = 3;

interface Trade {
  transactionHash: string;
  side: string;
  price: string;
  size: string;
  timestamp: string;
  market: string;
  asset: string;
  [key: string]: unknown;
}

interface CLIOptions {
  wallet: string;
  market?: string;
  event?: string;
  side?: string;
  format: "jsonl" | "json";
  output?: string;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`Usage: npx tsx src/index.ts <wallet-address> [options]

Options:
  --market <id>         Filter by market condition ID
  --event <id>          Filter by event ID
  --side <BUY|SELL>     Filter by trade side
  --format <jsonl|json> Output format (default: jsonl)
  --output <filename>   Custom output filename
  -h, --help            Show this help message`);
    process.exit(0);
  }

  const wallet = args[0];
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    console.error(`Error: Invalid wallet address "${wallet}"`);
    process.exit(1);
  }

  const opts: CLIOptions = { wallet, format: "jsonl" };

  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    switch (flag) {
      case "--market":
        opts.market = value;
        i++;
        break;
      case "--event":
        opts.event = value;
        i++;
        break;
      case "--side":
        if (value !== "BUY" && value !== "SELL") {
          console.error(`Error: --side must be BUY or SELL, got "${value}"`);
          process.exit(1);
        }
        opts.side = value;
        i++;
        break;
      case "--format":
        if (value !== "jsonl" && value !== "json") {
          console.error(`Error: --format must be jsonl or json, got "${value}"`);
          process.exit(1);
        }
        opts.format = value;
        i++;
        break;
      case "--output":
        opts.output = value;
        i++;
        break;
      default:
        console.error(`Error: Unknown option "${flag}"`);
        process.exit(1);
    }
  }

  return opts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(
  wallet: string,
  offset: number,
  opts: CLIOptions
): Promise<Trade[]> {
  const params = new URLSearchParams({
    user: wallet,
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });

  if (opts.market) params.set("market", opts.market);
  if (opts.event) params.set("event", opts.event);
  if (opts.side) params.set("side", opts.side);

  const url = `${API_BASE}?${params}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url);

    if (res.ok) {
      return (await res.json()) as Trade[];
    }

    if (res.status === 429 || res.status >= 500) {
      const delay = REQUEST_DELAY_MS * Math.pow(2, attempt);
      console.error(
        `  Retry ${attempt}/${MAX_RETRIES} (HTTP ${res.status}), waiting ${delay}ms...`
      );
      await sleep(delay);
      continue;
    }

    throw new Error(`API error: HTTP ${res.status} ${res.statusText}`);
  }

  throw new Error(`Failed after ${MAX_RETRIES} retries`);
}

function printSummary(trades: Trade[]): void {
  if (trades.length === 0) {
    console.log("\nNo trades found.");
    return;
  }

  const buys = trades.filter((t) => t.side === "BUY").length;
  const sells = trades.length - buys;
  const markets = new Set(trades.map((t) => t.conditionId || t.market)).size;
  const volume = trades.reduce((sum, t) => {
    const size = parseFloat(t.size) || 0;
    const price = parseFloat(t.price) || 0;
    return sum + size * price;
  }, 0);

  const timestamps = trades
    .map((t) => {
      const raw = Number(t.timestamp);
      // API returns Unix seconds; convert to ms
      return isNaN(raw) ? NaN : raw < 1e12 ? raw * 1000 : raw;
    })
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b);

  console.log("\n--- Summary ---");
  console.log(`Trades:    ${trades.length}`);
  console.log(`Buys:      ${buys}`);
  console.log(`Sells:     ${sells}`);
  console.log(`Markets:   ${markets}`);
  console.log(`Volume:    $${volume.toFixed(2)}`);
  if (timestamps.length > 0) {
    console.log(`Earliest:  ${new Date(timestamps[0]).toISOString()}`);
    console.log(`Latest:    ${new Date(timestamps[timestamps.length - 1]).toISOString()}`);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log(`Fetching trades for ${opts.wallet}...`);
  if (opts.market) console.log(`  Market filter: ${opts.market}`);
  if (opts.event) console.log(`  Event filter: ${opts.event}`);
  if (opts.side) console.log(`  Side filter: ${opts.side}`);

  const seen = new Set<string>();
  const allTrades: Trade[] = [];
  let hitCeiling = false;

  for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
    process.stdout.write(`  Fetching offset ${offset}...`);

    const page = await fetchPage(opts.wallet, offset, opts);

    let newCount = 0;
    for (const trade of page) {
      if (!seen.has(trade.transactionHash)) {
        seen.add(trade.transactionHash);
        allTrades.push(trade);
        newCount++;
      }
    }

    console.log(` ${page.length} returned, ${newCount} new`);

    if (page.length < PAGE_SIZE) break;

    if (offset === MAX_OFFSET) {
      hitCeiling = true;
      break;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  if (hitCeiling) {
    console.warn(
      "\nWarning: Hit the API offset ceiling (3000). There may be more trades " +
        "that cannot be retrieved. Consider filtering by --market to get " +
        "additional data per market."
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const walletPrefix = opts.wallet.slice(0, 8);
  const ext = opts.format === "json" ? "json" : "jsonl";
  const filename = opts.output || `trades_${walletPrefix}_${timestamp}.${ext}`;

  const { writeFileSync } = await import("node:fs");

  if (opts.format === "json") {
    writeFileSync(filename, JSON.stringify(allTrades, null, 2) + "\n");
  } else {
    const lines = allTrades.map((t) => JSON.stringify(t)).join("\n");
    writeFileSync(filename, allTrades.length > 0 ? lines + "\n" : "");
  }

  console.log(`\nWrote ${allTrades.length} trades to ${filename}`);
  printSummary(allTrades);
}

main().catch((err) => {
  console.error(`\nFatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
