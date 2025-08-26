import express from "express";
import {verifyStripeSignature} from "./middlewares/verifySignature";
import Stripe from "stripe";
import WebhookService from "../services/webhook.service";
import {eventDispatcher} from "./eventDispatcher";

export const stripeRouter = express.Router();

const webhookService = WebhookService.getInstance()

stripeRouter.post("/", verifyStripeSignature, async (req, res) => {
    res.status(200).json({
        received: true
    })

    setImmediate(()=>processWebhookEvent(req.stripeEvent))
});

const processWebhookEvent = async (event: Stripe.Event) => {
    try {

        if(await webhookService.exists(event.id)) {
            console.log(`Duplicate event with id ${event.id}, skipping`);
            return;
        }

        await webhookService.create(event.id, event.type, event);

        await eventDispatcher(event);

        await webhookService.markProcessed(event.id);

    } catch (e: any) {
        console.error(`Failed to process webhook ${event.id}:`, e);
        await webhookService.markFailed(event.id, e.message);
    }
}