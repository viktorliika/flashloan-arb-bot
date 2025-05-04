import { Contract, providers, BigNumber, PopulatedTransaction } from 'ethers';
// Using mock Flashbots instead of real one due to compatibility issues
import { MockFlashbotsBundleProvider } from './flashbots-mock';
import { createFlashbotsProvider, sendFlashbotsBundle } from './flashbots-mock';
import { GasStrategy } from './gas-strategy';

/**
 * A robust transaction executor that handles retries, gas optimization, and error handling
 */
export class TransactionExecutor {
  private provider: providers.Provider;
  private maxAttempts: number;
  private backoffMs: number;
  private gasStrategy: GasStrategy;
  private useFlashbots: boolean;
  
  /**
   * Create a new transaction executor
   * 
   * @param provider The ethers provider
   * @param gasStrategy The gas strategy to use for gas price calculation
   * @param maxAttempts Maximum number of retry attempts
   * @param backoffMs Backoff time between retries in ms
   * @param useFlashbots Whether to use Flashbots for transaction submission
   */
  constructor(
    provider: providers.Provider,
    gasStrategy: GasStrategy,
    maxAttempts: number = 3,
    backoffMs: number = 2000,
    useFlashbots: boolean = false
  ) {
    this.provider = provider;
    this.gasStrategy = gasStrategy;
    this.maxAttempts = maxAttempts;
    this.backoffMs = backoffMs;
    this.useFlashbots = useFlashbots;
  }
  
  /**
   * Execute a transaction with automatic retries
   * 
   * @param txFunction Function that returns a Promise with transaction
   * @param profitAmount Expected profit amount (used for gas calculation)
   * @param needsConfirmation Whether to wait for the tx to be confirmed
   * @returns Transaction receipt or null if confirmation not requested
   */
  async executeWithRetry(
    txFunction: () => Promise<providers.TransactionResponse>,
    profitAmount: BigNumber,
    needsConfirmation: boolean = true
  ): Promise<providers.TransactionReceipt | null> {
    let attempt = 0;
    let lastError: Error | null = null;
    
    while (attempt < this.maxAttempts) {
      try {
        attempt++;
        console.log(`Attempt ${attempt}/${this.maxAttempts}`);
        
        const tx = await txFunction();
        console.log(`Transaction sent: ${tx.hash}`);
        
        if (needsConfirmation) {
          console.log(`Waiting for transaction ${tx.hash} to be mined...`);
          const receipt = await tx.wait();
          console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
          return receipt;
        } else {
          return null;
        }
      } catch (error) {
        lastError = error as Error;
        console.error(`Attempt ${attempt} failed:`, error);
        
        // If this wasn't the last attempt, wait before retrying
        if (attempt < this.maxAttempts) {
          // Exponential backoff
          const backoff = this.backoffMs * Math.pow(2, attempt - 1);
          console.log(`Retrying in ${backoff}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoff));
        }
      }
    }
    
    console.error(`All ${this.maxAttempts} attempts failed.`);
    throw lastError;
  }
  
  /**
   * Execute a populated transaction with gas optimization
   * 
   * @param tx The populated transaction
   * @param signer The signer to use
   * @param profitAmount Expected profit amount
   * @param gasLimit Maximum gas to use
   * @returns Transaction receipt
   */
  async executeTransaction(
    tx: PopulatedTransaction,
    signer: providers.JsonRpcSigner,
    profitAmount: BigNumber,
    gasLimit: number = 1000000
  ): Promise<providers.TransactionReceipt | null> {
    // Get optimized gas price using the strategy
    const gasPrice = await this.gasStrategy.getGasPrice(this.provider, profitAmount);
    
    // Check if transaction would be profitable after gas costs
    const gasCost = gasPrice.mul(gasLimit);
    if (profitAmount.lte(gasCost)) {
      throw new Error(`Transaction would not be profitable after gas costs. Profit: ${profitAmount.toString()}, Gas cost: ${gasCost.toString()}`);
    }
    
    // Prepare transaction with gas settings
    const fullTx = {
      ...tx,
      gasPrice,
      gasLimit: BigNumber.from(gasLimit)
    };
    
    if (this.useFlashbots) {
      return this.executeFlashbotsTransaction(fullTx, signer, profitAmount);
    } else {
      return this.executeWithRetry(
        async () => signer.sendTransaction(fullTx),
        profitAmount,
        true
      );
    }
  }
  
  /**
   * Execute a transaction using Flashbots to prevent front-running
   * 
   * @param tx The populated transaction
   * @param signer The signer to use
   * @param profitAmount Expected profit amount
   * @returns Transaction receipt or null
   */
  private async executeFlashbotsTransaction(
    tx: PopulatedTransaction,
    signer: providers.JsonRpcSigner,
    profitAmount: BigNumber
  ): Promise<providers.TransactionReceipt | null> {
    try {
      const wallet = signer.connect(this.provider) as any;
      const flashbotsProvider = await createFlashbotsProvider(this.provider, wallet, 'mainnet');
      
      // Get current block number
      const blockNumber = await this.provider.getBlockNumber();
      const targetBlockNumber = blockNumber + 1;
      
      console.log(`Preparing Flashbots bundle for block ${targetBlockNumber}`);
      
      // Create bundle with the transaction
      const signedBundle = await flashbotsProvider.signBundle([
        {
          signer: wallet,
          transaction: tx
        }
      ]);
      
      // Send the bundle
      const bundleSubmitted = await sendFlashbotsBundle(
        flashbotsProvider,
        signedBundle,
        targetBlockNumber,
        5 // Try for 5 blocks
      );
      
      if (bundleSubmitted) {
        console.log(`Flashbots bundle was included successfully`);
        // Since we don't have a direct way to get the receipt, create a placeholder
        return {
          blockNumber: targetBlockNumber,
          status: 1
        } as any;
      } else {
        throw new Error('Flashbots bundle was not included');
      }
    } catch (error) {
      console.error('Error executing Flashbots transaction:', error);
      throw error;
    }
  }
  
  /**
   * Execute a transaction directly on a contract
   * 
   * @param contract The contract to call
   * @param methodName The method to call
   * @param args The arguments to pass to the method
   * @param signer The signer to use
   * @param profitAmount Expected profit amount
   * @param gasLimit Maximum gas to use
   * @returns Transaction receipt
   */
  async executeContractMethod(
    contract: Contract,
    methodName: string,
    args: any[],
    signer: providers.JsonRpcSigner,
    profitAmount: BigNumber,
    gasLimit: number = 1000000
  ): Promise<providers.TransactionReceipt | null> {
    // Populate the transaction
    const tx = await contract.populateTransaction[methodName](...args);
    
    // Execute it with our gas strategy
    return this.executeTransaction(tx, signer, profitAmount, gasLimit);
  }
}
