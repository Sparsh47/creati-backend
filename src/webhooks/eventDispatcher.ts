import Stripe from "stripe";
import {handleSubscriptionCreated, handleSubscriptionDeleted, handleSubscriptionUpdated} from "./handlers/subscription";
import {handlePaymentFailed, handlePaymentSucceeded} from "./handlers/payment";
import {handleCustomerDeleted, handleCustomerUpdated} from "./handlers/customer";

export const eventDispatcher = async (event: Stripe.Event) => {
    switch (event.type) {
        case "customer.subscription.created":
            await handleSubscriptionCreated(event.data.object);
            break;
        case "customer.subscription.updated":
            await handleSubscriptionUpdated(event.data.object);
            break;
        case "customer.subscription.deleted":
            await handleSubscriptionDeleted(event.data.object);
            break;
        case "invoice.payment_succeeded":
            await handlePaymentSucceeded(event.data.object);
            break;
        case "invoice.payment_failed":
            await handlePaymentFailed(event.data.object);
            break;
        case "customer.updated":
            await handleCustomerUpdated(event.data.object);
            break;
        case "customer.deleted":
            await handleCustomerDeleted(event.data.object);
            break;
        case 'payment_intent.succeeded':
        case 'charge.succeeded':
        case 'checkout.session.completed':
        case 'invoice.created':
        case 'invoice.finalized':
        case 'invoice.paid':
            console.log(`Event ${event.type} - no action needed`);
            break;
        default:
            console.log(`Event ${event.type} - not handled`);
    }
}