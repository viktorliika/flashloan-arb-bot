// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ILendingPool.sol";
import "./interfaces/IUniswapRouter.sol";
import "./interfaces/IUniswapV3Router.sol";
import "./interfaces/IUniswapV3Quoter.sol";
import "./interfaces/IFlashLoanReceiver.sol";

/**
 * @title FlashloanArbV2
 * @dev Enhanced contract that performs arbitrage using flash loans with support for
 * multi-hop paths, advanced V3 functionality, and triangle arbitrage
 */
contract FlashloanArbV2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ================ Constants ================

    // Uniswap V3 fee tiers
    uint24 public constant FEE_LOWEST = 100;    // 0.01%
    uint24 public constant FEE_LOW = 500;       // 0.05%
    uint24 public constant FEE_MEDIUM = 3000;   // 0.3%
    uint24 public constant FEE_HIGH = 10000;    // 1%

    // DEX type enum
    uint8 public constant DEX_TYPE_V2 = 0;
    uint8 public constant DEX_TYPE_V3 = 1;
    // Future: uint8 public constant DEX_TYPE_CURVE = 2;

    // ================ Structs ================

    // V3 path hop structure
    struct V3PathHop {
        address tokenIn;
        address tokenOut;
        uint24 fee;
    }

    // ================ State Variables ================

    // Aave Lending Pool contract
    ILendingPool public lendingPool;
    
    // DEX router addresses
    address public dexARouter;
    address public dexBRouter;
    
    // DEX quoter addresses (for V3)
    address public dexAQuoter;
    address public dexBQuoter;
    
    // Router types (0 = V2, 1 = V3)
    uint8 public dexAType;
    uint8 public dexBType;

    // Flag to prevent unauthorized flash loan callbacks
    bool private _flashLoanInProgress;

    // Minimum expected profit (in token decimals)
    uint256 public minProfitAmount;
    
    // Default V3 fee level if not specified
    uint24 public defaultV3Fee = FEE_MEDIUM; // 0.3%
    
    // Optimal fee tiers for common pairs (tokenA => tokenB => fee)
    mapping(address => mapping(address => uint24)) public optimalFeeTiers;

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
    
    event NewDexQuoterSet(
        string dex,
        address oldQuoter,
        address newQuoter
    );
    
    event OptimalFeeTierSet(
        address indexed tokenA,
        address indexed tokenB,
        uint24 fee
    );
    
    event DefaultV3FeeUpdated(
        uint24 oldFee,
        uint24 newFee
    );

    // ================ Constructor ================

    constructor(
        address _lendingPoolAddress,
        address _dexARouter,
        address _dexBRouter,
        address _dexAQuoter,
        address _dexBQuoter,
        uint256 _minProfitAmount
    ) Ownable(msg.sender) {
        lendingPool = ILendingPool(_lendingPoolAddress);
        dexARouter = _dexARouter;
        dexBRouter = _dexBRouter;
        dexAQuoter = _dexAQuoter;
        dexBQuoter = _dexBQuoter;
        minProfitAmount = _minProfitAmount;
        
        // Default to V2 routers
        dexAType = DEX_TYPE_V2;
        dexBType = DEX_TYPE_V2;
    }

    // ================ External Functions ================

    /**
     * @dev Execute an arbitrage opportunity using a flash loan with enhanced V3 support
     * @param loanAsset The token to borrow in the flash loan
     * @param loanAmount The amount to borrow
     * @param path Array of token addresses in the trade path (must start and end with the same token)
     * @param dexForTrade Array of dex identifiers (0 for DEX A, 1 for DEX B)
     * @param feeTiers Optional fee tiers for V3 swaps (0 for default or V2)
     */
    function executeArbitrage(
        address loanAsset,
        uint256 loanAmount,
        address[] calldata path,
        uint8[] calldata dexForTrade,
        uint24[] calldata feeTiers
    ) external onlyOwner nonReentrant {
        require(loanAmount > 0, "Loan amount must be greater than 0");
        require(path.length >= 2, "Trade path must have at least 2 tokens");
        require(path[0] == path[path.length - 1], "Path must start and end with same token");
        require(dexForTrade.length == path.length - 1, "DEX indicators must match path segments");
        
        // Fee tiers are optional - if provided, must match path segments
        if (feeTiers.length > 0) {
            require(feeTiers.length == path.length - 1, "Fee tiers must match path segments");
        }

        // Create assets array for flash loan (single asset)
        address[] memory assets = new address[](1);
        assets[0] = loanAsset;

        // Create amounts array for flash loan (single amount)
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = loanAmount;

        // Create modes array for flash loan (0 = no debt, just flash loan)
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0;

        // Encode path, dexForTrade, and feeTiers as params for the callback
        bytes memory params = abi.encode(path, dexForTrade, feeTiers);

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
     * @dev Executes a triangle arbitrage opportunity with advanced path configuration
     * @param loanAsset The token to borrow in the flash loan
     * @param loanAmount The amount to borrow
     * @param path Array of token addresses in the trade path (must start and end with the loan asset)
     * @param dexes Array of DEX identifiers for each hop (0 = DEX A, 1 = DEX B)
     * @param fees Array of fee tiers for V3 swaps (use 0 for V2 swaps)
     */
    function executeTriangleArbitrage(
        address loanAsset,
        uint256 loanAmount,
        address[] calldata path,
        uint8[] calldata dexes,
        uint24[] calldata fees
    ) external onlyOwner nonReentrant {
        require(loanAmount > 0, "Loan amount must be greater than 0");
        require(path.length >= 3, "Triangle path must have at least 3 tokens");
        require(path[0] == path[path.length - 1], "Path must start and end with loan asset");
        require(dexes.length == path.length - 1, "DEX indicators must match path segments");
        require(fees.length == path.length - 1, "Fee tiers must match path segments");
        
        // Create parameters for flash loan
        address[] memory assets = new address[](1);
        assets[0] = loanAsset;
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = loanAmount;
        
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0;
        
        // Encode triangle path parameters
        bytes memory params = abi.encode(
            true, // isTriangle flag to distinguish from regular arbitrage
            path,
            dexes,
            fees
        );
        
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
     * @dev Update DEX router address and type
     * @param dex Identifier ("A" or "B")
     * @param newRouter New router address
     * @param routerType Router type (0 = V2, 1 = V3)
     */
    function setDexRouter(string calldata dex, address newRouter, uint8 routerType) external onlyOwner {
        require(newRouter != address(0), "Router cannot be zero address");
        require(routerType <= DEX_TYPE_V3, "Invalid router type");
        
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
    
    /**
     * @dev Update DEX quoter address (for V3)
     * @param dex Identifier ("A" or "B")
     * @param newQuoter New quoter address
     */
    function setDexQuoter(string calldata dex, address newQuoter) external onlyOwner {
        require(newQuoter != address(0), "Quoter cannot be zero address");
        
        if (keccak256(abi.encodePacked(dex)) == keccak256(abi.encodePacked("A"))) {
            emit NewDexQuoterSet("A", dexAQuoter, newQuoter);
            dexAQuoter = newQuoter;
        } else if (keccak256(abi.encodePacked(dex)) == keccak256(abi.encodePacked("B"))) {
            emit NewDexQuoterSet("B", dexBQuoter, newQuoter);
            dexBQuoter = newQuoter;
        } else {
            revert("Invalid DEX identifier");
        }
    }
    
    /**
     * @dev Set optimal fee tier for a token pair
     * @param tokenA First token in the pair
     * @param tokenB Second token in the pair
     * @param feeTier Fee tier (100, 500, 3000, 10000)
     */
    function setOptimalFeeTier(address tokenA, address tokenB, uint24 feeTier) external onlyOwner {
        require(
            feeTier == FEE_LOWEST || 
            feeTier == FEE_LOW || 
            feeTier == FEE_MEDIUM || 
            feeTier == FEE_HIGH, 
            "Invalid fee tier"
        );
        
        // Store fee tier for both token orders
        optimalFeeTiers[tokenA][tokenB] = feeTier;
        optimalFeeTiers[tokenB][tokenA] = feeTier;
        
        emit OptimalFeeTierSet(tokenA, tokenB, feeTier);
    }
    
    /**
     * @dev Set default V3 fee tier
     * @param newDefaultFee New default fee (100, 500, 3000, 10000)
     */
    function setDefaultV3Fee(uint24 newDefaultFee) external onlyOwner {
        require(
            newDefaultFee == FEE_LOWEST || 
            newDefaultFee == FEE_LOW || 
            newDefaultFee == FEE_MEDIUM || 
            newDefaultFee == FEE_HIGH, 
            "Invalid fee tier"
        );
        
        emit DefaultV3FeeUpdated(defaultV3Fee, newDefaultFee);
        defaultV3Fee = newDefaultFee;
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
        
        // Borrowed asset and amount
        address borrowedAsset = assets[0];
        uint256 borrowedAmount = amounts[0];
        
        // Amount to repay (borrowed + premium)
        uint256 repayAmount = amounts[0] + premiums[0];
        
        // Check if this is a triangle arbitrage by inspecting first byte of params
        bool isTriangle;
        
        // First try to decode as triangle params
        try this.decodeFirstBool(params) returns (bool isTriangleFlag) {
            isTriangle = isTriangleFlag;
        } catch {
            // If fails, it's regular arbitrage
            isTriangle = false;
        }
        
        if (isTriangle) {
            // Decode triangle parameters
            (
                , // ignore the first bool we already extracted
                address[] memory path,
                uint8[] memory dexes,
                uint24[] memory fees
            ) = abi.decode(params, (bool, address[], uint8[], uint24[]));
            
            // Execute triangle arbitrage
            executeTriangleTrades(borrowedAsset, borrowedAmount, path, dexes, fees);
        } else {
            // Decode regular arbitrage parameters
            (
                address[] memory path,
                uint8[] memory dexForTrade,
                uint24[] memory feeTiers
            ) = abi.decode(params, (address[], uint8[], uint24[]));
            
            // Execute regular arbitrage trades
            executeArbitrageTrades(borrowedAsset, borrowedAmount, path, dexForTrade, feeTiers);
        }
        
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
    
    /**
     * @dev Helper function to decode first boolean from bytes
     * Used to determine if this is a triangle arbitrage
     */
    function decodeFirstBool(bytes calldata data) external pure returns (bool) {
        return abi.decode(data, (bool));
    }

    // ================ Internal Functions ================

    /**
     * @dev Execute trades as per the arbitrage path with enhanced V3 support
     */
    function executeArbitrageTrades(
        address startAsset,
        uint256 startAmount,
        address[] memory path,
        uint8[] memory dexForTrade,
        uint24[] memory feeTiers
    ) internal {
        require(path.length >= 2, "No trade path provided");
        require(path[0] == startAsset, "Path must start with loan asset");
        require(path[path.length - 1] == startAsset, "Path must end with loan asset");
        
        // Current asset and amount being traded
        address currentAsset = startAsset;
        uint256 currentAmount = startAmount;
        
        // Execute each trade in sequence
        for (uint i = 0; i < path.length - 1; i++) {
            address tokenFrom = path[i];
            address tokenTo = path[i + 1];
            
            // Ensure we're trading the correct asset
            require(tokenFrom == currentAsset, "Invalid trade sequence");
            
            // Select the DEX for this trade
            uint8 dexIndex = dexForTrade[i];
            address router = dexIndex == 0 ? dexARouter : dexBRouter;
            uint8 routerType = dexIndex == 0 ? dexAType : dexBType;
            
            // Determine fee tier for V3 swaps
            uint24 feeTier = defaultV3Fee;
            if (feeTiers.length > 0) {
                feeTier = feeTiers[i] > 0 ? feeTiers[i] : defaultV3Fee;
            } else if (optimalFeeTiers[tokenFrom][tokenTo] > 0) {
                feeTier = optimalFeeTiers[tokenFrom][tokenTo];
            }
            
            // Approve router to spend tokens
            IERC20(tokenFrom).approve(router, currentAmount);
            
            // Execute swap based on router type
            if (routerType == DEX_TYPE_V2) {
                // V2 router swap
                currentAmount = executeV2Swap(router, tokenFrom, tokenTo, currentAmount);
            } else {
                // V3 router swap
                currentAmount = executeV3Swap(router, tokenFrom, tokenTo, currentAmount, feeTier);
            }
            
            // Update current asset for next trade
            currentAsset = tokenTo;
        }
        
        // Ensure we ended up with the start asset
        require(currentAsset == startAsset, "Arbitrage must end with initial asset");
    }
    
    /**
     * @dev Execute triangle arbitrage trades
     */
    function executeTriangleTrades(
        address startAsset,
        uint256 startAmount,
        address[] memory path,
        uint8[] memory dexes,
        uint24[] memory fees
    ) internal {
        require(path.length >= 3, "Triangle path must have at least 3 tokens");
        require(path[0] == startAsset, "Path must start with loan asset");
        require(path[path.length - 1] == startAsset, "Path must end with loan asset");
        
        // Current asset and amount being traded
        address currentAsset = startAsset;
        uint256 currentAmount = startAmount;
        
        // Execute each trade in sequence
        for (uint i = 0; i < path.length - 1; i++) {
            address tokenFrom = path[i];
            address tokenTo = path[i + 1];
            
            // Ensure we're trading the correct asset
            require(tokenFrom == currentAsset, "Invalid trade sequence");
            
            // Select the DEX for this trade
            uint8 dexIndex = dexes[i];
            address router = dexIndex == 0 ? dexARouter : dexBRouter;
            uint8 routerType = dexIndex == 0 ? dexAType : dexBType;
            
            // Get fee tier for this trade
            uint24 feeTier = fees[i] > 0 ? fees[i] : defaultV3Fee;
            
            // Approve router to spend tokens
            IERC20(tokenFrom).approve(router, currentAmount);
            
            // Execute swap based on router type
            if (routerType == DEX_TYPE_V2) {
                currentAmount = executeV2Swap(router, tokenFrom, tokenTo, currentAmount);
            } else {
                currentAmount = executeV3Swap(router, tokenFrom, tokenTo, currentAmount, feeTier);
            }
            
            // Update current asset for next trade
            currentAsset = tokenTo;
        }
        
        // Ensure we ended up with the start asset
        require(currentAsset == startAsset, "Triangle arbitrage must end with loan asset");
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
        
        // Execute swap
        uint[] memory amounts = IUniswapRouter(router).swapExactTokensForTokens(
            amountIn,
            1, // Min output (we'll check profit at the end)
            path,
            address(this),
            block.timestamp + 15 minutes
        );
        
        return amounts[amounts.length - 1];
    }
    
    /**
     * @dev Execute swap using Uniswap V3 style router with fee tier
     */
    function executeV3Swap(
        address router,
        address tokenFrom,
        address tokenTo,
        uint256 amountIn,
        uint24 feeTier
    ) internal returns (uint256) {
        // Create params for V3 single swap
        IUniswapV3Router.ExactInputSingleParams memory params = IUniswapV3Router.ExactInputSingleParams({
            tokenIn: tokenFrom,
            tokenOut: tokenTo,
            fee: feeTier,
            recipient: address(this),
            deadline: block.timestamp + 15 minutes,
            amountIn: amountIn,
            amountOutMinimum: 1, // Min output (we'll check profit at the end)
            sqrtPriceLimitX96: 0 // No price limit
        });
        
        // Execute swap
        return IUniswapV3Router(router).exactInputSingle(params);
    }
    
    /**
     * @dev Execute multi-hop swap using Uniswap V3 style router
     * @param router The V3 router address
     * @param path Array of token path hops
     * @param amountIn The amount of initial token to swap
     * @return amountOut The final amount received
     */
    function executeV3MultiHopSwap(
        address router,
        V3PathHop[] memory path,
        uint256 amountIn
    ) internal returns (uint256) {
        // Encode the path for multi-hop swap
        bytes memory encodedPath = encodeV3Path(path);
        
        // Create params for V3 multi-hop swap
        IUniswapV3Router.ExactInputParams memory params = IUniswapV3Router.ExactInputParams({
            path: encodedPath,
            recipient: address(this),
            deadline: block.timestamp + 15 minutes,
            amountIn: amountIn,
            amountOutMinimum: 1 // Min output (we'll check profit at the end)
        });
        
        // Execute swap
        return IUniswapV3Router(router).exactInput(params);
    }
    
    /**
     * @dev Encode path for V3 multi-hop swap
     * @param path Array of token path hops
     * @return bytes Encoded path for V3 router
     */
    function encodeV3Path(V3PathHop[] memory path) internal pure returns (bytes memory) {
        bytes memory encoded;
        
        for (uint i = 0; i < path.length; i++) {
            // Encode the token address
            encoded = abi.encodePacked(encoded, path[i].tokenIn);
            
            // For all except the last hop, encode fee and next token
            if (i < path.length - 1) {
                encoded = abi.encodePacked(encoded, path[i].fee);
            }
        }
        
        // Encode the final token
        encoded = abi.encodePacked(encoded, path[path.length - 1].tokenOut);
        
        return encoded;
    }
}
