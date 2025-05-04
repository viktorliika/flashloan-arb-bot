// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ILendingPool.sol";
import "./interfaces/IFlashLoanReceiver.sol";
import "./interfaces/IUniswapRouter.sol";
import "./interfaces/IUniswapV3Router.sol";

/**
 * @title MultiDexArbitrageur
 * @dev Contract for executing arbitrage opportunities across multiple DEXes
 * Supports Uniswap V2, Uniswap V3, Curve, and Balancer
 */
contract MultiDexArbitrageur is Ownable(msg.sender), IFlashLoanReceiver {
    using SafeERC20 for IERC20;
    
    // DEX adapters
    address public constant UNISWAP_V2_ROUTER = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    address public constant UNISWAP_V3_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address public constant CURVE_ROUTER = 0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7;
    address public constant BALANCER_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
    
    // Flash loan provider
    address public lendingPoolAddress;
    
    // Supported DEX types
    enum DEX {
        UNISWAP_V2,
        UNISWAP_V3,
        CURVE,
        BALANCER
    }
    
    // Event emitted when an arbitrage is executed
    event ArbitrageExecuted(
        address indexed tokenBorrowed,
        uint256 amountBorrowed,
        uint256 profit,
        uint8[] dexPath,
        address[] tokenPath
    );
    
    // Event emitted when profits are withdrawn
    event ProfitsWithdrawn(
        address indexed token,
        uint256 amount,
        address indexed recipient
    );
    
    /**
     * @dev Constructor sets the flash loan provider
     * @param _lendingPoolAddress Address of the flash loan provider
     */
    constructor(address _lendingPoolAddress) {
        require(_lendingPoolAddress != address(0), "Invalid lending pool address");
        lendingPoolAddress = _lendingPoolAddress;
    }
    
    /**
     * @dev Update the lending pool address
     * @param _lendingPoolAddress New lending pool address
     */
    function setLendingPoolAddress(address _lendingPoolAddress) external onlyOwner {
        require(_lendingPoolAddress != address(0), "Invalid lending pool address");
        lendingPoolAddress = _lendingPoolAddress;
    }
    
    /**
     * @dev Initiate a flash loan to execute arbitrage
     * @param _tokenBorrow Address of token to borrow
     * @param _amountBorrow Amount to borrow
     * @param _dexPath Array of DEX enums indicating which DEX to use for each swap
     * @param _tokenPath Array of token addresses for the swap path
     * @param _pools Array of pool addresses for each swap
     * @param _poolData Additional data needed for certain DEXes (e.g., Curve pool indices)
     */
    function executeArbitrage(
        address _tokenBorrow,
        uint256 _amountBorrow,
        uint8[] calldata _dexPath,
        address[] calldata _tokenPath,
        address[] calldata _pools,
        bytes[] calldata _poolData
    ) external onlyOwner {
        require(_tokenPath.length >= 2, "Path must have at least 2 tokens");
        require(_tokenPath[0] == _tokenBorrow, "First token must be borrowed token");
        require(_tokenPath[_tokenPath.length - 1] == _tokenBorrow, "Last token must be borrowed token");
        require(_dexPath.length == _tokenPath.length - 1, "DEX path length must match token path segments");
        require(_pools.length == _dexPath.length, "Pools length must match DEX path length");
        
        // Prepare the flash loan
        address[] memory tokens = new address[](1);
        tokens[0] = _tokenBorrow;
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = _amountBorrow;
        
        // Encode arbitrage data to be used in the callback
        bytes memory params = abi.encode(
            _dexPath,
            _tokenPath,
            _pools,
            _poolData
        );
        
        // Execute flash loan
        ILendingPool(lendingPoolAddress).flashLoan(
            address(this),
            tokens,
            amounts,
            new uint256[](1), // Interest rate modes (0 = no debt)
            address(this),    // Receiver is this contract
            params,
            0                 // Referral code
        );
    }
    
    /**
     * @dev Flash loan callback function - executes the arbitrage
     * @param _assets Array of token addresses borrowed
     * @param _amounts Array of amounts borrowed
     * @param _premiums Array of fees to pay
     * @param _initiator Address that initiated the flash loan
     * @param _params Encoded parameters for the arbitrage execution
     */
    function executeOperation(
        address[] calldata _assets,
        uint256[] calldata _amounts,
        uint256[] calldata _premiums,
        address _initiator,
        bytes calldata _params
    ) external override returns (bool) {
        require(msg.sender == lendingPoolAddress, "Caller must be lending pool");
        require(_initiator == address(this), "Initiator must be this contract");
        
        // Decode params
        (
            uint8[] memory dexPath,
            address[] memory tokenPath,
            address[] memory pools,
            bytes[] memory poolData
        ) = abi.decode(_params, (uint8[], address[], address[], bytes[]));
        
        // Get the borrowed amount and calculate the repayment amount
        uint256 borrowedAmount = _amounts[0];
        uint256 repaymentAmount = borrowedAmount + _premiums[0];
        address borrowedToken = _assets[0];
        
        // Execute the arbitrage
        uint256 startBalance = IERC20(borrowedToken).balanceOf(address(this));
        
        // Execute swaps along the path
        uint256 currentAmount = borrowedAmount;
        for (uint i = 0; i < dexPath.length; i++) {
            address tokenIn = tokenPath[i];
            address tokenOut = tokenPath[i + 1];
            
            // Execute the swap based on DEX type
            currentAmount = executeSwap(
                DEX(dexPath[i]),
                tokenIn,
                tokenOut,
                currentAmount,
                pools[i],
                poolData[i]
            );
        }
        
        // Verify we made a profit
        uint256 endBalance = IERC20(borrowedToken).balanceOf(address(this));
        require(endBalance >= repaymentAmount, "Not enough profit to repay flash loan");
        
        // Calculate profit
        uint256 profit = endBalance - startBalance;
        
        // Approve repayment
        IERC20 token = IERC20(borrowedToken);
        token.approve(lendingPoolAddress, 0);
        token.approve(lendingPoolAddress, repaymentAmount);
        
        // Emit event for successful arbitrage
        emit ArbitrageExecuted(
            borrowedToken,
            borrowedAmount,
            profit,
            dexPath,
            tokenPath
        );
        
        return true;
    }
    
    /**
     * @dev Execute a swap on a specific DEX
     * @param _dex DEX type enum
     * @param _tokenIn Address of input token
     * @param _tokenOut Address of output token
     * @param _amountIn Amount of input token
     * @param _pool Pool address
     * @param _data Additional data needed for the swap
     * @return Amount of output token received
     */
    function executeSwap(
        DEX _dex,
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn,
        address _pool,
        bytes memory _data
    ) internal returns (uint256) {
        // Get router address
        address router = getRouterAddress(_dex, _pool);
        
        // Approve the router to spend tokens
        IERC20 token = IERC20(_tokenIn);
        token.approve(router, 0);
        token.approve(router, _amountIn);
        
        uint256 balanceBefore = IERC20(_tokenOut).balanceOf(address(this));
        
        if (_dex == DEX.UNISWAP_V2) {
            executeUniswapV2Swap(_tokenIn, _tokenOut, _amountIn);
        } else if (_dex == DEX.UNISWAP_V3) {
            executeUniswapV3Swap(_tokenIn, _tokenOut, _amountIn, _data);
        } else if (_dex == DEX.CURVE) {
            executeCurveSwap(_tokenIn, _tokenOut, _amountIn, _pool, _data);
        } else if (_dex == DEX.BALANCER) {
            executeBalancerSwap(_tokenIn, _tokenOut, _amountIn, _pool, _data);
        } else {
            revert("Unsupported DEX");
        }
        
        uint256 balanceAfter = IERC20(_tokenOut).balanceOf(address(this));
        return balanceAfter - balanceBefore;
    }
    
    /**
     * @dev Execute a swap on Uniswap V2
     */
    function executeUniswapV2Swap(
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn
    ) internal {
        address[] memory path = new address[](2);
        path[0] = _tokenIn;
        path[1] = _tokenOut;
        
        // Calculate current timestamp + 5 minutes
        uint deadline = block.timestamp + 300;
        
        // Execute swap
        IUniswapRouter(UNISWAP_V2_ROUTER).swapExactTokensForTokens(
            _amountIn,
            1, // Accept any amount of output tokens
            path,
            address(this),
            deadline
        );
    }
    
    /**
     * @dev Execute a swap on Uniswap V3
     */
    function executeUniswapV3Swap(
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn,
        bytes memory _data
    ) internal {
        // Decode fee from data
        uint24 fee = abi.decode(_data, (uint24));
        
        // Prepare Uniswap V3 params
        IUniswapV3Router.ExactInputSingleParams memory params = IUniswapV3Router.ExactInputSingleParams({
            tokenIn: _tokenIn,
            tokenOut: _tokenOut,
            fee: fee,
            recipient: address(this),
            deadline: block.timestamp + 300,
            amountIn: _amountIn,
            amountOutMinimum: 1, // Accept any amount
            sqrtPriceLimitX96: 0 // No price limit
        });
        
        // Execute swap
        IUniswapV3Router(UNISWAP_V3_ROUTER).exactInputSingle(params);
    }
    
    /**
     * @dev Execute a swap on Curve
     */
    function executeCurveSwap(
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn,
        address _pool,
        bytes memory _data
    ) internal {
        // Decode indices from data
        (int128 i, int128 j) = abi.decode(_data, (int128, int128));
        
        // Get Curve pool interface
        ICurvePool pool = ICurvePool(_pool);
        
        // Execute swap (note: Curve pools have different interfaces, this is a common one)
        pool.exchange(i, j, _amountIn, 1); // Accept any amount of output tokens
    }
    
    /**
     * @dev Execute a swap on Balancer
     */
    function executeBalancerSwap(
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn,
        address _pool,
        bytes memory _data
    ) internal {
        // Decode Balancer pool ID from data
        bytes32 poolId = abi.decode(_data, (bytes32));
        
        // Create batch swap parameters
        IBalancerVault.SingleSwap memory singleSwap = IBalancerVault.SingleSwap({
            poolId: poolId,
            kind: IBalancerVault.SwapKind.GIVEN_IN,
            assetIn: _tokenIn,
            assetOut: _tokenOut,
            amount: _amountIn,
            userData: ""
        });
        
        IBalancerVault.FundManagement memory funds = IBalancerVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(address(this)),
            toInternalBalance: false
        });
        
        // Execute swap
        IBalancerVault(BALANCER_VAULT).swap(
            singleSwap, 
            funds, 
            1, // Accept any amount of output tokens
            block.timestamp + 300
        );
    }
    
    /**
     * @dev Get the router address for a specific DEX
     */
    function getRouterAddress(DEX _dex, address _pool) internal pure returns (address) {
        if (_dex == DEX.UNISWAP_V2) {
            return UNISWAP_V2_ROUTER;
        } else if (_dex == DEX.UNISWAP_V3) {
            return UNISWAP_V3_ROUTER;
        } else if (_dex == DEX.CURVE) {
            return _pool; // For Curve, the pool is the router
        } else if (_dex == DEX.BALANCER) {
            return BALANCER_VAULT;
        } else {
            revert("Unsupported DEX");
        }
    }
    
    /**
     * @dev Withdraw profits to the owner
     * @param _token Address of token to withdraw
     * @param _amount Amount to withdraw (0 for all)
     */
    function withdrawProfits(address _token, uint256 _amount) external onlyOwner {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        uint256 withdrawAmount = _amount == 0 ? balance : _amount;
        
        require(withdrawAmount <= balance, "Not enough balance");
        
        IERC20(_token).safeTransfer(owner(), withdrawAmount);
        
        emit ProfitsWithdrawn(_token, withdrawAmount, owner());
    }
    
    /**
     * @dev Handle ETH received
     */
    receive() external payable {}
}

/**
 * @dev Interface for Curve pools
 */
interface ICurvePool {
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external returns (uint256);
}

/**
 * @dev Interface for Balancer Vault
 */
interface IBalancerVault {
    enum SwapKind { GIVEN_IN, GIVEN_OUT }
    
    struct SingleSwap {
        bytes32 poolId;
        SwapKind kind;
        address assetIn;
        address assetOut;
        uint256 amount;
        bytes userData;
    }
    
    struct FundManagement {
        address sender;
        bool fromInternalBalance;
        address payable recipient;
        bool toInternalBalance;
    }
    
    function swap(
        SingleSwap memory singleSwap,
        FundManagement memory funds,
        uint256 limit,
        uint256 deadline
    ) external returns (uint256);
}
