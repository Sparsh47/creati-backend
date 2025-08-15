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

    private async updateDatabaseAfterCheckout(
        userId: string,
        stripeSubscriptionId: string,
        stripeCustomerId: string,
        stripePriceId?: string
    ) {
        if (!stripePriceId) return;

        try {
            const planDetails = PlanValidator.validatePriceId(stripePriceId);
            if (!planDetails) return;

            const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);

            await prismaClient.subscriptions.updateMany({
                where: { userId, status: PaymentStatus.ACTIVE },
                data: { status: PaymentStatus.CANCELED, updatedAt: new Date() }
            });

            await prismaClient.subscriptions.create({
                data: {
                    userId,
                    stripeSubscriptionId,
                    stripePriceId,
                    planType: planDetails.planConfig.dbPlanType,
                    status: PaymentStatus.ACTIVE,
                    currentPeriodEnd: new Date(stripeSubscription.trial_end! * 1000)
                }
            });

            const maxDesigns = planDetails.planConfig.maxDesigns === -1 ? 999999 : planDetails.planConfig.maxDesigns;
            await prismaClient.user.update({
                where: { id: userId },
                data: { maxDesigns, stripeCustomerId }
            });

            console.log(`Database updated after checkout for user ${userId}`);
        } catch (error) {
            console.error('Error updating database after checkout:', error);
        }
    }

    /**
     * Create initial checkout session for new subscriptions
     */
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

    /**
     * Retrieve checkout session details
     */
    retrieveSession = async (req: Request, res: Response) => {
        try {
            const sessionId = req.query.session_id as string;
            const userId = req.user?.userId;

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

            if (userId && session.subscription && session.mode === 'subscription') {
                await this.updateDatabaseAfterCheckout(
                    userId,
                    session.subscription as string,
                    session.customer as string,
                    session.line_items?.data[0]?.price?.id
                );
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

    /**
     * Handle successful payment completion
     */
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

    /**
     * Handle cancelled payment
     */
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

            if(!userId) {
                return res.status(401).json({
                    status: false,
                    error: "User not authenticated"
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
                    try {
                        await stripe.subscriptions.cancel(currentSubscription.stripeSubscriptionId);
                    } catch (stripeError) {
                        console.error("Error cancelling Stripe subscription:", stripeError);
                    }
                }

                await prismaClient.subscriptions.updateMany({
                    where: {
                        userId,
                        status: PaymentStatus.ACTIVE
                    },
                    data: {
                        status: PaymentStatus.CANCELED,
                        updatedAt: new Date()
                    }
                });

                const freeSubscription = await prismaClient.subscriptions.create({
                    data: {
                        userId: userId as string,
                        stripeSubscriptionId: null,
                        stripePriceId: null,
                        planType: PlanType.FREE,
                        status: PaymentStatus.ACTIVE,
                        currentPeriodEnd: null
                    }
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
                        subscriptionStatus: PaymentStatus.ACTIVE,
                        subscriptionId: freeSubscription.id,
                        maxDesigns: planConfig.maxDesigns
                    }
                });
            }

            const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000';

            if(currentSubscription?.stripeSubscriptionId) {
                try {
                    await stripe.subscriptions.cancel(currentSubscription.stripeSubscriptionId);
                } catch (stripeError) {
                    console.error("Error cancelling existing subscription:", stripeError);
                }

                await prismaClient.subscriptions.updateMany({
                    where: {
                        userId,
                        status: PaymentStatus.ACTIVE
                    },
                    data: {
                        status: PaymentStatus.CANCELED,
                        updatedAt: new Date()
                    }
                });
            }

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
                    planChangeFlow: 'true',
                    targetPlanType: planConfig.dbPlanType,
                    previousPlanType: currentPlanType
                }
            };

            if (user.stripeCustomerId) {
                sessionConfig.customer = user.stripeCustomerId;
                delete sessionConfig.customer_email;
            }

            const session = await stripe.checkout.sessions.create(sessionConfig);

            return res.json({
                status: true,
                requiresCheckout: true,
                sessionId: session.id,
                message: 'Redirecting to secure payment',
                data: {
                    targetPlan: planConfig.dbPlanType,
                    billingCycle: billingCycle,
                    checkoutUrl: session.url
                }
            });

        } catch (e) {
            console.error('Plan change error:', e);
            ApplicationError(e);
            return res.status(500).json({
                status: false,
                error: 'PLAN_CHANGE_FAILED',
                message: e instanceof Error ? e.message : 'Unknown error occurred while changing plan'
            });
        }
    }

    async getCurrentUserPlan(req: Request, res: Response) {
        try {
            const userId = req.user?.userId;

            if (!userId) {
                return res.status(401).json({
                    status: false,
                    error: "User not authenticated"
                });
            }

            const user = await prismaClient.user.findUnique({
                where: { id: userId },
                include: {
                    subscriptions: {
                        where: { status: PaymentStatus.ACTIVE },
                        orderBy: { createdAt: 'desc' },
                        take: 1
                    }
                }
            });

            if (!user) {
                return res.status(404).json({
                    status: false,
                    error: "User not found"
                });
            }

            const currentSubscription = user.subscriptions[0];

            if (!currentSubscription) {
                const freeSubscription = await prismaClient.subscriptions.create({
                    data: {
                        userId: userId as string,
                        stripeSubscriptionId: null,
                        stripePriceId: null,
                        planType: PlanType.FREE,
                        status: PaymentStatus.ACTIVE,
                        currentPeriodEnd: null
                    }
                });

                return res.json({
                    status: true,
                    data: {
                        userId: user.id,
                        currentPlan: PlanType.FREE,
                        subscriptionStatus: PaymentStatus.ACTIVE,
                        hasStripeSubscription: false,
                        maxDesigns: user.maxDesigns || 3,
                        billingCycle: null,
                        subscriptionId: freeSubscription.id
                    }
                });
            }

            let billingCycle = null;
            if (currentSubscription.stripePriceId) {
                const planDetails = PlanValidator.validatePriceId(currentSubscription.stripePriceId);
                billingCycle = planDetails?.billingCycle || null;
            }

            return res.json({
                status: true,
                data: {
                    userId: user.id,
                    currentPlan: currentSubscription.planType,
                    subscriptionStatus: currentSubscription.status,
                    hasStripeSubscription: !!currentSubscription.stripeSubscriptionId,
                    maxDesigns: user.maxDesigns,
                    billingCycle: billingCycle,
                    subscriptionId: currentSubscription.id,
                    currentPeriodEnd: currentSubscription.currentPeriodEnd
                }
            });

        } catch (e) {
            console.error('Get user plan error:', e);
            ApplicationError(e);
            return res.status(500).json({
                status: false,
                error: 'Failed to get user plan information'
            });
        }
    }

    cancelPlan = async (req: Request, res: Response) => {
        try {
            const {priceId} = req.body;
            const isValidPriceId = PlanValidator.validatePriceId(priceId);

            if (!isValidPriceId) {
                return res.status(400).json({
                    status: false,
                    error: 'Invalid price id or price id is invalid'
                })
            }

            const userId = req.user?.userId;

            const user = await prismaClient.user.findUnique({
                where: { id: userId },
                include: {
                    subscriptions: {
                        where: {
                            status: PaymentStatus.ACTIVE,
                        },
                        take: 1
                    }
                }
            });

            if(!user) {
                return res.status(400).json({
                    status: false,
                    error: "User not found"
                })
            }

            const {planConfig, billingCycle} = isValidPriceId;
            const subscriptionId = user.subscriptions[0].stripeSubscriptionId;

            await stripe.subscriptions.update(subscriptionId!, {
                cancel_at_period_end: true
            })

        } catch (e) {
            ApplicationError(e);
        }
    }

    completeCheckout = async (req: Request, res: Response) => {
        try {
            const { stripeSubscriptionId, stripeCustomerId, stripePriceId } = req.body;
            const userId = req.user?.userId;

            if (!stripeSubscriptionId || !stripePriceId || !userId) {
                return res.status(400).json({
                    status: false,
                    error: 'Missing required parameters'
                });
            }

            console.log(`Completing checkout for user ${userId}, subscription ${stripeSubscriptionId}`);

            // **Validate price ID**
            const planDetails = PlanValidator.validatePriceId(stripePriceId);
            if (!planDetails) {
                return res.status(400).json({
                    status: false,
                    error: 'Invalid price ID'
                });
            }

            // **Fix: Ensure stripeSubscriptionId is a string**
            const subscriptionId = typeof stripeSubscriptionId === 'string'
                ? stripeSubscriptionId
                : stripeSubscriptionId.id || stripeSubscriptionId;

            console.log(`Retrieving subscription with ID: ${subscriptionId}`);

            // **Get subscription details from Stripe with correct ID**
            const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);

            if (stripeSubscription.status !== 'active') {
                return res.status(400).json({
                    status: false,
                    error: 'Subscription is not active'
                });
            }

            // **Fix: Cancel existing active subscriptions FIRST to avoid unique constraint violation**
            const existingSubscriptions = await prismaClient.subscriptions.findMany({
                where: {
                    userId,
                    status: PaymentStatus.ACTIVE
                }
            });

            console.log(`Found ${existingSubscriptions.length} existing active subscriptions to cancel`);

            // Cancel all existing active subscriptions
            if (existingSubscriptions.length > 0) {
                await prismaClient.subscriptions.updateMany({
                    where: {
                        userId,
                        status: PaymentStatus.ACTIVE
                    },
                    data: {
                        status: PaymentStatus.CANCELED,
                        updatedAt: new Date()
                    }
                });
                console.log(`Cancelled ${existingSubscriptions.length} existing subscriptions`);
            }

            // **Create new subscription record AFTER cancelling existing ones**
            const newSubscription = await prismaClient.subscriptions.create({
                data: {
                    userId,
                    stripeSubscriptionId: subscriptionId,
                    stripePriceId,
                    planType: planDetails.planConfig.dbPlanType,
                    status: PaymentStatus.ACTIVE,
                    currentPeriodEnd: new Date(stripeSubscription.trial_end! * 1000)
                }
            });

            console.log(`Created new subscription record: ${newSubscription.id}`);

            // **Update user's limits and customer ID**
            const maxDesigns = planDetails.planConfig.maxDesigns === -1 ? 999999 : planDetails.planConfig.maxDesigns;
            await prismaClient.user.update({
                where: { id: userId },
                data: {
                    maxDesigns,
                    stripeCustomerId: stripeCustomerId || undefined
                }
            });

            console.log(`Successfully completed checkout for user ${userId}`);

            return res.json({
                status: true,
                message: 'Checkout completed successfully',
                data: {
                    subscriptionId: newSubscription.id,
                    planType: planDetails.planConfig.dbPlanType,
                    maxDesigns,
                    billingCycle: planDetails.billingCycle
                }
            });

        } catch (error) {
            console.error('Error completing checkout:', error);
            ApplicationError(error);
            return res.status(500).json({
                status: false,
                error: 'Failed to complete checkout'
            });
        }
    }
}
