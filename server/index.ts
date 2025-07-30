import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { validateEnvironment } from "./config/aiConfig";
import { performanceMonitor } from "./utils/performanceMonitor";
import path from "path";
import { fileURLToPath } from "url";

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Only load dotenv in development - Railway provides env vars directly in production
if (process.env.NODE_ENV !== 'production') {
  const dotenv = await import('dotenv');
  dotenv.config();
}

const app = express();

// Configure CORS - simplified for better compatibility
const corsOptions = {
  origin: true, // Allow all origins - you can restrict this later if needed
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '15mb' })); // Increased limit for audio uploads (base64 encoded)
app.use(express.urlencoded({ extended: false, limit: '15mb' }));

// Add performance monitoring middleware
app.use(performanceMonitor.getMiddleware());

// Enhanced logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;
  const originalResJson = res.json;
  
  // Log incoming requests
  if (path.startsWith("/api")) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${path} - Origin: ${req.headers.origin || 'no-origin'}`);
    
    // Log request body for POST requests (excluding sensitive data)
    if (req.method === 'POST' && req.body) {
      const bodyLog = { ...req.body };
      if (bodyLog.audio) bodyLog.audio = `[base64 ${bodyLog.audio.length} chars]`;
      if (bodyLog.password) bodyLog.password = '[REDACTED]';
      console.log('Request body:', JSON.stringify(bodyLog).slice(0, 200));
    }
    
    // Special monitoring for STT API requests
    if (path === '/api/speech-to-text' && req.body?.audio) {
      const payloadSizeKB = Math.round(JSON.stringify(req.body).length / 1024);
      const audioSizeKB = Math.round(req.body.audio.length / 1024);
      console.log(`📊 STT Request Size: ${payloadSizeKB}KB total (${audioSizeKB}KB base64 audio)`);
    }
  }
  
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      
      // Log error responses in detail
      if (res.statusCode >= 400 && capturedJsonResponse) {
        console.error(`ERROR Response: ${JSON.stringify(capturedJsonResponse)}`);
      }
      
      if (capturedJsonResponse && res.statusCode < 400) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
    }
  });
  next();
});

(async () => {
  // 🚀 Validate environment variables on startup
  const envValidation = validateEnvironment();
  if (!envValidation.isValid) {
    console.warn('⚠️  Missing environment variables:', envValidation.missing);
    console.warn('Some features may not work properly. Please check your environment configuration.');
  } else {
    console.log('✅ All required environment variables are configured');
  }

  // Register API routes FIRST before any catch-all routes
  console.log('📝 Registering API routes...');
  const server = await registerRoutes(app);
  console.log('✅ API routes registered successfully');

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    
    // Log the error details
    console.error(`Error ${status}: ${message}`, {
      path: req.path,
      method: req.method,
      error: err.stack || err
    });
    
    // Ensure CORS headers are set even on errors
    if (!res.headersSent) {
      res.status(status).json({ 
        success: false,
        error: message,
        status: status 
      });
    }
  });

  // Serve static files in production
  if (process.env.NODE_ENV === "production") {
    const staticPath = path.resolve(__dirname, "..", "dist");

    console.log(`Serving static files from: ${staticPath}`);

    // Serve static files, but ONLY for non-API routes
    app.use((req, res, next) => {
      // Skip static file serving for API routes
      if (req.path.startsWith('/api/')) {
        return next();
      }
      // Serve static files for everything else
      express.static(staticPath)(req, res, next);
    });

    // Handle client-side routing - serve index.html for non-API routes only
    app.get("*", (req, res, next) => {
      // Skip for API routes - they should have been handled above
      if (req.path.startsWith('/api/')) {
        return next(); // This will result in a 404 if the API route wasn't found
      }
      
      const indexPath = path.resolve(staticPath, "index.html");
      res.sendFile(indexPath);
    });
  } else {
    // Setup vite in development - this also comes AFTER API routes
    await setupVite(app, server);
  }

  const port = process.env.PORT || 3000; // Use 3000 instead of 5000 to avoid macOS Control Center conflict
  const host = '0.0.0.0'; // Important for Railway deployment
  
  server.listen(
    port,
    host,
    () => {
      log(`serving on ${host}:${port}`);
      
      // Start performance monitoring after server is running
      console.log('🔍 Starting performance monitoring...');
      performanceMonitor.startMonitoring();
    },
  );
})();
