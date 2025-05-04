// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BasicFlashloan
 * @dev Minimalistic contract for flashloan operations
 */
contract BasicFlashloan is Ownable {
    address public lendingPool;
    bool private _flashLoanInProgress;

    event LoanReceived(address indexed token, uint256 amount);
    
    constructor(address _lendingPool) Ownable(msg.sender) {
        lendingPool = _lendingPool;
    }
    
    // Simple function to receive tokens
    function receiveTokens(address token, uint256 amount) external {
        emit LoanReceived(token, amount);
    }
    
    // Withdraw tokens from the contract
    function withdrawTokens(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Cannot withdraw to zero address");
        
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(amount <= balance, "Insufficient token balance");
        
        IERC20(token).transfer(to, amount);
    }
}
