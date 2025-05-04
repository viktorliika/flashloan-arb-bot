const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

// Path to logs directory
const logsDir = path.join(__dirname, '../logs');

/**
 * Parse log files to extract arbitrage opportunities
 * @returns Array of arbitrage opportunities
 */
function parseArbitrageData() {
    const opportunities = [];
    
    try {
        // Read all log files in the logs directory
        const logFiles = fs.readdirSync(logsDir)
            .filter(file => file.startsWith('curve_arb_') || 
                           file.startsWith('arbitrage_') || 
                           file.startsWith('multi_path_arb_'));
        
        // Process each log file
        for (const file of logFiles) {
            const filePath = path.join(logsDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            
            for (const line of lines) {
                // Look for profitable opportunities
                if (line.includes('POTENTIALLY PROFITABLE') || line.includes('VALIDATED ARBITRAGE OPPORTUNITY')) {
                    try {
                        // Extract timestamp from log entry
                        const timestampMatch = line.match(/\[(.*?)\]/);
                        if (!timestampMatch) continue;
                        
                        const timestamp = new Date(timestampMatch[1]).toISOString();
                        
                        // Extract pair information
                        let pair = '';
                        if (line.includes('for ')) {
                            const pairMatch = line.match(/for ([A-Z]+\/[A-Z]+)/);
                            if (pairMatch) {
                                pair = pairMatch[1];
                            }
                        }
                        
                        // Extract route information
                        let route = '';
                        if (line.includes('path:') || line.includes('→')) {
                            const routeMatch = line.match(/(.*?) → (.*?) for/);
                            if (routeMatch) {
                                route = `${routeMatch[1]} → ${routeMatch[2]}`;
                            }
                        }
                        
                        // Extract profit information
                        let profit = 0;
                        const profitMatch = line.match(/Net profit: ([0-9.]+)/);
                        if (profitMatch) {
                            profit = parseFloat(profitMatch[1]);
                        }
                        
                        // Extract profitability percentage
                        let profitPercent = 0;
                        const percentMatch = line.match(/\(([0-9.]+)%\)/);
                        if (percentMatch) {
                            profitPercent = parseFloat(percentMatch[1]) / 100;
                        }
                        
                        // Determine status
                        let status = 'Identified';
                        if (line.includes('Execution skipped')) {
                            status = 'Skipped';
                        } else if (line.includes('Transaction executed successfully')) {
                            status = 'Executed';
                        } else if (line.includes('Error executing arbitrage')) {
                            status = 'Failed';
                        } else if (line.includes('VALIDATED ARBITRAGE OPPORTUNITY')) {
                            status = 'Validated';
                        }
                        
                        // Add to opportunities if we have valid data
                        if (timestamp && (pair || route) && profit > 0) {
                            opportunities.push({
                                timestamp,
                                pair: pair || 'Unknown',
                                route: route || 'Unknown Route',
                                profit,
                                profitPercent,
                                status
                            });
                        }
                    } catch (parseError) {
                        console.error(`Error parsing line: ${parseError.message}`);
                    }
                }
            }
        }
        
        return opportunities;
    } catch (error) {
        console.error(`Error reading arbitrage data: ${error.message}`);
        return [];
    }
}

/**
 * Calculate key statistics from arbitrage data
 * @param {Array} opportunities Arbitrage opportunities
 * @returns Object with statistics
 */
function calculateStatistics(opportunities) {
    const stats = {
        totalOpportunities: opportunities.length,
        totalProfit: 0,
        avgProfit: 0,
        successRate: 0,
        executedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        identifiedCount: 0,
        validatedCount: 0,
        dexCounts: {},
        pairCounts: {},
        dailyStats: {}
    };
    
    // Count by status
    opportunities.forEach(opp => {
        stats.totalProfit += opp.profit;
        
        if (opp.status === 'Executed') {
            stats.executedCount++;
        } else if (opp.status === 'Skipped') {
            stats.skippedCount++;
        } else if (opp.status === 'Failed') {
            stats.failedCount++;
        } else if (opp.status === 'Identified') {
            stats.identifiedCount++;
        } else if (opp.status === 'Validated') {
            stats.validatedCount++;
        }
        
        // Count by DEX
        if (opp.route !== 'Unknown Route') {
            const dexes = opp.route.split(' → ');
            dexes.forEach(dex => {
                if (!stats.dexCounts[dex]) {
                    stats.dexCounts[dex] = 0;
                }
                stats.dexCounts[dex]++;
            });
        }
        
        // Count by pair
        if (opp.pair !== 'Unknown') {
            if (!stats.pairCounts[opp.pair]) {
                stats.pairCounts[opp.pair] = 0;
            }
            stats.pairCounts[opp.pair]++;
        }
        
        // Group by day
        const date = new Date(opp.timestamp).toISOString().split('T')[0];
        if (!stats.dailyStats[date]) {
            stats.dailyStats[date] = {
                count: 0,
                profit: 0
            };
        }
        stats.dailyStats[date].count++;
        stats.dailyStats[date].profit += opp.profit;
    });
    
    // Calculate averages
    if (stats.totalOpportunities > 0) {
        stats.avgProfit = stats.totalProfit / stats.totalOpportunities;
    }
    
    // Calculate success rate
    if (stats.executedCount > 0) {
        stats.successRate = (stats.executedCount / 
            (stats.executedCount + stats.failedCount)) * 100;
    }
    
    return stats;
}

// API endpoint for getting arbitrage data
router.get('/api/arbitrage-data', (req, res) => {
    const opportunities = parseArbitrageData();
    const stats = calculateStatistics(opportunities);
    
    res.json({
        opportunities: opportunities.sort((a, b) => 
            new Date(b.timestamp) - new Date(a.timestamp)
        ),
        stats
    });
});

module.exports = router;
