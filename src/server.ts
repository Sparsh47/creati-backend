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
import neo4jDriver, { testConnection } from "./services/neo4j.service";
// REMOVED: import {neo4jKeepalive} from "./scripts/keepalive.script";

dotenv.config();

console.log('=== SERVER STARTUP ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT from env:', process.env.PORT);

// Validate Neo4j environment variables
function validateNeo4jEnvironment() {
    const required = ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD'];
    const missing = required.filter(env => !process.env[env]);

    if (missing.length > 0) {
        console.error('❌ Missing required Neo4j environment variables:', missing);
        return false;
    }

    console.log('✅ Neo4j environment variables validated');
    console.log('🔗 Neo4j URI:', process.env.NEO4J_URI?.replace(/\/\/.*@/, '//***@'));
    return true;
}

const PORT = parseInt(process.env.PORT || "8000", 10);
console.log('Final PORT:', PORT);

const app = express();

process.on('uncaughtException', (error) => {
    console.error('❌ UNCAUGHT EXCEPTION:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ UNHANDLED REJECTION:', reason);
    process.exit(1);
});

app.use("/api/v1/webhooks", webhookRouter);
app.use(express.json());

app.use(cors({
    origin: "https://creati.vercel.app"
}));

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

// Add Neo4j database health check endpoint
app.get("/health/database", async (req, res) => {
    try {
        const isConnected = await testConnection();

        if (isConnected) {
            res.status(200).json({
                status: "healthy",
                database: "neo4j",
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        } else {
            res.status(503).json({
                status: "unhealthy",
                database: "neo4j",
                error: "Connection failed",
                timestamp: new Date().toISOString()
            });
        }
    } catch (error: any) {
        res.status(503).json({
            status: "error",
            database: "neo4j",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// External keepalive trigger endpoint (for GitHub Actions)
app.post("/keepalive/trigger", async (req, res) => {
    try {
        console.log('🔄 External keepalive triggered (GitHub Actions)');

        const session = neo4jDriver.session();
        const startTime = Date.now();

        const result = await session.run('RETURN 1 as keepalive, datetime() as timestamp');
        const record = result.records[0];
        await session.close();

        const duration = Date.now() - startTime;
        const timestamp = record.get('timestamp');

        console.log('✅ Neo4j keepalive successful');
        console.log(`📊 Query executed in ${duration}ms`);
        console.log(`🕐 Database time: ${timestamp}`);

        res.status(200).json({
            status: "success",
            message: "Keepalive executed successfully",
            duration: `${duration}ms`,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('❌ External keepalive failed:', error.message);

        res.status(500).json({
            status: "error",
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/designs", authMiddleware, designsRouter);
app.use("/api/v1/profile", authMiddleware, profileRouter);
app.use("/api/v1/payment", authMiddleware, paymentRouter);

app.use(globalErrorHandler);

console.log('🚀 Starting server...');

// Simplified server startup function
async function startServer() {
    try {
        // Validate environment variables
        if (!validateNeo4jEnvironment()) {
            console.error('❌ Environment validation failed. Exiting...');
            process.exit(1);
        }

        // Start the server first
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

        // Test Neo4j connection after server starts (non-blocking)
        setTimeout(async () => {
            try {
                console.log('🔄 Testing Neo4j database connection...');
                const isConnected = await testConnection();

                if (isConnected) {
                    console.log('✅ Neo4j connection verified');
                    console.log('🤖 Using GitHub Actions for keepalive service');
                } else {
                    console.error('❌ Failed to connect to Neo4j database');
                    console.error('⚠️  Database operations may fail - check if instance is paused');
                }
            } catch (error) {
                console.error('Neo4j initialization error:', error);
            }
        }, 2000);

        // Simplified graceful shutdown
        const gracefulShutdown = async (signal: string) => {
            console.log(`🛑 ${signal} received, shutting down gracefully`);

            server.close(async () => {
                console.log('✅ Server closed');

                try {
                    console.log('🔄 Closing Neo4j driver...');
                    await neo4jDriver.close();
                    console.log('✅ Neo4j driver closed');
                } catch (error) {
                    console.error('❌ Error closing Neo4j driver:', error);
                }

                process.exit(0);
            });

            // Force exit if graceful shutdown takes too long
            setTimeout(() => {
                console.error('❌ Forced shutdown due to timeout');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
startServer().catch((error) => {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
});

console.log('📝 Server setup complete');
