import { Router } from 'express';
import StripeController from "../controllers/stripe.controllers";

export const paymentRouter = Router();

const stripeController = StripeController.getInstance();

paymentRouter.post("/create-checkout-session", stripeController.createCheckoutSession);
paymentRouter.get("/retrieve-session", stripeController.retrieveSession);
paymentRouter.get("/success", stripeController.success);
paymentRouter.get("/cancel", stripeController.cancel);
paymentRouter.post("/cancel-plan", stripeController.cancelPlan);
paymentRouter.post("/change", stripeController.changePlan);
paymentRouter.get('/current-plan', stripeController.getCurrentUserPlan);
paymentRouter.post("/reactivate-plan", stripeController.reactivatePlan);
paymentRouter.post('/complete-checkout', stripeController.completeCheckout);
