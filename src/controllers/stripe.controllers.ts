import { Request, Response } from "express";
import { ApplicationError } from "../lib/utils";
import Stripe from "stripe";
import { stripe } from "../services/stripe.service";
import { prismaClient } from "../services/prisma.service";
import { PlanValidator } from "../validations/plan.validations";
import { PaymentStatus, PlanType } from '@prisma/client';

export default class StripeController {
    private static _instance: StripeController;

    constructor() {}

    public static getInstance() {
        if(!StripeController._instance) {
            StripeController._instance = new StripeController();
        }
        return StripeController._instance;
    }

    private async getBillingPeriodDates(stripeSubscriptionId: string, stripePriceId: string) {
        try {
            const planDetails = PlanValidator.validatePriceId(stripePriceId);
            console.log('🔍 PlanValidator result:', planDetails);

            if (!planDetails) {
                throw new Error('Invalid price ID');
            }

            const billingCycle = planDetails.billingCycle;
            console.log('🔍 Billing cycle from PlanValidator:', billingCycle);

            const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
                expand: ['latest_invoice']
            });

            let periodStart: Date;
            let periodEnd: Date;

            // @ts-ignore
            if (subscription.latest_invoice && subscription.latest_invoice.period_start && subscription.latest_invoice.period_end) {

                // @ts-ignore
                const invoiceStart = new Date(subscription.latest_invoice.period_start * 1000);
                // @ts-ignore
                const invoiceEnd = new Date(subscription.latest_invoice.period_end * 1000);

                if (invoiceStart.getTime() !== invoiceEnd.getTime()) {
                    periodStart = invoiceStart;
                    periodEnd = invoiceEnd;
                } else {

                    periodStart = subscription.start_date
                        ? new Date(subscription.start_date * 1000)
                        : new Date();

                    periodEnd = new Date(periodStart.getTime());

                    if (billingCycle === 'monthly') {
                        periodEnd.setMonth(periodEnd.getMonth() + 1);
                    } else if (billingCycle === 'yearly') {
                        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
                    } else {
                        periodEnd.setMonth(periodEnd.getMonth() + 1);
                    }
                }

            } else {

                periodStart = subscription.start_date
                    ? new Date(subscription.start_date * 1000)
                    : new Date();

                periodEnd = new Date(periodStart.getTime());

                if (billingCycle === 'monthly') {
                    periodEnd.setMonth(periodEnd.getMonth() + 1);
                } else if (billingCycle === 'yearly') {
                    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
                } else {
                    periodEnd.setMonth(periodEnd.getMonth() + 1);
                }
            }

