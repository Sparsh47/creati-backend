import { prismaClient } from '../../services/prisma.service';
import { PaymentStatus } from '../../generated/prisma';

export const handlePaymentSucceeded = async (invoice: any) => {
    console.log('Processing payment succeeded:', invoice.id);

    if (!invoice.subscription) return;

    try {
        const periodStart = invoice.period_start ? new Date(invoice.period_start * 1000) : null;
        const periodEnd = invoice.period_end ? new Date(invoice.period_end * 1000) : null;

        await prismaClient.subscriptions.update({
            where: { stripeSubscriptionId: invoice.subscription },
            data: {
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
                lastPaymentAt: new Date(),
                status: PaymentStatus.ACTIVE,
                updatedAt: new Date()
            }
        });

        console.log(`Updated subscription ${invoice.subscription} with new billing period: ${periodStart} to ${periodEnd}`);

    } catch (error) {
        console.error(`Error updating subscription after payment ${invoice.id}:`, error);
        throw error;
    }
};

export const handlePaymentFailed = async (invoice: any) => {
    console.log('Processing payment failed:', invoice.id);

    if (!invoice.subscription) return;

    try {
        const subscription = await prismaClient.subscriptions.findFirst({
            where: { stripeSubscriptionId: invoice.subscription },
            include: { user: true }
        });

        if (subscription) {
            console.log(`Payment failed for user ${subscription.user.email}`);
        }
    } catch (error) {
        console.error(`Error handling payment failure ${invoice.id}:`, error);
    }
};
