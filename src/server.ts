import express from "express";
import dotenv from "dotenv";
import {authRouter} from "./routes/auth.routes";
import {globalErrorHandler} from "./lib/utils";
import cors from "cors";
import {authMiddleware} from "./middlewares/auth.middlewares";
import {designsRouter} from "./routes/designs.routes";
import {profileRouter} from "./routes/profile.routes";
import {paymentRouter} from "./routes/stripe.routes";
import {webhookRouter} from "./webhooks";

dotenv.config();

// Add comprehensive logging
console.log('=== SERVER STARTUP ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT from env:', process.env.PORT);

const PORT = parseInt(process.env.PORT || "8000", 10);
console.log('Final PORT:', PORT);

const app = express();

// Add error handlers early
process.on('uncaughtException', (error) => {
    console.error('❌ UNCAUGHT EXCEPTION:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ UNHANDLED REJECTION:', reason);
    process.exit(1);
});

// Middleware setup
app.use("/api/v1/webhooks", webhookRouter);
app.use(express.json());

// Fix CORS configuration
const allowedOrigins = [
    "http://localhost:3000",
    process.env.FRONTEND_BASE_URL!
].filter(Boolean);

console.log('Allowed CORS origins:', allowedOrigins);

app.use(cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true
}));

// Health check endpoint
app.get("/", (req, res) => {
    console.log('✅ Health check endpoint hit');
    res.status(200).json({
        status: "success",
        message: "Welcome to the server!",
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "healthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/designs", authMiddleware, designsRouter);
app.use("/api/v1/profile", authMiddleware, profileRouter);
app.use("/api/v1/payment", authMiddleware, paymentRouter);

// Global error handler
app.use(globalErrorHandler);

// Start server with proper error handling
console.log('🚀 Starting server...');

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('✅ Server successfully started!');
    console.log(`🌐 Server running on http://0.0.0.0:${PORT}`);
    console.log(`🔗 Server accessible at port ${PORT}`);
});

server.on('error', (error: any) => {
    console.error('❌ Server error:', error);
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
    }
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

console.log('📝 Server setup complete');
