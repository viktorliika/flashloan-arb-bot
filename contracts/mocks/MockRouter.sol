// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockRouter
 * @dev Mock DEX router for testing arbitrage opportunities
 */
contract MockRouter {
    string public dexName;
    
    // Mapping to store exchange rates between token pairs
    // tokenA address => tokenB address => exchange rate (1 tokenA = X tokenB)
    // Exchange rates are stored with 18 decimals (1.0 = 10^18)
    mapping(address => mapping(address => uint256)) private exchangeRates;
    
    constructor(string memory _dexName) {
        dexName = _dexName;
    }
    
    /**
     * @dev Set the exchange rate between two tokens
     * @param tokenA The address of tokenA
     * @param tokenB The address of tokenB
     * @param rate The exchange rate (1 tokenA = rate tokenB), with 18 decimals
     */
    function setExchangeRate(address tokenA, address tokenB, uint256 rate) external {
        exchangeRates[tokenA][tokenB] = rate;
        
        // If not explicitly set, use 1/rate for the reverse direction
        if (exchangeRates[tokenB][tokenA] == 0) {
            // Calculate reverse rate: 1/rate = 10^36 / rate
            uint256 reverseRate = (10**36) / rate;
            exchangeRates[tokenB][tokenA] = reverseRate;
        }
    }
    
    /**
     * @dev Get the exchange rate between two tokens
     * @param tokenA The address of tokenA
     * @param tokenB The address of tokenB
     * @return rate The exchange rate (1 tokenA = rate tokenB), with 18 decimals
     */
    function getExchangeRate(address tokenA, address tokenB) external view returns (uint256) {
        require(exchangeRates[tokenA][tokenB] > 0, "Exchange rate not set");
        return exchangeRates[tokenA][tokenB];
    }
    
    /**
     * @dev Swap tokens based on the preset exchange rates
     * @param amountIn The amount of input tokens
     * @param amountOutMin The minimum amount of output tokens
     * @param path Array of token addresses (path[0] = input token, path[path.length-1] = output token)
     * @param to The address to send the output tokens to
     * @param deadline The deadline timestamp for the transaction
     * @return amounts Array of amounts for each step in the path
     */
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory) {
        require(path.length >= 2, "Invalid path");
        require(deadline >= block.timestamp, "Expired deadline");
        
        uint256[] memory amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        
        // Calculate amounts out for each step in the path
        for (uint i = 0; i < path.length - 1; i++) {
            address tokenIn = path[i];
            address tokenOut = path[i + 1];
            
            require(exchangeRates[tokenIn][tokenOut] > 0, "Exchange rate not set");
            
            // Calculate output amount based on exchange rate
            // amountOut = amountIn * exchangeRate / 10^18
            uint256 amountOut = (amounts[i] * exchangeRates[tokenIn][tokenOut]) / (10**18);
            amounts[i + 1] = amountOut;
            
            // Transfer tokens
            IERC20(tokenIn).transferFrom(msg.sender, address(this), amounts[i]);
            IERC20(tokenOut).transfer(to, amountOut);
        }
        
        require(amounts[amounts.length - 1] >= amountOutMin, "Insufficient output amount");
        
        return amounts;
    }
    
    /**
     * @dev Calculate output amounts for a given input amount and path
     * @param amountIn The amount of input tokens
     * @param path Array of token addresses (path[0] = input token, path[path.length-1] = output token)
     * @return amounts Array of amounts for each step in the path
     */
    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory) {
        require(path.length >= 2, "Invalid path");
        
        uint256[] memory amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        
        // Calculate amounts out for each step in the path
        for (uint i = 0; i < path.length - 1; i++) {
            address tokenIn = path[i];
            address tokenOut = path[i + 1];
            
            require(exchangeRates[tokenIn][tokenOut] > 0, "Exchange rate not set");
            
            // Calculate output amount based on exchange rate
            // amountOut = amountIn * exchangeRate / 10^18
            amounts[i + 1] = (amounts[i] * exchangeRates[tokenIn][tokenOut]) / (10**18);
        }
        
        return amounts;
    }
    
    /**
     * @dev Mock implementation of factory() function
     */
    function factory() external view returns (address) {
        return address(this);
    }
    
    /**
     * @dev Mock implementation of WETH() function
     */
    function WETH() external pure returns (address) {
        return address(0);
    }
}
