# Flashloan Arbitrage Bot Simulation Environment

This document explains how to use the simulation environment to test the flashloan arbitrage bot before deploying to a testnet.

## Getting Started

First, make sure you've installed all the necessary dependencies:

```bash
npm install
```

Compile the contracts:

```bash
npm run compile
```

## Running the Simulation Environment

### Step 1: Manage the Hardhat Node

We've added a node manager script that checks if a Hardhat node is already running and gives you options to kill it or use the existing one:

```bash
npm run node
```

This will:
1. Check if a node is already running on port 8545
2. If yes, ask if you want to kill it or use the existing one
3. If no, start a new node

### Step 2: Deploy the Simulation Contracts

Once your node is running, deploy the simulation contracts:

```bash
npm run deploy:sim
```

This will:
1. Deploy mock tokens (WETH, DAI, USDC)
2. Deploy mock DEX routers (Uniswap V2 and V3)
3. Deploy the FlashloanArb contract
4. Set up exchange rates with price discrepancies to create arbitrage opportunities
5. Save the deployment information to `simulation-config.json`

### Step 3: Verify the Deployment

To ensure the deployment was successful:

```bash
npm run test:sim
```

This will check if all necessary contracts were deployed and display their addresses.

### Step 4: Run the Arbitrage Scanner

Start the arbitrage scanner to detect and log arbitrage opportunities:

```bash
npm run arb:scan:local
```

### Step 5: Start the Dashboard

In a separate terminal, start the dashboard to visualize the results:

```bash
npm run dashboard
```

Visit `http://localhost:3000` in your browser to see the dashboard.

## All-in-One Commands

If you prefer to run everything with a single command:

### Windows

```bash
npm run simulate:win
```

### Unix/Linux/Mac

```bash
npm run simulate:unix
```

## Troubleshooting

### Address Already in Use

If you see an error like:
```
Error: listen EADDRINUSE: address already in use 127.0.0.1:8545
```

Use the node manager to kill the existing process:
```bash
npm run node
```
And select the option to kill the existing node.

### Missing Configuration

If the scanner fails with:
```
Error loading simulation config: Error: Simulation config not found
```

Make sure you've run `npm run deploy:sim` first and it completed successfully.

### Deployment Errors

If you see contract deployment errors:
1. Make sure your local node is running
2. Try running `npm run compile` again
3. Check if there are any compilation errors in your contracts

## Next Steps

Once you've verified that everything works in the simulation environment, you can proceed to deploy to a testnet:

```bash
npm run deploy:goerli
```

And then run the scanner against the testnet:

```bash
npm run arb:scan
```

## Note on Uniswap V2 vs V3

The simulation environment includes support for both Uniswap V2 and V3 style exchanges. The FlashloanArb contract has been updated to work with both router types, and the mock contracts simulate the price differences between them.
