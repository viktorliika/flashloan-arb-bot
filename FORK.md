# Flashloan Arbitrage Bot - Forked Mainnet Testing

This document explains how to test your flashloan arbitrage bot in a forked mainnet environment before deploying to a testnet or the actual mainnet.

## What is a Forked Mainnet?

A forked mainnet is a local copy of the Ethereum mainnet blockchain that allows you to:

- Interact with real deployed contracts (Aave, Uniswap, Sushiswap, etc.)
- Execute transactions without spending real ETH
- Test arbitrage opportunities with real market data
- Validate your contract's interaction with production protocols

This provides a much more realistic testing environment compared to simulations with mock contracts.

## Prerequisites

Make sure you have:

1. Node.js and npm installed
2. Project dependencies installed (`npm install`)
3. A mainnet RPC URL from Infura, Alchemy, or another provider (added to your `.env` file)

## Step 1: Start the Forked Mainnet Node

First, make sure your Hardhat node isn't running. If it is, stop it before proceeding.

Start a local Hardhat node that forks from Ethereum mainnet:

```bash
npm run fork
```

This will start a local node at `http://127.0.0.1:8545/` that's forked from a recent Ethereum mainnet block. The node will use chainId 1 (same as Ethereum mainnet) to ensure compatibility with the deployed contracts.

> **Important**: If you were previously running a Hardhat node, you must restart it after updating the configuration to ensure it uses the correct chain ID.

## Step 2: Deploy Your Contract to the Forked Mainnet

In a new terminal window, deploy your FlashloanArb contract to the forked mainnet:

```bash
npm run deploy:fork
```

This script will:
1. Deploy your FlashloanArb contract to the forked mainnet
2. Configure it to use the real Aave LendingPool, Uniswap, and Sushiswap routers
3. Save the deployment information to `fork-config.json`

## Step 3: Run Tests on the Forked Mainnet

Verify that your contract works correctly with the real mainnet contracts:

```bash
npm run test:fork
```

This will run tests that check:
- Connection to the real tokens (WETH, DAI, USDC)
- Price queries from Uniswap and Sushiswap
- Aave flash loan fee verification

## Step 4: Run the Arbitrage Scanner

Start the arbitrage scanner to detect opportunities between Uniswap and Sushiswap:

```bash
npm run arb:scan:fork
```

This will:
1. Connect to your deployed contract
2. Monitor price differences between Uniswap and Sushiswap
3. Log potential arbitrage opportunities
4. Save profitable opportunities to a CSV file

## Step 5: Start the Dashboard (Optional)

In another terminal window, start the dashboard to visualize results:

```bash
npm run dashboard
```

Visit `http://localhost:3000` in your browser to see the dashboard.

## All-in-One Commands

For convenience, you can run the entire setup with a single command:

### Windows

```bash
npm run fork:all:win
```

### Unix/Linux/Mac

```bash
npm run fork:all:unix
```

## Troubleshooting

### Chain ID Mismatch

If you encounter an error like:
```
Error: HH101: Hardhat was set to use chain id 31337, but connected to a chain with id 1
```
This means there's a mismatch between the configured chain ID in Hardhat and the one in your forked network. Make sure:
1. The `chainId` property in your hardhat.config.ts file is set to `1` for both the `hardhat` and `localhost` networks
2. You've restarted your node after making configuration changes
3. All your terminals are using the correct network configuration

### Gas Price and Transaction Fee Errors

If you encounter errors related to gas prices or transaction fees, like:
```
Transaction maxFeePerGas is too low for the next block
```

This is because the forked mainnet has specific gas price requirements based on the block it's forked from. To fix this:

1. In your `hardhat.config.ts`, ensure you have proper gas configuration in both network settings:
   ```javascript
   hardhat: {
     gas: 12000000,
     gasPrice: "auto",
     blockGasLimit: 30000000
   },
   localhost: {
     gasPrice: "auto",
     gas: 6000000
   }
   ```

2. Restart your node after making these changes
3. The transaction should now deploy with the appropriate gas settings

### RPC Connection Issues

If you see errors connecting to the mainnet:
1. Check your `.env` file to ensure `MAINNET_RPC_URL` is set correctly
2. Verify your Infura/Alchemy API key is valid
3. Some providers have rate limits for archive node access

### Contract Interaction Errors

If your contract fails to interact with mainnet contracts:
1. Check the Aave LendingPool address is correct for the version you're targeting
2. Verify your contract implements the expected interfaces correctly
3. Some protocols might have updated since your code was written

## Advanced Testing Tools

This project includes several advanced tools for testing and optimizing your arbitrage bot in a forked mainnet environment:

### 1. Pool Liquidity Checker

Examines the actual reserves and pricing in the liquidity pools:

```bash
npm run check:pools
```

This tool:
- Directly accesses token reserves in Uniswap and Sushiswap pairs
- Displays raw and formatted prices between tokens
- Helps identify liquidity imbalances that affect trading

### 2. Multi-Path Arbitrage Analyzer

Tests all possible arbitrage paths with different amounts:

```bash
npm run multi:arb
```

This tool:
- Tests various token pairs at different loan amounts
- Evaluates both direct and triangle arbitrage paths
- Checks all combinations of DEXes for each path
- Identifies the most profitable opportunities

### 3. Artificial Arbitrage Creator

Creates profitable arbitrage opportunities for testing:

```bash
npm run create:arb
```

This tool:
- Manipulates pool reserves to create price discrepancies
- Creates controlled arbitrage opportunities between exchanges
- Useful for testing execution logic without waiting for natural opportunities

By default, it creates a 20% imbalance in the DAI/USDC Sushiswap pool.
You can customize with command-line parameters:

```bash
# Example: Create 30% imbalance in WETH-DAI on Uniswap
npx hardhat run scripts/create-arb-opportunity.ts --network localhost -- pair=WETH-DAI exchange=uniswap imbalance=30 direction=token1
```

### 4. Uniswap V3 Scanner

Scans for arbitrage opportunities between V2 and V3 exchanges:

```bash
npm run arb:scan:v3
```

This tool:
- Checks all Uniswap V3 fee tiers (0.01%, 0.05%, 0.3%, 1%)
- Compares prices between Uniswap V2, Sushiswap, and Uniswap V3
- Identifies cross-version arbitrage opportunities
- More accurately models real mainnet conditions

### Performance Issues

Forked nodes can be resource-intensive:
1. Consider limiting the number of scans in your tests
2. If running on limited hardware, increase the sleep time between scans
3. For production testing, consider using a dedicated VPS or cloud instance

## Next Steps

Once you've validated your contract works in the forked environment:

1. Deploy to a testnet using `npm run deploy:goerli`
2. Run arbitrage scanning on testnet with `npm run arb:scan`
3. Fine-tune parameters based on testnet results
4. Consider mainnet deployment when ready

## Notes on Gas and Profitability

In the forked environment, you won't experience real gas costs. Before real deployment:

1. Estimate gas costs for arbitrage transactions
2. Update your minimum profit threshold to account for gas
3. Consider implementing dynamic gas price strategies
4. Test with various market conditions to ensure profitability
