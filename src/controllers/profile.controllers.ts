import {Request, Response} from "express";
import {ApplicationError} from "../lib/utils";
import {prismaClient} from "../services/prisma.service";

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

    async updateProfile(req: Request, res: Response) {
        try {
            const {userId} = req.params;
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

    async getProfile(req: Request, res: Response) {
        try {
            const {userId} = req.params;

            const user = await prismaClient.user.findUnique({where: {id: userId}});

            if(!user) {
                res.status(404).json({
                    status: false,
                    message: "User not found."
                });
                return;
            }

            res.status(200).json({
                status: true,
                data: {
                    name: user.name,
                    email: user.email
                }
            })
        } catch (e) {
            ApplicationError(e)
        }
    }
}