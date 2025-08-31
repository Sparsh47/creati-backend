import neo4jDriver from "../services/neo4j.service";

class Neo4jKeepalive {
    private intervalId: NodeJS.Timeout | null = null;
    private readonly intervalHours: number;
    private isRunning: boolean = false;

    constructor(intervalHours: number = 24) {
        this.intervalHours = intervalHours;
    }

    async performKeepalive(): Promise<boolean> {
        try {
            console.log('🔄 Performing Neo4j keepalive...');

            const session = neo4jDriver.session();
            const startTime = Date.now();

            // Simple query that doesn't affect your data
            const result = await session.run('RETURN 1 as keepalive, datetime() as timestamp');
            const record = result.records[0];

            await session.close();

            const duration = Date.now() - startTime;
            const timestamp = record.get('timestamp');

            console.log('✅ Neo4j keepalive successful');
            console.log(`📊 Query executed in ${duration}ms`);
            console.log(`🕐 Database time: ${timestamp}`);

            return true;

        } catch (error: any) {
            console.error('❌ Neo4j keepalive failed:', error.message);

            // Log specific error types
            if (error.code === 'ServiceUnavailable') {
                console.error('🔍 Database may be paused or unreachable');
            }

            return false;
        }
    }

    start(): void {
        if (this.isRunning) {
            console.log('⚠️  Keepalive is already running');
            return;
        }

        console.log(`🚀 Starting Neo4j keepalive service (every ${this.intervalHours} hours)`);

        // Run immediately on start
        this.performKeepalive();

        // Schedule recurring keepalive
        const intervalMs = this.intervalHours * 60 * 60 * 1000;
        this.intervalId = setInterval(async () => {
            await this.performKeepalive();
        }, intervalMs);

        this.isRunning = true;
        console.log('✅ Keepalive service started');
    }

    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isRunning = false;
        console.log('🛑 Keepalive service stopped');
    }

    getStatus(): { isRunning: boolean; intervalHours: number; nextRun?: string } {
        return {
            isRunning: this.isRunning,
            intervalHours: this.intervalHours,
            nextRun: this.isRunning ?
                new Date(Date.now() + this.intervalHours * 60 * 60 * 1000).toISOString() :
                undefined
        };
    }
}

export const neo4jKeepalive = new Neo4jKeepalive(24); // Keep alive every 24 hours
export default Neo4jKeepalive;
