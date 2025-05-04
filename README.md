# Flashloan Arbitrage Bot

A smart contract-based system for executing arbitrage opportunities between decentralized exchanges (DEXs) using flash loans.

## Overview

This project implements a bot that:
1. Monitors price differences between Uniswap and Sushiswap
2. Identifies arbitrage opportunities
3. Executes trades using flash loans for zero initial capital
4. Profits from price discrepancies between exchanges

## Features

- **Zero Capital Trading**: Uses flash loans to borrow funds for arbitrage
- **Multi-DEX Support**: Works with Uniswap and Sushiswap (extensible to other DEXs)
- **Configurable Parameters**: Customize profit thresholds, gas limits, etc.
- **Logging & Monitoring**: Full logging of opportunities and transactions
- **Gas Optimization**: Optimized contract for efficient execution

## Prerequisites

- Node.js (v14+)
- npm or yarn
- An Ethereum wallet with private key
- Goerli ETH for testing (testnet mode)
- Infura, Alchemy, or other RPC provider API key

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/flashloan-arb-bot.git
cd flashloan-arb-bot
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Edit `.env` with your configuration details:
```
GOERLI_RPC_URL=https://goerli.infura.io/v3/YOUR_INFURA_KEY
PRIVATE_KEY=your_private_key_here_without_0x_prefix
CONTRACT_ADDRESS=  # Leave empty until deployment
ETHERSCAN_API_KEY=your_etherscan_api_key
GAS_PRICE=50
DRY_RUN=true  # Set to false to execute real transactions
```

## Deployment

1. Compile the contracts:
```bash
npm run compile
```

2. Run the tests to verify functionality:
```bash
npm test
```

3. Deploy the contract to Goerli testnet:
```bash
npm run deploy:goerli
```

4. Update your `.env` file with the deployed contract address

## Testing Options

### Simulation Testing

For testing in a fully simulated environment with mock contracts:

1. Start the local node manager:
```bash
npm run node
```

2. Deploy the simulation contracts:
```bash
npm run deploy:sim
```

3. Start the arbitrage scanner in simulation mode:
```bash
npm run arb:scan:local
```

For more details, see [SIMULATION.md](SIMULATION.md).

### Forked Mainnet Testing

For testing against real mainnet contracts in a local environment:

1. Start a forked mainnet node:
```bash
npm run fork
```

2. Deploy your contract to the forked mainnet:
```bash
npm run deploy:fork
```

3. Run the arbitrage scanner against the forked mainnet:
```bash
npm run arb:scan:fork
```

For more details, see [FORK.md](FORK.md).

### Testnet Deployment

For testing on a public testnet with real transactions:

1. Deploy to Goerli testnet:
```bash
npm run deploy:goerli
```

2. Start the arbitrage scanner against Goerli:
```bash
npm run arb:scan
```

## Usage

The bot will:
- Monitor price differences between DEXs
- Log potential arbitrage opportunities
- Execute trades when profitable (if DRY_RUN=false)
- Record all activities in the logs directory

## Security Considerations

- **Private Keys**: Never share your private key or commit it to git
- **Test Mode**: Always start with DRY_RUN=true to test without executing trades
- **Small Amounts**: Start with small flash loan amounts for initial testing
- **Gas Costs**: Be aware of gas costs, which affect profitability

## Contract Architecture

- **FlashloanArb.sol**: Main contract for executing arbitrage
- **Interfaces**: Definitions for interacting with DEXs and lending protocols
- **Mock Contracts**: Used for testing and simulation

## Development

- Modify `scripts/arbitrage.ts` to adjust opportunity detection logic
- Edit contract parameters in `hardhat.config.ts`
- Add additional DEXs by extending the router interfaces

## License

MIT

## Disclaimer

This software is for educational purposes only. Use at your own risk. Always test thoroughly before deploying with real assets.
