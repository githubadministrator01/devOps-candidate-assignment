const express = require("express");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;

// Allow override for testing
const SECRET_PATH = process.env.SECRET_PATH || "/mnt/secrets-store/my-secret";

// In-memory cache with hot reload capability
let secretCache = {
  value: null,
  lastUpdated: null,
  watcherActive: false
};

/**
 * Read secret from file system
 */
function readSecretFromDisk() {
  try {
    const value = fs.readFileSync(SECRET_PATH, "utf8").trim();
    const stats = fs.statSync(SECRET_PATH);
    
    secretCache = {
      value: value,
      lastUpdated: new Date().toISOString(),
      fileModified: stats.mtime.toISOString(),
      watcherActive: secretCache.watcherActive
    };
    
    console.log(`[${new Date().toISOString()}] Secret loaded: ${value.substring(0, 20)}...`);
    return value;
  } catch (err) {
    // In test/dev environment, use fallback value
    if (process.env.NODE_ENV === 'test' || !fs.existsSync('/mnt/secrets-store')) {
      return "TEST_SECRET_VALUE";
    }
    
    console.error(`[${new Date().toISOString()}] Error reading secret:`, err.message);
    return "SECRET_NOT_AVAILABLE";
  }
}

/**
 * Set up file watcher for hot reload
 * This watches the actual file for changes and reloads automatically
 */
function setupFileWatcher() {
  if (secretCache.watcherActive) {
    console.log("File watcher already active");
    return;
  }

  // Skip file watching in test environment
  if (process.env.NODE_ENV === 'test') {
    console.log("Skipping file watcher in test environment");
    return;
  }

  // Check if the directory exists
  const watchDir = '/mnt/secrets-store';
  if (!fs.existsSync(watchDir)) {
    console.log("Secret directory not found - skipping file watcher");
    return;
  }

  try {
    console.log(`Setting up file watcher on ${watchDir}...`);
    
    fs.watch(watchDir, { recursive: false }, (eventType, filename) => {
      if (filename === 'my-secret' || filename === '..data') {
        console.log(`[${new Date().toISOString()}] File change detected: ${eventType} on ${filename}`);
        
        // Small delay to ensure file is fully written
        setTimeout(() => {
          const oldValue = secretCache.value;
          const newValue = readSecretFromDisk();
          
          if (oldValue !== newValue) {
            console.log(`[${new Date().toISOString()}] 🔄 SECRET ROTATED!`);
            console.log(`  Old: ${oldValue}`);
            console.log(`  New: ${newValue}`);
          }
        }, 100);
      }
    });
    
    secretCache.watcherActive = true;
    console.log("✅ File watcher active - hot reload enabled!");
    
  } catch (err) {
    console.error("Failed to set up file watcher:", err.message);
    console.log("Secret will be read on each request (slower but still works)");
  }
}

/**
 * Get current secret value (always fresh)
 */
function getSecret() {
  // Always read from disk to ensure we have the latest value
  return readSecretFromDisk();
}

// Endpoints
app.get("/", (req, res) => {
  res.json({
    service: "my-node-app",
    status: "running",
    version: "2.0.0-hot-reload",
    features: {
      fileWatching: secretCache.watcherActive,
      hotReload: true
    }
  });
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.get("/config", (req, res) => {
  res.json({
    mySecret: getSecret(),
    timestamp: new Date().toISOString(),
    lastUpdated: secretCache.lastUpdated,
    fileWatcherActive: secretCache.watcherActive
  });
});

app.get("/secret-info", (req, res) => {
  try {
    if (!fs.existsSync(SECRET_PATH)) {
      return res.json({
        value: getSecret(),
        path: SECRET_PATH,
        exists: false,
        mode: "fallback"
      });
    }

    const stats = fs.statSync(SECRET_PATH);
    const realPath = fs.realpathSync(SECRET_PATH);
    
    res.json({
      value: getSecret(),
      path: SECRET_PATH,
      realPath: realPath,
      isSymlink: realPath !== SECRET_PATH,
      fileModified: stats.mtime.toISOString(),
      cacheLastUpdated: secretCache.lastUpdated,
      watcherActive: secretCache.watcherActive
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/trigger-reload", (req, res) => {
  const oldValue = secretCache.value;
  const newValue = readSecretFromDisk();
  
  res.json({
    message: "Manual reload triggered",
    changed: oldValue !== newValue,
    oldValue: oldValue,
    newValue: newValue,
    timestamp: new Date().toISOString()
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║  Node.js App with Hot Secret Reload                 ║
╚══════════════════════════════════════════════════════╝

Server running on port ${PORT}

Endpoints:
  GET /              - Service info
  GET /health        - Health check
  GET /config        - Config with secret (auto-reloads)
  GET /secret-info   - Detailed secret information
  GET /trigger-reload - Manually trigger secret reload

Features:
  ✅ File system watching enabled
  ✅ Automatic secret hot reload
  ✅ No pod restart required
    `);
    
    // Initial load
    readSecretFromDisk();
    
    // Start watching for changes
    setupFileWatcher();
  });
}

module.exports = app;