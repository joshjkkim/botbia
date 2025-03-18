const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { Configuration, OpenAIApi } = require('openai');
const fs = require('fs/promises');
const fsPromises = require('fs')
const path = require('path');

// Initialize AI client
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const time = 1000;

puppeteer.use(StealthPlugin());

class BotbiaAgent {
  constructor() {
    this.browser = null;
    this.activePage = null;
    this.memory = {
      shortTerm: [],
      longTerm: {
        interactions: {} // Initialize interactions here
      },
      context: {}
    };
    this.maxMemoryItems = 9;
  }

  async initialize() {
    console.log("Connecting to existing Chrome browser...");
    
    try {
      // Try to connect to an existing Chrome instance
      // You need to start Chrome with remote debugging enabled:
      // chrome.exe --remote-debugging-port=9222
      this.browser = await puppeteer.connect({
        browserURL: 'http://localhost:9222',
        defaultViewport: null
      });
      
      console.log("Successfully connected to existing Chrome browser");
      
      // Get all pages and select the active one
      const pages = await this.browser.pages();
      if (pages.length > 0) {
        // Use the most recently focused page as the active one
        this.activePage = pages[pages.length - 1];
        console.log(`Connected to page: ${await this.activePage.title()}`);
      } else {
        console.log("No pages found. Opening a new page");
        this.activePage = await this.browser.newPage();
      }
    } catch (error) {
      console.error("Failed to connect to existing browser:", error.message);
      console.log("Falling back to launching a new browser instance...");
      
      // Fall back to launching a new browser if connection fails
      const userDataDir = path.join(__dirname, 'automation-profile');
      if (!fsPromises.existsSync(userDataDir)) {
        fsPromises.mkdirSync(userDataDir);
      }

      this.browser = await puppeteer.launch({ 
        headless: false,
        defaultViewport: null,
        args: [
          '--start-maximized',
          '--remote-debugging-port=9222',
          `--user-data-dir=${userDataDir}`,
          '--disable-features=AutomationControlled'
        ]
      });
      
      this.activePage = await this.browser.newPage();
    }
    
    this.memory.longTerm = {}
    
    // Set up global error handler
    process.on('uncaughtException', this.handleError.bind(this));
    process.on('SIGINT', this.shutdown.bind(this));
    
    console.log("Botbia is now online and ready to assist.");
  }
  
  // Method to switch to a different tab/page
  async switchToPage(pageIndex) {
    try {
      const pages = await this.browser.pages();
      if (pageIndex >= 0 && pageIndex < pages.length) {
        this.activePage = pages[pageIndex];
        await this.activePage.bringToFront();
        return { 
          status: 'success', 
          message: `Switched to page: ${await this.activePage.title()}` 
        };
      } else {
        throw new Error("Invalid page index");
      }
    } catch (error) {
      throw new Error(`Failed to switch page: ${error.message}`);
    }
  }
  
  // Method to list all open tabs/pages
  async listPages() {
    try {
      const pages = await this.browser.pages();
      const pageInfo = await Promise.all(pages.map(async (page, index) => {
        return {
          index,
          title: await page.title(),
          url: page.url()
        };
      }));
      
      return { status: 'success', pages: pageInfo };
    } catch (error) {
      throw new Error(`Failed to list pages: ${error.message}`);
    }
  }

  // ...
  
  // Add this method to the BotbiaAgent class to allow users to trigger autonomous thinking
async processCommand(userInput) {
  // Add to memory
  this.updateMemory({ type: 'userCommand', content: userInput });
  
  // Check for autonomous thinking command
  if (userInput.toLowerCase().includes('think autonomously') || 
      userInput.toLowerCase().includes('explore autonomously') || 
      userInput.toLowerCase().includes('autonomous thinking')) {
    
    // Extract iterations if specified
    let iterations = 3; // Default
    const iterMatch = userInput.match(/(\d+)\s*iterations/i);
    if (iterMatch) {
      iterations = parseInt(iterMatch[1]);
      // Cap at reasonable limits
      iterations = Math.min(Math.max(iterations, 1), 10);
    }
    
    // Extract context if specified
    let context = null;
    const contextMatch = userInput.match(/about\s+(.+?)(\s+for|\s+with|\s*$)/i);
    if (contextMatch) {
      context = {
        inferredGoal: `Exploration of ${contextMatch[1]}`,
        topicOfInterest: contextMatch[1],
        suggestedExploration: `Learn more about ${contextMatch[1]}`
      };
    }
    
    // Start autonomous thinking process
    return this.autonomousThinking(context, iterations)
      .then(result => {
        // Generate a user-friendly response
        return `I did some autonomous exploration for you. Here's what I found:\n\n${result.summary}`;
      })
      .catch(error => `I ran into an issue while exploring autonomously: ${error.message}`);
  }
  
  // Handle special commands for browser control
  if (userInput.toLowerCase().startsWith('switch to tab')) {
    const indexMatch = userInput.match(/\d+/);
    if (indexMatch) {
      const index = parseInt(indexMatch[0]) - 1; // Convert to 0-based index
      return this.switchToPage(index)
        .then(result => `Switched to tab ${index + 1}: ${result.message}`)
        .catch(error => `Failed to switch tab: ${error.message}`);
    } else {
      return "Please specify a tab number, e.g., 'switch to tab 2'";
    }
  }
  
  if (userInput.toLowerCase() === 'list tabs' || userInput.toLowerCase() === 'show tabs') {
    return this.listPages()
      .then(result => {
        const tabs = result.pages.map(p => `Tab ${p.index + 1}: ${p.title} (${p.url})`).join('\n');
        return `Open tabs:\n${tabs}`;
      })
      .catch(error => `Failed to list tabs: ${error.message}`);
  }
  
  try {
    // Step 1: Analyze user request with AI
    const taskAnalysis = await this.analyzeTask(userInput);
    
    // Step 2: Execute the understood task
    const result = await this.executeTask(taskAnalysis, userInput);
    
    // Step 3: Generate response to user
    return await this.generateResponse(result, taskAnalysis);
  } catch (error) {
    return `I encountered an issue processing your request: ${error.message}. Is there another way I can help?`;
  }
}
  
