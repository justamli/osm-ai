# Installation Guide for macOS

This guide covers setting up the Restaurant AI Application (Frontend and Backend) on a macOS environment from scratch.

## Prerequisites

Before starting, ensure you have the following installed on your Mac. We highly recommend using [Homebrew](https://brew.sh), the missing package manager for macOS.

1. **Homebrew**: Open your Terminal app and paste:
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. **Node.js**: As our JavaScript runtime.
   ```bash
   brew install node
   ```

3. **Git** (if you need to pull/push updates):
   ```bash
   brew install git
   ```

4. **Local LLM Server** (Required for the `callLocalLLM` functionality in the backend):
   - Install an inference runner like **LM Studio** and download an instruction-tuned model.
   - Start the local Inference Server on port `1234`.
   - Update line 22 in `server.js` (`const LLM_API_URL`) to point to your specific LM Studio local network IP or `localhost`.

---

## Backend Installation

The backend is built with Node.js and Express, using an SQLite database to store restaurant data and session history.

1. **Open your Terminal** and navigate to your project's root directory:
   ```bash
   cd /Users/justinlai/osm-ai
   ```

2. **Install Node dependencies**:
   ```bash
   npm install
   ```
   *(This automatically installs `express`, `sqlite3`, `cors`, `multer` and `csv-parser` defined in your `package.json`)*

3. **Start the Backend Node Server**:
   ```bash
   node server.js
   ```
   *You should see a message confirming the Backend Service is listening on port 3001, and that it successfully connected to the SQLite database (`data/restobase.sqlite` is auto-generated).*

---

## Frontend Installation

The frontend is a responsive UI operating on top of a Vite development environment.

1. **Open a new Terminal window/tab**.

2. **Navigate into the frontend project folder**:
   ```bash
   cd /Users/justinlai/osm-ai/frontend
   ```

3. **Install frontend dependencies**:
   ```bash
   npm install
   ```

4. **Launch the Development Server**:
   ```bash
   npm run dev
   ```

5. **Open the Application**:
   - The terminal will display a local address (usually `http://localhost:5173`).
   - `Cmd + Click` the link to open the AI Portal in your web browser. 
   - The frontend communicates seamlessly with the backend endpoints running on port `3001`.

---

## Configuration & Networking Settings

In order for the individual application components to route data correctly, the paths and ports must align across files. We have configured the default settings to work together, but if you need to alter them, check the following sources:

### Backend Configurations (`server.js`)
- **Web Port:** The backend is configured to run on Port `3001` (`const PORT = process.env.PORT || 3001;`).
- **Remote Network Access:** The backend binds to `0.0.0.0` so it accepts connections from other devices on your local Wi-Fi.
- **LLM Origin Engine:** Look for the `LLM_API_URL` setting. It currently targets your external local inference server (e.g., `http://192.168.105.136:1234/api/v1/chat`). If you run LM Studio on a different machine or locally, this must reflect accurately!

### Frontend Configurations (`frontend/src/main.js`)
If you change the backend port, you must also update the frontend route variables to match. Open `frontend/src/main.js` and verify the constants:
- `API_ENDPOINT`: Should point to `http://${window.location.hostname}:3001/api/chat/session`
- `PROMPT_API`: Should point to `http://${window.location.hostname}:3001/api/prompts`
- `API_RESTAURANTS`: Should point to `http://${window.location.hostname}:3001/api/restaurants`

> **Note:** By default, Vite hosts the frontend on port `5173`. Avoid hosting the backend on `5173`. 

--- 

## Shutting Down Services

Whenever you are done developing or testing:
- Return to your **Backend Terminal** and press `Ctrl + C` to stop the Node process.
- Return to your **Frontend Terminal** and press `Ctrl + C` to stop the Vite process.
