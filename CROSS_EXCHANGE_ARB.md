# Cross-Exchange Arbitrage System

This module extends the FlashloanArb project to include cross-exchange arbitrage capabilities, allowing the bot to identify and potentially execute price differences between different cryptocurrency exchanges.

## Architecture

The cross-exchange arbitrage system consists of several modular components:

1. **Exchange Connector** - Core management class for connecting to multiple exchanges
2. **Exchange Adapters** - Exchange-specific implementations for API interactions
3. **WebSocket Client** - Reliable WebSocket connection with auto-reconnection
4. **Scanner** - Identifies price differences across exchanges in real-time
5. **Configuration System** - Centralized configuration for all components

## Features

- **Multi-Exchange Support**: Easily extensible to support any exchange with an API
- **Real-Time Price Monitoring**: Uses WebSocket connections for instant price updates
- **Configurable Trading Pairs**: Monitor any trading pairs supported by the connected exchanges
- **Customizable Profit Thresholds**: Set minimum spread percentages for each trading pair
- **Automatic Reconnection**: Handles WebSocket disconnections gracefully
- **Comprehensive Logging**: Records all opportunities in log files and CSV format for later analysis
- **Graceful Shutdown**: Properly closes connections on termination

## Implementation Details

### Exchange Connectors and Adapters

The system uses an adapter pattern to standardize interactions with different exchange APIs:

- `ExchangeConnector`: Manages multiple exchange connections and provides a unified interface
- `ExchangeAdapter`: Abstract base class defining the interface for exchange-specific adapters
- `BinanceAdapter`: Binance-specific implementation (additional adapters can be added)

### Reliable WebSocket Client

The WebSocket client includes sophisticated error handling and reconnection logic:

- Automatic reconnection with exponential backoff
- Ping/pong health checking
- Subscription restoration after reconnection
- Connection timeout detection

### Scanner Logic

The arbitrage scanner:

1. Fetches prices for configured trading pairs from all connected exchanges
2. Identifies the highest and lowest prices across exchanges
3. Calculates the percentage spread between them
4. If the spread exceeds the configured threshold, records the opportunity
5. Provides estimated profit calculations in USD

## Usage

### Configuration

Configure the pairs to monitor in the `PAIRS_TO_MONITOR` constant:

```typescript
const PAIRS_TO_MONITOR = [
  { base: 'BTC', quote: 'USDT', symbol: 'BTCUSDT', minSpreadPercent: 0.5 },
  { base: 'ETH', quote: 'USDT', symbol: 'ETHUSDT', minSpreadPercent: 0.5 },
  // Add more pairs as needed
];
```

### Running the Scanner

```bash
npx hardhat run scripts/cross-exchange-arbitrage.ts
```

### Output

The scanner produces two types of output:

1. Console and log file output with detailed information
2. CSV records for all detected opportunities in `cross_exchange_arb_log.csv`

Example log output:
```
2025-05-04T14:07:33.963Z [info]: Scanning for cross-exchange arbitrage opportunities...
2025-05-04T14:07:34.127Z [info]: BTCUSDT prices: Binance: 45123.45, Coinbase: 45178.90
2025-05-04T14:07:34.128Z [info]: Arbitrage opportunity detected for BTCUSDT:
2025-05-04T14:07:34.128Z [info]:   Buy on Binance at 45123.45
2025-05-04T14:07:34.128Z [info]:   Sell on Coinbase at 45178.90
2025-05-04T14:07:34.128Z [info]:   Spread: 0.55%
2025-05-04T14:07:34.128Z [info]:   Estimated profit per unit: $55.45
```

## Integration with FlashloanArb Project

The cross-exchange arbitrage system complements the on-chain arbitrage capabilities:

1. **Price Discovery**: Uses external exchange data as reference points for on-chain prices
2. **Opportunity Validation**: Cross-references on-chain prices with external exchanges
3. **Risk Management**: Provides additional price information for more accurate slippage estimates

## Future Enhancements

- Create exchange-specific adapters for major platforms (Coinbase, Kraken, etc.)
- Implement execution capabilities for cross-exchange trades
- Add order book depth analysis for more accurate profit calculations
- Integrate with on-chain DEX price data for comprehensive arbitrage opportunities
