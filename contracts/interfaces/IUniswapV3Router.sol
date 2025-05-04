// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IUniswapV3Router
 * @dev Interface for Uniswap V3 Router (simplified for our arbitrage needs)
 */
interface IUniswapV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    /**
     * @notice Swaps amountIn of one token for as much as possible of another token
     * @param params The parameters necessary for the swap, encoded as ExactInputSingleParams
     * @return amountOut The amount of the received token
     */
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);

    /**
     * @notice Swaps amountIn of one token for as much as possible of another along the specified path
     * @param params The parameters necessary for the multi-hop swap, encoded as ExactInputParams
     * @return amountOut The amount of the received token
     */
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}
