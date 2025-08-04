import {Request, Response} from "express";
import {ApplicationError} from "../lib/utils";
import Stripe from "stripe";
import {stripe} from "../services/stripe.service";

export default class StripeController {
    private static _instance: StripeController;

    constructor() {}

    public static getInstance() {
        if(!StripeController._instance) {
            StripeController._instance = new StripeController();
        }
        return StripeController._instance;
    }

    async createCheckoutSession(req: Request, res: Response) {
        const { priceId } = req.body;

        if (!priceId) {
            return res.status(400).json({
                status: false,
                error: "Price Id not found"
            });
        }

        try {
            const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000';

            const session: Stripe.Checkout.Session = await stripe.checkout.sessions.create({
                mode: "subscription",
                payment_method_types: ["card"],
                line_items: [{
                    price: priceId,
                    quantity: 1,
                }],
                success_url: `${publicUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${publicUrl}/cancel?session_id={CHECKOUT_SESSION_ID}`,
            });

            res.status(201).json({
                status: true,
                sessionId: session.id,
            });
        } catch (e) {
            console.error("Stripe error:", e);
            ApplicationError(e);
            res.status(500).json({
                status: false,
                error: "Failed to create checkout session"
            });
        }
    }

    async retrieveSession(req: Request, res: Response) {
        try {
            const sessionId = req.query.session_id as string;

            if(!sessionId) {
                return res.status(404).json({
                    status: false,
                    error: "Session id not found"
                });
            }

            const session = await stripe.checkout.sessions.retrieve(sessionId, {
                expand: ['line_items', 'subscription', 'invoice', 'invoice.payment_intent']
            });

            let paymentIntent = null;

            if (session.invoice) {
                // @ts-ignore
                const paymentIntentId = (session.invoice as Stripe.Invoice)['payment_intent'] as string | null;

                if (paymentIntentId) {
                    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
                }
            }

            res.status(200).json({
                status: true,
                session: session,
                paymentIntent: paymentIntent
            });

        } catch (e) {
            console.error("Failed to retrieve session:", e);
            ApplicationError(e);
            res.status(500).json({
                status: false,
                error: "Failed to retrieve session details."
            });
        }
    }

    async success(req: Request, res: Response) {
        try {
            res.status(200).json({
                status: true,
                message: "Successfully created! Redirecting...",
            })
        } catch (e) {
            ApplicationError(e);
        }
    }

    async cancel(req: Request, res: Response) {
        try {
            res.json({
                status: false,
                message: "Cancelled!",
            })
        } catch (e) {
            ApplicationError(e);
        }
    }
}