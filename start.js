// start.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const opener = require('opener');

// Ensure the public directory exists
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
}

// Copy the HTML file to the public directory
const htmlSource = path.join(__dirname, 'index.html');
const htmlDest = path.join(publicDir, 'index.html');
fs.copyFileSync(htmlSource, htmlDest);

console.log("Starting Botbia...");

// Start the server
const server = spawn('node', ['server.js'], {
    stdio: 'inherit'
});

// Open the browser after a short delay
setTimeout(() => {
    opener('http://localhost:3000');
}, 2000);

console.log("Botbia is starting up. The interface will open in your browser momentarily.");

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log("Stopping Botbia...");
    server.kill('SIGINT');
    process.exit(0);
});

server.on('close', (code) => {
    console.log(`Botbia server exited with code ${code}`);
    process.exit(code);
});