# Botbia Installation Guide

Botbia is an AI-powered browser assistant that helps you automate browser tasks using natural language commands. This guide will help you set up Botbia on your local machine.

## Prerequisites

- Node.js (v14 or later)
- Google Chrome browser
- Basic knowledge of using terminal/command prompt

## Installation Steps

1. **Download the Botbia files**

   Download and extract the Botbia package to a folder on your computer.

2. **Install dependencies**

   Open a terminal/command prompt in the Botbia folder and run:

   ```bash
   npm install
   ```

   This will install all the required dependencies for Botbia.

3. **Configure Chrome for automation**

   To allow Botbia to control your existing Chrome browser:

   - Close all Chrome windows
   - Create a shortcut to Chrome
   - Right-click the shortcut and select "Properties"
   - In the "Target" field, add the following to the end of the path (after the quotes):
     ```
     --remote-debugging-port=9222
     ```
   - Click OK to save the changes
   - Use this shortcut to open Chrome whenever you want to use Botbia

taskkill /IM chrome.exe /F

Start-Process "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" `
  -ArgumentList "--remote-debugging-port=9222"

   OR: Powerwhell:
   - Start-Process `
      -FilePath "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" `
      -ArgumentList @(
        "--remote-debugging-port=9222"
    )

   OR: For MAC:
   - Write: "/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222"
   - Into your terminal and enter, MAKE SURE ALL OTHER TABS ARE CLOSED.

   OR:
   - Botbia can start its own browser and you will be able to log in to your MICHIGAN student email
   - This will save tabs and features but may be blocked by websites that have cloudflare bot protection.

4. **Start Botbia**

   In the terminal/command prompt, run:

   ```bash
   node start.js
   ```

   This will start the Botbia server and automatically open the interface in your browser.

## Using Botbia

Once Botbia is running, you can give it commands in natural language, such as:

- "Open youtube.com"
- "Search for cat videos"
- "Click on the first video"
- "Scroll down"
- "Go back to the search results"
- "Take a screenshot"

Botbia will understand your commands and control the browser accordingly.

## Troubleshooting

- **Botbia can't connect to Chrome**
  - Make sure Chrome is running with the remote debugging port enabled
  - Try restarting both Chrome and Botbia

- **Commands are not working properly**
  - Be more specific with your commands
  - Try breaking down complex tasks into smaller steps

- **Other issues**
  - Check the terminal/command prompt for error messages
  - Restart the Botbia server by pressing Ctrl+C and running `node start.js` again

## Security Notes

- Botbia runs locally on your machine and doesn't send your data to any external servers (except for the AI commands which use OpenAI's API)
- The AI functionality requires an internet connection for OpenAI API access
- Never share your OpenAI API key with others

## Updating Botbia

To update Botbia to the latest version, download the newest package and replace your existing files, keeping your `agent_memory.json` file if you want to preserve your session data.