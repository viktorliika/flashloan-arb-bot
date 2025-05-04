# Multi-DEX Arbitrage System

This document describes the enhanced multi-DEX arbitrage system that extends the flashloan arbitrage bot to work with multiple decentralized exchanges (DEXes).

## Overview

The multi-DEX arbitrage system allows you to:

1. Scan for arbitrage opportunities across multiple DEXes (Uniswap V2, Uniswap V3, Curve, Balancer)
2. Execute arbitrage trades using flashloans
3. Support multiple trading paths (direct and triangle arbitrage)
4. Dynamically adjust to market conditions

## Components

### 1. Smart Contracts

- **MultiDexArbitrageur.sol**: The main arbitrage contract that executes trades across multiple DEXes.
  - Supports Uniswap V2, Uniswap V3, Curve, and Balancer
  - Handles flashloan borrowing and repayment
  - Includes profit management functions

### 2. DEX Adapters

Located in `scripts/utils/adapters/`:

- **uniswap-v2-adapter.ts**: Adapter for Uniswap V2 and similar DEXes (Sushiswap, etc.)
- **curve-dex-adapter.ts**: Adapter for Curve Finance pools
- **balancer-dex-adapter.ts**: Adapter for Balancer pools

### 3. Universal Scanner

- **universal-scanner.ts**: Centralized scanner that coordinates all DEX adapters
- Discovers arbitrage opportunities across all connected DEXes
- Validates opportunities for profitability

### 4. Utility Modules

- **gas-strategy.ts**: Manages dynamic gas pricing
- **opportunity-validator.ts**: Validates arbitrage opportunities
- **price-feed.ts**: Gets token prices for profitability calculations
- **transaction-executor.ts**: Handles transaction submission

## How to Use

### Step 1: Deploy the Multi-DEX Arbitrageur Contract

```bash
npm run deploy:multi-dex-arb
```

This will deploy the `MultiDexArbitrageur` contract and save the deployment details to `deployments/multi-dex-arb-deployment.json`.

### Step 2: Scan for Arbitrage Opportunities

```bash
npm run arb:scan:universal
```

This script scans all supported DEXes for potential arbitrage opportunities. It will:

1. Register all DEX adapters
2. Search for direct arbitrage between token pairs
3. Search for triangle arbitrage paths
4. Validate each opportunity for profitability after gas costs
5. Log results to the console and to CSV files

### Step 3: Execute Arbitrage Opportunities

```bash
npm run execute:multi-dex-arb
```

This will execute an example arbitrage opportunity. In a production environment, you would modify this script to execute the opportunities discovered by the scanner.

## Configuration

Key configuration parameters can be found in `scripts/arb-scan-universal.ts`:

- `MIN_PROFIT_USD`: Minimum profit threshold in USD (default: 15 USD)
- `SCAN_INTERVAL_MS`: How frequently to scan for opportunities (default: 10 seconds)
- `FLASH_LOAN_AMOUNT`: Amount to borrow for arbitrage (default: 10 ETH)
- `SLIPPAGE_TOLERANCE`: Maximum acceptable slippage percentage (default: 3%)
- `MIN_PROFIT_PERCENTAGE`: Minimum profit percentage after gas (default: 0.5%)
- `EXECUTE_TRADES`: Whether to automatically execute trades (default: false)

## Trading Pairs

The system is configured to scan the following token pairs:

- WETH/USDC
- WETH/DAI
- USDC/USDT
- DAI/USDC
- WETH/WBTC

For triangle arbitrage, it uses the following intermediate tokens:

- USDC
- DAI
- WBTC

## Advanced Features

### 1. Multi-DEX Path Finding

The universal scanner can find complex trading paths that involve multiple DEXes. For example:

Uniswap V2 (WETH → DAI) → Curve (DAI → USDC) → Balancer (USDC → WETH)

### 2. Dynamic Gas Strategy

The gas strategy module dynamically adjusts gas prices based on network conditions and opportunity profitability.

### 3. Flashbots Integration

For MEV protection, the transaction executor supports submitting transactions via Flashbots when available.

### 4. Real-time Price Feeds

The price feed module gets current token prices from CoinGecko to calculate profitability in USD terms.

## Logs and Monitoring

Logs and CSV files are stored in the following locations:

- Log files: `logs/universal_arb_[date].log`
- CSV data: `arbitrage_universal_log.csv`

The CSV file contains important metrics about each opportunity:
- Timestamp
- Tokens involved
- Source and destination DEXes
- Amount and profit
- Price difference percentage
- Transaction hash (if executed)

## Future Enhancements

Planned improvements to the system:

1. Additional DEX adapters (SushiSwap, PancakeSwap, etc.)
2. Machine learning for predicting profitable opportunities
3. Enhanced MEV protection
4. Parallel scanning for faster opportunity discovery
5. Risk management system for safer trading
6. Integration with centralized exchanges for more arbitrage paths

## Troubleshooting

Common issues and their solutions:

1. **Error: Not enough profit to repay flash loan**
   - Increase the flashloan amount or decrease the minimum profit threshold
   
2. **Gas price too high for profitable arbitrage**
   - Adjust the `MIN_PROFIT_PERCENTAGE` or use Flashbots for more efficient execution
   
3. **DEX liquidity too low for trade**
   - Try smaller trade sizes or focus on more liquid trading pairs

4. **Contract deployment failure**
   - Check that you have sufficient ETH in your account for deployment
   - Verify that the lending pool address is correct

## Security Considerations

1. Keep private keys secure and never commit them to source control
2. Use a dedicated wallet for arbitrage operations
3. Start with small trade sizes and gradually increase as confidence grows
4. Regularly withdraw profits to reduce risk exposure
5. Monitor for contract upgrades in the DEXes you interact with
