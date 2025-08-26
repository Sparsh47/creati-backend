import {Request, Response} from "express";
import {ApplicationError} from "../lib/utils";
import {prismaClient} from "../services/prisma.service";
import {PaymentStatus, PlanType} from "@prisma/client";

export default class ProfileController {
    private static _instance: ProfileController;

    private constructor() {
    }

    public static getInstance() {
        if (!ProfileController._instance) {
            ProfileController._instance = new ProfileController();
        }
        return this._instance;
    }

    private getUserActiveSubscription = async (userId: string) => {
        return prismaClient.subscriptions.findFirst({
            where: {
                userId: userId,
                status: "ACTIVE"
            },
            orderBy: {
                createdAt: "desc"
            }
        });
    };

    async updateProfile(req: Request, res: Response) {
        try {
            const userId = req.user?.userId;
            const {name} = req.body;

            const user = await prismaClient.user.findUnique({where: {id: userId}});

            if(!user) {
                res.status(404).json({
                    status: false,
                    message: "User not found."
                });
                return;
            }

            await prismaClient.user.update({
                where: {
                    id: userId
                },
                data: {
                    name: name
                }
            });

            res.status(200).json({
                status: true,
                message: "Profile updated successfully.",
                data: {
                    name: name,
                    email: user.email
                }
            })

        } catch (e) {
            ApplicationError(e)
        }
    }

    getUserPlan = async (req: Request, res: Response) => {
        try {
            const userId = req.user?.userId;

            if(!userId) {
                res.status(404).json({
                    status: false,
                    message: "User not found."
                });
                return;
            }

            const currentPlan = await this.getUserActiveSubscription(userId);

            res.status(200).json({
                status: true,
                data: {
                    plan: currentPlan
                }
            })

        } catch (e) {
            ApplicationError(e)
        }
    }

    getProfile = async (req: Request, res: Response) => {
        try {
            const userId = req.user?.userId;

            const user = await prismaClient.user.findUnique({
                where: {
                    id: userId
                },
                include: {
                    subscriptions: {
                        orderBy: {
                            updatedAt: "desc",
                        },
                        where: {
                            planType: {
                                not: PlanType.FREE
                            }
                        },
                        take: 10
                    },
                    designs: true
                }
            });

            if(!user) {
                res.status(404).json({
                    status: false,
                    message: "User not found."
                });
                return;
            }

            const currentPlan = await this.getUserActiveSubscription(userId!);

            res.status(200).json({
                status: true,
                data: {
                    name: user.name,
                    email: user.email,
                    designs: user.designs,
                    subscriptions: user.subscriptions,
                    maxDesigns: user.maxDesigns,
                    plan: currentPlan
                }
            })
        } catch (e) {
            ApplicationError(e)
        }
    }
}