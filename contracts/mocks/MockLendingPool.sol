// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IFlashLoanReceiver.sol";

/**
 * @title MockLendingPool
 * @dev Mock lending pool for flash loan testing
 */
contract MockLendingPool {
    // Flash loan fee in basis points (1 basis point = 0.01%)
    uint16 public flashLoanFee;
    
    // Receiver address for flash loan callback
    address public flashLoanReceiver;
    
    constructor(uint16 _flashLoanFee) {
        flashLoanFee = _flashLoanFee;
    }
    
    /**
     * @dev Set the flash loan receiver address for testing
     * @param _receiver The address that will receive the flash loan
     */
    function setFlashloanReceiver(address _receiver) external {
        flashLoanReceiver = _receiver;
    }
    
    /**
     * @dev Execute a flash loan (simplified for testing)
     * Since this is a mock, we only support a single asset
     * @param receiverAddress The address to receive the flash loan funds
     * @param assets The addresses of the assets to flash loan (only first one used)
     * @param amounts The amounts of the assets to flash loan (only first one used)
     * @param params The parameters for the flash loan
     * Note: modes, onBehalfOf, and referralCode parameters are unused in this mock implementation
     */
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata /* modes */,         // Unused parameter
        address /* onBehalfOf */,               // Unused parameter
        bytes calldata params,
        uint16 /* referralCode */               // Unused parameter
    ) external {
        require(assets.length > 0, "No assets provided");
        require(amounts.length > 0, "No amounts provided");
        
        // Call internal function to reduce stack usage
        _executeFlashLoan(
            receiverAddress,
            assets[0],
            amounts[0],
            params
        );
    }
    
    /**
     * @dev Internal function to execute flash loan with fewer parameters
     * to avoid stack too deep errors
     */
    function _executeFlashLoan(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params
    ) internal {
        // Calculate fee
        uint256 premium = (amount * flashLoanFee) / 10000;
        
        // Create arrays for the callback
        address[] memory assetArray = new address[](1);
        uint256[] memory amountArray = new uint256[](1);
        uint256[] memory premiumArray = new uint256[](1);
        
        assetArray[0] = asset;
        amountArray[0] = amount;
        premiumArray[0] = premium;
        
        // Transfer asset to the receiver
        IERC20(asset).transfer(receiverAddress, amount);
        
        // Call the executeOperation function on the receiver contract
        bool success = IFlashLoanReceiver(receiverAddress).executeOperation(
            assetArray,
            amountArray,
            premiumArray,
            msg.sender,
            params
        );
        
        require(success, "Flash loan callback failed");
        
        // Ensure the loan plus fee is paid back
        uint256 amountOwed = amount + premium;
        IERC20(asset).transferFrom(receiverAddress, address(this), amountOwed);
    }
}
