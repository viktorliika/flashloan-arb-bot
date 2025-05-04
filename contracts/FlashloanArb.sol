// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ILendingPool.sol";
import "./interfaces/IUniswapRouter.sol";
import "./interfaces/IUniswapV3Router.sol";
import "./interfaces/IFlashLoanReceiver.sol";

/**
 * @title FlashloanArb
 * @dev Contract that performs arbitrage using flash loans from Aave
 */
contract FlashloanArb is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ================ Interface References ================

    // Interfaces defined outside the contract

    // ================ State Variables ================

    // Aave Lending Pool contract
    ILendingPool public lendingPool;
    
    // DEX router addresses
    address public dexARouter;
    address public dexBRouter;
    
    // Router types (0 = V2, 1 = V3)
    uint8 public dexAType;
    uint8 public dexBType;

    // Flag to prevent unauthorized flash loan callbacks
    bool private _flashLoanInProgress;

    // Minimum expected profit (in token decimals)
    uint256 public minProfitAmount;
    
    // V3 default fee level
    uint24 public constant DEFAULT_V3_FEE = 3000; // 0.3%
    
    // Slippage tolerance in basis points (100 = 1%)
    uint256 public slippageTolerance = 300; // 3% default

    // ================ Events ================

    event ArbitrageExecuted(
        address indexed tokenBorrowed,
        uint256 amountBorrowed,
        address indexed profitToken,
        uint256 profit,
        uint256 timestamp
    );

    event ProfitWithdrawn(
        address indexed token,
        address indexed to,
        uint256 amount,
        uint256 timestamp
    );

    event MinProfitAmountUpdated(
        uint256 oldAmount,
        uint256 newAmount
    );

    event NewDexRouterSet(
        string dex,
        address oldRouter,
        address newRouter,
        uint8 routerType
    );

    // ================ Constructor ================

    constructor(
        address _lendingPoolAddress,
        address _dexARouter,
        address _dexBRouter,
        uint256 _minProfitAmount
    ) Ownable(msg.sender) {
        lendingPool = ILendingPool(_lendingPoolAddress);
        dexARouter = _dexARouter;
        dexBRouter = _dexBRouter;
        minProfitAmount = _minProfitAmount;
        
        // Default to V2 routers
        dexAType = 0;
        dexBType = 0;
    }

    // ================ External Functions ================

    /**
     * @dev Execute an arbitrage opportunity using a flash loan
     * @param loanAsset The token to borrow in the flash loan
     * @param loanAmount The amount to borrow
     * @param pairs Array of [tokenFrom, tokenTo] pairs for the trade path
     * @param dexForTrade Array of dex identifiers (0 for DEX A, 1 for DEX B)
     */
    function executeArbitrage(
        address loanAsset,
        uint256 loanAmount,
        address[2][] calldata pairs,
        uint8[] calldata dexForTrade
    ) external onlyOwner nonReentrant {
        require(loanAmount > 0, "Loan amount must be greater than 0");
        require(pairs.length > 0, "Trade pairs must be provided");
        require(dexForTrade.length == pairs.length, "DEX indicators must match pairs length");

        // Create assets array for flash loan (single asset)
        address[] memory assets = new address[](1);
        assets[0] = loanAsset;

        // Create amounts array for flash loan (single amount)
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = loanAmount;

        // Create modes array for flash loan (0 = no debt, just flash loan)
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0;

        // Encode pairs and dexForTrade as params for the callback
        bytes memory params = abi.encode(pairs, dexForTrade);

        // Execute flash loan
        _flashLoanInProgress = true;
        lendingPool.flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            params,
            0 // referral code
        );
        _flashLoanInProgress = false;
    }

    /**
     * @dev Withdraw tokens from the contract
     * @param token The token to withdraw
     * @param to The address to send tokens to
     * @param amount The amount to withdraw (0 for all)
     */
    function withdrawTokens(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner nonReentrant {
        require(to != address(0), "Cannot withdraw to zero address");
        
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 withdrawAmount = (amount == 0) ? balance : amount;
        
        require(withdrawAmount <= balance, "Insufficient token balance");
        require(withdrawAmount > 0, "Amount must be greater than 0");
        
        IERC20(token).transfer(to, withdrawAmount);
        
        emit ProfitWithdrawn(token, to, withdrawAmount, block.timestamp);
    }

    /**
     * @dev Update minimum profit amount
     * @param _newMinProfitAmount New minimum profit amount
     */
    function setMinProfitAmount(uint256 _newMinProfitAmount) external onlyOwner {
        emit MinProfitAmountUpdated(minProfitAmount, _newMinProfitAmount);
        minProfitAmount = _newMinProfitAmount;
    }
    
    /**
     * @dev Update slippage tolerance
     * @param _newSlippageTolerance New slippage tolerance in basis points (100 = 1%)
     */
    function setSlippageTolerance(uint256 _newSlippageTolerance) external onlyOwner {
        require(_newSlippageTolerance <= 5000, "Slippage tolerance too high"); // Max 50%
        slippageTolerance = _newSlippageTolerance;
    }

    /**
     * @dev Update DEX router addresses and type
     * @param dex Identifier ("A" or "B")
     * @param newRouter New router address
     * @param routerType Router type (0 = V2, 1 = V3)
     */
    function setDexRouter(string calldata dex, address newRouter, uint8 routerType) external onlyOwner {
        require(newRouter != address(0), "Router cannot be zero address");
        require(routerType <= 1, "Invalid router type");
        
        if (keccak256(abi.encodePacked(dex)) == keccak256(abi.encodePacked("A"))) {
            emit NewDexRouterSet("A", dexARouter, newRouter, routerType);
            dexARouter = newRouter;
            dexAType = routerType;
        } else if (keccak256(abi.encodePacked(dex)) == keccak256(abi.encodePacked("B"))) {
            emit NewDexRouterSet("B", dexBRouter, newRouter, routerType);
            dexBRouter = newRouter;
            dexBType = routerType;
        } else {
            revert("Invalid DEX identifier");
        }
    }

    // ================ Flash Loan Callback ================

    /**
     * @dev This function is called by the lending pool after we receive the flash loan
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        // Security check to prevent unauthorized calls
        require(_flashLoanInProgress, "Unauthorized callback");
        require(initiator == address(this), "Unauthorized initiator");
        
        // Decode parameters
        (address[2][] memory pairs, uint8[] memory dexForTrade) = abi.decode(
            params,
            (address[2][], uint8[])
        );

        // Borrowed asset and amount
        address borrowedAsset = assets[0];
        uint256 borrowedAmount = amounts[0];
        
        // Amount to repay (borrowed + premium)
        uint256 repayAmount = amounts[0] + premiums[0];
        
        // Execute trades
        executeArbitrageTrades(borrowedAsset, borrowedAmount, pairs, dexForTrade);
        
        // Calculate profit
        uint256 finalBalance = IERC20(borrowedAsset).balanceOf(address(this));
        uint256 profit = finalBalance > repayAmount ? finalBalance - repayAmount : 0;
        
        // Ensure we have enough profit
        require(profit >= minProfitAmount, "Insufficient profit");

        // Approve flash loan repayment
        IERC20(borrowedAsset).approve(address(lendingPool), repayAmount);
        
        // Emit event
        emit ArbitrageExecuted(
            borrowedAsset,
            borrowedAmount,
            borrowedAsset,
            profit,
            block.timestamp
        );
        
        return true;
    }

    // ================ Internal Functions ================

    /**
     * @dev Execute trades as per the arbitrage path
     */
    function executeArbitrageTrades(
        address startAsset,
        uint256 startAmount,
        address[2][] memory pairs,
        uint8[] memory dexForTrade
    ) internal {
        require(pairs.length > 0, "No trade pairs provided");
        
        // Current asset and amount being traded
        address currentAsset = startAsset;
        uint256 currentAmount = startAmount;
        
        // Execute each trade in sequence
        for (uint i = 0; i < pairs.length; i++) {
            address tokenFrom = pairs[i][0];
            address tokenTo = pairs[i][1];
            
            // Ensure we're trading the correct asset
            require(tokenFrom == currentAsset, "Invalid trade sequence");
            
            // Select the DEX for this trade
            uint8 dexIndex = dexForTrade[i];
            address router = dexIndex == 0 ? dexARouter : dexBRouter;
            uint8 routerType = dexIndex == 0 ? dexAType : dexBType;
            
            // Approve router to spend tokens
            IERC20(tokenFrom).approve(router, currentAmount);
            
            // Execute swap based on router type
            if (routerType == 0) {
                // V2 router swap
                currentAmount = executeV2Swap(router, tokenFrom, tokenTo, currentAmount);
            } else {
                // V3 router swap
                currentAmount = executeV3Swap(router, tokenFrom, tokenTo, currentAmount);
            }
            
            // Update current asset for next trade
            currentAsset = tokenTo;
        }
        
        // Ensure we ended up with the start asset
        require(currentAsset == startAsset, "Arbitrage must end with initial asset");
    }
    
    /**
     * @dev Execute swap using Uniswap V2 style router
     */
    function executeV2Swap(
        address router,
        address tokenFrom,
        address tokenTo,
        uint256 amountIn
    ) internal returns (uint256) {
        // Create path for swap
        address[] memory path = new address[](2);
        path[0] = tokenFrom;
        path[1] = tokenTo;
        
        // Get expected output amount
        uint[] memory amountsOut = IUniswapRouter(router).getAmountsOut(amountIn, path);
        uint256 expectedOutput = amountsOut[1];
        
        // Calculate minimum output with slippage protection
        uint256 minOutput = expectedOutput * (10000 - slippageTolerance) / 10000;
        
        // Execute swap with slippage protection
        uint[] memory amounts = IUniswapRouter(router).swapExactTokensForTokens(
            amountIn,
            minOutput,
            path,
            address(this),
            block.timestamp + 15 minutes
        );
        
        return amounts[amounts.length - 1];
    }
    
    /**
     * @dev Execute swap using Uniswap V3 style router
     */
    function executeV3Swap(
        address router,
        address tokenFrom,
        address tokenTo,
        uint256 amountIn
    ) internal returns (uint256) {
        // Get quote from V3 - this would require calling the Quoter contract in a real implementation
        // Here we'll simulate by checking token balances before and after
        uint256 balanceBefore = IERC20(tokenTo).balanceOf(address(this));
        
        // Estimate output based on input (in a real implementation, use the Quoter contract)
        uint256 estimatedOutput = estimateV3Output(router, tokenFrom, tokenTo, amountIn);
        
        // Calculate minimum output with slippage protection
        uint256 minOutput = estimatedOutput * (10000 - slippageTolerance) / 10000;
        
        // Create params for V3 swap with slippage protection
        IUniswapV3Router.ExactInputSingleParams memory params = IUniswapV3Router.ExactInputSingleParams({
            tokenIn: tokenFrom,
            tokenOut: tokenTo,
            fee: DEFAULT_V3_FEE,
            recipient: address(this),
            deadline: block.timestamp + 15 minutes,
            amountIn: amountIn,
            amountOutMinimum: minOutput, // Apply slippage protection
            sqrtPriceLimitX96: 0 // No price limit
        });
        
        // Execute swap
        return IUniswapV3Router(router).exactInputSingle(params);
    }
    
    /**
     * @dev Estimate output for Uniswap V3 swap
     * @notice In a real implementation, this would call the Quoter contract
     */
    function estimateV3Output(
        address router,
        address tokenFrom,
        address tokenTo,
        uint256 amountIn
    ) internal view returns (uint256) {
        // This is a simplified estimation. In reality, you would:
        // 1. Call the Uniswap V3 Quoter contract to get an accurate quote
        // 2. Use historical data if quoter is not available
        
        // For simplicity in this implementation, we'll assume 
        // V3 gives slightly better rates than V2 (1.005x)
        // In a real implementation, this should call the Quoter
        
        // Create path for V2 quote as fallback
        address[] memory path = new address[](2);
        path[0] = tokenFrom;
        path[1] = tokenTo;
        
        try IUniswapRouter(dexARouter).getAmountsOut(amountIn, path) returns (uint[] memory amountsOut) {
            // Apply a 0.5% improvement as V3 is typically more efficient
            return amountsOut[1] * 1005 / 1000;
        } catch {
            // If that fails, provide a conservative estimate
            return amountIn / 2; // Very conservative fallback
        }
    }
}
