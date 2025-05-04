const { exec } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Check if Hardhat node is running
function checkNodeRunning() {
  console.log("Checking if Hardhat node is already running...");
  
  // Different commands for Windows vs Unix-like systems
  const isWindows = process.platform === 'win32';
  const checkCommand = isWindows 
    ? 'netstat -ano | findstr :8545' 
    : 'lsof -i :8545';
  
  exec(checkCommand, (error, stdout, stderr) => {
    if (stdout && stdout.length > 0) {
      console.log("Hardhat node is already running on port 8545.");
      if (isWindows) {
        // Extract PID from netstat output
        const lines = stdout.split('\n').filter(line => line.includes('LISTENING'));
        if (lines.length > 0) {
          const pidMatch = lines[0].match(/(\d+)$/);
          if (pidMatch && pidMatch[1]) {
            const pid = pidMatch[1];
            askToKillProcess(pid);
          } else {
            console.log("Could not extract PID from netstat output.");
            askWhatToDo();
          }
        }
      } else {
        // Extract PID from lsof output
        const lines = stdout.split('\n').filter(line => line.includes('LISTEN'));
        if (lines.length > 0) {
          const pidMatch = lines[0].match(/\s+(\d+)\s+/);
          if (pidMatch && pidMatch[1]) {
            const pid = pidMatch[1];
            askToKillProcess(pid);
          } else {
            console.log("Could not extract PID from lsof output.");
            askWhatToDo();
          }
        }
      }
    } else {
      console.log("No Hardhat node is currently running on port 8545.");
      startNewNode();
    }
  });
}

// Ask user if they want to kill the existing process
function askToKillProcess(pid) {
  rl.question(`Do you want to kill the existing Hardhat node process (PID: ${pid})? (y/n) `, (answer) => {
    if (answer.toLowerCase() === 'y') {
      const killCommand = process.platform === 'win32' 
        ? `taskkill /F /PID ${pid}` 
        : `kill -9 ${pid}`;
      
      exec(killCommand, (error, stdout, stderr) => {
        if (error) {
          console.log(`Error killing process: ${error.message}`);
          rl.close();
          return;
        }
        console.log(`Successfully killed process with PID ${pid}`);
        startNewNode();
      });
    } else {
      askWhatToDo();
    }
  });
}

// Ask user what they want to do next
function askWhatToDo() {
  rl.question('What would you like to do?\n1. Continue with existing node\n2. Exit\nEnter choice (1 or 2): ', (answer) => {
    if (answer === '1') {
      console.log("Using existing Hardhat node. You can now run deployment and other scripts.");
      rl.close();
    } else {
      console.log("Exiting. Please manually kill the existing Hardhat node process before trying again.");
      rl.close();
    }
  });
}

// Start a new Hardhat node
function startNewNode() {
  console.log("Starting new Hardhat node...");
  const nodeProcess = exec('npx hardhat node', (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      return;
    }
  });
  
  // Forward the node's output to the console
  nodeProcess.stdout.on('data', (data) => {
    process.stdout.write(data);
  });
  
  nodeProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
  });
  
  console.log("Hardhat node started. Press Ctrl+C to stop.");
}

// Start the script
checkNodeRunning();