            return { periodStart, periodEnd };

        } catch (error) {
            console.error('❌ Error calculating billing period dates:', error);

            const now = new Date();
            const oneMonthLater = new Date(now.getTime());
            oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);

            console.log(`🔧 FALLBACK: ${now.toLocaleDateString()} to ${oneMonthLater.toLocaleDateString()}`);

            return {
                periodStart: now,
                periodEnd: oneMonthLater
            };
        }
    }

    private updateDatabaseAfterCheckout = async (
        userId: string,
        stripeSubscriptionId: string,
        stripeCustomerId: string,
        stripePriceId?: string
    ) => {
        if (!stripePriceId) return;

        try {
            const planDetails = PlanValidator.validatePriceId(stripePriceId);
            if (!planDetails) return;

            // ✅ Get accurate billing period using PlanValidator
            const { periodStart, periodEnd } = await this.getBillingPeriodDates(stripeSubscriptionId, stripePriceId);

            await prismaClient.$transaction(async (tx) => {
                const existingSubscription = await tx.subscriptions.findUnique({
                    where: { stripeSubscriptionId }
                });

                if (existingSubscription) {
                    console.log(`Subscription ${stripeSubscriptionId} already exists, skipping creation`);
                    return;
                }

                const existingSubs = await tx.subscriptions.findMany({
                    where: { userId, status: PaymentStatus.ACTIVE }
                });

                console.log(`Found ${existingSubs.length} existing active subscriptions to cancel`);

                if (existingSubs.length > 0) {
                    await tx.subscriptions.updateMany({
                        where: { userId, status: PaymentStatus.ACTIVE },
                        data: { status: PaymentStatus.CANCELLED, updatedAt: new Date() }
                    });
                }

                // ✅ Use calculated billing period dates
                await tx.subscriptions.create({
                    data: {
                        userId,
                        stripeSubscriptionId,
                        stripePriceId,
                        planType: planDetails.planConfig.dbPlanType,
                        status: PaymentStatus.ACTIVE,
                        currentPeriodStart: periodStart,
                        currentPeriodEnd: periodEnd,
                        cancelAtPeriodEnd: false,
                        expiresAt: null
                    }
                });

                console.log(`Created subscription: ${periodStart.toLocaleDateString()} to ${periodEnd.toLocaleDateString()}`);
            });

            const maxDesigns = planDetails.planConfig.maxDesigns === -1 ? 999999 : planDetails.planConfig.maxDesigns;
            await prismaClient.user.update({
                where: { id: userId },
                data: { maxDesigns, stripeCustomerId }
            });

            console.log(`Database updated after checkout for user ${userId}`);
        } catch (error) {
            console.error('Error updating database after checkout:', error);
            throw error;
        }
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
                    // @ts-ignore
                    session.subscription.id as string,
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

            if(currentSubscription?.stripePriceId === targetPriceId) {
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
                        status: PaymentStatus.CANCELLED,
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
                        status: PaymentStatus.CANCELLED,
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
                cancel_url: `${publicUrl}/pricing?cancelled=true`,
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
                    error: 'Invalid price id'
                });
            }

            const userId = req.user?.userId;
            const user = await prismaClient.user.findUnique({
                where: { id: userId },
                include: {
                    subscriptions: {
                        where: { status: PaymentStatus.ACTIVE },
                        take: 1
                    }
                }
            });

            if(!user || !user.subscriptions.length) {
                return res.status(400).json({
                    status: false,
                    error: "User not found or no active subscription"
                });
            }

            const currentSubscription = user.subscriptions[0];
            const subscriptionId = currentSubscription.stripeSubscriptionId;

            // ✅ Get current billing period end using PlanValidator
            const { periodEnd } = await this.getBillingPeriodDates(
                subscriptionId!,
                currentSubscription.stripePriceId!
            );

            // Cancel subscription in Stripe
            await stripe.subscriptions.update(subscriptionId!, {
                cancel_at_period_end: true
            });

            // ✅ Use the calculated period end date
            await prismaClient.subscriptions.update({
                where: { stripeSubscriptionId: subscriptionId! },
                data: {
                    cancelAtPeriodEnd: true,
                    expiresAt: periodEnd, // ✅ This will show the correct billing period end
                    status: PaymentStatus.ACTIVE,
                    updatedAt: new Date()
                }
            });

            console.log(`Plan cancelled for user ${userId}, expires: ${periodEnd.toLocaleDateString()}`);

            return res.status(200).json({
                status: true,
                message: 'Your plan will be canceled at the end of the billing period',
                data: {
                    cancelAtPeriodEnd: true,
                    expiresAt: periodEnd,
                    message: `You'll retain access until ${periodEnd.toLocaleDateString()}`
                }
            });

        } catch (e) {
            console.error('Cancel plan error:', e);
            return res.status(500).json({
                status: false,
                error: 'Failed to cancel subscription'
            });
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

            const planDetails = PlanValidator.validatePriceId(stripePriceId);
            if (!planDetails) {
                return res.status(400).json({
                    status: false,
                    error: 'Invalid price ID'
                });
            }

            const subscriptionId = typeof stripeSubscriptionId === 'string'
                ? stripeSubscriptionId
                : stripeSubscriptionId.id || stripeSubscriptionId;

            // ✅ Get accurate billing period using PlanValidator
            const { periodStart, periodEnd } = await this.getBillingPeriodDates(subscriptionId, stripePriceId);

            await prismaClient.$transaction(async (tx) => {
                const existingSubscription = await tx.subscriptions.findUnique({
                    where: { stripeSubscriptionId: subscriptionId }
                });

                if (existingSubscription) {
                    console.log(`Subscription ${subscriptionId} already exists, skipping creation`);
                    return;
                }

                const existingSubs = await tx.subscriptions.findMany({
                    where: { userId, status: PaymentStatus.ACTIVE }
                });

                if (existingSubs.length > 0) {
                    await tx.subscriptions.updateMany({
                        where: { userId, status: PaymentStatus.ACTIVE },
                        data: { status: PaymentStatus.CANCELLED, updatedAt: new Date() }
                    });
                }

                // ✅ Use calculated billing period dates
                await tx.subscriptions.create({
                    data: {
                        userId,
                        stripeSubscriptionId: subscriptionId,
                        stripePriceId,
                        planType: planDetails.planConfig.dbPlanType,
                        status: PaymentStatus.ACTIVE,
                        currentPeriodStart: periodStart,
                        currentPeriodEnd: periodEnd,
                        cancelAtPeriodEnd: false,
                        expiresAt: null
                    }
                });
            });

            const maxDesigns = planDetails.planConfig.maxDesigns === -1 ? 999999 : planDetails.planConfig.maxDesigns;
            await prismaClient.user.update({
                where: { id: userId },
                data: {
                    maxDesigns,
                    stripeCustomerId: stripeCustomerId || undefined
                }
            });

            return res.json({
                status: true,
                message: 'Checkout completed successfully',
                data: {
                    planType: planDetails.planConfig.dbPlanType,
                    maxDesigns,
                    billingCycle: planDetails.billingCycle
                }
            });

        } catch (error) {
            console.error('Error completing checkout:', error);
            return res.status(500).json({
                status: false,
                error: 'Failed to complete checkout'
            });
        }
    }

    reactivatePlan = async (req: Request, res: Response) => {
        try {
            const {priceId} = req.body;
            const userId = req.user?.userId;

            if (!priceId || !userId) {
                return res.status(400).json({
                    status: false,
                    error: 'Missing required parameters'
                });
            }

            const user = await prismaClient.user.findUnique({
                where: { id: userId },
                include: {
                    subscriptions: {
                        where: {
                            status: PaymentStatus.ACTIVE,
                            cancelAtPeriodEnd: true,
                        },
                        take: 1
                    }
                }
            })

            if(!user || !user.subscriptions.length) {
                return res.status(400).json({
                    status: false,
                    error: "No subscription found to reactivate"
                });
            }

            const subscription = user.subscriptions[0];

            const subscriptionId = subscription.stripeSubscriptionId

            if(!subscriptionId) {
                return res.status(400).json({
                    status: false,
                    error: "Cannot reactivate free plan"
                });
            }

            const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
                cancel_at_period_end: false
            });

            const {periodStart, periodEnd} = await this.getBillingPeriodDates(subscriptionId, subscription.stripePriceId!);

            await prismaClient.subscriptions.update({
                where: {
                    stripeSubscriptionId: subscriptionId
                },
                data: {
                    status: PaymentStatus.ACTIVE,
                    expiresAt: null,
                    cancelAtPeriodEnd: false,
                    currentPeriodStart: periodStart,
                    currentPeriodEnd: periodEnd,
                    updatedAt: new Date()
                }
            })

            console.log(`Subscription reactivated for user ${userId}, subscription ${subscriptionId}`);

            return res.status(200).json({
                status: true,
                message: 'Your subscription has been reactivated successfully',
                data: {
                    subscriptionStatus: PaymentStatus.ACTIVE,
                    cancelAtPeriodEnd: false,
                    currentPeriodEnd: periodEnd,
                    message: `Your ${subscription.planType} plan will continue until ${periodEnd.toLocaleDateString()}`
                }
            });
        } catch (e) {
            console.error('Error reactivating plan:', e);
            ApplicationError(e);
            return res.status(500).json({
                status: false,
                error: 'Failed to reactivate plan'
            });
        }
    }
}
