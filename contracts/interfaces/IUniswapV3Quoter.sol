// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IUniswapV3Quoter
 * @dev Interface for Uniswap V3 Quoter contract (simplified for simulation)
 */
interface IUniswapV3Quoter {
    /**
     * @notice Returns the amount out received for a given exact input swap without executing the swap
     * @param tokenIn The token being swapped in
     * @param tokenOut The token being swapped out
     * @param fee The fee tier of the pool
     * @param amountIn The amount of tokenIn to swap
     * @param sqrtPriceLimitX96 The price limit of the pool that cannot be exceeded by the swap
     * @return amountOut The amount of tokenOut received
     */
    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96
    ) external returns (uint256 amountOut);

    /**
     * @notice Returns the amount out received for a given exact input but for a swap path
     * @param path The path of the swap, i.e. each token pair and the pool fee
     * @param amountIn The amount of the first token to swap
     * @return amountOut The amount of the last token received
     */
    function quoteExactInput(
        bytes memory path,
        uint256 amountIn
    ) external returns (uint256 amountOut);
}
