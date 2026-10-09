import fetch from "node-fetch";
import type { ContractTag, ITagService } from "atq-types";

interface ChainConfig { label: string; deployment: string; directory: string }
const CHAINS: Readonly<Record<string, ChainConfig>> = {
  "1": {
    label: "Ethereum", deployment: "QmdRFSobiBMoKKyNZnwahtn8uzPFxat86qg1Mu7KobJcSb",
    directory: "0x835482fe0532f169024d5e9410199369aad5c77e",
  },
  "42161": {
    label: "Arbitrum One", deployment: "QmU8G3bY1v3r5RkLjcpJQbBnZauj4pL6KdGQMEhXj3N8qA",
    directory: "0xc201b8c8dd22c779025e16f1825c90e1e6dd6a08",
  },
};
const PAGE = 1000;
const DEADLINE_MS = 180_000;
const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = "0x" + "0".repeat(40);
const META_QUERY = `query { _meta { deployment hasIndexingErrors block { number hash } } }`;
// This module covers native-ETH receipt cTokens only. ERC20-underlying cTokens
// are a different specific category, so are outside this query's declared scope.
// The indexed native sentinel denotes CEther, not a deployed underlying token.
// No active, supply, balance, TVL, or current-listing filter is applied: genuine
// historical, delisted and zero-supply native receipt contracts remain included.
// Market IDs have no unique sequential field, so their IDs are the cursor.
const MARKETS_QUERY = `query NativeMarkets($block: Block_height!, $last: ID!, $native: ID!) {
  _meta(block: $block) { deployment hasIndexingErrors block { number hash } }
  markets(first: 1000, orderBy: id, orderDirection: asc,
    where: { id_gt: $last, inputToken_: { id: $native } }, block: $block) {
    id inputToken { id name symbol decimals } outputToken { id name symbol decimals }
    protocol { id name slug }
  }
}`;
// Fuse pool numbers are unique sequential directory indices, preferred to IDs.
// The schema stores them as String, so order and cursor comparisons are lexical.
const POOLS_QUERY = `query FusePools($block: Block_height!, $last: String!) {
  _meta(block: $block) { deployment hasIndexingErrors block { number hash } }
  fusePools(first: 1000, orderBy: poolNumber, orderDirection: asc,
    where: { poolNumber_gt: $last }, block: $block) {
    id name poolNumber marketIDs
  }
}`;
interface Meta { deployment: string; hasIndexingErrors: boolean; block: { number: number; hash: string | null } }
interface Token { id: unknown; name: unknown; symbol: unknown; decimals: unknown }
interface Market { id: unknown; inputToken: Token | null; outputToken: Token | null; protocol: { id: unknown; name: unknown; slug: unknown } | null }
interface Pool { id: unknown; name: unknown; poolNumber: unknown; marketIDs: unknown }
interface Identity { contract: string; tokenName: string; symbol: string; pool: string; poolNumber: string; poolName: string }

