# Flashloan Arbitrage Testing in Forked Mainnet

This document provides comprehensive instructions for testing the flashloan arbitrage system in a forked mainnet environment. The project includes both basic and advanced arbitrage testing workflows.

## Getting Started

Before running any tests, you need to set up a forked mainnet and deploy the contracts:

1. **Start the forked mainnet**
   ```bash
   npm run fork
   ```

2. **Deploy the standard arbitrage contract**
   ```bash
   npm run deploy:fork
   ```

3. **Deploy the enhanced (V2) arbitrage contract**
   ```bash
   npm run deploy:enhanced
   ```

4. **Reduce the profit threshold to near zero**
   ```bash
   npm run reduce:profit
   ```

## Basic Arbitrage Testing (Two-Token Path)

This is the simpler approach and is the most reliable for testing:

1. **Create a direct arbitrage opportunity**
   ```bash
   npm run direct:arb
   ```
   
   This creates extreme (80%) imbalances between Uniswap and Sushiswap pools, making WETH significantly cheaper on one exchange and DAI cheaper on the other, creating a clear arbitrage opportunity.

2. **Execute the direct arbitrage**
   ```bash
   npm run execute:direct
   ```
   
   This script will automatically detect the best arbitrage path and execute it.

## Advanced Triangle Arbitrage Testing (Three-Token Path)

This is a more complex approach that tests the triangle arbitrage capability:

1. **Create triangle imbalances**
   ```bash
   npm run triangle:imbalance
   ```
   
   This creates coordinated imbalances in all three pools of the triangle (WETH-DAI, DAI-USDC, WETH-USDC), enabling a three-token circular arbitrage.

2. **Execute the triangle arbitrage**
   ```bash
   npm run execute:triangle
   ```
   
   This attempts several combinations of DEXes to find a profitable path.

## Troubleshooting

If you encounter "Insufficient profit" errors:

1. **Check if the fork is synced properly**
   ```bash
   npm run check:pools
   ```

2. **Try increasing the imbalance**
   You can modify the imbalance percentages in the scripts:
   - `scripts/create-direct-arbitrage.ts`
   - `scripts/create-triangle-imbalance.ts`

3. **Verify contract minimum profit threshold**
   Ensure `reduce:profit` ran successfully by checking the log output.

4. **Restart the fork**
   Sometimes the fork state can get corrupted:
   ```bash
   # Stop the current fork process
   # Then start a new one
   npm run fork
   # Then redeploy and proceed
   ```

5. **Increase the loan amount**
   In both `execute-direct-arb.ts` and `execute-triangle-arb.ts`, try increasing the loan amount to make potential profits larger in absolute terms.

## Script Overview

### Core Testing Scripts

- `direct:arb` - Creates a large imbalance between Uniswap and Sushiswap for the WETH-DAI pair
- `execute:direct` - Executes a direct (two-token) arbitrage between Uniswap and Sushiswap
- `triangle:imbalance` - Creates coordinated imbalances in all three pools of a triangle path
- `execute:triangle` - Executes a triangle (three-token) arbitrage across multiple DEXes
- `reduce:profit` - Sets the minimum profit threshold to near zero (0.000000001 ETH)

### Helper Scripts

- `careful:arb` - Creates a more conservative imbalance in a single pair
- `deploy:fork` - Deploys the original FlashloanArb contract
- `deploy:enhanced` - Deploys the FlashloanArbV2 contract with advanced features

## Choosing Between Direct and Triangle Arbitrage

- **Direct arbitrage** (two-token path) is simpler and more reliable for testing
- **Triangle arbitrage** is more complex but tests the full capabilities of the system

For initial testing and verification, it's recommended to use the direct arbitrage workflow first, then proceed to triangle arbitrage once you've confirmed the basic functionality.

## Production Considerations

For mainnet deployment, consider:

1. Using private transaction submission through services like Flashbots
2. Implementing MEV protection mechanisms
3. Adding gas price optimization strategies
4. Implementing more sophisticated pool selection algorithms
5. Adding monitoring for arbitrage opportunities across more DEXes and token pairs
