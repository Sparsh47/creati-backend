import { createClient } from "redis";
import crypto from "crypto";
import { ApplicationError } from "../lib/utils";

export const redisClient = createClient({
    url: process.env.REDIS_URL!,
});

redisClient.on("error", (err) => {
    console.error("Redis Client Error", err);
});

(async () => {
    await redisClient.connect();
    console.log("Redis Client Connected!");
})();

export async function issueRefreshToken(userId: string) {
    try {
        const token = crypto.randomUUID();
        await redisClient.set(`refresh:${token}`, userId, { EX: 30 * 24 * 60 * 60 });
        return token;
    } catch (e: any) {
        ApplicationError(e);
    }
}

export async function verifyRefreshToken(oldToken: string) {
    try {
        const userId = await redisClient.get(`refresh:${oldToken}`);
        if(!userId) {
            return null;
        } else {
            await redisClient.del(`refresh:${oldToken}`);
            const newToken = await issueRefreshToken(userId);
            return {userId, newToken};
        }
    } catch (e: any) {
        ApplicationError(e);
    }
}

export async function revokeRefreshToken(token: string) {
    try {
        await redisClient.del(`refresh:${token}`);
    } catch (e: any) {
        ApplicationError(e);
    }
}