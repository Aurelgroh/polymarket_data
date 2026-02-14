# Polymarket Trade History Puller

Pull public trade history from Polymarket's Data API for any wallet address.

## Setup

```bash
npm install
```

## Usage

```bash
npx tsx src/index.ts <wallet-address> [options]
```

### Options

| Flag | Description |
|---|---|
| `--market <id>` | Filter by market condition ID |
| `--event <id>` | Filter by event ID |
| `--side <BUY\|SELL>` | Filter by trade side |
| `--format <jsonl\|json>` | Output format (default: `jsonl`) |
| `--output <filename>` | Custom output filename |

### Examples

```bash
# Pull all trades for a wallet (JSONL output)
npx tsx src/index.ts 0xABC...123

# Pull only BUY trades as JSON
npx tsx src/index.ts 0xABC...123 --side BUY --format json

# Filter by market with custom output file
npx tsx src/index.ts 0xABC...123 --market <conditionId> --output my_trades.jsonl
```

Default output filename: `trades_<wallet_prefix>_<timestamp>.jsonl`

## Output

Each trade record includes: `transactionHash`, `side`, `price`, `size`, `timestamp`, `conditionId`, `title`, `outcome`, and more.

A summary is printed after each run:

```
--- Summary ---
Trades:    3534
Buys:      2624
Sells:     910
Markets:   1
Volume:    $88636.45
Earliest:  2026-02-14T17:07:01.000Z
Latest:    2026-02-14T17:09:15.000Z
```

## Limitations

The public Data API caps at ~4,000 trades per query (server rejects offsets above 3,000 with a page size of 1,000). If a wallet has more history, use `--market` to pull trades per market — each gets its own 4,000-trade window.
