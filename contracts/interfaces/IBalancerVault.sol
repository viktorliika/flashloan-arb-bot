// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IBalancerVault
 * @dev Interface for interacting with Balancer V2 Vault
 */
interface IBalancerVault {
    /**
     * @dev Information for a single swap
     */
    struct SingleSwap {
        bytes32 poolId;
        uint8 kind;
        address assetIn;
        address assetOut;
        uint256 amount;
        bytes userData;
    }
    
    /**
     * @dev Fund management options for performing swaps
     */
    struct FundManagement {
        address sender;
        bool fromInternalBalance;
        address payable recipient;
        bool toInternalBalance;
    }
    
    /**
     * @dev Perform a swap with a specific pool
     * @param singleSwap Swap information
     * @param funds Fund management options
     * @param limit Price limit
     * @param deadline Deadline timestamp
     * @return amountOut Amount of tokens received
     */
    function swap(
        SingleSwap memory singleSwap,
        FundManagement memory funds,
        uint256 limit,
        uint256 deadline
    ) external payable returns (uint256 amountOut);
    
    /**
     * @dev Query the Vault for swap information
     * @param kind Swap kind (0: given in, 1: given out)
     * @param swaps Array of swap steps
     * @param assets Array of assets involved in the swap
     * @param funds Fund management options
     * @return assetDeltas Array of asset deltas
     */
    function queryBatchSwap(
        uint8 kind,
        SingleSwap[] memory swaps,
        address[] memory assets,
        FundManagement memory funds
    ) external returns (int256[] memory assetDeltas);
    
    /**
     * @dev Returns the pool ID for a given pool address
     * @param pool Pool address
     * @return poolId Pool ID
     */
    function getPool(address pool) external view returns (bytes32 poolId);
    
    /**
     * @dev Returns a pool's registered tokens
     * @param poolId Pool ID
     * @return tokens Array of token addresses
     * @return balances Array of token balances
     * @return lastChangeBlock Block when balances last changed
     */
    function getPoolTokens(bytes32 poolId) external view returns (
        address[] memory tokens,
        uint256[] memory balances,
        uint256 lastChangeBlock
    );
}

/**
 * @title IBalancerPool
 * @dev Interface for Balancer V2 Pool
 */
interface IBalancerPool {
    /**
     * @dev Returns the effective BPT supply (total supply minus permanently locked BPT)
     * @return supply The actual supply
     */
    function getActualSupply() external view returns (uint256 supply);
    
    /**
     * @dev Returns the amount of tokens required to join the pool
     * @param tokensIn Array of token addresses to join with
     * @param amountsIn Array of token amounts to join with
     * @param userData ABI encoded user data
     * @return bptOut Amount of BPT tokens minted
     * @return amountsInRequired Amounts required for each token
     */
    function queryJoin(
        address[] memory tokensIn,
        uint256[] memory amountsIn,
        bytes memory userData
    ) external view returns (uint256 bptOut, uint256[] memory amountsInRequired);
    
    /**
     * @dev Returns the amount of tokens received when exiting the pool
     * @param tokensOut Array of token addresses to receive
     * @param amountsOut Array of token amounts to receive
     * @param userData ABI encoded user data
     * @return bptIn Amount of BPT required to exit
     * @return amountsOutReceived Amounts of tokens received when exiting
     */
    function queryExit(
        address[] memory tokensOut,
        uint256[] memory amountsOut,
        bytes memory userData
    ) external view returns (uint256 bptIn, uint256[] memory amountsOutReceived);
    
    /**
     * @dev Returns the pool's ID
     * @return poolId The pool's ID
     */
    function getPoolId() external view returns (bytes32 poolId);
    
    /**
     * @dev Returns the pool's swap fee
     * @return fee The swap fee percentage
     */
    function getSwapFeePercentage() external view returns (uint256 fee);
}