  async analyzeTask(userInput) {
    // Get current context and a screenshot if we're on a web page
    let pageContext = '';
    
    // Build the prompt with both page context and the screenshot (base64)
    const prompt = `
      You are Botbia, an AI assistant that controls a web browser. The user command is:
      "${userInput}"
      
      ${pageContext ? `Current page context: ${JSON.stringify(pageContext, null, 2)}` : 'No active page context available.'}
      
      Analyze this command and return a JSON object ONLY with these exact fields:
      Intent Methods ONLY ONE PER COMMAND ASSUME HIGHEST PRIORITY:
      - "friend": If the user wants to casually conversate or anything text based that you deem important and memorable about the user.
      - "analyze": if the user wants you to analyze his page for a question or help
      - "navigate": head to a different website
      - "search": search in a search bar somewhere
      - "input": write/input information

      {
        "intent": "friend, analyze, navigate, search, input, click",
        "target": "target domain or app (e.g., youtube.com, symbolab.com)",
        "elements": "detailed description of the UI element to interact with",
        "data": "any text or search terms to use",
        "expectedOutcome": "what should happen after execution",
        "fallbackStrategies": ["list of fallback strategies"]
      }
      
      Example:
      For the command "search for cat videos on YouTube", return:
      {
        "intent": "search",
        "target": "youtube.com",
        "elements": "the search input field",
        "data": "cat videos",
        "expectedOutcome": "display search results for cat videos",
        "fallbackStrategies": ["navigate to youtube.com then search", "use google search with site:youtube.com"]
      }
      
      Do not include any explanations.
    `;
    await sleep(time);
    
    const response = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });
  
    try {
      // Parse the JSON response
      const responseText = response.data.choices[0].message.content;
      let parsedResponse;
      
      // Try to extract JSON if full response isn't JSON
      try {
        parsedResponse = JSON.parse(responseText);
      } catch (initialError) {
        // Look for JSON object in the response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedResponse = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Could not parse response as JSON");
        }
      }
      
      // Validate that we have the expected fields
      const requiredFields = ['intent', 'target', 'elements', 'data', 'expectedOutcome'];
      for (const field of requiredFields) {
        if (!parsedResponse[field]) {
          // Set defaults for missing fields to prevent undefined errors
          if (field === 'intent') {
            if (userInput.toLowerCase().includes('open') || userInput.toLowerCase().includes('go to')) {
              parsedResponse.intent = 'navigate';  
            } else if (userInput.toLowerCase().includes('search')) {
              parsedResponse.intent = 'search';
            } else if (userInput.toLowerCase().includes('talk') || userInput.toLowerCase().includes('chat') || userInput.toLowerCase().includes('why')) {
              parsedResponse.intent = 'talk'
            } else {
              parsedResponse.intent = 'navigate'; // Default to navigate as safest option
            }
          } else if (field === 'target') {
            // Extract domain from input if possible
            const domainMatch = userInput.match(/\b([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}\b/i);
            parsedResponse.target = domainMatch ? domainMatch[0] : 'google.com';
          } else {
            parsedResponse[field] = '';
          }
        }
      }
      
      console.log("Task analysis result:", parsedResponse);
      return parsedResponse;
    } catch (error) {
      console.error("Task analysis failed:", error);
      // Return a default analysis as fallback
      return {
        intent: 'navigate',
        target: userInput.includes('google') ? 'google.com' : 'google.com',
        elements: '',
        data: '',
        expectedOutcome: 'Open requested website',
        fallbackStrategies: ['search for the term']
      };
    }
  }
  
  // Improved executeTask function with better handling for navigation
  async executeTask(taskAnalysis, userInput) {
    const recentActions = await this.summarizeRecentPrompts(this.memory.shortTerm)
    this.updateMemory({ type: 'taskExecution', content: taskAnalysis });
    
    const { intent, target, elements, data, expectedOutcome } = taskAnalysis;
    
    console.log(`Executing task: ${intent} on ${target}`);
    
    // Better navigation handling
    if (intent === 'navigate') {
      try {
        let url = target;
        
        // Make sure we have a proper URL
        if (!url.startsWith('http') && !url.startsWith('about:')) {
          url = `https://${url}`;
        }
        
        console.log(`Navigating to: ${url}`);
        await this.activePage.goto(url, { waitUntil: 'domcontentloaded' });
        return { 
          status: 'success', 
          message: `Navigated to ${url}`,
          currentUrl: this.activePage.url()
        };
      } catch (error) {
        console.error(`Navigation error:`, error);
        throw new Error(`Failed to navigate: ${error.message}`);
      }
    }

    const pageContext = this.getCurrentPageContext();
    
    // Rest of the task execution logic...
    switch (intent) {
      case 'search':
        return await this.performSearch(target, data, recentActions);
        
      case 'input':
        return await this.enterInformation(elements, data, userInput, recentActions);
        
      case 'click':
        return await this.clickElement(elements, userInput,recentActions);

      case 'analyze':
        return await this.analyze(pageContext, userInput, recentActions);

      case 'friend':
        return await this.friend(userInput, recentActions);
        
      default:
        throw new Error(`Unknown intent: ${intent}`);
    }
  }
  
  async getCurrentPageContext() {
    // Get key information about the current page
    return await this.activePage.evaluate(() => {
      // Collect important elements and their text content
      const getVisibleElements = () => {
        const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map(el => el.textContent.trim());
        const formFields = Array.from(document.querySelectorAll('input, textarea, select'))
            .map(el => ({
                type: el.tagName.toLowerCase(),
                id: el.id,
                name: el.name,
                placeholder: el.placeholder
            }));
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'))
            .map(el => el.textContent.trim() || el.value || el.id || el.name);
        const links = Array.from(document.querySelectorAll('a[href]'))
            .slice(0, 10) // Only get first 10 to avoid overwhelming
            .map(el => ({ text: el.textContent.trim(), href: el.href }));
        
        return { headings, formFields, buttons, links };
      };
      
      return {
        url: window.location.href,
        title: document.title,
        mainText: document.body.innerText.substring(0, 500) + '...',
        visibleElements: getVisibleElements()
      };
    });
  }
  
  async performSearch(target, searchQuery, recentActions) {
    // Handle different search engines and sites
    if (!this.activePage || this.activePage.url() === 'about:blank') {
      await this.activePage.goto(`https://${target}`);
    }
    
    // Use AI to analyze page and find search input
    const pageInfo = await this.getCurrentPageContext();
    
    // Ask AI to identify the search selector based on page content
    const searchSelectorPrompt = `
      Here is a description of your most recent actions: "${JSON.stringify(recentActions)}"
      Based on this page info: ${JSON.stringify(pageInfo)},
      what is the most likely CSS selector for the main search input field?
      Return only the selector as a string.
    `;

    await sleep(time);
    
    const selectorResponse = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: searchSelectorPrompt }],
      temperature: 0.2,
    });
    
    const searchSelector = selectorResponse.data.choices[0].message.content.trim().replace(/^"|"$/g, '');
    
    // Try the AI-suggested selector, with fallbacks
    try {
      await this.activePage.waitForSelector(searchSelector, { timeout: 5000 });
      await this.activePage.type(searchSelector, searchQuery);
      await Promise.all([
        this.activePage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}),
        this.activePage.keyboard.press('Enter')
      ]);
    } catch (error) {
      // Fallback to common search selectors
      const commonSelectors = [
        'input[type="search"]',
        'input[name="q"]',
        'input[aria-label*="search" i]',
        'input[placeholder*="search" i]',
        '#search',
        '.search-input'
      ];
      
      for (const selector of commonSelectors) {
        try {
          await this.activePage.waitForSelector(selector, { timeout: 2000 });
          await this.activePage.type(selector, searchQuery);
          await this.activePage.keyboard.press('Enter');
          return { status: 'success', message: `Searched for "${searchQuery}" using fallback selector` };
        } catch (selectorError) {
          // Continue to next selector
        }
      }
      
      throw new Error("Could not locate search input");
    }
    
    return { status: 'success', message: `Searched for "${searchQuery}"` };
  }


  async analyze(pageContext, userInput, recentActions) {
    // Build the message without extra indentation
    if (pageContext instanceof Promise) {
      pageContext = await pageContext;
    }

    const screenshotBase64 = await this.activePage.screenshot({
      encoding: 'base64',
      fullPage: true,
    });
    const screenshotPath = path.join(__dirname, `debug_screenshot.png`);
    const buffer = Buffer.from(screenshotBase64, 'base64');
    fsPromises.writeFileSync(screenshotPath, buffer);
    console.log(`Screenshot saved to ${screenshotPath}`);
    // Build a plain object in case of any non-enumerable properties
    const plainContext = JSON.parse(JSON.stringify(pageContext));
  
    const response = await openai.createChatCompletion({
      model: "gpt-4o-mini", // or any model you prefer for conversation
      messages: [
        { role: "system", content: `You are a friendly conversational assistant that can analyze images. \n Here is a description of your most recent actions: "${JSON.stringify(recentActions)}` },
        { role: "user", content: [
          { type: "text", text: `${userInput} \n Page Context: ${pageContext}` },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${screenshotBase64}`
            }
          }
        ]}
      ],
      temperature: 0.7,
    });
    return response.data.choices[0].message.content;
  }

  async friend(userInput, recentActions) {
  // Retrieve persistent memory for friend interactions.
  // (Using the 'friend:friend' key, which you can adjust as needed.)
  const friendMemory = await this.getAiSelectorMemory('friend:friend');

  // Build the prompt with a very explicit instruction.
  const prompt = `${userInput}\n` +
    `If the message contains **ONLY** the **MOST** important information about the user and their life, include the exact word "!Remember" anywhere in your response. ` +
    `You should **NOT** include "!Remember" for casual conversation, only new and important information in the user's life. Be strict.` +
    `Here is a description of your most recent actions: "${JSON.stringify(recentActions)}"` +
    `Important Memory About User **THIS HAS ALREADY BEEN SAVED DO NOT RESAVE BASED ON THE FOLLOWING**: ${JSON.stringify(friendMemory)}`;

  console.log("Friend prompt:", prompt);

  const completion = await openai.createChatCompletion({
    model: "gpt-4o-mini", // Adjust model as needed
    messages: [
      { 
        role: "system", 
        content: "You are a friendly conversational assistant and a good friend to the user." 
      },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 300,
  });

  const friendResponse = completion.data.choices[0].message.content;

  console.log(friendResponse)
  const important = friendResponse.includes("!Remember");
  console.log(important)

  if (important) {
    await this.learnFromInteraction(
      { intent: 'friend', method: 'friend', details: { description: userInput } },
      true
    );
  }

  return friendResponse
}

  
  async enterInformation(elements, data, userInput, recentActions) {
    const pageInfo = await this.getCurrentPageContext();
    const description = typeof elements === 'string'
      ? elements
      : elements.text || elements.description || JSON.stringify(elements);

    const aiSelectorMemory = await this.getAiSelectorMemory('input:ai-selector', pageInfo.url);
    let aiSelector = null;
    
    // --- Attempt 1: AI-generated selector with a revised prompt ---
    try {
      const inputSelectorPrompt = `
        Here is a description of your most recent actions: "${JSON.stringify(recentActions)}"
        Based on the following page context:
        URL: ${pageInfo.url}
        Page Context: "${JSON.stringify(pageInfo)}"

        Memory of Recent Clicks: "${JSON.stringify(aiSelectorMemory)}"
        
        Given the element description: "${description}",

        Lastly, the User has asked: "${userInput}"

        please generate a precise HTML selector element that identifies a element corresponding to the description
        
        Return only the CSS selector as a string.
      `;

      console.log(inputSelectorPrompt)
      await sleep(time);

      const selectorResponse = await openai.createChatCompletion({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: inputSelectorPrompt }],
        temperature: 0.2,
      });
      aiSelector = selectorResponse.data.choices[0].message.content.replace(/```(css)?\n?|\n?```/g, '').trim();

      await this.activePage.waitForSelector(aiSelector, { timeout: 10000, visible: true });
      const elementHandle = await this.activePage.$(aiSelector);
      await elementHandle.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await elementHandle.click();
      await this.activePage.type(aiSelector, data);
      await this.learnFromInteraction(
        { intent: 'input', method: 'ai-selector', details: { url: pageInfo.url, selector: aiSelector, description } },
        true
      );
      return { status: 'success', message: `Entered text using AI selector: ${aiSelector}` };
    } catch (error) {
      console.warn(`AI selector approach failed: ${error.message}`);
    }
    
    // --- Attempt 2: Broad dynamic candidate detection ---
    try {
      const candidateHandle = await this.activePage.evaluateHandle((desc) => {
        const lowerDesc = desc.toLowerCase();
        // Gather standard selectors.
        let candidates = Array.from(document.querySelectorAll(
          'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]'
        ));
        // Also scan the whole document for any container that holds a nested textarea or input.
        const containerCandidates = Array.from(document.querySelectorAll('*')).reduce((acc, el) => {
          if (['TEXTAREA', 'INPUT'].includes(el.tagName)) return acc;
          const nested = el.querySelector('textarea, input[type="text"]');
          if (nested) {
            const rect = nested.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) acc.push(nested);
          }
          return acc;
        }, []);
        candidates = candidates.concat(containerCandidates);
        // Remove duplicates.
        candidates = candidates.filter((el, i, self) => self.indexOf(el) === i);
        // Filter only visible candidates.
        const visibleCandidates = candidates.filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        // Prioritize elements whose attributes hint at input purposes.
        const keywords = ['input', 'paste', 'post', 'calc', 'search', 'main'];
        let bestCandidate = visibleCandidates.find(el => {
          const attrs = (el.id || '') + ' ' + (el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '');
          return keywords.some(kw => attrs.toLowerCase().includes(kw));
        });
        return bestCandidate || (visibleCandidates.length > 0 ? visibleCandidates[0] : null);
      }, description);
      
      const candidate = candidateHandle.asElement();
      if (candidate) {
        await candidate.click({ delay: 50 });
        const isContentEditable = await this.activePage.evaluate(el => el.getAttribute('contenteditable') === 'true', candidate);
        if (isContentEditable) {
          await this.activePage.evaluate((el, inputData) => {
            el.focus();
            el.innerHTML = '';
            el.textContent = inputData;
          }, candidate, data);
        } else {
          await candidate.type(data);
        }
        return { status: 'success', message: 'Entered text using dynamic candidate detection.' };
      }
    } catch (error) {
      console.warn(`Dynamic candidate detection failed: ${error.message}`);
    }
    
    // --- Attempt 3: Fallback via direct DOM manipulation ---
    try {
      const success = await this.activePage.evaluate((desc, inputData) => {
        const lowerDesc = desc.toLowerCase();
        const candidates = Array.from(document.querySelectorAll(
          'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]'
        ));
        const containerCandidates = Array.from(document.querySelectorAll('*'))
          .filter(el => !['TEXTAREA', 'INPUT'].includes(el.tagName) && el.querySelector('textarea'))
          .map(el => el.querySelector('textarea'));
        const allCandidates = candidates.concat(containerCandidates)
          .filter((el, i, self) => self.indexOf(el) === i)
          .filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        let target = allCandidates.find(el => {
          const attrs = (el.id || '') + ' ' +
                        (el.getAttribute('placeholder') || '') + ' ' +
                        (el.getAttribute('aria-label') || '') + ' ' +
                        (el.innerText || '');
          return attrs.toLowerCase().includes(lowerDesc);
        });
        if (target) {
          target.focus();
          if (target.getAttribute('contenteditable') === 'true') {
            target.innerHTML = '';
            target.textContent = inputData;
          } else {
            target.value = inputData;
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return true;
        }
        return false;
      }, description, data);
      
      if (success) {
        return { status: 'success', message: 'Entered text using fallback DOM manipulation.' };
      } else {
        throw new Error("No matching input candidate found via fallback.");
      }
    } catch (error) {
      throw new Error(`Could not dynamically find a suitable input field: ${error.message}`);
    }
  }
  
  
  async clickElement(elements, userInput, recentActions) {
    
    // Replace the simple click with Promise.all to handle potential navigation


    const pageInfo = await this.getCurrentPageContext();
    const elementDescription = typeof elements === 'string' ? elements : (elements.text || JSON.stringify(elements));
    
    // Access memory safely
    const aiSelectorMemory = await this.getAiSelectorMemory('click:ai-selector', pageInfo.url);
    
    let aiSelector = null;  // Declare variable here
    
    // --- Attempt 1: AI-generated selector ---
    try {
      const clickSelectorPrompt = `
        Here is a description of your most recent actions: "${JSON.stringify(recentActions)}"
        Based on the following page context:
        URL: ${pageInfo.url}
        Memory of Recent Clicks: "${JSON.stringify(aiSelectorMemory)}"

        Page Context: "${JSON.stringify(pageInfo)}"

        
        And given the element description: "${elementDescription}",
        
        Finally this is what the user requests: "${userInput}"
    
        please generate a precise HTML selector element that identifies a element corresponding to the description.
        
        Return only the CSS selector as a string.
      `;
      await sleep(time);

      console.log(clickSelectorPrompt)
  
      const selectorResponse = await openai.createChatCompletion({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: clickSelectorPrompt }],
        temperature: 0.2,
      });

      aiSelector = selectorResponse.data.choices[0].message.content.replace(/```(css)?\n?|\n?```/g, '').trim();

      console.log(aiSelector)
      await this.activePage.waitForSelector(aiSelector, { timeout: 5000 });

      await Promise.all([
        this.activePage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
        this.activePage.click(aiSelector)
      ]);
      await this.activePage.click(aiSelector);
      
      // Record success, including the selector used
      await this.learnFromInteraction(
        { intent: 'click', method: 'ai-selector', details: { url: pageInfo.url, selector: aiSelector, elementDescription } },
        true
      );
      return { status: 'success', message: `Clicked using AI selector: ${aiSelector}` };
    } catch (error) {
      console.warn(`AI selector approach failed: ${error.message}`);
      // Record failure without referencing aiSelector if it's null
    }
    
    // --- Attempt 2: Dynamic candidate detection using similarity matching ---
    try {
      const candidateResult = await this.activePage.evaluate((desc) => {
        function similarity(s1, s2) {
          s1 = s1.toLowerCase();
          s2 = s2.toLowerCase();
          const words1 = s1.split(/\s+/).filter(Boolean);
          const words2 = s2.split(/\s+/).filter(Boolean);
          if (!words1.length || !words2.length) return 0;
          const common = words1.filter(word => words2.includes(word));
          return common.length / Math.max(words1.length, words2.length);
        }
        const candidates = Array.from(document.querySelectorAll('a, button, [role="button"]'));
        let bestCandidate = null;
        let bestScore = 0;
        const lowerDesc = desc.toLowerCase();
        let scores = [];
        for (const el of candidates) {
          const text = (el.innerText || el.textContent || '').trim();
          if (!text) continue;
          if (text.toLowerCase().includes('ad ') || text.toLowerCase().includes(' advertisement')) continue;
          const score = similarity(text, lowerDesc);
          scores.push({ text, score });
          if (score > bestScore) {
            bestScore = score;
            bestCandidate = el;
          }
        }
        console.log("Candidate scores:", scores);
        if (bestCandidate && bestScore >= 0.3) {
          bestCandidate.click();
          return { clicked: true, method: 'similarity matching', score: bestScore };
        }
        return { clicked: false };
      }, elementDescription);
      
      if (candidateResult.clicked) {
        return { status: 'success', message: `Clicked element using similarity matching (score: ${candidateResult.score.toFixed(2)}).` };
      }
    } catch (error) {
      console.warn(`Dynamic candidate detection failed: ${error.message}`);
    }
    
    // --- Attempt 3: Fallback - click the most prominent visible clickable element ---
    try {
      await this.activePage.evaluate(() => {
        const interactiveElements = Array.from(document.querySelectorAll('a, button, [role="button"]'))
          .filter(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0;
          });
        if (interactiveElements.length) {
          interactiveElements.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
          interactiveElements[0].click();
          return true;
        }
        throw new Error("No visible clickable element found");
      });
      return { status: 'success', message: 'Clicked on the most prominent clickable element dynamically.' };
    } catch (error) {
      throw new Error(`Could not dynamically click on the element: ${error.message}`);
    }
  }
  
  async generateResponse(result, taskAnalysis) {
    const prompt = `
      As Botbia, generate a response to the user about the following action:
      
      Task analysis: ${JSON.stringify(taskAnalysis)}
      Action result: ${JSON.stringify(result)}
      
      Respond as a realistic friend not too formal but not too informal.
      If the information above comes from the intent "friend", you do not have to restate too much the response as it is just a casual conversation.
      Keep the response concise but informative.
    `;

    await sleep(time);
    
    const response = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });
    
    const message = response.data.choices[0].message.content;
    this.updateMemory({ type: 'response', content: message });
    return message;
  }

  async summarizeRecentPrompts(shortTermMemory) {
    const prompt = `
      Here are your recent taskExecutions, userCommands, and responses as a helpful AI friend and agent. 
      Please summarize them in a short, concise, but descriptful way to give context for future actions.
      ${JSON.stringify(shortTermMemory)}
    `;

    await sleep(time);
    
    const response = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });
    
    const message = response.data.choices[0].message.content;
    console.log(message)
    return message;
  }
  
  
  updateMemory(item) {
    // Add item to short-term memory
    this.memory.shortTerm.push({
      ...item,
      timestamp: new Date().toISOString()
    });
    
    // Keep memory size manageable
    if (this.memory.shortTerm.length > this.maxMemoryItems) {
      this.memory.shortTerm.shift();
    }
    
    // Update long-term memory based on patterns
    if (item.type === 'userCommand') {
      // Record user preferences and patterns
      const words = item.content.toLowerCase().split(' ');
      for (const word of words) {
        if (this.memory.longTerm.keywords) {
          this.memory.longTerm.keywords[word] = (this.memory.longTerm.keywords[word] || 0) + 1;
        } else {
          this.memory.longTerm.keywords = { [word]: 1 };
        }
      }
    }
  }
  
  async learnFromInteraction(interaction, success) {
    // Create a composite key that includes intent and method.
    const interactionKey = `${interaction.intent}:${interaction.method || 'general'}`;
    const memoryPath = path.join(__dirname, 'agent_memory.json');
  
    // Load existing persistent memory from file
    let persistentMemory = { interactions: {} };
    try {
      const data = await fs.readFile(memoryPath, 'utf8');
      persistentMemory = JSON.parse(data);
      if (!persistentMemory.interactions) {
        persistentMemory.interactions = {};
      }
    } catch (err) {
      console.log("No existing memory file found, starting fresh.");
    }
    
    // Get the existing record for this key or initialize it
    let record = persistentMemory.interactions[interactionKey] || { successes: 0, failures: 0, examples: [] };
    
    // Update the counters
    if (success) {
      record.successes = (record.successes || 0) + 1;
    } else {
      record.failures = (record.failures || 0) + 1;
    }
    
    // Prepend the new interaction details
    record.examples.unshift({
      interaction,
      success,
      timestamp: new Date().toISOString()
    });
    
    // Limit the number of stored examples (e.g., keep only the 5 most recent)
    if (record.examples.length > 5) {
      record.examples = record.examples.slice(0, 5);
    }
    
    // Save the updated record back into the persistent memory
    persistentMemory.interactions[interactionKey] = record;
    
    // Write the updated memory back to file
    try {
      await fs.writeFile(memoryPath, JSON.stringify(persistentMemory, null, 2), 'utf8');
      console.log("Memory saved successfully.");
    } catch (error) {
      console.error("Error saving memory:", error);
    }
    
    // Optionally, update the in-memory memory too
    this.memory.longTerm.interactions = persistentMemory.interactions;
  }
  
  
  async saveMemory() {
    try {
      const memoryPath = path.join(__dirname, 'agent_memory.json');
      await fs.writeFile(memoryPath, JSON.stringify(this.memory.longTerm, null, 2), 'utf8');
      console.log("Memory saved successfully.");
    } catch (error) {
      console.error("Error saving memory:", error);
    }
  }
  
    async loadPersistentMemory() {
      const memoryPath = path.join(__dirname, 'agent_memory.json');
      try {
        const data = await fs.readFile(memoryPath, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        console.log("No persistent memory file found; using empty memory.");
        return {};
      }
    }
    
    async getAiSelectorMemory(key, urlFilter) {
      // Load persistent memory from file
      const persistentMemory = await this.loadPersistentMemory();
      // Get interactions from persistent memory
      const persistentInteractions = persistentMemory.interactions || {};
      // Merge persistent interactions with current local interactions (if any)
      const localInteractions = this.memory.longTerm.interactions || {};
      const mergedInteractions = { ...persistentInteractions, ...localInteractions };
      
      // Retrieve memory for the given key (default if not found)
      let memory = mergedInteractions[key] || { successes: 0, failures: 0, examples: [] };
    
      // If a URL filter is provided, filter the examples accordingly.
      if (urlFilter) {
        const filteredExamples = memory.examples.filter(example => {
          const url = example.interaction?.details?.url;
          console.log("URL: ", url);
          console.log("URL KEY: ", urlFilter);
          
          if (!url) return false; // Skip if no URL
          try {
            const hostname = new URL(url).hostname;
            const filterHostname = new URL(urlFilter).hostname
            return hostname.includes(filterHostname);
          } catch (e) {
            return false; // Invalid URL, exclude
          }
        });
        // Recalculate successes and failures based on filtered examples.
        const successes = filteredExamples.filter(example => example.success === true).length;
        const failures = filteredExamples.filter(example => example.success !== true).length;
        memory = { successes, failures, examples: filteredExamples };
      }
      
      return memory;
    }
    
  
  async handleError(error) {
    console.error("Botbia encountered an error:", error);
    
    // Try to recover browser if it crashed
    if (!this.browser || !this.browser.isConnected()) {
      try {
        console.log("Attempting to restart browser...");
        this.browser = await puppeteer.launch({ 
          headless: false,
          defaultViewport: null,
          args: ['--start-maximized']
        });
        this.activePage = await this.browser.newPage();
        console.log("Browser restarted successfully");
      } catch (restartError) {
        console.error("Failed to restart browser:", restartError);
      }
    }
  }
  
  async shutdown() {
    console.log("Shutting down Botbia...");
    if (this.browser) {
      // Don't close the browser if we connected to an existing one
      await this.browser.disconnect();
    }
    console.log("Botbia has been shut down.");
    process.exit(0);
  }

  async captureScreenshot() {
    const screenshotPath = path.join(__dirname, `screenshot_${Date.now()}.png`);
    await this.activePage.screenshot({ path: screenshotPath, fullPage: true });
    return { status: 'success', message: `Screenshot saved to ${screenshotPath}` };
  }
  
  async runJavascript(code) {
    // CAUTION: This is potentially dangerous and should have strict validation
    try {
      const result = await this.activePage.evaluate((userCode) => {
        // Execute in page context
        try {
          return { success: true, result: eval(userCode) };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, code);
      
      return result;
    } catch (error) {
      throw new Error(`Failed to execute JavaScript: ${error.message}`);
    }
  }
  
  async useAPI(apiDetails) {
    // Method to interact with APIs instead of browser
    // Implementation would depend on specific APIs needed
    throw new Error("API interaction not yet implemented");
  }

  async autonomousThinking(context, iterations = 3) {
    console.log("Starting autonomous thinking process...");
    
    // Initialize thinking state
    let thinkingState = {
      currentGoal: null,
      explorationPath: [],
      discoveries: [],
      currentPage: await this.getCurrentPageContext(),
      iterationsLeft: iterations
    };
    
    // If no explicit context is provided, try to determine it
    if (!context) {
      context = await this.inferContextFromHistory();
    }
    
    // Start the thinking process
    while (thinkingState.iterationsLeft > 0) {
      console.log(`Autonomous thinking iteration ${iterations - thinkingState.iterationsLeft + 1}/${iterations}`);
      
      // Step 1: Decide what to do next based on current state and context
      const nextAction = await this.decideNextAction(thinkingState, context);
      
      // Step 2: Execute the decided action
      const actionResult = await this.executeAutonomousAction(nextAction);

      try {
        await this.activePage.evaluate(() => document.title);
      } catch (error) {
        console.log("Page context was destroyed, retrieving new context");
        // Wait for any pending navigations to complete
        try {
          await this.activePage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 3000 });
        } catch (navError) {
          // It's ok if there's no navigation or it times out
      }
    }
      
      // Step 3: Observe and learn from the result
      await this.observeAndLearn(actionResult, thinkingState);
      
      // Step 4: Update the thinking state
      thinkingState.explorationPath.push({
        action: nextAction,
        result: actionResult,
        timestamp: new Date().toISOString()
      });
      
      thinkingState.currentPage = await this.getCurrentPageContext();
      thinkingState.iterationsLeft--;
      
      // Add a small delay between iterations
      await sleep(1500);
    }
    
    // Generate a summary of what was learned
    const summary = await this.generateExplorationSummary(thinkingState);
    return summary;
  }
  
  async inferContextFromHistory() {
    // Analyze recent interactions to infer what the context might be
    const recentHistory = this.memory.shortTerm.slice(-5);
    
    const prompt = `
      Based on these recent interactions, what is the user's likely goal or interest?
      ${JSON.stringify(recentHistory)}
      
      Respond with a JSON object:
      {
        "inferredGoal": "brief description of the user's likely goal",
        "topicOfInterest": "main topic the user seems interested in",
        "suggestedExploration": "what might be valuable to explore related to this topic"
      }
    `;
    
    await sleep(1000);
    
    const response = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      response_format: { type: "json_object" }
    });
    
    try {
      return JSON.parse(response.data.choices[0].message.content);
    } catch (error) {
      console.error("Failed to parse inferred context:", error);
      return { 
        inferredGoal: "general exploration",
        topicOfInterest: "current page content",
        suggestedExploration: "explore related topics"
      };
    }
  }
  
  async decideNextAction(thinkingState, context) {
    // Get a screenshot of the current page for better context
    const screenshotBase64 = await this.activePage.screenshot({
      encoding: 'base64',
      fullPage: false
    });
    
    // Prepare the prompt for decision making
    const prompt = {
      role: "user", 
      content: [
        { 
          type: "text", 
          text: `You are an autonomous web agent deciding what to do next.
          
          Current context:
          ${JSON.stringify(context)}
          
          Current page info:
          ${JSON.stringify(thinkingState.currentPage)}
          
          Exploration path so far:
          ${JSON.stringify(thinkingState.explorationPath)}
          
          Decide what to do next. Return a JSON object with these fields:
          - intent: "navigate", "click", "search", or "analyze"
          - reasoning: brief explanation of why this action was chosen
          - target: target website, element, or search query
          - elements: description of elements to interact with
          - data: any data to input (if applicable)
          
          Be opportunistic and curious. Make decisions that would uncover interesting information related to the context.
          `
        },
        {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${screenshotBase64}`
          }
        }
      ]
    };
    
    await sleep(1000);
    
    const response = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "You are an autonomous web exploration agent. You make decisions about what to explore next based on context and goals."
        },
        prompt
      ],
      temperature: 0.6,
      response_format: { type: "json_object" }
    });
    
    try {
      const decision = JSON.parse(response.data.choices[0].message.content);
      console.log("Autonomous decision:", decision);
      return decision;
    } catch (error) {
      console.error("Failed to parse autonomous decision:", error);
      // Default fallback action
      return {
        intent: "analyze",
        reasoning: "Analyzing current page due to error in decision making",
        target: thinkingState.currentPage.url,
        elements: "page content",
        data: ""
      };
    }
  }
  
  async executeAutonomousAction(action) {
    console.log(`Executing autonomous action: ${action.intent}`);
    
    try {
      // Structure the action as a task analysis object
      const taskAnalysis = {
        intent: action.intent,
        target: action.target,
        elements: action.elements,
        data: action.data,
        expectedOutcome: action.reasoning,
        fallbackStrategies: ["analyze current page", "navigate to related content"]
      };
      
      // Use the existing executeTask method to perform the action
      const result = await this.executeTask(taskAnalysis, `Autonomous action: ${action.reasoning}`);

      try {
        await this.activePage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 3000 });
      } catch (navError) {
        // It's ok if there's no navigation or it times out
      }
      
      // Check if the result is a string (which happens with 'analyze' intent)
      if (typeof result === 'string') {
        // Wrap the string result in an object with the expected properties
        return {
          status: 'success',
          message: result,
          reasoning: action.reasoning
        };
      }
      
      // If it's already an object, just add the reasoning to it
      result.reasoning = action.reasoning;
      return result;
    } catch (error) {
      console.error(`Autonomous action failed: ${error.message}`);
      return {
        status: 'error',
        message: `Failed to execute autonomous action: ${error.message}`,
        reasoning: action.reasoning
      };
    }
  }
  
  async observeAndLearn(actionResult, thinkingState) {
    // Extract the current page content
    const pageContent = await this.getCurrentPageContext();
    
    // Take a screenshot for analysis
    const screenshotBase64 = await this.activePage.screenshot({
      encoding: 'base64',
      fullPage: false
    });
    
    // Analyze what was learned from this action
    const prompt = {
      role: "user",
      content: [
        {
          type: "text",
          text: `
            Analyze what was learned from this autonomous action:
            
            Action: ${JSON.stringify(actionResult)}
            
            Current page info:
            ${JSON.stringify(pageContent)}
            
            Identify any new discoveries or insights from this action.
            Return a JSON object with:
            - keyDiscovery: the most important thing learned
            - relevance: how relevant this is to the original goal (0-10)
            - newTopics: array of new topics or areas that might be worth exploring
            - shouldContinueExploring: boolean indicating if this path seems promising
          `
        },
        {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${screenshotBase64}`
          }
        }
      ]
    };
    
    await sleep(1000);
    
    const response = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an observant web exploration agent. You analyze what was learned from autonomous actions."
        },
        prompt
      ],
      temperature: 0.4,
      response_format: { type: "json_object" }
    });
    
    try {
      const analysis = JSON.parse(response.data.choices[0].message.content);
      console.log("Action analysis:", analysis);
      
      // Add the analysis to discoveries
      thinkingState.discoveries.push({
        action: actionResult,
        analysis: analysis,
        timestamp: new Date().toISOString()
      });
      
      // Update the agent's memory with this learning
      this.updateMemory({
        type: 'autonomousLearning',
        content: {
          discovery: analysis.keyDiscovery,
          relevance: analysis.relevance,
          topics: analysis.newTopics
        }
      });
      
      return analysis;
    } catch (error) {
      console.error("Failed to analyze action result:", error);
      return {
        keyDiscovery: "Error analyzing result",
        relevance: 0,
        newTopics: [],
        shouldContinueExploring: false
      };
    }
  }
  
  async generateExplorationSummary(thinkingState) {
    // Generate a summary of what was learned during exploration
    const prompt = `
      Generate a summary of what was learned during this autonomous exploration session:
      
      Exploration path:
      ${JSON.stringify(thinkingState.explorationPath)}
      
      Discoveries:
      ${JSON.stringify(thinkingState.discoveries)}
      
      Generate a summary that explains:
      1. What the agent explored and why
      2. The most important discoveries or insights
      3. How this relates to the user's likely interests
      4. What might be worth exploring further
      
      Keep the summary concise but informative.
    `;
    
    await sleep(1000);
    
    const response = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 350
    });
    
    const summary = response.data.choices[0].message.content;
    
    // Add the summary to the agent's memory
    this.updateMemory({
      type: 'autonomousSummary',
      content: summary
    });
    
    return {
      status: 'success',
      message: 'Autonomous exploration complete',
      summary: summary,
      explorationPath: thinkingState.explorationPath,
      discoveries: thinkingState.discoveries
    };
  }
  
  // Helper function to handle web page navigation events during autonomous exploration
  async handleNavigationEvent(url) {
    // Wait for navigation to complete
    try {
      await this.activePage.waitForNavigation({ 
        waitUntil: 'domcontentloaded',
        timeout: 10000 
      });
      return { status: 'success', message: `Navigation to ${url} complete` };
    } catch (error) {
      console.warn(`Navigation event timed out: ${error.message}`);
      return { status: 'warning', message: `Navigation may not have completed: ${error.message}` };
    }
  }
  
  async multiStep(steps) {
    // Execute a series of steps in sequence
    const results = [];
    for (const step of steps) {
      try {
        const result = await this.executeTask(step);
        results.push({ step, result, success: true });
      } catch (error) {
        results.push({ step, error: error.message, success: false });
        // Decide whether to continue or abort based on step importance
        if (step.critical) {
          throw new Error(`Critical step failed: ${error.message}`);
        }
      }
    }
    return results;
  }
  
  async waitForCondition(condition, timeout = 30000) {
    // Wait for a specific condition to be true on the page
    try {
      await this.activePage.waitForFunction(condition, { timeout });
      return { status: 'success', message: 'Condition met' };
    } catch (error) {
      throw new Error(`Condition not met within timeout: ${error.message}`);
    }
  }
  
  
  async getElementAttribute(selector, attribute) {
    // Get a specific attribute from an element
    try {
      const value = await this.activePage.$eval(selector, (el, attr) => el[attr] || el.getAttribute(attr), attribute);
      return { status: 'success', value };
    } catch (error) {
      throw new Error(`Failed to get attribute: ${error.message}`);
    }
  }


}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { BotbiaAgent };
