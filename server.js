const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { BotbiaAgent } = require('./botbia.js'); // Import the agent from your existing code

// Create Express application
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from public directory
app.use(express.static(__dirname));

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize Botbia agent
let botbiaAgent;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function initializeBotbia() {
    try {
        // Extend the BotbiaAgent class to intercept task analysis
        class ExtendedBotbiaAgent extends BotbiaAgent {
            async analyzeTask(userInput) {
                const parsedResponse = await super.analyzeTask(userInput);
                
                // Broadcast the task analysis to all connected clients
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'task_analysis',
                            data: parsedResponse
                        }));
                    }
                });
                
                return parsedResponse;
            }

            async decideNextAction(thinkingState, context) {
                const parsedResponse = await super.decideNextAction(thinkingState, context);
                
                // Broadcast the task analysis to all connected clients
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'task_analysis',
                            data: parsedResponse
                        }));
                    }
                });
                
                return parsedResponse;
            }

            async observeAndLearn(actionResult, thinkingState) {
                const parsedResponse = await super.observeAndLearn(actionResult, thinkingState);
                
                // Broadcast the task analysis to all connected clients
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'task_analysis',
                            data: parsedResponse
                        }));
                    }
                });
                
                return parsedResponse;
            }
        }
        
        botbiaAgent = new ExtendedBotbiaAgent();
        await botbiaAgent.initialize();
        console.log("Botbia agent initialized successfully");
    } catch (error) {
        console.error("Failed to initialize Botbia agent:", error);
    }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('Client connected');
    
    // Send initial connection status
    ws.send(JSON.stringify({
        type: 'status',
        connected: botbiaAgent ? true : false,
        message: botbiaAgent ? 'Connected to browser' : 'Browser not connected'
    }));

    // Listen for messages from the client
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            console.log(data);

            const response = await botbiaAgent.processCommand(data.text);
                    
            ws.send(JSON.stringify({
                type: 'response',
                text: response
            }));
            
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: error.message
            }));
        }
    });

    // Handle disconnection
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Botbia server started on http://localhost:${PORT}`);
    initializeBotbia();
});

// Handle server shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down Botbia server...');
    if (botbiaAgent) {
        await botbiaAgent.shutdown();
    }
    process.exit(0);
});