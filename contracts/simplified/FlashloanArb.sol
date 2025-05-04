// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// External interfaces
interface ILendingPool {
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata modes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IUniswapRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

/**
 * @title FlashloanArb
 * @dev Simplified contract for flashloan arbitrage between DEXes
 */
contract FlashloanArb is Ownable, ReentrancyGuard {

    // State variables
    ILendingPool public lendingPool;    
    address public dexARouter;
    address public dexBRouter;
    bool private _flashLoanInProgress;
    uint256 public minProfitAmount;

    // Events
    event ArbitrageExecuted(
        address indexed tokenBorrowed,
        uint256 amountBorrowed,
        uint256 profit,
        uint256 timestamp
    );

    event ProfitWithdrawn(
        address indexed token,
        address indexed to,
        uint256 amount
    );

    // Constructor
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
    }

    // Execute arbitrage via flash loan
    function executeArbitrage(
        address loanAsset,
        uint256 loanAmount,
        address[2][] calldata pairs,
        uint8[] calldata dexForTrade
    ) external onlyOwner nonReentrant {
        require(loanAmount > 0, "Loan amount must be greater than 0");
        require(pairs.length > 0, "Trade pairs must be provided");
        
        address[] memory assets = new address[](1);
        assets[0] = loanAsset;
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = loanAmount;
        
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0;
        
        bytes memory params = abi.encode(pairs, dexForTrade);
        
        _flashLoanInProgress = true;
        lendingPool.flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            params,
            0
        );
        _flashLoanInProgress = false;
    }

    // Flash loan callback
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(_flashLoanInProgress, "Unauthorized callback");
        require(initiator == address(this), "Unauthorized initiator");
        
        (address[2][] memory pairs, uint8[] memory dexForTrade) = abi.decode(
            params,
            (address[2][], uint8[])
        );

        address borrowedAsset = assets[0];
        uint256 borrowedAmount = amounts[0];
        uint256 repayAmount = amounts[0] + premiums[0];
        
        // Execute trades between DEXes
        executeTrades(borrowedAsset, borrowedAmount, pairs, dexForTrade);
        
        uint256 finalBalance = IERC20(borrowedAsset).balanceOf(address(this));
        uint256 profit = finalBalance > repayAmount ? finalBalance - repayAmount : 0;
        
        require(profit >= minProfitAmount, "Insufficient profit");
        
        IERC20(borrowedAsset).approve(address(lendingPool), repayAmount);
        
        emit ArbitrageExecuted(
            borrowedAsset,
            borrowedAmount,
            profit,
            block.timestamp
        );
        
        return true;
    }

    // Internal function to execute trades
    function executeTrades(
        address startAsset,
        uint256 startAmount,
        address[2][] memory pairs,
        uint8[] memory dexForTrade
    ) internal {
        address currentAsset = startAsset;
        uint256 currentAmount = startAmount;
        
        for (uint i = 0; i < pairs.length; i++) {
            address tokenFrom = pairs[i][0];
            address tokenTo = pairs[i][1];
            
            require(tokenFrom == currentAsset, "Invalid trade sequence");
            
            address router = dexForTrade[i] == 0 ? dexARouter : dexBRouter;
            
            address[] memory path = new address[](2);
            path[0] = tokenFrom;
            path[1] = tokenTo;
            
            IERC20(tokenFrom).approve(router, currentAmount);
            
            uint[] memory amounts = IUniswapRouter(router).swapExactTokensForTokens(
                currentAmount,
                1,
                path,
                address(this),
                block.timestamp + 15 minutes
            );
            
            currentAsset = tokenTo;
            currentAmount = amounts[amounts.length - 1];
        }
        
        require(currentAsset == startAsset, "Arbitrage must end with initial asset");
    }

    // Withdraw tokens from the contract
    function withdrawTokens(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner nonReentrant {
        require(to != address(0), "Cannot withdraw to zero address");
        
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 withdrawAmount = (amount == 0) ? balance : amount;
        
        require(withdrawAmount <= balance, "Insufficient token balance");
        
        IERC20(token).transfer(to, withdrawAmount);
        
        emit ProfitWithdrawn(token, to, withdrawAmount);
    }

    // Update minimum profit threshold
    function setMinProfitAmount(uint256 _newMinProfitAmount) external onlyOwner {
        minProfitAmount = _newMinProfitAmount;
    }

    // Update DEX router addresses
    function setDexRouter(string calldata dex, address newRouter) external onlyOwner {
        require(newRouter != address(0), "Router cannot be zero address");
        
        if (keccak256(abi.encodePacked(dex)) == keccak256(abi.encodePacked("A"))) {
            dexARouter = newRouter;
        } else if (keccak256(abi.encodePacked(dex)) == keccak256(abi.encodePacked("B"))) {
            dexBRouter = newRouter;
        } else {
            revert("Invalid DEX identifier");
        }
    }
}
