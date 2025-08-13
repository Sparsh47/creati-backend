import { Request, Response } from "express";
import { ApplicationError } from "../lib/utils";
import Stripe from "stripe";
import { stripe } from "../services/stripe.service";
import { prismaClient } from "../services/prisma.service";
import { PlanValidator } from "../validations/plan.validations";
import { PaymentStatus, PlanType } from '../generated/prisma';

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
            const publicUrl = process.env.PUBLIC_URL!;

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

    async createPlanChangeCheckout(req: Request, res: Response) {
        try {
            const { targetPriceId } = req.body;
            const userId = req.user?.userId;

            if (!targetPriceId) {
                return res.status(400).json({
                    status: false,
                    error: "Price Id not found"
                });
            }

            const planDetails = PlanValidator.validatePriceId(targetPriceId);
            if (!planDetails || planDetails.planConfig.isFree) {
                return res.status(400).json({
                    status: false,
                    error: "Invalid price ID for checkout"
                });
            }

            const user = await prismaClient.user.findUnique({
                where: { id: userId }
            });

            if (!user) {
                return res.status(400).json({
                    status: false,
                    error: "User not found"
                });
            }

            const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000';

            const sessionConfig: Stripe.Checkout.SessionCreateParams = {
                mode: "subscription",
                payment_method_types: ["card"],
                line_items: [{
                    price: targetPriceId,
                    quantity: 1,
                }],
                success_url: `${publicUrl}/success?session_id={CHECKOUT_SESSION_ID}&plan_change=true`,
                cancel_url: `${publicUrl}/pricing?canceled=true`,
                customer_email: user.email,
                metadata: {
                    userId: userId as string,
                    planChangeFlow: 'true'
                }
            };

            if (user.stripeCustomerId) {
                sessionConfig.customer = user.stripeCustomerId;
                delete sessionConfig.customer_email;
            }

            const session = await stripe.checkout.sessions.create(sessionConfig);

            res.status(201).json({
                status: true,
                sessionId: session.id,
            });

        } catch (e) {
            console.error("Stripe checkout error:", e);
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

            const customer = session.customer;

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

    async changePlan(req: Request, res: Response) {
        try {
            const { targetPriceId } = req.body;
            const userId = req.user?.userId;

            if(!targetPriceId) {
                return res.status(400).json({
                    status: false,
                    error: "Missing required parameters targetPriceId"
                });
            }

            const planDetails = PlanValidator.validatePriceId(targetPriceId);
            if (!planDetails) {
                return res.status(400).json({
                    status: false,
                    error: 'INVALID_PRICE_ID',
                    message: 'Selected plan is not available'
                });
            }

            const user = await prismaClient.user.findUnique({
                where: { id: userId },
                include: {
                    subscriptions: {
                        where: { status: PaymentStatus.ACTIVE },
                        orderBy: { updatedAt: 'desc' },
                        take: 1
                    }
                }
            });

            if(!user) {
                return res.status(400).json({
                    status: false,
                    error: "User not found"
                });
            }

            const { planConfig, billingCycle } = planDetails;
            const currentSubscription = user.subscriptions[0];
            const currentPlanType = currentSubscription?.planType || PlanType.FREE;

            if(currentPlanType === planConfig.dbPlanType) {
                return res.status(400).json({
                    status: false,
                    message: 'You are already on this plan'
                });
            }

            if(planConfig.isFree) {
                if(currentSubscription?.stripeSubscriptionId) {
                    await stripe.subscriptions.cancel(currentSubscription.stripeSubscriptionId);
                }

                await prismaClient.subscriptions.updateMany({
                    where: { userId, status: PaymentStatus.ACTIVE },
                    data: { status: PaymentStatus.CANCELED, updatedAt: new Date() }
                });

                await prismaClient.user.update({
                    where: { id: userId },
                    data: { maxDesigns: planConfig.maxDesigns }
                });

                return res.json({
                    status: true,
                    message: 'Successfully downgraded to free plan',
                    data: {
                        newPlan: PlanType.FREE,
                        billingCycle: null,
                        subscriptionStatus: PaymentStatus.CANCELED
                    }
                });
            }

            let stripeCustomerId = user.stripeCustomerId;

            if(!stripeCustomerId) {
                const customer = await stripe.customers.create({
                    email: user.email,
                    metadata: { userId: userId as string }
                });

                stripeCustomerId = customer.id;
                await prismaClient.user.update({
                    where: { id: userId },
                    data: { stripeCustomerId }
                });
            }

            const paymentMethods = await stripe.paymentMethods.list({
                customer: stripeCustomerId,
                type: 'card'
            });

            if (paymentMethods.data.length === 0) {
                return res.status(400).json({
                    status: false,
                    error: 'PAYMENT_METHOD_REQUIRED',
                    message: 'Payment method required for plan upgrade',
                    requiresCheckout: true
                });
            }

            if (currentSubscription?.stripeSubscriptionId) {
                const existingSubscription = await stripe.subscriptions.retrieve(currentSubscription.stripeSubscriptionId);

                const updatedSubscription = await stripe.subscriptions.update(
                    currentSubscription.stripeSubscriptionId,
                    {
                        items: [{
                            id: existingSubscription.items.data[0].id,
                            price: targetPriceId
                        }],
                        proration_behavior: 'create_prorations'
                    }
                );

                await prismaClient.subscriptions.update({
                    where: { id: currentSubscription.id },
                    data: {
                        stripePriceId: targetPriceId,
                        planType: planConfig.dbPlanType,
                        currentPeriodEnd: new Date(updatedSubscription.trial_end! * 1000),
                        updatedAt: new Date()
                    }
                });
            } else {
                const newSubscription = await stripe.subscriptions.create({
                    customer: stripeCustomerId,
                    items: [{price: targetPriceId}],
                    default_payment_method: paymentMethods.data[0].id,
                    metadata: { userId: userId as string }
                });

                await prismaClient.subscriptions.updateMany({
                    where: { userId, status: PaymentStatus.ACTIVE },
                    data: { status: PaymentStatus.CANCELED, updatedAt: new Date() }
                });

                await prismaClient.subscriptions.create({
                    data: {
                        userId: userId as string,
                        stripeSubscriptionId: newSubscription.id,
                        stripePriceId: targetPriceId,
                        planType: planConfig.dbPlanType,
                        status: PaymentStatus.ACTIVE,
                        currentPeriodEnd: new Date(newSubscription.trial_end! * 1000)
                    }
                });
            }

            const maxDesigns = planConfig.maxDesigns === -1 ? 999999 : planConfig.maxDesigns;
            await prismaClient.user.update({
                where: { id: userId },
                data: { maxDesigns }
            });

            return res.json({
                status: true,
                message: 'Plan updated successfully',
                data: {
                    newPlan: planConfig.dbPlanType,
                    billingCycle,
                    subscriptionStatus: PaymentStatus.ACTIVE,
                    nextBillingDate: currentSubscription?.stripeSubscriptionId ?
                        new Date((await stripe.subscriptions.retrieve(currentSubscription.stripeSubscriptionId)).trial_end! * 1000) :
                        null
                }
            });

        } catch (e) {
            console.error('Plan change error:', e);
            ApplicationError(e);
            return res.status(500).json({
                status: false,
                error: 'Failed to change plan',
                message: e instanceof Error ? e.message : 'Unknown error occurred'
            });
        }
    }
}
