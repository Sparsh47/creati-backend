import {stripe} from "../../services/stripe.service";
import {Request, Response, NextFunction} from "express";

export const verifyStripeSignature = (req: Request, res: Response, next: NextFunction) => {
    try {
        const signature = req.headers['stripe-signature'] as string;
        const stripeEvent = stripe.webhooks.constructEvent(
            req.body,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET!
        )
        if(stripeEvent) {
            req.stripeEvent = stripeEvent;
            next();
        }
    } catch (e) {
        return res.status(400).json({
            status: false,
            error: "Webhook Error"
        })
    }
}