function address(value: unknown, field: string): string {
  if (typeof value !== "string" || !ADDRESS.test(value) || value.toLowerCase() === ZERO)
    throw Error(`Invalid ${field} address in Fuse response.`);
  return value.toLowerCase();
}
function plain(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 300)
    throw Error(`Invalid ${field} in Fuse response.`);
  const text = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/[`*_\[\]<>\\|]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) throw Error(`Empty sanitized ${field}.`);
  return text;
}
function checkMeta(value: unknown, deployment: string, block?: number): Meta {
  const meta = value as Meta | null;
  if (!meta || meta.deployment !== deployment || meta.hasIndexingErrors !== false ||
      !Number.isSafeInteger(meta.block?.number) || meta.block.number <= 0 ||
      (meta.block.hash !== null && (typeof meta.block.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(meta.block.hash))) ||
      (block !== undefined && meta.block.number !== block))
    throw Error("Invalid, inconsistent or errored Fuse indexing metadata.");
  return meta;
}
function poolNumber(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 20)
    throw Error("Invalid Fuse pool number.");
  return value;
}

export async function returnTags(chainId: string, apiKey: string): Promise<ContractTag[]> {
  if (typeof chainId !== "string" || !Object.hasOwn(CHAINS, chainId))
    throw Error(`Unsupported Chain ID: ${String(chainId)}.`);
  if (typeof apiKey !== "string" || !apiKey.trim() || /\s/.test(apiKey))
    throw Error("A nonempty Graph API key without whitespace is required.");
  const config = CHAINS[chainId];
  const endpoint = `https://gateway.thegraph.com/api/deployments/id/${config.deployment}`;
  const deadline = Date.now() + DEADLINE_MS;
  async function query(document: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Error("Fuse query deadline exceeded; no partial result returned.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(30_000, remaining));
    try {
      const response = await fetch(endpoint, {
        method: "POST", redirect: "error", size: 16_000_000,
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query: document, variables }), signal: controller.signal,
      });
      if (!response.ok) throw Error("Graph gateway HTTP failure.");
      const payload = await response.json() as { data?: Record<string, unknown>; errors?: unknown };
      if (payload.errors !== undefined && (!Array.isArray(payload.errors) || payload.errors.length))
        throw Error("Graph returned query errors; no partial result returned.");
      if (!payload.data || typeof payload.data !== "object") throw Error("Graph returned no query data.");
      return payload.data;
    } catch {
      // Provider error text may contain credentials, so never reflect it.
      throw Error("Unable to retrieve complete Fuse native-ETH receipt data.");
    } finally { clearTimeout(timer); }
  }
  const head = checkMeta((await query(META_QUERY, {}))._meta, config.deployment);
  if (!head.block.hash) throw Error("Graph did not identify an indexed snapshot hash.");
  const block = { hash: head.block.hash };
  function sameSnapshot(result: Record<string, unknown>): void {
    const meta = checkMeta(result._meta, config.deployment, head.block.number);
    if (meta.block.hash && meta.block.hash !== head.block.hash) throw Error("Fuse snapshot hash changed.");
  }
  const markets: Market[] = [];
  let cursor = "";
  while (true) {
    const result = await query(MARKETS_QUERY, { block, last: cursor, native: NATIVE_ETH });
    sameSnapshot(result);
    const rows = result.markets as Market[];
    if (!Array.isArray(rows) || rows.length > PAGE) throw Error("Invalid Fuse market page.");
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || row.id <= cursor || address(row.id, "market") !== row.id)
        throw Error("Market cursor did not advance in strict order.");
      cursor = row.id; markets.push(row);
    }
    if (rows.length < PAGE) break;
  }
  if (!markets.length) throw Error("Deployment returned no native-ETH receipt tokens.");
  const memberships = new Map<string, { pool: string; number: string; name: string }>();
  const poolIds = new Set<string>();
  let lastNumber = "";
  while (true) {
    const result = await query(POOLS_QUERY, { block, last: lastNumber });
    sameSnapshot(result);
    const rows = result.fusePools as Pool[];
    if (!Array.isArray(rows) || rows.length > PAGE) throw Error("Invalid Fuse pool page.");
    for (const row of rows) {
      const pool = address(row?.id, "comptroller"), number = poolNumber(row?.poolNumber), name = plain(row?.name, "registered pool name");
      if (number <= lastNumber || poolIds.has(pool)) throw Error("Fuse pool cursor or identity repeated.");
      poolIds.add(pool); lastNumber = number;
      if (!Array.isArray(row.marketIDs)) throw Error("Missing Fuse pool market membership.");
      for (const raw of row.marketIDs) {
        const id = address(raw, "pool market");
        const prior = memberships.get(id);
        if (prior && prior.pool !== pool) throw Error("Ambiguous Fuse pool market membership.");
        // Repeated indexing of the same association is not another contract.
        // A repeated ID within one pool preserves exactly the same membership.
        memberships.set(id, { pool, number, name });
      }
    }
    if (rows.length < PAGE) break;
  }
  const identities: Identity[] = [];
  for (const market of markets) {
    const contract = address(market.id, "receipt token");
    if (!market.outputToken || address(market.outputToken.id, "output token") !== contract ||
        address(market.inputToken?.id, "native asset") !== NATIVE_ETH ||
        market.inputToken?.symbol !== "ETH" || market.inputToken?.decimals !== 18 ||
        !Number.isInteger(market.outputToken?.decimals) || Number(market.outputToken?.decimals) < 0 || Number(market.outputToken?.decimals) > 255 ||
        address(market.protocol?.id, "protocol directory") !== config.directory ||
        market.protocol?.slug !== "rari-fuse") throw Error("Inconsistent Fuse native receipt association.");
    const membership = memberships.get(contract);
    if (!membership) throw Error("Native receipt token has no registered Fuse pool association.");
    identities.push({ contract, tokenName: plain(market.outputToken.name, "receipt token name"),
      symbol: plain(market.outputToken.symbol, "receipt token symbol"),
      pool: membership.pool, poolNumber: membership.number, poolName: membership.name });
  }
  const baseName = (i: Identity): string => `Pool ${i.poolNumber} ${i.symbol} Token`;
  const nameCounts = new Map<string, number>();
  for (const i of identities) { const key = baseName(i).toLowerCase(); nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1); }
  const emittedNames = new Set<string>();
  const tags: ContractTag[] = identities.map(i => {
    const base = baseName(i), suffix = (nameCounts.get(base.toLowerCase()) ?? 0) > 1 ? ` (${i.contract.slice(2, 10)})` : "";
    const name = (base.length + suffix.length <= 50 ? base : base.slice(0, 47 - suffix.length) + "...") + suffix;
    if (emittedNames.has(name.toLowerCase())) throw Error("Ambiguous formatted native receipt name.");
    emittedNames.add(name.toLowerCase());
    return {
      "Contract Address": `eip155:${chainId}:${i.contract}`,
      "Public Name Tag": name,
      "Project Name": "Rari Capital",
      // Official project-owned Fuse page; a relevant brand/product website,
      // not a claim that a deprecated lending interface is still operational.
      "UI/Website Link": "https://github.com/Rari-Capital/fuse-v1",
      // Pool names are registered by creators. Preserve their text as context,
      // not an invented attribution or a claim that a named project runs it.
      "Public Note": `Rari Capital; Ethereum. Fuse native-ETH receipt token on ${config.label}: ${i.tokenName} (${i.symbol}). Records a lending claim for native Ether (ETH), not wrapped ETH. Pool ${i.poolNumber}, registered name: ${i.poolName}; comptroller ${i.pool}. Historical, delisted and zero-supply contracts are included; an entry is not a statement that the pool currently accepts deposits.`,
    };
  });
  const service: ITagService = { returnTags: async () => tags };
  return service.returnTags(chainId, apiKey);
}
