# Enhanced Flashloan Arbitrage Bot Testing Guide

This guide explains how to test your upgraded flashloan arbitrage bot with triangle arbitrage and Uniswap V3 support in a forked mainnet environment.

## Prerequisites

- Hardhat project set up (already done)
- Node.js and npm installed
- Access to an Ethereum node provider (e.g., Infura or Alchemy)

## Testing Workflow

Follow these steps to test the enhanced arbitrage functionality:

### 1. Start a Local Forked Mainnet

```bash
npm run fork
```

This starts a Hardhat node that forks from a recent Ethereum mainnet state.

### 2. Deploy the Original Contract

```bash
npm run deploy:fork
```

This deploys the original FlashloanArb contract and updates fork-config.json with addresses.

### 3. Deploy the Enhanced Contract

```bash
npm run deploy:enhanced
```

This deploys the FlashloanArbV2 contract with:
- Support for all Uniswap V3 fee tiers
- Triangle arbitrage capability
- Optimal fee tier mapping

### 4. Reduce Minimum Profit Threshold

```bash
npm run reduce:profit
```

This reduces the minimum required profit to 0.0001 ETH (almost zero) for both contracts to make testing easier. The default threshold (0.01 ETH) makes it difficult to find profitable opportunities in test environments.

### 5. Create an Artificial Arbitrage Opportunity

For a moderate 5% imbalance:
```bash
npm run create:arb
```

For a stronger 10% imbalance (more likely to be profitable):
```bash
npm run increase:imbalance
```

These commands manipulate the DAI-USDC Sushiswap pool to create price differences between exchanges.

### 6. Execute Triangle Arbitrage

```bash
npm run execute:triangle
```

This tests different DEX combinations for the WETH→DAI→USDC→WETH triangle path. If all attempts fail with "Insufficient profit," try:
1. Running `increase:imbalance` to create a stronger price difference
2. Running `create:arb` with a different pair or exchange (`pair=WETH-DAI exchange=uniswap`)
3. Editing `scripts/execute-triangle-arb.ts` to try different token paths or lower loan amounts

## Troubleshooting

### "Insufficient profit" Errors

If you see "Insufficient profit" errors despite reducing the minimum profit threshold:
1. The gas costs may be exceeding potential profits
2. The price differences may be too small (try increasing imbalance)
3. The token paths may need optimization

### "Transaction maxFeePerGas is too low" Errors

If you see gas-related errors:
1. All scripts now include proper gas settings for forked mainnet
2. The scripts use 100 gwei max fee and 2 gwei priority fee
3. If errors persist, try manually increasing these values

### "UniswapV2: K" Errors

If you see "UniswapV2: K" errors during imbalance creation:
1. The requested imbalance is too large for the constant product formula
2. Try a smaller imbalance percentage (default is now 5%)

## Advanced Testing

### Cross-DEX Price Checking

```bash
npm run check:pools
```

Shows real-time pool reserves and prices across exchanges.

### Multi-Path Optimization

```bash
npm run multi:arb
```

Tests different arbitrage paths with varying loan amounts to find the most profitable configurations.

### Uniswap V3 Pool Scanning

```bash
npm run arb:scan:v3
```

Tests arbitrage opportunities between V2 and V3 pools with different fee tiers.

## Contract Enhancements

The FlashloanArbV2 contract includes:

1. **Triangle arbitrage support** - Can execute A→B→C→A paths
2. **All Uniswap V3 fee tiers** - Supports 0.01%, 0.05%, 0.3%, and 1% pools
3. **Optimal fee tier mapping** - Automatically uses 0.05% for stablecoins and 0.3% for ETH pairs
4. **Multi-DEX paths** - Can combine different exchanges in a single arbitrage

These enhancements significantly increase your potential for finding profitable arbitrage opportunities compared to the original implementation.
