// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICurvePool
 * @dev Interface for Curve Finance liquidity pools
 */
interface ICurvePool {
    /**
     * @dev Perform an exchange between two coins
     * @param i Index value for the coin to send
     * @param j Index value of the coin to receive
     * @param dx Amount of i being exchanged
     * @param min_dy Minimum amount of j to receive
     * @return Amount of j received
     */
    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy
    ) external returns (uint256);
    
    /**
     * @dev Calculate amount received when swapping coins
     * @param i Index value for the coin to send
     * @param j Index value of the coin to receive
     * @param dx Amount of i being exchanged
     * @return Amount of j to be received
     */
    function get_dy(
        int128 i,
        int128 j,
        uint256 dx
    ) external view returns (uint256);
    
    /**
     * @dev Get the underlying coin at given index
     * @param index Index value of the coin
     * @return Address of the coin
     */
    function coins(uint256 index) external view returns (address);
    
    /**
     * @dev Get the current balance of a coin
     * @param index Index value of the coin
     * @return Balance of the coin
     */
    function balances(uint256 index) external view returns (uint256);
}

/**
 * @title ICurveRegistry
 * @dev Interface for Curve Finance registry
 */
interface ICurveRegistry {
    /**
     * @dev Get a pool's address using the LP token address
     * @param lp_token LP token address
     * @return Pool address
     */
    function get_pool_from_lp_token(address lp_token) external view returns (address);
    
    /**
     * @dev Get a pool's address using coin addresses
     * @param _coins Array of coin addresses
     * @param n_coins Number of coins
     * @param pool_type Pool type as uint256
     * @return Pool address
     */
    function find_pool_for_coins(
        address[8] calldata _coins,
        uint256 n_coins,
        uint256 pool_type
    ) external view returns (address);
    
    /**
     * @dev Get a list of pools that include the given coin
     * @param _coin Coin address
     * @return List of pool addresses
     */
    function get_pools_for_coin(address _coin) external view returns (address[10] memory);
    
    /**
     * @dev Get the number of coins in a pool
     * @param _pool Pool address
     * @return Number of coins
     */
    function get_n_coins(address _pool) external view returns (uint256);
    
    /**
     * @dev Get the underlying coins for a pool
     * @param _pool Pool address
     * @return Array of coin addresses
     */
    function get_coins(address _pool) external view returns (address[8] memory);
}
