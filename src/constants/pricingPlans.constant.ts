import { PlanType } from '../generated/prisma';

export interface PlanConfig {
    frontendId: string;
    dbPlanType: PlanType;
    title: string;
    priceIds: {
        monthly: string;
        yearly: string;
    };
    maxDesigns: number;
    isFree: boolean;
}

export const PLAN_CONFIGS: PlanConfig[] = [
    {
        frontendId: 'starter',
        dbPlanType: PlanType.FREE,
        title: 'Starter',
        priceIds: {
            monthly: "price_1Rv04OSsg21IEsaK7P0UvyZV",
            yearly: "price_1Rv04OSsg21IEsaK7P0UvyZV"
        },
        maxDesigns: 3,
        isFree: true
    },
    {
        frontendId: 'plus',
        dbPlanType: PlanType.PLUS,
        title: 'Plus',
        priceIds: {
            monthly: "price_1Rs5IOSsg21IEsaKPQhRl4aX",
            yearly: "price_1Rs5QcSsg21IEsaKymrRCdNw"
        },
        maxDesigns: 20,
        isFree: false
    },
    {
        frontendId: 'pro-plus',
        dbPlanType: PlanType.PRO_PLUS,
        title: 'Pro Plus',
        priceIds: {
            monthly: "price_1Rs5OqSsg21IEsaKMvE6F6dZ",
            yearly: "price_1Rs5RCSsg21IEsaKpbAWq3Du"
        },
        maxDesigns: -1,
        isFree: false
    }
];

export const PRICE_ID_TO_PLAN = new Map<string, PlanConfig>();
export const FRONTEND_ID_TO_PLAN = new Map<string, PlanConfig>();

PLAN_CONFIGS.forEach(plan => {
    PRICE_ID_TO_PLAN.set(plan.priceIds.monthly, plan);
    PRICE_ID_TO_PLAN.set(plan.priceIds.yearly, plan);
    FRONTEND_ID_TO_PLAN.set(plan.frontendId, plan);
});
