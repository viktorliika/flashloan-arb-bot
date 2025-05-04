const express = require('express');
const path = require('path');
const fs = require('fs');
const dataConnector = require('./data-connector');
const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the dashboard directory
app.use(express.static(__dirname));

// Use the data connector router
app.use(dataConnector);

// Check for analytics flag
const showAnalytics = process.argv.includes('--analytics');

// Serve the main dashboard page
app.get('/', (req, res) => {
  // Serve analytics page if flag is passed, otherwise regular dashboard
  if (showAnalytics) {
    res.sendFile(path.join(__dirname, 'analytics.html'));
  } else {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

// Direct analytics endpoint for direct access
app.get('/analytics', (req, res) => {
  res.sendFile(path.join(__dirname, 'analytics.html'));
});

// API endpoint to get log data
app.get('/api/logs', (req, res) => {
  try {
    const logsDir = path.join(__dirname, '../logs');
    
    // Check if logs directory exists
    if (!fs.existsSync(logsDir)) {
      return res.json({ logs: [] });
    }
    
    // Get the most recent log file
    const logFiles = fs.readdirSync(logsDir).filter(file => file.endsWith('.log'));
    if (logFiles.length === 0) {
      return res.json({ logs: [] });
    }
    
    // Sort files by date (newest first)
    logFiles.sort((a, b) => {
      return fs.statSync(path.join(logsDir, b)).mtime.getTime() - 
             fs.statSync(path.join(logsDir, a)).mtime.getTime();
    });
    
    // Read the most recent log file
    const latestLogFile = path.join(logsDir, logFiles[0]);
    const logContent = fs.readFileSync(latestLogFile, 'utf8');
    
    // Parse log entries
    const logEntries = logContent.split('\n')
      .filter(line => line.trim() !== '')
      .map(line => {
        // Extract timestamp and message
        const timestampMatch = line.match(/\[(.*?)\]/);
        const timestamp = timestampMatch ? timestampMatch[1] : '';
        const message = line.replace(/\[.*?\]\s*/, '');
        
        return { timestamp, message };
      });
    
    res.json({ logs: logEntries });
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

// API endpoint to get arbitrage opportunities
app.get('/api/opportunities', (req, res) => {
  try {
    const csvFile = path.join(__dirname, '../arbitrage_log.csv');
    
    // Check if CSV file exists
    if (!fs.existsSync(csvFile)) {
      return res.json({ opportunities: [] });
    }
    
    // Read the CSV file
    const csvContent = fs.readFileSync(csvFile, 'utf8');
    
    // Parse CSV entries
    const opportunities = csvContent.split('\n')
      .filter(line => line.trim() !== '')
      .map(line => {
        const [timestamp, pair, route, profit, percentage, txHash] = line.split(',');
        return { timestamp, pair, route, profit, percentage, txHash };
      });
    
    res.json({ opportunities });
  } catch (error) {
    console.error('Error reading opportunities:', error);
    res.status(500).json({ error: 'Failed to read opportunities' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Dashboard server running at http://localhost:${port}`);
});
