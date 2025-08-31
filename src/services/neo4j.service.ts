import neo4j, {Driver} from 'neo4j-driver';

const neo4jDriver: Driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(
        process.env.NEO4J_USERNAME!,
        process.env.NEO4J_PASSWORD!,
    )
);

export const testConnection = async (): Promise<boolean> => {
    try {
        const serverInfo = await neo4jDriver.getServerInfo();
        console.log('✅ Neo4j connection established successfully!');
        console.log('📊 Server info:', serverInfo);
        return true;
    } catch (error: any) {
        console.error('❌ Neo4j connection failed:', error.message);

        if (error.message.includes('ENOTFOUND')) {
            console.error('🔍 DNS Resolution Error: Cannot resolve hostname');
            console.error('   - Check NEO4J_URI environment variable');
        }

        if (error.code === 'ServiceUnavailable') {
            console.error('🔍 Service Unavailable: Database might be down');
        }

        return false;
    }
};

export default neo4jDriver;
