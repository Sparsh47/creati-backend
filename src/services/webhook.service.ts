import {prismaClient} from "./prisma.service";
import {WebhookStatus} from "@prisma/client";

export default class WebhookService {
    private static _instance: WebhookService

    private constructor() {}

    static getInstance = () => {
        if(!this._instance) {
            this._instance = new WebhookService();
        }
        return this._instance;
    }

    async exists(eventId: string){
        const count = await prismaClient.webhookEvents.count({
            where: {
                eventId
            }
        });

        return count > 0;
    }

    async create(eventId: string, eventType: string, payload: any) {
        return prismaClient.webhookEvents.create({
            data: {
                eventId,
                eventType,
                payload,
                status: WebhookStatus.PENDING
            }
        });
    }

    async markProcessed(eventId: string){
        return prismaClient.webhookEvents.update({
            where: {
                eventId
            },
            data: {
                status: WebhookStatus.PROCESSED,
                processedAt: new Date()
            }
        })
    }

    async markFailed(eventId: string, errorMessage: string){
        const event = await prismaClient.webhookEvents.findUnique({
            where: {
                eventId
            }
        });

        if(!event) {
            throw new Error(`WebhookEvent ${eventId} not found`);
        }

        return prismaClient.webhookEvents.update({
            where: {
                eventId
            },
            data: {
                status: WebhookStatus.FAILED,
                errorMessage,
                retryCount: event.retryCount + 1
            }
        })
    }

    async getFailedEvents() {
        return prismaClient.webhookEvents.findMany({
            where: {
                status: WebhookStatus.FAILED
            }
        })
    }
}