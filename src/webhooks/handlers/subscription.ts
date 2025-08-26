import {prismaClient} from "../../services/prisma.service";
import {PaymentStatus, PlanType} from "@prisma/client";
import Stripe from "stripe";
import {PlanValidator} from "../../validations/plan.validations";

export const handleSubscriptionCreated = async (subscription: Stripe.Subscription) => {
    console.log("Processing subscription created: ", subscription.id);

    try {
        const existingSubscription = await prismaClient.subscriptions.findUnique({
            where: {
                stripeSubscriptionId: subscription.id
            }
        })

        if(existingSubscription) {
            console.log(`Subscription ${subscription.id} already exists, skipping webhook creation`);
            return;
        }

        const user = await prismaClient.user.findFirst({
            where: {
                stripeCustomerId: subscription.customer as string
            }
        })

        if (!user) {
            console.error(`User not found for customer: ${subscription.customer}`);
            return;
        }

        if(!subscription.items.data.length) {
            console.error(`No subscription items found for: ${subscription.id}`);
        }

        const priceId = subscription.items.data[0].price.id;

        const planDetails = PlanValidator.validatePriceId(priceId);

        await prismaClient.$transaction(async (tx) => {
            await tx.subscriptions.updateMany({
                where: {
                    userId: user.id,
                    status: PaymentStatus.ACTIVE
                },
                data: {
                    status: PaymentStatus.CANCELLED,
                    updatedAt: new Date()
                }
            })

            await tx.subscriptions.create({
                data: {
                    userId: user.id,
                    stripeSubscriptionId: subscription.id,
                    stripePriceId: priceId,
                    planType: planDetails?.planConfig.dbPlanType!,
                    status: PaymentStatus.ACTIVE,
                    currentPeriodStart: new Date(subscription.start_date * 1000),
                    currentPeriodEnd: subscription.cancel_at ? new Date(subscription.cancel_at * 1000) : null,
                }
            })
        })
    } catch (error) {
        console.error('Error in handleSubscriptionCreated:', error);
        throw error;
    }
}

export const handleSubscriptionUpdated = async (subscription: any) => {
    console.log('Processing subscription updated:', subscription.id);

    try {
        const updateData: any = {
            updatedAt: new Date()
        };

        // ✅ FIXED: Get billing period with proper fallback
        let periodStart = null;
        let periodEnd = null;

        // Try to get from subscription fields first
        if (subscription.start_date) {
            periodStart = new Date(subscription.start_date * 1000);
        }

        if (subscription.cancel_at) {
            periodEnd = new Date(subscription.cancel_at * 1000);
        } else if (subscription.ended_at) {
            periodEnd = new Date(subscription.ended_at * 1000);
        } else {
            // ✅ Calculate based on monthly cycle as default
            if (periodStart) {
                periodEnd = new Date(periodStart.getTime());
                periodEnd.setMonth(periodEnd.getMonth() + 1);
            }
        }

        if (periodStart) updateData.currentPeriodStart = periodStart;
        if (periodEnd) updateData.currentPeriodEnd = periodEnd;

        if (subscription.cancel_at_period_end) {
            updateData.cancelAtPeriodEnd = true;
            updateData.status = PaymentStatus.ACTIVE; // Stay active until period ends
            updateData.expiresAt = periodEnd;

            console.log(`Subscription ${subscription.id} will expire on ${periodEnd?.toISOString()}`);
        }

        await prismaClient.subscriptions.update({
            where: { stripeSubscriptionId: subscription.id },
            data: updateData
        });

        console.log(`Successfully updated subscription ${subscription.id} with billing period`);

    } catch (error) {
        console.error(`Error updating subscription ${subscription.id}:`, error);
        throw error;
    }
};

export const handleSubscriptionDeleted = async (subscription: any) => {
    console.log('Processing subscription deleted (expired):', subscription.id);

    try {
        const userSubscription = await prismaClient.subscriptions.findFirst({
            where: {
                stripeSubscriptionId: subscription.id
            },
            include: {
                user: true
            }
        });

        if (!userSubscription) {
            console.error(`No subscription found for Stripe ID: ${subscription.id}`);
            return;
        }

        const userId = userSubscription.userId;

        await prismaClient.subscriptions.update({
            where: { id: userSubscription.id },
            data: {
                status: PaymentStatus.EXPIRED,
                endedAt: subscription.ended_at ? new Date(subscription.ended_at * 1000) : new Date(),
                cancelAtPeriodEnd: false,
                expiresAt: null
            }
        });

        const freeSubscription = await prismaClient.subscriptions.create({
            data: {
                userId,
                stripeSubscriptionId: null,
                stripePriceId: null,
                planType: PlanType.FREE,
                status: PaymentStatus.ACTIVE,
                currentPeriodEnd: null
            }
        });

        await prismaClient.user.update({
            where: { id: userId },
            data: {
                maxDesigns: 3
            }
        });

        console.log(`Successfully activated free plan for user ${userId}`);

    } catch (error) {
        console.error(`Error activating free plan for subscription ${subscription.id}:`, error);
        throw error;
    }
};