import neo4j, {Driver} from 'neo4j-driver';

const neo4jDriver: Driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(
        process.env.NEO4J_USERNAME!,
        process.env.NEO4J_PASSWORD!,
    )
)

export default neo4jDriver;