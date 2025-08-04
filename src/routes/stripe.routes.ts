import { Router } from 'express';
import StripeController from "../controllers/stripe.controllers";

export const paymentRouter = Router();

const stripeController = StripeController.getInstance();

paymentRouter.post("/create-checkout-session", stripeController.createCheckoutSession);
paymentRouter.get("/retrieve-session", stripeController.retrieveSession);
paymentRouter.get("/success", stripeController.success);
paymentRouter.get("/cancel", stripeController.cancel);