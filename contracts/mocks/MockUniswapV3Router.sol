// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IUniswapV3Router.sol";

/**
 * @title MockUniswapV3Router
 * @dev Simplified mock of Uniswap V3 Router for simulation purposes
 */
contract MockUniswapV3Router is IUniswapV3Router {
    string public name;
    
    // Mapping of exchange rates between token pairs with different fee tiers
    // tokenA address => tokenB address => fee tier => exchange rate (1 tokenA = X tokenB)
    // Exchange rates are stored with 18 decimals (1.0 = 10^18)
    mapping(address => mapping(address => mapping(uint24 => uint256))) private exchangeRates;
    
    // Common fee tiers in Uniswap V3
    uint24 public constant FEE_0_05 = 500;    // 0.05%
    uint24 public constant FEE_0_3 = 3000;    // 0.3%
    uint24 public constant FEE_1 = 10000;     // 1%
    
    constructor(string memory _name) {
        name = _name;
    }
    
    /**
     * @dev Set the exchange rate between two tokens for a specific fee tier
     * @param tokenA The address of tokenA
     * @param tokenB The address of tokenB
     * @param fee The fee tier
     * @param rate The exchange rate (1 tokenA = rate tokenB), with 18 decimals
     */
    function setExchangeRate(address tokenA, address tokenB, uint24 fee, uint256 rate) external {
        exchangeRates[tokenA][tokenB][fee] = rate;
        
        // If not explicitly set, use a calculated inverse rate for the reverse direction
        if (exchangeRates[tokenB][tokenA][fee] == 0) {
            // Calculate reverse rate: 1/rate = 10^36 / rate
            uint256 reverseRate = (10**36) / rate;
            exchangeRates[tokenB][tokenA][fee] = reverseRate;
        }
    }
    
    /**
     * @dev Get the exchange rate between two tokens for a specific fee tier
     * @param tokenA The address of tokenA
     * @param tokenB The address of tokenB
     * @param fee The fee tier
     * @return rate The exchange rate
     */
    function getExchangeRate(address tokenA, address tokenB, uint24 fee) external view returns (uint256) {
        require(exchangeRates[tokenA][tokenB][fee] > 0, "Exchange rate not set");
        return exchangeRates[tokenA][tokenB][fee];
    }
    
    /**
     * @dev Get quote for a swap (without executing swap)
     * @param tokenIn Input token
     * @param tokenOut Output token
     * @param fee Fee tier
     * @param amountIn Amount of input token
     * @return amountOut Expected output amount
     */
    function getQuote(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn) 
        public view returns (uint256) 
    {
        require(exchangeRates[tokenIn][tokenOut][fee] > 0, "Exchange rate not set");
        
        // Calculate output amount based on exchange rate
        // amountOut = amountIn * exchangeRate / 10^18
        uint256 amountOut = (amountIn * exchangeRates[tokenIn][tokenOut][fee]) / (10**18);
        
        // Apply fee
        uint256 feeAmount = (amountOut * fee) / 1000000;
        return amountOut - feeAmount;
    }
    
    /**
     * @notice Swaps amountIn of one token for as much as possible of another token
     * @param params The parameters necessary for the swap
     * @return amountOut The amount of the received token
     */
    function exactInputSingle(ExactInputSingleParams calldata params) external payable 
        returns (uint256 amountOut) 
    {
        require(params.deadline >= block.timestamp, "Transaction expired");
        require(exchangeRates[params.tokenIn][params.tokenOut][params.fee] > 0, "Pool does not exist");
        
        // Calculate output amount
        amountOut = getQuote(params.tokenIn, params.tokenOut, params.fee, params.amountIn);
        require(amountOut >= params.amountOutMinimum, "Insufficient output amount");
        
        // Transfer tokens
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenOut).transfer(params.recipient, amountOut);
        
        return amountOut;
    }
    
    /**
     * @notice Swaps amountIn of one token for as much as possible of another along the specified path
     * @param params The parameters necessary for the multi-hop swap
     * @return amountOut The amount of the received token
     */
    function exactInput(ExactInputParams calldata params) external payable 
        returns (uint256 amountOut) 
    {
        require(params.deadline >= block.timestamp, "Transaction expired");
        
        // For simplicity in the mock, we'll just support a single hop
        // In real Uniswap V3, this would handle a multi-hop path
        
        // Decode the path - in real Uniswap V3, this is encoded with the fee
        // For our mock, we'll simplify and assume a fixed format: tokenIn (20 bytes) + fee (3 bytes) + tokenOut (20 bytes)
        require(params.path.length >= 43, "Invalid path");
        
        // Extract path components using a simplified approach
        // In real implementation, this would use proper bit manipulation
        address tokenIn;
        address tokenOut;
        uint24 fee;
        
        // Simple manual decoding - actual Uniswap V3 would use more sophisticated approach
        bytes memory path = params.path;
        assembly {
            tokenIn := mload(add(path, 20))
            // Adjust addresses to proper format
            tokenIn := shr(96, tokenIn)
            // Extract 3 bytes for fee at offset 20
            fee := mload(add(path, 23))
            fee := and(shr(232, fee), 0xffffff)
            // Extract token out address
            tokenOut := mload(add(path, 43))
            tokenOut := shr(96, tokenOut)
        }
        
        // Calculate output amount
        amountOut = getQuote(tokenIn, tokenOut, fee, params.amountIn);
        require(amountOut >= params.amountOutMinimum, "Insufficient output amount");
        
        // Transfer tokens
        IERC20(tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        IERC20(tokenOut).transfer(params.recipient, amountOut);
        
        return amountOut;
    }
    
    /**
     * @dev Helper function to create a path for a V3 swap
     * @param tokenIn Input token
     * @param fee Fee tier
     * @param tokenOut Output token
     * @return path Encoded path bytes
     */
    function encodePath(address tokenIn, uint24 fee, address tokenOut) external pure returns (bytes memory) {
        bytes memory path = new bytes(43);
        
        // Manual path encoding - simplified version
        assembly {
            // Store tokenIn at start of path
            mstore(add(path, 32), shl(96, tokenIn))
            // Store fee in the middle (3 bytes)
            mstore(add(path, 52), shl(232, fee))
            // Store tokenOut at the end
            mstore(add(path, 55), shl(96, tokenOut))
        }
        
        return path;
    }
}
