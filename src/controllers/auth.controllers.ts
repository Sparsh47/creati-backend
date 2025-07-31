import {Request, Response} from "express";
import {hash, compare} from "bcrypt";
import {loginSchema, registerSchema} from "../validations/auth.validations";
import {ApplicationError, generateAccessToken} from "../lib/utils";
import jwt from "jsonwebtoken";
import {issueRefreshToken, revokeRefreshToken, verifyRefreshToken} from "../services/redis.service";
import {prismaClient} from "../services/prisma.service";
import {verifyGoogleToken} from "../services/google.service";

export default class AuthController {

    private static _instance: AuthController;

    private constructor() {}

    public static getInstance(): AuthController {
        if (!AuthController._instance) {
            AuthController._instance = new AuthController();
        }
        return AuthController._instance;
    }

    async login(req: Request, res: Response){
        try {
            const {email, password} = req.body;

            const isValid = loginSchema.safeParse({
                email,
                password,
            });

            if(isValid.success) {
                const user = await prismaClient.user.findUnique({where: { email }});
                if(!user) {
                    res.status(401).json({
                        status: false,
                        message: "Account does not exist"
                    })
                } else {
                    const isPasswordCorrect = await compare(password, user.passwordHash!);
                    if(!isPasswordCorrect) {
                        res.status(401).json({
                            status: false,
                            message: "Invalid password"
                        })
                    } else {
                        const accessToken = generateAccessToken(user.id);

                        const token = await issueRefreshToken(user.id);
                        res.status(200).json({
                            status: true,
                            message: "Successfully logged in",
                            user,
                            accessToken,
                            refreshToken: token
                        })
                    }
                }
            } else {
                res.status(401).json({
                    status: false,
                    message: "Invalid email or password",
                })
            }

        } catch (e: any) {
            ApplicationError(e);
        }
    }

    async register(req: Request, res: Response){
        try {
            const {name, email, password} = req.body;

            const isValid = registerSchema.safeParse({
                name,
                email,
                password,
            });

            if(isValid.success) {
                const hashedPassword = await hash(password, 12);
                const user = await prismaClient.user.create({
                    data: {
                        name, email, passwordHash: hashedPassword,
                    }
                });

                const accessToken = generateAccessToken(user.id);

                const token = await issueRefreshToken(user.id);

                res.status(201).json({
                    status: true,
                    message: "User registered successfully",
                    user,
                    accessToken,
                    refreshToken: token
                });
            } else {
                res.status(401).json({
                    status: false,
                    message: "Invalid email or password format",
                })
            }
        } catch (e: any) {
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

    async oauth(req: Request, res: Response){
        try {
            const {name, email, googleAccessToken, googleRefreshToken} = req.body;

            if (!email || !name || !googleAccessToken) {
                return res.status(400).json({ message: "Missing required fields" });
            }

            const googleTokenInfo = await verifyGoogleToken(googleAccessToken);

            if (googleTokenInfo.email !== email) {
                return res.status(400).json({ message: "Token email mismatch" });
            }

            const user = await prismaClient.user.upsert({
                where: { email },
                update: { name },
                create: {
                    email,
                    name,
                    passwordHash: null,
                },
            });

            const accessToken = generateAccessToken(user.id);
            const refreshToken = await issueRefreshToken(user.id);

            res.status(200).json({
                status: true,
                message: "Successfully logged in via google",
                user: {id: user.id, name: user.name, email: user.email},
                accessToken,
                refreshToken,
            });

        } catch (e: any) {
            console.error('OAuth verification failed:', e);
            ApplicationError(e);
        }
    }

    async logout(req: Request, res: Response){
        try {
            const {refreshToken} = req.body;
            await revokeRefreshToken(refreshToken);

            res.status(200).json({
                status: true,
                message: "User logged out",
            })
        } catch (e: any) {
            ApplicationError(e);
        }
    }
}