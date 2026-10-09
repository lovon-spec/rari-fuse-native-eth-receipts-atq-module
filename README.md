# Rari Fuse native-ETH receipt tokens

Generates address tags for Rari Capital Fuse cTokens whose underlying asset is native Ether, on Ethereum and Arbitrum One. ERC20-underlying markets, including wrapped ETH, are a separate contract category and are not returned. Genuine native receipt contracts remain included regardless of current listing, activity, supply or deposits.

Install with Yarn 1.22.22 and `yarn install --frozen-lockfile`, then `yarn build`. Import `returnTags` from `dist/main.mjs` and pass a decimal chain-ID string (`"1"` or `"42161"`) and a Graph API key. `yarn test` runs local deterministic tests. Only decentralized Graph deployment endpoints are queried; the supplied key is used only in the authorization header.

The module pages native markets by ID and Fuse pools by their sequential pool number at one indexed block hash. Every returned output-token address must equal its market address, be associated with exactly one indexed Fuse pool, and belong to the deployment's Rari Fuse directory. It throws on errors or inconsistent data instead of returning partial output.

Pool numbers and on-chain token symbols distinguish instances. If two contracts share the same pool number and symbol, their address prefixes distinguish them. Registered pool names and token names are retained in the Public Note as creator-provided context, not as proof of an operator's identity. The website field links Rari Capital's official project-owned Fuse page. It is a relevant product/brand website, not a claim that a legacy lending interface remains operational or that these contracts currently accept deposits.

## Sources

Messari's explicit deployment catalog identifies the `rari-fuse` deployments for Ethereum and Arbitrum:

- [Deployment catalog](https://github.com/messari/subgraphs/blob/2711ac91ef119f321f65b339e10a57f9aa74f9d8/deployment/deployment.json)
- [Ethereum Graph listing](https://thegraph.com/explorer/subgraphs/kecp6SPMvbB4GTqg9r5PXvztYriexj5F3ZCaATpjmb2?view=Overview&chain=arbitrum-one)
- [Arbitrum Graph listing](https://thegraph.com/explorer/subgraphs/HnV3fhwsWfmQGdD2AeGzqvRVTDBqnMH74jCsDVq1DXYP?view=Overview&chain=arbitrum-one)

Rari Capital's official code defines the native-ETH cToken class and pool directory:

- [CEther](https://github.com/Rari-Capital/fuse-v1/blob/85c4e6246abd9b2d24dba2a62a0501aee4cc25ed/src/core/CEther.sol)
- [CEther and ERC20 interfaces](https://github.com/Rari-Capital/fuse-v1/blob/85c4e6246abd9b2d24dba2a62a0501aee4cc25ed/src/core/CTokenInterfaces.sol)
- [Fuse pool directory](https://github.com/Rari-Capital/fuse-contracts/blob/3513b139568a1f406486eece9731f21108097c32/contracts/FusePoolDirectory.sol)
- [Official organization and published website](https://github.com/Rari-Capital)
