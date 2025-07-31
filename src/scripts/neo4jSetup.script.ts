import dotenv from "dotenv";
dotenv.config();

import neo4jDriver from "../services/neo4j.service";


async function createConstraints() {
    const session = neo4jDriver.session();
    try {
        console.log('Creating new constraints and indexes...');

        // 1. Ensure Node IDs are unique
        await session.run(`
            CREATE CONSTRAINT node_id_unique IF NOT EXISTS
            FOR (n:Node)
            REQUIRE n.id IS UNIQUE
        `);
        console.log('✅ Created constraint: node_id_unique');

        // 2. Ensure Edge IDs are unique
        await session.run(`
            CREATE CONSTRAINT edge_id_unique IF NOT EXISTS
            FOR (e:Edge)
            REQUIRE e.id IS UNIQUE
        `);
        console.log('✅ Created constraint: edge_id_unique');

        // 3. Index on userId for fast user-based queries on nodes
        await session.run(`
            CREATE INDEX node_user_id IF NOT EXISTS
            FOR (n:Node)
            ON (n.userId)
        `);
        console.log('✅ Created index: node_user_id');

        // 4. Index on userId for fast user-based queries on edges
        await session.run(`
            CREATE INDEX edge_user_id IF NOT EXISTS
            FOR (e:Edge)
            ON (e.userId)
        `);
        console.log('✅ Created index: edge_user_id');

        // 5. Index on designId for fast design-based queries on nodes
        await session.run(`
            CREATE INDEX node_design_id IF NOT EXISTS
            FOR (n:Node)
            ON (n.designId)
        `);
        console.log('✅ Created index: node_design_id');

        // 6. Index on designId for fast design-based queries on edges
        await session.run(`
            CREATE INDEX edge_design_id IF NOT EXISTS
            FOR (e:Edge)
            ON (e.designId)
        `);
        console.log('✅ Created index: edge_design_id');

        // 7. Composite index for userId + designId queries on nodes (for faster combined queries)
        await session.run(`
            CREATE INDEX node_user_design IF NOT EXISTS
            FOR (n:Node)
            ON (n.userId, n.designId)
        `);
        console.log('✅ Created composite index: node_user_design');

        // 8. Composite index for userId + designId queries on edges
        await session.run(`
            CREATE INDEX edge_user_design IF NOT EXISTS
            FOR (e:Edge)
            ON (e.userId, e.designId)
        `);
        console.log('✅ Created composite index: edge_user_design');

        console.log('🎉 All constraints and indexes created successfully!');

    } catch (e: any) {
        console.error("Error creating constraints and indexes:", e.message);
    } finally {
        await session.close();
        await neo4jDriver.close();
    }
}

createConstraints();
