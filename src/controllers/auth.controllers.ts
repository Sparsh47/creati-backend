import { Request, Response } from "express";
import { hash, compare } from "bcrypt";
import { loginSchema, registerSchema } from "../validations/auth.validations";
import { ApplicationError, generateAccessToken } from "../lib/utils";
import {
    issueRefreshToken,
    revokeRefreshToken,
    verifyRefreshToken,
} from "../services/redis.service";
import { prismaClient } from "../services/prisma.service";
import { verifyGoogleToken } from "../services/google.service";
import {PaymentStatus, PlanType} from "@prisma/client";

export default class AuthController {
    private static _instance: AuthController;

    private constructor() {}

    public static getInstance(): AuthController {
        if (!AuthController._instance) {
            AuthController._instance = new AuthController();
        }
        return AuthController._instance;
    }

    private createFreeSubscription = async (userId: string) => {
        try {
            const existingFreeSubscription = await prismaClient.subscriptions.findFirst({
                where: {
                    userId: userId,
                    planType: PlanType.FREE,
                    status: PaymentStatus.ACTIVE
                }
            });

            if (existingFreeSubscription) {
                console.log("User already has an active free subscription");
                return existingFreeSubscription;
            }

            const subscription = await prismaClient.subscriptions.create({
                data: {
                    userId: userId,
                    stripeSubscriptionId: null,
                    stripePriceId: null,
                    status: PaymentStatus.ACTIVE,
                    planType: PlanType.FREE,
                    currentPeriodEnd: null
                },
            });

            return subscription;
        } catch (error) {
            console.error("Failed to create free subscription:", error);
            throw error;
        }
    };

    async login(req: Request, res: Response) {
        try {
            const { email, password } = req.body;

            const isValid = loginSchema.safeParse({
                email,
                password,
            });

            if (!isValid.success) {
                return res.status(401).json({
                    status: false,
                    message: "Invalid email or password",
                });
            }

            const user = await prismaClient.user.findUnique({
                where: { email },
                include: {
                    subscriptions: {
                        where: { status: "ACTIVE" },
                        orderBy: { createdAt: "desc" }
                    }
                }
            });

            if (!user) {
                return res.status(401).json({
                    status: false,
                    message: "Account does not exist",
                });
            }

            const isPasswordCorrect = await compare(password, user.passwordHash!);
            if (!isPasswordCorrect) {
                return res.status(401).json({
                    status: false,
                    message: "Invalid password",
                });
            }

            const accessToken = generateAccessToken(user.id);
            const token = await issueRefreshToken(user.id);

            return res.status(200).json({
                status: true,
                message: "Successfully logged in",
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    maxDesigns: user.maxDesigns,
                    currentPlan: user.subscriptions[0]?.planType || "FREE"
                },
                accessToken,
                refreshToken: token,
            });
        } catch (e: any) {
            ApplicationError(e);
        }
    }

    register = async (req: Request, res: Response) => {
        try {
            const { name, email, password } = req.body;

            const isValid = registerSchema.safeParse({
                name,
                email,
                password,
            });

            if (!isValid.success) {
                return res.status(401).json({
                    status: false,
                    message: "Invalid email or password format",
                });
            }

            const hashedPassword = await hash(password, 12);

            const user = await prismaClient.user.create({
                data: {
                    name,
                    email,
                    maxDesigns: 3,
                    passwordHash: hashedPassword,
                },
            });

            await this.createFreeSubscription(user.id);

            const accessToken = generateAccessToken(user.id);
            const token = await issueRefreshToken(user.id);

            return res.status(201).json({
                status: true,
                message: "User registered successfully with free plan",
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    maxDesigns: user.maxDesigns,
                    currentPlan: "FREE",
                },
                accessToken,
                refreshToken: token,
            });
        } catch (e: any) {
            console.error("Registration error:", e);
            ApplicationError(e);
        }
    };

    async oauth(req: Request, res: Response) {
        try {
            const { name, email, googleAccessToken } = req.body;

            if (!email || !name || !googleAccessToken) {
                return res.status(400).json({ message: "Missing required fields" });
            }

            const googleTokenInfo = await verifyGoogleToken(googleAccessToken);

            if (googleTokenInfo.email !== email) {
                return res.status(400).json({ message: "Token email mismatch" });
            }

            let user = await prismaClient.user.findUnique({
                where: { email },
                include: {
                    subscriptions: {
                        where: { status: "ACTIVE" },
                        orderBy: { createdAt: "desc" }
                    }
                }
            });
            let isNewUser = false;

            if (user) {
                user = await prismaClient.user.update({
                    where: { email },
                    data: { name },
                    include: {
                        subscriptions: {
                            where: { status: "ACTIVE" },
                            orderBy: { createdAt: "desc" }
                        }
                    }
                });
            } else {
                user = await prismaClient.user.create({
                    data: {
                        email,
                        name,
                        maxDesigns: 3,
                        passwordHash: null,
                    },
                    include: {
                        subscriptions: true
                    }
                });
                isNewUser = true;
            }

            if (isNewUser) {
                await this.createFreeSubscription(user.id);
            }

            const accessToken = generateAccessToken(user.id);
            const refreshToken = await issueRefreshToken(user.id);

            return res.status(200).json({
                status: true,
                message: isNewUser
                    ? "Successfully registered via Google with free plan"
                    : "Successfully logged in via Google",
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    maxDesigns: user.maxDesigns,
                    currentPlan: user.subscriptions[0]?.planType || "FREE"
                },
                accessToken,
                refreshToken,
            });
        } catch (e: any) {
            console.error("OAuth verification failed:", e);
            ApplicationError(e);
        }
    }

    async refresh(req: Request, res: Response) {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ error: "refreshToken is required" });
        }

        try {
            const result = await verifyRefreshToken(refreshToken);
            if (!result) {
                return res.status(401).json({ error: "Invalid or expired refresh token" });
            }
            const { userId, newToken } = result;

            const accessToken = generateAccessToken(userId);

            return res.status(200).json({
                accessToken,
                refreshToken: newToken,
            });
        } catch (err) {
            console.error("Unexpected error in refresh:", err);
            return res.status(500).json({ error: "Internal server error" });
        }
    }

    async logout(req: Request, res: Response) {
        try {
            const { refreshToken } = req.body;
            await revokeRefreshToken(refreshToken);

            return res.status(200).json({
                status: true,
                message: "User logged out",
            });
        } catch (e: any) {
            ApplicationError(e);
        }
    }
}